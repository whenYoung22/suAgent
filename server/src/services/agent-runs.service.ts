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
    streamDeepSeekEvents
} from "./deepseek.service.js";
import type { DeepSeekMessage } from "./deepseek.service.js";

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
            data: { status: "interrupted", finishedAt }
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
                    messages: { orderBy: { createdAt: "asc" } }
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

        const conversation = previousRuns
            .reverse()
            .flatMap((previousRun) =>
                previousRun.messages.flatMap((message): DeepSeekMessage[] => {
                    if (message.role === "user") {
                        return [{ role: "user", content: message.content }];
                    }
                    return message.content
                        ? [{ role: "assistant", content: message.content }]
                        : [];
                })
            );

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

    try {
        const scenario = run.provider === "mock"
            ? getScenario(run.prompt).scenario
            : null;
        const events = scenario
            ? scenario.createEvents()
            : streamDeepSeekEvents(
                run.prompt,
                run.conversation,
                activeRun.controller.signal
            );
        if (activeRun.controller.signal.aborted) {
            throw new Error("Run interrupted");
        }
        const toolCallSequences = new Map<string, number>();
        let nextToolCallSequence = 0;
        let content = "";
        let thinking = "";

        for await (const event of events) {
            if (scenario) {
                await waitForNextEvent(activeRun.controller.signal);
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
                throw persistError;
            }
            return;
        }

        const runError = error instanceof DeepSeekServiceError
            ? { code: error.code, message: error.message }
            : { code: "INTERNAL_ERROR", message: "Agent stream failed" };
        await prisma.agentRun.update({
            where: { id: run.id },
            data: {
                status: "failed",
                finishedAt: new Date(),
                errorCode: runError.code,
                errorMessage: runError.message
            }
        });
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
