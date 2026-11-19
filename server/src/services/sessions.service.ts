// Session（会话）的读写服务层：提供会话列表、创建、改标题、查详情、删除

import type { AgentRunStatus, AgentLoopStopReason, SessionDetail, SessionMessage, SessionSummary, SessionToolCall } from "@suagent/shared/session";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";

// 查询包含配置与类型派生
const sessionDetailInclude = {
    runs: {
        orderBy: { sequence: "asc" }, // run 按时间正序
        include: {
            messages: { orderBy: { createdAt: "asc" } },
            toolCalls: { orderBy: { sequence: "asc" } }
        }
    }
} satisfies Prisma.SessionInclude;

type SessionWithRuns = Prisma.SessionGetPayload<{
    include: typeof sessionDetailInclude;
}>;

// 错误类型
export class SessionServiceError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "SessionServiceError";
    }
}

// 摘要转换
function toSessionSummary(session: {
    id: string;
    title: string;
    createdAt: Date;
    lastActivityAt: Date;
}): SessionSummary {
    return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),  // Date → ISO 字符串
        lastActivityAt: session.lastActivityAt.toISOString()
    };
}

// 类型守卫
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 停止原因校验 ；白名单校验 + 类型收窄
function toAgentLoopStopReason(value: string | null): AgentLoopStopReason | null {
    switch (value) {
        case "completed":
        case "interrupted":
        case "model_round_limit":
        case "tool_call_limit":
        case "repeated_tool_failure":
        case "tool_recovery_limit":
        case "error":
            return value;
        default:
            return null;
    }
}

// 核心：toSessionDetail；把"session → runs → messages + toolCalls"的数据库嵌套结构，拍平成前端可直接渲染的消息流
function toSessionDetail(session: SessionWithRuns): SessionDetail {
    // 遍历 run，逐 run 处理
    const messages: SessionMessage[] = [];

    for (const run of session.runs) {    // runs 已按 sequence asc
        // 消息排序：user 永远在 agent 前
        const sortedMessages = [...run.messages].sort((a, b) => {
            if (a.role === b.role) {
                return a.createdAt.getTime() - b.createdAt.getTime();  // 同角色按时间
            }

            return a.role === "user" ? -1 : 1; // user 排前
        });
        
        for (const message of sortedMessages) {
            // user 消息：直接映射
            if (message.role === "user") {
                messages.push({
                    id: message.id,
                    runId: run.id,
                    role: "user",
                    content: message.content,
                    createdAt: message.createdAt.toISOString()
                });
                continue;
            }

            // agent 消息：挂上该 run 的全部工具调用
            const toolCalls: SessionToolCall[] = run.toolCalls.map((toolCall) => {
                if (!isRecord(toolCall.arguments)) {
                    throw new Error(`Tool call ${toolCall.id} has invalid arguments`);
                }

                return {
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    modelRound: toolCall.modelRound,
                    arguments: toolCall.arguments,
                    status: toolCall.status,
                    ...(toolCall.result === null ? {} : { result: toolCall.result }),
                    ...(toolCall.errorMessage === null ? {} : { errorMessage: toolCall.errorMessage }),
                    startedAt: toolCall.startedAt.toISOString(),
                    finishedAt: toolCall.finishedAt?.toISOString() ?? null
                };
            });

            // 组装 agent 消息（带 run 元数据）
            const runStatus: AgentRunStatus = run.status;
            messages.push({
                id: message.id,
                runId: run.id,
                role: "agent",
                content: message.content,
                thinking: message.thinking ?? "",
                toolCalls,
                runStatus,
                modelRounds: run.modelRounds,
                toolCallCount: run.toolCallCount,
                stopReason: toAgentLoopStopReason(run.stopReason),
                error: run.errorCode && run.errorMessage
                    ? { code: run.errorCode, message: run.errorMessage }
                    : null,
                createdAt: message.createdAt.toISOString()
            });
        }
    }

    return {
        ...toSessionSummary(session),
        messages
    };
}

// CRUD 函数

// 最近活跃倒序（最新对话在前），映射为摘要
export async function listSessions(): Promise<SessionSummary[]> {
    const sessions = await prisma.session.findMany({
        orderBy: { lastActivityAt: "desc" }
    });
    return sessions.map(toSessionSummary);
}

// 返回完整 session 对象直接喂给 toSessionSummary
export async function createSession(): Promise<SessionSummary> {
    const session = await prisma.session.create({ data: {} });
    return toSessionSummary(session);
}

// 先查存在再更新
export async function updateSessionTitle(
    id: string,
    title: string
): Promise<SessionSummary> {
    const session = await prisma.session.findUnique({
        where: { id },
        select: { id: true }
    });
    if (!session) {
        throw new SessionServiceError("Session not found", 404);
    }

    const updatedSession = await prisma.session.update({
        where: { id },
        data: {
            title,
            lastActivityAt: new Date()
        }
    });
    return toSessionSummary(updatedSession);
}

// 复用 sessionDetailInclude（satisfies 定义的那份），保证查询形状与 SessionWithRuns 类型精确匹配
export async function getSession(id: string): Promise<SessionDetail> {
    const session = await prisma.session.findUnique({
        where: { id },
        include: sessionDetailInclude
    });
    if (!session) {
        throw new SessionServiceError("Session not found", 404);
    }
    return toSessionDetail(session);
}

// 同样"先查后删"以保证 404 语义清晰
export async function deleteSession(id: string): Promise<void> {
    const session = await prisma.session.findUnique({
        where: { id },
        select: { id: true }
    });
    if (!session) {
        throw new SessionServiceError("Session not found", 404);
    }

    await prisma.session.delete({ where: { id } });
}
