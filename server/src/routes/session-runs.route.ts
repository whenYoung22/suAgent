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

interface ActiveRun {
    controller: AbortController;
    completion: Promise<void>;
    complete: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

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
            data: { status: "interrupted", finishedAt }
        })
    ]);
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

router.delete(
    "/:sessionId/runs/:runId",
    async (req: Request<{ sessionId: string; runId: string }>, res: Response) => {
        const run = await prisma.agentRun.findFirst({
            where: {
                id: req.params.runId,
                sessionId: req.params.sessionId
            },
            select: { id: true }
        });

        if (!run) {
            res.status(404).json({ message: "Run not found" });
            return;
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
            res.status(404).json({ message: "Run not found" });
            return;
        }
        if (completedRun.status === "running") {
            res.status(500).json({ message: "Run interruption was not persisted" });
            return;
        }

        res.json({ runId: completedRun.id, status: completedRun.status });
    }
);

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
        const activeRun = createActiveRun();
        activeRuns.set(run.id, activeRun);
        const toolCallSequences = new Map<string, number>();
        let nextToolCallSequence = 0;
        let content = "";
        let thinking = "";

        res.on("close", () => {
            if (!res.writableEnded) {
                activeRun.controller.abort();
            }
        });

        try {
            res.setHeader("X-Run-Id", run.id);
            initSSE(res);
            if (res.destroyed || req.aborted) {
                activeRun.controller.abort();
            }

            for (const event of events) {
                await waitForNextEvent(activeRun.controller.signal);

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

                if (activeRun.controller.signal.aborted) {
                    throw new Error("Run interrupted");
                }

                await prisma.session.update({
                    where: { id: session.id },
                    data: { lastActivityAt: new Date() }
                });
                if (activeRun.controller.signal.aborted) {
                    throw new Error("Run interrupted");
                }
                sendSSE(res, event);
                if (activeRun.controller.signal.aborted) {
                    throw new Error("Run interrupted");
                }

                if (event.type === "done" || event.type === "error") {
                    break;
                }
            }
        } catch (error) {
            if (activeRun.controller.signal.aborted) {
                try {
                    await persistInterruptedRun(run.id);
                } catch (persistError) {
                    console.error("Session run interruption persistence error:", persistError);
                }
                return;
            }

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
            if (activeRun.controller.signal.aborted) {
                try {
                    await persistInterruptedRun(run.id);
                } catch (persistError) {
                    console.error("Session run interruption persistence error:", persistError);
                }
                return;
            }
            sendSSE(res, errorEvent);
        } finally {
            endSSE(res);
            activeRuns.delete(run.id);
            activeRun.complete();
        }
    }
);

export default router;
