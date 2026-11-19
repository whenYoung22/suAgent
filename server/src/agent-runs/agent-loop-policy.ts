// Agent 循环控制与预算管理；限制模型轮数、工具调用次数，检测重复失败，并实现"一次纠错机会"机制

// 常量：预算上限
export const MAX_MODEL_ROUNDS = 5;
export const MAX_TOOL_CALLS = 10;

// 停止原因类型
export type AgentLoopStopReason =
    | "completed"              // 正常完成
    | "interrupted"            // 用户主动中断
    | "model_round_limit"      // 达到模型轮数上限
    | "tool_call_limit"        // 达到工具调用次数上限
    | "repeated_tool_failure"  // 重复同样的失败工具调用
    | "tool_recovery_limit"    // 纠错机会用尽
    | "error";                 // 发生错误

export type AgentLoopBudgetStopReason =
    | "model_round_limit"
    | "tool_call_limit"
    | "repeated_tool_failure"
    | "tool_recovery_limit";

export interface AgentLoopToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

// 状态结构
export interface AgentLoopState {
    modelRounds: number;                       // 已进行的模型轮数
    toolCallCount: number;                     // 已发起的工具调用总数
    stopReason: AgentLoopStopReason | null;    // 当前停止原因（null = 未停）
    failedToolCallSignatures: Set<string>;     // 失败过的工具调用签名集合
    correctionPending: boolean;                // 是否处于"等待纠错"状态
    correctionAttempted: boolean;              // 是否已经尝试过一次纠错
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

// 轮数控制
export function beginModelRound(state: AgentLoopState): "model_round_limit" | null {
    // 先检查再自增
    if (state.modelRounds >= MAX_MODEL_ROUNDS) {
        return "model_round_limit";   // 已达上限，拒绝
    }
    state.modelRounds += 1;    // 否则轮数 +1，放行
    return null;
}

// 稳定序列化；用于签名稳定化的递归判断
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

// 工具调用签名；判断"两次调用是否本质相同"的依据
// 如果模型连续两次用同样的参数调同样的工具且都失败，那就是无意义的重复
export function getToolCallSignature(call: AgentLoopToolCall): string {
    return `${call.name}:${stableJson(call.arguments)}`;
}

// 批次预算检查；这个函数在执行一整批工具调用之前调用，判断"这批能不能执行" ;
// 轮数上限|工具调用次数上限|纠错机会已用尽|重复同样的失败调用
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

// 状态更新函数
export function recordToolCallStarted(state: AgentLoopState): void {
    state.toolCallCount += 1;
}

export function recordToolBatchResults(
    state: AgentLoopState,
    results: Array<AgentLoopToolCall & { success: boolean }>
): void {
    const failed = results.filter((result) => !result.success);

    // 情况 A：本批全部成功
    if (failed.length === 0) {
        if (state.correctionPending) {          // 若之前有待纠错的失败
            state.failedToolCallSignatures.clear();  // 清空失败记录
            state.correctionPending = false;         // 解除待纠错
            state.correctionAttempted = false;       // 重置纠错机会
        }
        return;
    }

    // 情况 B：本批有失败
    for (const result of failed) {
        state.failedToolCallSignatures.add(getToolCallSignature(result));  // 记录失败签名
    }
    if (state.correctionPending) {
        state.correctionAttempted = true;   // 之前就在纠错 → 这次纠错也失败了
    } else {
        state.correctionPending = true;     // 首次失败 → 进入待纠错状态
    }
}
