import type { AgentEvent } from "@suagent/shared";

export interface DeepSeekMessage {
    role: "system" | "user" | "assistant";
    content: string;
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

function parseDataFrame(data: string): {
    content: string | null;
    finished: boolean;
    done: boolean;
} {
    if (data === "[DONE]") {
        return { content: null, finished: true, done: true };
    }

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

    const choices = payload.choices;
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    if (!isRecord(choice)) {
        return { content: null, finished: false, done: false };
    }

    const delta = choice.delta;
    const content = isRecord(delta) && typeof delta.content === "string"
        ? delta.content
        : null;

    return {
        content,
        finished: choice.finish_reason !== null && choice.finish_reason !== undefined,
        done: false
    };
}

export async function* streamDeepSeekEvents(
    prompt: string,
    conversation: DeepSeekMessage[],
    signal: AbortSignal
): AsyncGenerator<AgentEvent> {
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
                messages: [
                    {
                        role: "system",
                        content: "请直接使用 Markdown 格式回答。不要将整段普通回答包在代码围栏中；只有实际代码片段才使用代码围栏。"
                    },
                    ...conversation,
                    { role: "user", content: prompt }
                ],
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];
    let receivedDone = false;
    let receivedFinishReason = false;

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
        while (!receivedDone) {
            const { done, value } = await reader.read();
            if (done) {
                buffer += decoder.decode();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                const data = consumeLine(line);
                if (data !== null) {
                    const frame = parseDataFrame(data);
                    receivedDone = frame.done;
                    receivedFinishReason ||= frame.finished;
                    if (frame.content !== null) {
                        yield { type: "token", data: { content: frame.content } };
                    }
                }
                if (receivedDone) {
                    break;
                }
                newlineIndex = buffer.indexOf("\n");
            }
        }

        if (!receivedDone) {
            if (buffer.length > 0) {
                const data = consumeLine(buffer);
                if (data !== null) {
                    const frame = parseDataFrame(data);
                    receivedDone = frame.done;
                    receivedFinishReason ||= frame.finished;
                    if (frame.content !== null) {
                        yield { type: "token", data: { content: frame.content } };
                    }
                }
            }

            const finalData = consumeLine("");
            if (finalData !== null) {
                const frame = parseDataFrame(finalData);
                receivedDone = frame.done;
                receivedFinishReason ||= frame.finished;
                if (frame.content !== null) {
                    yield { type: "token", data: { content: frame.content } };
                }
            }
        }

        if (!receivedDone && !receivedFinishReason) {
            throw new DeepSeekServiceError(
                "INCOMPLETE_UPSTREAM_STREAM",
                "The DeepSeek response stream ended before generation completed."
            );
        }

        yield { type: "done" };
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
