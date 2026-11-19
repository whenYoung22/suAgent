// Agent Loop 执行、取消和中断处理
// 是整个 Agent 系统的引擎核心：驱动"模型调用 → 工具执行 → 再模型调用"的循环，
// 同时处理取消/中断这一分布式系统里最棘手的部分——连接断开、用户主动取消、进程内运行时取消三种来源的统一协调

import type { AgentEvent } from "@suagent/shared";
import type { AgentRunStatus } from "@suagent/shared/session";

import { prisma } from "../db/prisma.js";

import { DeepSeekServiceError, streamDeepSeekCompletion } from "./deepseek-client.js";
import type { DeepSeekMessage } from "./deepseek-client.js";

import { AgentRunServiceError, getScenario } from "./create-agent-run.js";
import type { CreatedRun } from "./create-agent-run.js";

import { toToolResultMessage } from "./agent-run-serialization.js";

import { AgentRunEventWriter } from "./agent-run-events.js";

import { agentToolDefinitions, executeAgentTool } from "../agent-tools/index.js";

import { beginModelRound, createAgentLoopState, getToolBatchStopReason, getToolCallSignature, MAX_MODEL_ROUNDS, MAX_TOOL_CALLS, recordToolBatchResults } from "./agent-loop-policy.js";
import type { AgentLoopBudgetStopReason, AgentLoopToolCall } from "./agent-loop-policy.js";

// 系统提示词
const DEEPSEEK_SYSTEM_PROMPT =
    "请直接使用 Markdown 格式回答。不要将整段普通回答包在代码围栏中；只有实际代码片段才使用代码围栏。" +
    "查询天气时，city 和 region 请使用 Open-Meteo 可识别的英文名或拼音（例如 Changsha、Hunan）；country 如需填写，必须使用 ISO 3166-1 alpha-2 两位代码（例如 CN），不要使用三位代码；" +
    "工具调用失败后可以修正参数重试一次；不要重复同一工具和相同参数，修正仍失败时停止调用工具并说明原因。";

// 活动运行注册表
interface ActiveRun {
    controller: AbortController;   // 取消信号源
    completion: Promise<void>;     // 运行结束的完成信号
    complete: () => void;          // 手动 resolve completion
}

const activeRuns = new Map<string, ActiveRun>();

// 辅助函数

// 预算停止 → 领域错误
function createLoopLimitError(reason: AgentLoopBudgetStopReason): DeepSeekServiceError {
    switch (reason) {
        case "model_round_limit":
            return new DeepSeekServiceError(
                "AGENT_LOOP_LIMIT_REACHED",
                `The Agent reached the maximum of ${MAX_MODEL_ROUNDS} model requests before completing the response.`
            );
        case "tool_call_limit":
            return new DeepSeekServiceError(
                "AGENT_TOOL_CALL_LIMIT_REACHED",
                `The Agent reached the maximum of ${MAX_TOOL_CALLS} tool calls for this run.`
            );
        case "repeated_tool_failure":
            return new DeepSeekServiceError(
                "AGENT_REPEATED_TOOL_FAILURE",
                "The Agent stopped because the same tool call failed more than once."
            );
        case "tool_recovery_limit":
            return new DeepSeekServiceError(
                "AGENT_TOOL_RECOVERY_LIMIT",
                "The Agent could not recover from the tool failure after one correction attempt."
            );
    }
}

// 此守卫只负责 Agent Loop 对模型返回值的结构检查，不依赖工具参数校验模块。
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 安全解析工具参数
function parseToolArguments(rawArguments: string): {
    arguments: Record<string, unknown>;
    error?: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(rawArguments);
    } catch {
        return {
            arguments: {},
            error: "Tool arguments were not valid JSON."
        };
    }
    if (!isRecord(value)) {
        return {
            arguments: {},
            error: "Tool arguments must be a JSON object."
        };
    }
    return { arguments: value };
}

// 建立 ActiveRun
function createActiveRun(): ActiveRun {
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
        complete = resolve;
    });

    return {
        controller: new AbortController(),
        completion,
        complete
    };
}

// 可中断的定时等待
function waitForNextEvent(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error("Run interrupted"));
            return;
        }

        let timer: ReturnType<typeof setTimeout> | null = null;
        const onAbort = () => {
            if (timer) {
                clearTimeout(timer);
            }
            signal.removeEventListener("abort", onAbort);
            reject(new Error("Run interrupted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
            onAbort();  // 竞态兜底
            return;
        }
        timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, 600);
    });
}

// 中断落库
async function persistInterruptedRun(runId: string): Promise<void> {
    const finishedAt = new Date();
    await prisma.$transaction([
        prisma.toolCall.updateMany({
            where: { runId, status: "running" },
            data: {
                status: "failed",
                errorMessage: "Run interrupted",
                finishedAt
            }
        }),
        prisma.agentRun.update({
            where: { id: runId },
            data: {
                status: "interrupted",
                finishedAt,
                stopReason: "interrupted"
            }
        })
    ]);
}

export async function executeRun(
    run: CreatedRun,
    connectionSignal: AbortSignal, //外部信号（HTTP 连接断开）
    onEvent: (event: AgentEvent) => void
): Promise<void> {
    // 建立取消基础设施；两层 AbortController 设计是关键
    const activeRun = createActiveRun();
    const abortFromConnection = () => activeRun.controller.abort();
    connectionSignal.addEventListener("abort", abortFromConnection, { once: true });
    if (connectionSignal.aborted) {
        activeRun.controller.abort();
    }
    activeRuns.set(run.id, activeRun);

    const loopState = createAgentLoopState();

    try {
        // mock 分支：带节奏回放
        const scenario = run.provider === "mock"
            ? getScenario(run.prompt).scenario
            : null;
        const eventWriter = new AgentRunEventWriter(
            run.id,
            run.sessionId,
            activeRun.controller.signal, //run 内部统一信号;多个取消源汇聚到单一内部信号，内部代码只监听一个 signal
            loopState,
            onEvent
        );

        if (scenario) {
            for (const event of scenario.createEvents()) {
                await waitForNextEvent(activeRun.controller.signal);
                await eventWriter.emit(event);
                if (event.type === "done" || event.type === "error") {
                    break;
                }
            }
            return;
        }

        // deepseek 主循环
        const messages: DeepSeekMessage[] = [
            { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
            ...run.conversation,
            { role: "user", content: run.prompt }
        ];

        while (true) {
            const roundLimit = beginModelRound(loopState);
            if (roundLimit) {
                loopState.stopReason = roundLimit;
                throw createLoopLimitError(roundLimit);
            }
            await prisma.agentRun.update({
                where: { id: run.id },
                data: { modelRounds: loopState.modelRounds }
            });

            const roundTokens: string[] = [];
            // 每轮请求都提供当前白名单定义；模型只提出调用意图，工具仍由本服务端执行。
            const completion = await streamDeepSeekCompletion(
                messages,
                agentToolDefinitions,
                activeRun.controller.signal,
                async (token) => {
                    roundTokens.push(token);
                }
            );

            if (completion.toolCalls.length === 0) {
                for (const token of roundTokens) {
                    await eventWriter.emit({ type: "token", data: { content: token } });
                }
                await eventWriter.emit({ type: "done" });
                return;
            }

            // 将模型给出的参数 JSON 安全解析，并先统一检查本批调用是否违反循环预算/纠错策略。
            const parsedToolCalls = completion.toolCalls.map((toolCall) => {
                const parsedArguments = parseToolArguments(toolCall.rawArguments);
                const policyCall: AgentLoopToolCall = {
                    name: toolCall.name,
                    arguments: parsedArguments.arguments
                };
                return {
                    toolCall,
                    parsedArguments,
                    policyCall
                };
            });
            const batchStopReason = getToolBatchStopReason(
                loopState,
                parsedToolCalls.map(({ policyCall }) => policyCall)
            );
            if (batchStopReason) {
                loopState.stopReason = batchStopReason;
                throw createLoopLimitError(batchStopReason);
            }

            const assistantToolCalls = completion.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function" as const,
                function: {
                    name: toolCall.name,
                    arguments: toolCall.rawArguments
                }
            }));
            messages.push({
                role: "assistant",
                content: completion.content || null,
                tool_calls: assistantToolCalls
            });

            const toolResults: Array<{
                role: "tool";
                tool_call_id: string;
                content: string;
            }> = [];
            const toolCallOutcomes: Array<AgentLoopToolCall & { success: boolean }> = [];
            for (const { toolCall, parsedArguments, policyCall } of parsedToolCalls) {
                const toolArguments = parsedArguments.arguments;
                // 先发布调用事件，再通过白名单分发器执行；无效 JSON 会作为失败结果交还给模型修正。
                await eventWriter.emit({
                    type: "tool_call",
                    data: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        arguments: toolArguments
                    }
                });

                const execution = parsedArguments.error
                    ? { success: false, error: parsedArguments.error }
                    : await executeAgentTool( //服务端执行工具
                        toolCall.name,
                        toolArguments,
                        activeRun.controller.signal
                    );
                const resultEvent: AgentEvent = {
                    type: "tool_result",  //包装成 tool_result 事件并写进后续模型上下文
                    data: {
                        toolCallId: toolCall.id,
                        success: execution.success,
                        ...(execution.result === undefined
                            ? {}
                            : { result: execution.result }),
                        ...(execution.error === undefined
                            ? {}
                            : { error: execution.error })
                    }
                };
                await eventWriter.emit(resultEvent);
                toolCallOutcomes.push({
                    ...policyCall,
                    success: execution.success
                });
                toolResults.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toToolResultMessage(
                        execution.result,
                        execution.error ?? null
                    )
                });
            }
            recordToolBatchResults(loopState, toolCallOutcomes);
            // 按 tool_call_id 把每个执行结果追加到上下文，下一轮模型才能据此回答或继续调用工具。
            messages.push(...toolResults);
        }
    } catch (error) {
        if (activeRun.controller.signal.aborted) {
            loopState.stopReason = "interrupted";
            try {
                await persistInterruptedRun(run.id);
            } catch (persistError) {
                console.error("Session run interruption persistence error:", persistError);
                throw persistError;
            }
            return;
        }

        const runError = error instanceof DeepSeekServiceError
            ? { code: error.code, message: error.message }
            : { code: "INTERNAL_ERROR", message: "Agent stream failed" };
        loopState.stopReason = loopState.stopReason ?? "error";
        const finishedAt = new Date();
        await prisma.$transaction([
            prisma.toolCall.updateMany({
                where: { runId: run.id, status: "running" },
                data: {
                    status: "failed",
                    errorMessage: runError.message,
                    finishedAt
                }
            }),
            prisma.agentRun.update({
                where: { id: run.id },
                data: {
                    status: "failed",
                    finishedAt,
                    errorCode: runError.code,
                    errorMessage: runError.message,
                    modelRounds: loopState.modelRounds,
                    toolCallCount: loopState.toolCallCount,
                    stopReason: loopState.stopReason
                }
            })
        ]);
        if (activeRun.controller.signal.aborted) {
            try {
                await persistInterruptedRun(run.id);
            } catch (persistError) {
                console.error("Session run interruption persistence error:", persistError);
                throw persistError;
            }
            return;
        }
        if (error instanceof DeepSeekServiceError) {
            await prisma.session.update({
                where: { id: run.sessionId },
                data: { lastActivityAt: new Date() }
            });
            onEvent({ type: "error", data: runError });
            return;
        }
        throw error;
    } finally {
        connectionSignal.removeEventListener("abort", abortFromConnection);
        activeRuns.delete(run.id);
        activeRun.complete();
    }
}

// 取消入口
export async function cancelRun(
    sessionId: string,
    runId: string
): Promise<{ runId: string; status: AgentRunStatus }> {
    const run = await prisma.agentRun.findFirst({
        where: { id: runId, sessionId },
        select: { id: true }
    });
    if (!run) {
        throw new AgentRunServiceError("Run not found", 404);
    }

    const activeRun = activeRuns.get(run.id);
    if (activeRun) {
        activeRun.controller.abort();
        await activeRun.completion;      // 等 run 真正结束
    } else {
        const currentRun = await prisma.agentRun.findUnique({
            where: { id: run.id },
            select: { status: true }
        });
        if (currentRun?.status === "running") {
            await persistInterruptedRun(run.id);   // 无活跃实例但卡 running → 直接落库
        }
    }

    const completedRun = await prisma.agentRun.findUnique({
        where: { id: run.id },
        select: { id: true, status: true }
    });
    if (!completedRun) {
        throw new AgentRunServiceError("Run not found", 404);
    }
    if (completedRun.status === "running") {
        throw new AgentRunServiceError("Run interruption was not persisted", 500);
    }

    return { runId: completedRun.id, status: completedRun.status };
}
