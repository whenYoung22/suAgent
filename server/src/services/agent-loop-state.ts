export const MAX_MODEL_ROUNDS = 5;
export const MAX_TOOL_CALLS = 10;

export type AgentLoopStopReason =
    | "completed"
    | "interrupted"
    | "model_round_limit"
    | "tool_call_limit"
    | "repeated_tool_failure"
    | "tool_recovery_limit"
    | "error";

export type AgentLoopBudgetStopReason =
    | "model_round_limit"
    | "tool_call_limit"
    | "repeated_tool_failure"
    | "tool_recovery_limit";

export interface AgentLoopToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

export interface AgentLoopState {
    modelRounds: number;
    toolCallCount: number;
    stopReason: AgentLoopStopReason | null;
    failedToolCallSignatures: Set<string>;
    correctionPending: boolean;
    correctionAttempted: boolean;
}

export function createAgentLoopState(): AgentLoopState {
    return {
        modelRounds: 0,
        toolCallCount: 0,
        stopReason: null,
        failedToolCallSignatures: new Set(),
        correctionPending: false,
        correctionAttempted: false
    };
}

export function beginModelRound(state: AgentLoopState): "model_round_limit" | null {
    if (state.modelRounds >= MAX_MODEL_ROUNDS) {
        return "model_round_limit";
    }
    state.modelRounds += 1;
    return null;
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    if (isRecord(value)) {
        const entries = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
        return `{${entries.join(",")}}`;
    }
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getToolCallSignature(call: AgentLoopToolCall): string {
    return `${call.name}:${stableJson(call.arguments)}`;
}

export function getToolBatchStopReason(
    state: AgentLoopState,
    calls: AgentLoopToolCall[]
): AgentLoopBudgetStopReason | null {
    if (state.modelRounds >= MAX_MODEL_ROUNDS) {
        return "model_round_limit";
    }
    if (state.toolCallCount + calls.length > MAX_TOOL_CALLS) {
        return "tool_call_limit";
    }
    if (state.correctionAttempted) {
        return "tool_recovery_limit";
    }
    if (state.correctionPending &&
        calls.some((call) => state.failedToolCallSignatures.has(getToolCallSignature(call)))) {
        return "repeated_tool_failure";
    }
    return null;
}

export function recordToolCallStarted(state: AgentLoopState): void {
    state.toolCallCount += 1;
}

export function recordToolBatchResults(
    state: AgentLoopState,
    results: Array<AgentLoopToolCall & { success: boolean }>
): void {
    const failed = results.filter((result) => !result.success);
    if (failed.length === 0) {
        if (state.correctionPending) {
            state.failedToolCallSignatures.clear();
            state.correctionPending = false;
            state.correctionAttempted = false;
        }
        return;
    }

    for (const result of failed) {
        state.failedToolCallSignatures.add(getToolCallSignature(result));
    }
    if (state.correctionPending) {
        state.correctionAttempted = true;
    } else {
        state.correctionPending = true;
    }
}
