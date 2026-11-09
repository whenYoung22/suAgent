import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentEvent } from "@suagent/shared";
import type { RunSessionRequest } from "@suagent/shared/session";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { endSSE, initSSE, sendSSE } from "../lib/sseSender.js";
import { singleToolCallScenario } from "../scenarios/single-tool-call.js";
import { multiToolCallScenario } from "../scenarios/multi-tool-call.js";
import { toolFailureScenario } from "../scenarios/tool-failure.js";
import { streamErrorScenario } from "../scenarios/stream-error.js";

const router = Router();

const scenarios = {
    "1": { name: "single-tool-call", createEvents: singleToolCallScenario },
    "2": { name: "multi-tool-call", createEvents: multiToolCallScenario },
    "3": { name: "tool-failure", createEvents: toolFailureScenario },
    "4": { name: "stream-error", createEvents: streamErrorScenario }
} as const;

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

router.post(
    "/:sessionId/runs",
    async (
        req: Request<{ sessionId: string }, unknown, RunSessionRequest>,
        res: Response
    ) => {
        const prompt = req.body?.prompt;
        if (typeof prompt !== "string" || prompt.trim().length === 0) {
            res.status(400).json({ message: "Prompt is required" });
            return;
        }

        const selectedScenario = scenarios[prompt.trim() as keyof typeof scenarios];
        if (!selectedScenario) {
            res.status(400).json({ message: "Prompt must be 1, 2, 3, or 4" });
            return;
        }

        const session = await prisma.session.findUnique({
            where: { id: req.params.sessionId },
            select: { id: true }
        });

        if (!session) {
            res.status(404).json({ message: "Session not found" });
            return;
        }

        const run = await prisma.$transaction(async (transaction) => {
            const updatedSession = await transaction.session.update({
                where: { id: session.id },
                data: {
                    lastRunSequence: { increment: 1 },
                    lastActivityAt: new Date()
                },
                select: { lastRunSequence: true }
            });

            const createdRun = await transaction.agentRun.create({
                data: {
                    sessionId: session.id,
                    sequence: updatedSession.lastRunSequence,
                    scenario: selectedScenario.name
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

            return createdRun;
        });

        const events = selectedScenario.createEvents();
        const toolCallSequences = new Map<string, number>();
        let nextToolCallSequence = 0;
        let content = "";
        let thinking = "";

        res.setHeader("X-Run-Id", run.id);
        initSSE(res);

        try {
            for (const event of events) {
                await new Promise<void>((resolve) => setTimeout(resolve, 600));

                if (event.type === "thinking") {
                    thinking += event.data.content;
                    await prisma.message.update({
                        where: {
                            runId_role: { runId: run.id, role: "agent" }
                        },
                        data: { thinking }
                    });
                } else if (event.type === "token") {
                    content += event.data.content;
                    await prisma.message.update({
                        where: {
                            runId_role: { runId: run.id, role: "agent" }
                        },
                        data: { content }
                    });
                } else if (event.type === "tool_call") {
                    nextToolCallSequence += 1;
                    toolCallSequences.set(event.data.toolCallId, nextToolCallSequence);
                    await prisma.toolCall.create({
                        data: {
                            runId: run.id,
                            toolCallId: event.data.toolCallId,
                            sequence: nextToolCallSequence,
                            toolName: event.data.toolName,
                            arguments: toPrismaJson(event.data.arguments)
                        }
                    });
                } else if (event.type === "tool_result") {
                    const sequence = toolCallSequences.get(event.data.toolCallId);
                    if (sequence === undefined) {
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
                    await prisma.agentRun.update({
                        where: { id: run.id },
                        data: { status: "completed", finishedAt: new Date() }
                    });
                } else if (event.type === "error") {
                    await prisma.agentRun.update({
                        where: { id: run.id },
                        data: {
                            status: "failed",
                            finishedAt: new Date(),
                            errorCode: event.data.code,
                            errorMessage: event.data.message
                        }
                    });
                }

                await prisma.session.update({
                    where: { id: session.id },
                    data: { lastActivityAt: new Date() }
                });
                sendSSE(res, event);

                if (event.type === "done" || event.type === "error") {
                    break;
                }
            }
        } catch (error) {
            console.error("Session run stream error:", error);

            const errorEvent: AgentEvent = {
                type: "error",
                data: {
                    code: "INTERNAL_ERROR",
                    message: "Agent stream failed"
                }
            };

            await prisma.agentRun.update({
                where: { id: run.id },
                data: {
                    status: "failed",
                    finishedAt: new Date(),
                    errorCode: errorEvent.data.code,
                    errorMessage: errorEvent.data.message
                }
            });
            sendSSE(res, errorEvent);
        } finally {
            endSSE(res);
        }
    }
);

export default router;
