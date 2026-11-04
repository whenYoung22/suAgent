这两者属于不同层次，但存在直接关系：

+ SSE 事件协议类型定义：规定前后端通信时，允许传输哪些事件，以及每种事件的数据结构。
+ 预设事件序列（Scenario）：规定某一种模拟场景下，后端按照什么顺序、发送哪些事件。

可以理解为：协议定义规则，Scenario 按照规则组织事件。

## 1. 先看两者分别是什么

### A. SSE 事件协议：定义单个事件

你在 `shared/agent-events.ts` 中定义的就是这个东西。

例如，Agent 运行过程中可能产生以下事件：

| 事件类型      | 作用                   | 典型数据                   |
| ------------- | ---------------------- | -------------------------- |
| `thinking`    | 表示 Agent 正在思考    | 思考阶段描述               |
| `tool_call`   | 表示发起工具调用       | 工具名称、参数、toolCallId |
| `tool_result` | 表示工具执行结果       | toolCallId、执行结果       |
| `token`       | 表示生成回答的文本片段 | 文本内容                   |
| `done`        | 表示本次运行正常结束   | 可选的运行统计信息         |
| `error`       | 表示本次运行发生错误   | 错误代码、错误信息         |

这里需要注意：

`thinking`、`tool_call` 等是事件类型（Event Type），而不是 Scenario。

例如，一个 `tool_call` 事件可以表示：

```
{
  type: "tool_call",
  data: {
    toolCallId: "tool-001",
    toolName: "search",
    arguments: {
      query: "React"
    }
  }
}
```

它只描述了一次工具调用事件，不规定前后还会发生什么。

### B. Scenario：定义一组事件的执行顺序

Scenario 是后端预设的模拟场景。

例如：

singleToolCall

```
thinking
   ↓
tool_call
   ↓
tool_result
   ↓
thinking
   ↓
token
   ↓
token
   ↓
done
```

multiToolCall

```
thinking
   ↓
tool_call
   ↓
tool_result
   ↓
thinking
   ↓
tool_call
   ↓
tool_result
   ↓
thinking
   ↓
token
   ↓
done
```

toolFailure

```
thinking
   ↓
tool_call
   ↓
tool_result（工具执行失败）
   ↓
thinking
   ↓
token（解释错误）
   ↓
done
```

streamError

```
thinking
   ↓
token
   ↓
error
```

这些只是我们为 V1 设计的模拟序列，不代表真实 Agent 的决策过程。

## 2. 它们之间的关系

可以用下面这个结构理解：

![image-20261103190529961](C:\Users\阿ven\AppData\Roaming\Typora\typora-user-images\image-20261103190529961.png)

实际的依赖关系是：

```
shared/agent-events.ts
        ↑
        │ 类型约束
        │
server/scenarios/*.ts
        │
        ↓
server/routes/agent.ts
        │
        ↓
server/lib/sse.ts
        │ SSE 推送
        ↓
client/hooks/useAgentStream.ts
        │
        ↓
client/stores/agentStore.ts
```

## 3. 为什么要分开定义？

假设你没有共享协议，而是直接在 Scenario 中随意写对象：

```
const events = [
  { type: "thinking", content: "正在思考" },
  { type: "tool_call", name: "search" }
];
```

很容易出现前后端理解不一致：

+ 后端使用 `name`，前端却读取 `toolName`。
+ 后端使用 `id`，前端却读取 `toolCallId`。
+ 后端新增事件，前端没有对应处理逻辑。

如果统一使用 `AgentEvent` 类型，TypeScript 就可以在开发阶段帮助你发现这些问题。

而且，Scenario 只需要关心事件顺序，不需要关心 SSE 编码细节。

例如：

```
// scenario 负责组织事件
const events: AgentEvent[] = [
  { /* thinking event */ },
  { /* tool_call event */ },
  { /* tool_result event */ },
  { /* done event */ }
];
```

真正把事件转换成 SSE 格式的工作交给 `server/lib/sse.ts`。

## 4. 接下来应该怎么做？

我建议先不要写四个 Scenario。

先完成 `shared/agent-events.ts`，确定协议。

这里有两个设计原则需要明确：

1. 使用 TypeScript 的判别联合类型（Discriminated Union），让不同 `type` 对应不同的 `data` 结构。
2. 每种事件都要明确必需字段和可选字段，尤其是 `tool_call` 和 `tool_result`，必须通过 `toolCallId` 关联。

你现在把 `shared/agent-events.ts` 的现有内容发给我。 我们基于现有代码设计协议，而不是重新写一套与你当前项目脱节的类型。