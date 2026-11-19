// Agent 系统的入口层：输入校验、创建 run、组装历史上下文;
// 连接了"前端请求"和"LLM 循环"，是整个 Agent 的起点

import { prisma } from "../db/prisma.js";
import { singleToolCallScenario } from "../scenarios/single-tool-call.js";
import { multiToolCallScenario } from "../scenarios/multi-tool-call.js";
import { toolFailureScenario } from "../scenarios/tool-failure.js";
import { streamErrorScenario } from "../scenarios/stream-error.js";
import type { DeepSeekMessage } from "./deepseek-client.js";
import { toToolResultMessage } from "./agent-run-serialization.js";

// mock场景注册表
const scenarios = {
    "1": { name: "single-tool-call", createEvents: singleToolCallScenario },
    "2": { name: "multi-tool-call", createEvents: multiToolCallScenario },
    "3": { name: "tool-failure", createEvents: toolFailureScenario },
    "4": { name: "stream-error", createEvents: streamErrorScenario }
} as const;

type Scenario = (typeof scenarios)[keyof typeof scenarios];

// 输入类型：按 provider 分流的可辨识联合
type AgentProvider = "mock" | "deepseek";

type RunInput =
    | { prompt: string; provider: "mock"; scenario: Scenario }
    | { prompt: string; provider: "deepseek" };

// 角色映射
const sessionRoleToDeepSeekRole = {
    user: "user",
    agent: "assistant"
} as const;

// 数据库内的角色命名（user / agent）与 DeepSeek API 的角色命名（user / assistant）不同;这里用一个映射表转换，把"存储域"和"协议域"的词汇解耦
type SessionMessageRole = keyof typeof sessionRoleToDeepSeekRole; // "user" | "agent"

function toDeepSeekRole(role: SessionMessageRole): "user" | "assistant" {
    return sessionRoleToDeepSeekRole[role];
}

// 错误类型
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

// 输入校验：getScenario 与 getRunInput
export function getScenario(prompt: unknown): {
    prompt: string;
    scenario: Scenario;
} {
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

// 分流入口
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

// 核心：createRun
export async function createRun(sessionId: string, input: unknown): Promise<CreatedRun> {
    // 前置检查
    const runInput = getRunInput(input);
    const { prompt, provider } = runInput;
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true }
    });
    if (!session) {
        throw new AgentRunServiceError("Session not found", 404);
    }

    // 事务：保证一致性；整个"递增序列号 → 查历史 → 创建 run → 写消息 → 组装上下文"放在一个事务里
    const { run, conversation } = await prisma.$transaction(async (transaction) => {
        // 原子递增序列号
        const updatedSession = await transaction.session.update({
            where: { id: session.id },
            data: {
                lastRunSequence: { increment: 1 },
                lastActivityAt: new Date()
            },
            select: { lastRunSequence: true }
        });

        // 仅 deepseek 才查历史
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

        // 创建 run + 两条消息;新 run 立刻写入两条消息：user 消息 = 当前 prompt;agent 消息 = 空的占位符（content: "", thinking: ""）
        const createdRun = await transaction.agentRun.create({
            data: {
                sessionId: session.id,
                sequence: updatedSession.lastRunSequence,
                scenario: runInput.provider === "mock"
                    ? runInput.scenario.name
                    : "deepseek"
            }
        });

        // 组装历史上下文
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
        // .reverse() 后变成时间正序（最旧在前），符合对话的自然时序
        for (const previousRun of previousRuns.reverse()) {
            // 重建用户消息
            const userMessage = previousRun.messages.find((message) => message.role === "user");
            if (userMessage) {
                conversation.push({
                    role: toDeepSeekRole(userMessage.role),
                    content: userMessage.content
                });
            }
            // 按 modelRound 把工具调用分组
            const toolCallBatches: Array<typeof previousRun.toolCalls> = [];
            for (const toolCall of previousRun.toolCalls) {
                const previousBatch = toolCallBatches[toolCallBatches.length - 1];
                if (toolCall.modelRound > 0 &&
                    previousBatch?.[0]?.modelRound === toolCall.modelRound) {
                    previousBatch.push(toolCall); // 同一轮 → 追加到当前批
                } else {
                    toolCallBatches.push([toolCall]); // 新的一轮 → 开新批
                }
            }

            // 每批还原成 assistant(tool_calls) + 多条 tool 结果
            for (const toolCallBatch of toolCallBatches) {
                conversation.push({
                    role: "assistant",
                    content: null,     // 有工具调用时 content 为 null
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

            // 还原最终 agent 文本回复；"用户提问 → 若干轮工具调用及其结果 → 助手最终回答"，完整还原了一次 run 的对话轨迹
            const agentMessage = previousRun.messages.find((message) => message.role === "agent");
            if (agentMessage?.content) {
                conversation.push({
                    role: toDeepSeekRole(agentMessage.role),
                    content: agentMessage.content
                });
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
