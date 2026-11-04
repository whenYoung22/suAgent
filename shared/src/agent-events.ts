/**
 * Agent 正在思考
 */
export interface ThinkingEvent {
    type: "thinking";
    data: {
        content: string;
    };
}

/**
 * Agent 发起工具调用
 */
export interface ToolCallEvent {
    type: "tool_call";
    data: {
        toolCallId: string;
        toolName: string;
        arguments: Record<string, unknown>;
    };
}

/**
 * 工具执行结果
 */
export interface ToolResultEvent {
    type: "tool_result";
    data: {
        toolCallId: string;
        success: boolean;
        result?: unknown;
        error?: string;
    };
}

/**
 * 模型输出文本片段
 */
export interface TokenEvent {
    type: "token";
    data: {
        content: string;
    };
}

/**
 * Agent 运行正常结束
 */
export interface DoneEvent {
    type: "done";
}

/**
 * Agent 运行发生异常
 */
export interface ErrorEvent {
    type: "error";
    data: {
        code: string;
        message: string;
    };
}

/**
 * 前后端共享的 Agent 事件类型
 */
export type AgentEvent = | ThinkingEvent | ToolCallEvent | ToolResultEvent | TokenEvent | DoneEvent | ErrorEvent;
