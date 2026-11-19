// DeepSeek API 的流式调用封装
// 支持 SSE（Server-Sent Events）解析、工具调用（Function Calling）的增量拼接，以及完善的错误处理

import type { AgentToolDefinition } from "../agent-tools/types.js";

// DeepSeek wire roles; persisted session messages use `user` and `agent`.
export type DeepSeekMessage =
    | { role: "user" | "system"; content: string }
    | {
        role: "assistant";
        content: string | null;
        tool_calls?: DeepSeekToolCallMessage[];
    }
    | { role: "tool"; tool_call_id: string; content: string };

// 工具调用相关类型    
export interface DeepSeekToolCallMessage { // API 原始格式
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface DeepSeekToolCall { // 内部归一化格式
    id: string;
    name: string;
    rawArguments: string;  // 注意是原始 JSON 字符串，未解析
}

export interface DeepSeekCompletion { // 最终返回值
    content: string;
    toolCalls: DeepSeekToolCall[];
}

interface MutableToolCall { //流式拼接过程中使用的可变中间态
    id: string;
    name: string;
    arguments: string;
}

// 错误类型
export class DeepSeekServiceError extends Error {
    constructor(
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = "DeepSeekServiceError";
    }
}

// 类型守卫
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// SSE 流解析  把 ReadableStream<Uint8Array> 转成 一个个完整的 data: 帧
// 以 : 开头的是注释行（如心跳 : keep-alive），忽略。
// 以 data: 开头的是数据行，冒号后的一个空格要去掉。
// 一个帧可以由多行 data: 组成，用 \n 连接。
// 空行表示帧结束
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
        if (line === "") {   // 空行 = 帧结束
            if (dataLines.length === 0) {
                return null;
            }
            const data = dataLines.join("\n");
            dataLines = [];
            return data;
        }
        if (line.startsWith(":")) {  // 注释行忽略
            return null;
        }
        if (line.startsWith("data:")) {
            const value = line.slice(5);
            dataLines.push(value.startsWith(" ") ? value.slice(1) : value);   // 去掉可选空格
        }
        return null;
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {  // 冲刷解码器残留
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

        if (buffer.length > 0) {  // 处理最后没有换行的残留行
            const data = consumeLine(buffer);
            if (data !== null) {
                yield data;
            }
        }
        const finalData = consumeLine("");  // 用空行强制提交最后一个未闭合的帧 ；很多 SSE 实现会漏掉"最后一帧没有尾随空行"的情况，这里处理了
        if (finalData !== null) {
            yield finalData;
        }
    } catch (error) { //错误转换
        if (signal.aborted || error instanceof DeepSeekServiceError) {
            throw error;  // 原样抛出
        }
        throw new DeepSeekServiceError(
            "DEEPSEEK_STREAM_ERROR",
            "The DeepSeek response stream was interrupted."
        );
    } finally {
        reader.releaseLock();  // 确保释放流锁
    }
}

// 单帧解析 ；职责单一：解析 + 校验 + 检测上游错误；[DONE] 不在这里处理，而是在主循环里提前判断，因为它不是 JSON
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

// 主函数
export async function streamDeepSeekCompletion(
    messages: DeepSeekMessage[],
    tools: AgentToolDefinition[],
    signal: AbortSignal,
    onToken: (content: string) => Promise<void> //是 流式回调：每收到一段文本 delta 就回调一次，用于实时推给前端/终端
): Promise<DeepSeekCompletion> { //流结束后给出完整结果（全文 + 工具调用）
     //配置检查
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
        // 发起请求
        response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                messages,
                // 工具定义来自服务端注册表；auto 允许模型选择回答或提出一个/多个工具调用。
                tools,
                tool_choice: "auto", //模型自行决定是否调用工具
                stream: true //启用 SSE
            }),
            signal //透传给 fetch，支持外部取消
        });
    } catch (error) {
        if (signal.aborted) { 
            throw error;  // 主动取消，原样抛
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

    // 消费流：文本累积 + 工具调用增量拼接
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

        // 文本增量 ；每段 delta 追加到数组，同时 await onToken(...)
        if (typeof delta.content === "string" && delta.content.length > 0) {
            contentParts.push(delta.content);
            await onToken(delta.content);  //await 意味着 背压：如果下游消费慢，读流也会变慢
        }

        // 工具调用增量；流式返回的工具调用是分片到达的，靠 index 标识属于同一次调用
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

    //  完整性校验
    if (!receivedDone && finishReason === null) {
        throw new DeepSeekServiceError(
            "INCOMPLETE_UPSTREAM_STREAM",
            "The DeepSeek response stream ended before generation completed."
        );
    }

    // 输出有序、校验后的工具调用
    const orderedToolCalls = [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)   // 按 index 排序；Map 的插入顺序不一定等于 index 顺序（虽然实际通常如此），显式排序保证并行工具调用的顺序稳定
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
