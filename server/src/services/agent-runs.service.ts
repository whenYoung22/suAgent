import type { AgentEvent } from "@suagent/shared";
import type { AgentRunStatus } from "@suagent/shared/session";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { singleToolCallScenario } from "../scenarios/single-tool-call.js";
import { multiToolCallScenario } from "../scenarios/multi-tool-call.js";
import { toolFailureScenario } from "../scenarios/tool-failure.js";
import { streamErrorScenario } from "../scenarios/stream-error.js";
import {
    DeepSeekServiceError,
    streamDeepSeekCompletion
} from "./deepseek.service.js";
import type { DeepSeekMessage } from "./deepseek.service.js";
import {
    agentToolDefinitions,
    executeAgentTool
} from "./agent-tools.service.js";
import {
    beginModelRound,
    createAgentLoopState,
    getToolBatchStopReason,
    getToolCallSignature,
    MAX_MODEL_ROUNDS,
    MAX_TOOL_CALLS,
    recordToolBatchResults,
    recordToolCallStarted
} from "./agent-loop-state.js";
import type {
    AgentLoopBudgetStopReason,
    AgentLoopToolCall
} from "./agent-loop-state.js";

const DEEPSEEK_SYSTEM_PROMPT =
    "请直接使用 Markdown 格式回答。不要将整段普通回答包在代码围栏中；只有实际代码片段才使用代码围栏。" +
    "查询天气时，city 和 region 请使用 Open-Meteo 可识别的英文名或拼音（例如 Changsha、Hunan）；country 如需填写，必须使用 ISO 3166-1 alpha-2 两位代码（例如 CN），不要使用三位代码；" +
    "工具调用失败后可以修正参数重试一次；不要重复同一工具和相同参数，修正仍失败时停止调用工具并说明原因。";

const scenarios = {
    "1": { name: "single-tool-call", createEvents: singleToolCallScenario },
    "2": { name: "multi-tool-call", createEvents: multiToolCallScenario },
    "3": { name: "tool-failure", createEvents: toolFailureScenario },
    "4": { name: "stream-error", createEvents: streamErrorScenario }
} as const;

type Scenario = (typeof scenarios)[keyof typeof scenarios];
type AgentProvider = "mock" | "deepseek";
type RunInput =
    | { prompt: string; provider: "mock"; scenario: Scenario }
    | { prompt: string; provider: "deepseek" };

export class AgentRunServiceError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "AgentRunServiceError";
    }
}

export interface CreatedRun {
    id: string;
    sessionId: string;
    prompt: string;
    provider: AgentProvider;
    conversation: DeepSeekMessage[];
}

interface ActiveRun {
    controller: AbortController;
    completion: Promise<void>;
    complete: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

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

function getScenario(prompt: unknown): { prompt: string; scenario: Scenario } {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new AgentRunServiceError("Prompt is required", 400);
    }

    const normalizedPrompt = prompt.trim();
    const scenario = scenarios[normalizedPrompt as keyof typeof scenarios];
    if (!scenario) {
        throw new AgentRunServiceError("Prompt must be 1, 2, 3, or 4", 400);
    }

    return { prompt: normalizedPrompt, scenario };
}

function getAgentProvider(): AgentProvider {
    const provider = process.env.AGENT_PROVIDER?.trim() || "mock";
    if (provider !== "mock" && provider !== "deepseek") {
        throw new AgentRunServiceError(
            "AGENT_PROVIDER must be either mock or deepseek",
            500
        );
    }
    return provider;
}

function getRunInput(input: unknown): RunInput {
    const provider = getAgentProvider();
    if (provider === "mock") {
        const { prompt, scenario } = getScenario(input);
        return { prompt, provider, scenario };
    }
    if (typeof input !== "string" || input.trim().length === 0) {
        throw new AgentRunServiceError("Prompt is required", 400);
    }
    return { prompt: input.trim(), provider };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonInputValue(value: unknown): value is Prisma.InputJsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value !== null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value);
    }

    if (Array.isArray(value)) {
        return value.every((item) => item === null || isJsonInputValue(item));
    }

    return isRecord(value) && Object.values(value).every(
        (item) => item === null || isJsonInputValue(item)
    );
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) {
        return Prisma.JsonNull;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error("Value cannot be serialized as JSON");
    }

    const parsed: unknown = JSON.parse(serialized);
    if (!isJsonInputValue(parsed)) {
        throw new Error("Value contains unsupported JSON data");
    }

    return parsed;
}

function toToolResultMessage(result: unknown, error: string | null): string {
    const value = error ? { error } : result ?? null;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error("Tool result cannot be serialized as JSON");
    }
    return serialized;
}

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
            onAbort();
            return;
        }
        timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, 600);
    });
}

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

export async function createRun(sessionId: string, input: unknown): Promise<CreatedRun> {
    const runInput = getRunInput(input);
    const { prompt, provider } = runInput;
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true }
    });
    if (!session) {
        throw new AgentRunServiceError("Session not found", 404);
    }

    const { run, conversation } = await prisma.$transaction(async (transaction) => {
        const updatedSession = await transaction.session.update({
            where: { id: session.id },
            data: {
                lastRunSequence: { increment: 1 },
                lastActivityAt: new Date()
            },
            select: { lastRunSequence: true }
        });

        const previousRuns = provider === "deepseek"
            ? await transaction.agentRun.findMany({
                where: {
                    sessionId: session.id,
                    status: "completed",
                    scenario: "deepseek"
                },
                orderBy: { sequence: "desc" },
                take: 10,
                include: {
                    messages: { orderBy: { createdAt: "asc" } },
                    toolCalls: { orderBy: { sequence: "asc" } }
                }
            })
            : [];

        const createdRun = await transaction.agentRun.create({
            data: {
                sessionId: session.id,
                sequence: updatedSession.lastRunSequence,
                scenario: runInput.provider === "mock"
                    ? runInput.scenario.name
                    : "deepseek"
            }
        });

        await transaction.message.create({
            data: {
                runId: createdRun.id,
                role: "user",
                content: prompt
            }
        });
        await transaction.message.create({
            data: {
                runId: createdRun.id,
                role: "agent",
                content: "",
                thinking: ""
            }
        });

        const conversation: DeepSeekMessage[] = [];
        for (const previousRun of previousRuns.reverse()) {
            const userMessage = previousRun.messages.find((message) => message.role === "user");
            if (userMessage) {
                conversation.push({ role: "user", content: userMessage.content });
            }

            const toolCallBatches: Array<typeof previousRun.toolCalls> = [];
            for (const toolCall of previousRun.toolCalls) {
                const previousBatch = toolCallBatches[toolCallBatches.length - 1];
                if (toolCall.modelRound > 0 &&
                    previousBatch?.[0]?.modelRound === toolCall.modelRound) {
                    previousBatch.push(toolCall);
                } else {
                    toolCallBatches.push([toolCall]);
                }
            }

            for (const toolCallBatch of toolCallBatches) {
                conversation.push({
                    role: "assistant",
                    content: null,
                    tool_calls: toolCallBatch.map((toolCall) => {
                        const argumentsJson = JSON.stringify(toolCall.arguments);
                        if (argumentsJson === undefined) {
                            throw new Error(`Tool call ${toolCall.id} arguments cannot be serialized`);
                        }
                        return {
                            id: toolCall.toolCallId,
                            type: "function" as const,
                            function: {
                                name: toolCall.toolName,
                                arguments: argumentsJson
                            }
                        };
                    })
                });
                for (const toolCall of toolCallBatch) {
                    conversation.push({
                        role: "tool",
                        tool_call_id: toolCall.toolCallId,
                        content: toToolResultMessage(
                            toolCall.result,
                            toolCall.errorMessage
                        )
                    });
                }
            }

            const agentMessage = previousRun.messages.find((message) => message.role === "agent");
            if (agentMessage?.content) {
                conversation.push({ role: "assistant", content: agentMessage.content });
            }
        }

        return { run: createdRun, conversation };
    });

    return {
        id: run.id,
        sessionId: session.id,
        prompt,
        provider,
        conversation
    };
}

export async function executeRun(
    run: CreatedRun,
    connectionSignal: AbortSignal,
    onEvent: (event: AgentEvent) => void
): Promise<void> {
    const activeRun = createActiveRun();
    const abortFromConnection = () => activeRun.controller.abort();
    connectionSignal.addEventListener("abort", abortFromConnection, { once: true });
    if (connectionSignal.aborted) {
        activeRun.controller.abort();
    }
    activeRuns.set(run.id, activeRun);

    const loopState = createAgentLoopState();

    try {
        const scenario = run.provider === "mock"
            ? getScenario(run.prompt).scenario
            : null;
        const toolCallSequences = new Map<string, number>();
        let nextToolCallSequence = 0;
        let content = "";
        let thinking = "";

        const emitRunEvent = async (event: AgentEvent): Promise<void> => {
            if (activeRun.controller.signal.aborted) {
                throw new Error("Run interrupted");
            }
            if (event.type === "thinking") {
                thinking += event.data.content;
                await prisma.message.update({
                    where: { runId_role: { runId: run.id, role: "agent" } },
                    data: { thinking }
                });
            } else if (event.type === "token") {
                content += event.data.content;
                await prisma.message.update({
                    where: { runId_role: { runId: run.id, role: "agent" } },
                    data: { content }
                });
            } else if (event.type === "tool_call") {
                nextToolCallSequence += 1;
                const nextToolCallCount = loopState.toolCallCount + 1;
                await prisma.$transaction([
                    prisma.toolCall.create({
                        data: {
                            runId: run.id,
                            toolCallId: event.data.toolCallId,
                            sequence: nextToolCallSequence,
                            modelRound: loopState.modelRounds,
                            toolName: event.data.toolName,
                            arguments: toPrismaJson(event.data.arguments)
                        }
                    }),
                    prisma.agentRun.update({
                        where: { id: run.id },
                        data: { toolCallCount: nextToolCallCount }
                    })
                ]);
                recordToolCallStarted(loopState);
                toolCallSequences.set(event.data.toolCallId, nextToolCallSequence);
            } else if (event.type === "tool_result") {
                if (!toolCallSequences.has(event.data.toolCallId)) {
                    throw new Error(`Unknown tool call: ${event.data.toolCallId}`);
                }

                await prisma.toolCall.update({
                    where: {
                        runId_toolCallId: {
                            runId: run.id,
                            toolCallId: event.data.toolCallId
                        }
                    },
                    data: {
                        status: event.data.success ? "succeeded" : "failed",
                        ...(event.data.result === undefined
                            ? {}
                            : { result: toPrismaJson(event.data.result) }),
                        errorMessage: event.data.error ?? null,
                        finishedAt: new Date()
                    }
                });
            } else if (event.type === "done") {
                loopState.stopReason = "completed";
                await prisma.agentRun.update({
                    where: { id: run.id },
                    data: {
                        status: "completed",
                        finishedAt: new Date(),
                        modelRounds: loopState.modelRounds,
                        toolCallCount: loopState.toolCallCount,
                        stopReason: loopState.stopReason
                    }
                });
            } else if (event.type === "error") {
                loopState.stopReason = "error";
                await prisma.agentRun.update({
                    where: { id: run.id },
                    data: {
                        status: "failed",
                        finishedAt: new Date(),
                        errorCode: event.data.code,
                        errorMessage: event.data.message,
                        modelRounds: loopState.modelRounds,
                        toolCallCount: loopState.toolCallCount,
                        stopReason: loopState.stopReason
                    }
                });
            }

            if (activeRun.controller.signal.aborted) {
                throw new Error("Run interrupted");
            }

            await prisma.session.update({
                where: { id: run.sessionId },
                data: { lastActivityAt: new Date() }
            });
            if (activeRun.controller.signal.aborted) {
                throw new Error("Run interrupted");
            }
            onEvent(event);
            if (activeRun.controller.signal.aborted) {
                throw new Error("Run interrupted");
            }
        };

        if (scenario) {
            for (const event of scenario.createEvents()) {
                await waitForNextEvent(activeRun.controller.signal);
                await emitRunEvent(event);
                if (event.type === "done" || event.type === "error") {
                    break;
                }
            }
            return;
        }

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
                    await emitRunEvent({ type: "token", data: { content: token } });
                }
                await emitRunEvent({ type: "done" });
                return;
            }

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
                await emitRunEvent({
                    type: "tool_call",
                    data: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        arguments: toolArguments
                    }
                });

                const execution = parsedArguments.error
                    ? { success: false, error: parsedArguments.error }
                    : await executeAgentTool(
                        toolCall.name,
                        toolArguments,
                        activeRun.controller.signal
                    );
                const resultEvent: AgentEvent = {
                    type: "tool_result",
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
                await emitRunEvent(resultEvent);
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
        await activeRun.completion;
    } else {
        const currentRun = await prisma.agentRun.findUnique({
            where: { id: run.id },
            select: { status: true }
        });
        if (currentRun?.status === "running") {
            await persistInterruptedRun(run.id);
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
