import { Router } from "express";
import type { Request, Response } from "express";
import type {
    AgentRunStatus,
    SessionDetail,
    SessionMessage,
    SessionSummary,
    SessionToolCall,
    UpdateSessionTitleRequest
} from "@suagent/shared/session";
import { prisma } from "../lib/prisma.js";

const router = Router();

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

router.get("/", async (_req: Request, res: Response) => {
    const sessions = await prisma.session.findMany({
        orderBy: { lastActivityAt: "desc" }
    });

    res.json({
        sessions: sessions.map(toSessionSummary)
    });
});

router.post("/", async (_req: Request, res: Response) => {
    const session = await prisma.session.create({ data: {} });

    res.status(201).json({
        session: toSessionSummary(session)
    });
});

router.patch(
    "/:id",
    async (
        req: Request<{ id: string }, unknown, UpdateSessionTitleRequest>,
        res: Response
    ) => {
        const title = req.body?.title;

        if (typeof title !== "string" || title.trim().length === 0 || title.trim().length > 120) {
            res.status(400).json({ message: "Title must contain between 1 and 120 characters" });
            return;
        }

        const session = await prisma.session.findUnique({
            where: { id: req.params.id },
            select: { id: true }
        });

        if (!session) {
            res.status(404).json({ message: "Session not found" });
            return;
        }

        const updatedSession = await prisma.session.update({
            where: { id: req.params.id },
            data: {
                title: title.trim(),
                lastActivityAt: new Date()
            }
        });

        res.json({
            session: toSessionSummary(updatedSession)
        });
    }
);

router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
    const session = await prisma.session.findUnique({
        where: { id: req.params.id },
        include: {
            runs: {
                orderBy: { sequence: "asc" },
                include: {
                    messages: { orderBy: { createdAt: "asc" } },
                    toolCalls: { orderBy: { sequence: "asc" } }
                }
            }
        }
    });

    if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
    }

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

    const detail: SessionDetail = {
        ...toSessionSummary(session),
        messages
    };

    res.json({ session: detail });
});

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
    const session = await prisma.session.findUnique({
        where: { id: req.params.id },
        select: { id: true }
    });

    if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
    }

    await prisma.session.delete({ where: { id: req.params.id } });
    res.status(204).end();
});

export default router;
