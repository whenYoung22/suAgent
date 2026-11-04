## 1. 定义 AgentEvent

采用 TypeScript 的 Discriminated Union（判别联合类型）。

它的核心思想是：通过 `type` 字段区分事件，不同事件对应不同的数据结构。

将以下代码写入 `shared/agent-events.ts`：

```
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
export type AgentEvent =
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent;
```

## 2. 理解几个关键设计

① 为什么每种事件单独定义 interface？

因为不同事件的数据结构不同。

例如：

```
const event: AgentEvent = {
  type: "tool_call",
  data: {
    toolCallId: "tool-001",
    toolName: "search",
    arguments: {
      query: "React"
    }
  }
};
```

如果你把 `toolName` 写成 `name`，TypeScript 就会提示类型错误。

② 为什么使用 toolCallId？

因为一次 Agent 运行可能包含多个工具调用。

例如：

```
tool_call: tool-001
tool_result: tool-001

tool_call: tool-002
tool_result: tool-002
```

前端通过 `toolCallId` 将调用事件和结果事件关联起来，确保 Tool Card 能正确更新。

③ 为什么 done 没有 data？

目前 V1 不需要在结束事件中传递额外信息，因此不必人为增加一个空对象。

④ 为什么 error 和 tool_result.success 是两回事？

+ `tool_result.success = false`：工具执行失败，但 Agent 运行本身可以继续。
+ `error`：当前 Agent 流程发生异常，无法正常继续。

例如，搜索工具失败后，Agent 仍然可以向用户解释搜索失败，这属于工具级错误，而不是整个流的异常。

## 3. 当前事件协议的整体关系

| 事件        | 发生阶段     | 是否代表整个 Run 结束 |
| ----------- | ------------ | --------------------- |
| thinking    | 思考阶段     | 否                    |
| tool_call   | 工具调用阶段 | 否                    |
| tool_result | 工具执行结束 | 否                    |
| token       | 回答生成阶段 | 否                    |
| done        | 正常结束     | 是                    |
| error       | 异常终止     | 是                    |

这里暂定 `error` 为终止事件，后续如果需要支持可恢复的流内错误，再单独调整协议。

