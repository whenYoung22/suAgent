import type {
    AgentRunStatus,
    SessionDetail,
    SessionMessage,
    SessionSummary,
    SessionToolCall
} from "@suagent/shared/session";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const sessionDetailInclude = {
    runs: {
        orderBy: { sequence: "asc" },
        include: {
            messages: { orderBy: { createdAt: "asc" } },
            toolCalls: { orderBy: { sequence: "asc" } }
        }
    }
} satisfies Prisma.SessionInclude;

type SessionWithRuns = Prisma.SessionGetPayload<{
    include: typeof sessionDetailInclude;
}>;

export class SessionServiceError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "SessionServiceError";
    }
}

function toSessionSummary(session: {
    id: string;
    title: string;
    createdAt: Date;
    lastActivityAt: Date;
}): SessionSummary {
    return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastActivityAt.toISOString()
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSessionDetail(session: SessionWithRuns): SessionDetail {
    const messages: SessionMessage[] = [];

    for (const run of session.runs) {
        const sortedMessages = [...run.messages].sort((a, b) => {
            if (a.role === b.role) {
                return a.createdAt.getTime() - b.createdAt.getTime();
            }

            return a.role === "user" ? -1 : 1;
        });

        for (const message of sortedMessages) {
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

            const toolCalls: SessionToolCall[] = run.toolCalls.map((toolCall) => {
                if (!isRecord(toolCall.arguments)) {
                    throw new Error(`Tool call ${toolCall.id} has invalid arguments`);
                }

                return {
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    arguments: toolCall.arguments,
                    status: toolCall.status,
                    ...(toolCall.result === null ? {} : { result: toolCall.result }),
                    ...(toolCall.errorMessage === null ? {} : { errorMessage: toolCall.errorMessage }),
                    startedAt: toolCall.startedAt.toISOString(),
                    finishedAt: toolCall.finishedAt?.toISOString() ?? null
                };
            });

            const runStatus: AgentRunStatus = run.status;
            messages.push({
                id: message.id,
                runId: run.id,
                role: "agent",
                content: message.content,
                thinking: message.thinking ?? "",
                toolCalls,
                runStatus,
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

export async function listSessions(): Promise<SessionSummary[]> {
    const sessions = await prisma.session.findMany({
        orderBy: { lastActivityAt: "desc" }
    });
    return sessions.map(toSessionSummary);
}

export async function createSession(): Promise<SessionSummary> {
    const session = await prisma.session.create({ data: {} });
    return toSessionSummary(session);
}

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
