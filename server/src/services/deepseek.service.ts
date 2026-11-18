import type { AgentToolDefinition } from "./agent-tools.service.js";

export type DeepSeekMessage =
    | { role: "user" | "system"; content: string }
    | {
        role: "assistant";
        content: string | null;
        tool_calls?: DeepSeekToolCallMessage[];
    }
    | { role: "tool"; tool_call_id: string; content: string };

export interface DeepSeekToolCallMessage {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface DeepSeekToolCall {
    id: string;
    name: string;
    rawArguments: string;
}

export interface DeepSeekCompletion {
    content: string;
    toolCalls: DeepSeekToolCall[];
}

interface MutableToolCall {
    id: string;
    name: string;
    arguments: string;
}

export class DeepSeekServiceError extends Error {
    constructor(
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = "DeepSeekServiceError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function* readDataFrames(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal
): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];

    const consumeLine = (rawLine: string): string | null => {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
            if (dataLines.length === 0) {
                return null;
            }
            const data = dataLines.join("\n");
            dataLines = [];
            return data;
        }
        if (line.startsWith(":")) {
            return null;
        }
        if (line.startsWith("data:")) {
            const value = line.slice(5);
            dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
        }
        return null;
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                buffer += decoder.decode();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const data = consumeLine(buffer.slice(0, newlineIndex));
                buffer = buffer.slice(newlineIndex + 1);
                if (data !== null) {
                    yield data;
                }
                newlineIndex = buffer.indexOf("\n");
            }
        }

        if (buffer.length > 0) {
            const data = consumeLine(buffer);
            if (data !== null) {
                yield data;
            }
        }
        const finalData = consumeLine("");
        if (finalData !== null) {
            yield finalData;
        }
    } catch (error) {
        if (signal.aborted || error instanceof DeepSeekServiceError) {
            throw error;
        }
        throw new DeepSeekServiceError(
            "DEEPSEEK_STREAM_ERROR",
            "The DeepSeek response stream was interrupted."
        );
    } finally {
        reader.releaseLock();
    }
}

function parsePayload(data: string): Record<string, unknown> {
    let payload: unknown;
    try {
        payload = JSON.parse(data);
    } catch {
        throw new DeepSeekServiceError(
            "INVALID_UPSTREAM_RESPONSE",
            "DeepSeek returned an invalid streaming response."
        );
    }
    if (!isRecord(payload)) {
        throw new DeepSeekServiceError(
            "INVALID_UPSTREAM_RESPONSE",
            "DeepSeek returned an invalid streaming response."
        );
    }
    if (isRecord(payload.error)) {
        throw new DeepSeekServiceError(
            "UPSTREAM_ERROR",
            "DeepSeek returned an error while generating a response."
        );
    }
    return payload;
}

export async function streamDeepSeekCompletion(
    messages: DeepSeekMessage[],
    tools: AgentToolDefinition[],
    signal: AbortSignal,
    onToken: (content: string) => Promise<void>
): Promise<DeepSeekCompletion> {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
        throw new DeepSeekServiceError(
            "DEEPSEEK_NOT_CONFIGURED",
            "DeepSeek is selected but DEEPSEEK_API_KEY is not configured."
        );
    }

    const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
    let response: Response;
    try {
        response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                messages,
                tools,
                tool_choice: "auto",
                stream: true
            }),
            signal
        });
    } catch (error) {
        if (signal.aborted) {
            throw error;
        }
        throw new DeepSeekServiceError(
            "DEEPSEEK_CONNECTION_ERROR",
            "Unable to connect to the DeepSeek API."
        );
    }

    if (!response.ok) {
        throw new DeepSeekServiceError(
            "DEEPSEEK_HTTP_ERROR",
            `DeepSeek API returned HTTP ${response.status}.`
        );
    }
    if (!response.body) {
        throw new DeepSeekServiceError(
            "INVALID_UPSTREAM_RESPONSE",
            "DeepSeek did not return a response stream."
        );
    }

    const contentParts: string[] = [];
    const toolCalls = new Map<number, MutableToolCall>();
    let finishReason: string | null = null;
    let receivedDone = false;

    for await (const data of readDataFrames(response.body, signal)) {
        if (data === "[DONE]") {
            receivedDone = true;
            break;
        }

        const payload = parsePayload(data);
        const choices = payload.choices;
        const choice = Array.isArray(choices) ? choices[0] : undefined;
        if (!isRecord(choice)) {
            continue;
        }

        if (typeof choice.finish_reason === "string") {
            finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!isRecord(delta)) {
            continue;
        }

        if (typeof delta.content === "string" && delta.content.length > 0) {
            contentParts.push(delta.content);
            await onToken(delta.content);
        }

        if (!Array.isArray(delta.tool_calls)) {
            continue;
        }

        for (const item of delta.tool_calls) {
            if (!isRecord(item) || typeof item.index !== "number") {
                throw new DeepSeekServiceError(
                    "INVALID_TOOL_CALL",
                    "DeepSeek returned an invalid tool call."
                );
            }

            const toolCall = toolCalls.get(item.index) ?? {
                id: "",
                name: "",
                arguments: ""
            };
            if (typeof item.id === "string") {
                toolCall.id += item.id;
            }
            if (isRecord(item.function)) {
                if (typeof item.function.name === "string") {
                    toolCall.name += item.function.name;
                }
                if (typeof item.function.arguments === "string") {
                    toolCall.arguments += item.function.arguments;
                }
            }
            toolCalls.set(item.index, toolCall);
        }
    }

    if (!receivedDone && finishReason === null) {
        throw new DeepSeekServiceError(
            "INCOMPLETE_UPSTREAM_STREAM",
            "The DeepSeek response stream ended before generation completed."
        );
    }

    const orderedToolCalls = [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, toolCall]) => {
            if (!toolCall.id || !toolCall.name) {
                throw new DeepSeekServiceError(
                    "INVALID_TOOL_CALL",
                    "DeepSeek returned a tool call without an ID or function name."
                );
            }
            return {
                id: toolCall.id,
                name: toolCall.name,
                rawArguments: toolCall.arguments
            };
        });

    return {
        content: contentParts.join(""),
        toolCalls: orderedToolCalls
    };
}
