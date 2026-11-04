现在开始实现第一个 Scenario：`single-tool-call.ts`。

这一阶段只解决一个问题：如何用共享的 `AgentEvent` 类型，描述一次完整的 Agent 工具调用过程。

## 1. 创建目录和文件

在 `server/src/` 下创建：

```
server/
└── src/
    └── scenarios/
        └── single-tool-call.ts
```

## 2. 先理解 Scenario 的职责

`single-tool-call` 模拟一次 Agent 运行：

```
用户提出问题
    ↓
thinking：正在分析问题
    ↓
tool_call：调用搜索工具
    ↓
tool_result：搜索成功
    ↓
thinking：正在整理搜索结果
    ↓
token：逐步输出回答
    ↓
done：运行结束
```

这里有一个关键设计：

Scenario 不负责发送 SSE，也不负责控制事件的发送时间。

它只负责提供一组有序的事件数据。

因此，我们让它返回 `AgentEvent[]`。

## 3. 编写 single-tool-call.ts

```
import type { AgentEvent } from "@suagent/shared";

/**
 * 模拟一次完整的工具调用过程
 */
export function singleToolCallScenario(): AgentEvent[] {
  return [
    {
      type: "thinking",
      data: {
        content: "正在分析用户的问题..."
      }
    },
    {
      type: "tool_call",
      data: {
        toolCallId: "tool-001",
        toolName: "search",
        arguments: {
          query: "React useEffect"
        }
      }
    },
    {
      type: "tool_result",
      data: {
        toolCallId: "tool-001",
        success: true,
        result: {
          summary: "useEffect 用于处理组件中的副作用"
        }
      }
    },
    {
      type: "thinking",
      data: {
        content: "已获取搜索结果，正在整理回答..."
      }
    },
    {
      type: "token",
      data: {
        content: "useEffect 是 React 提供的 Hook，"
      }
    },
    {
      type: "token",
      data: {
        content: "主要用于处理副作用，例如请求数据和订阅事件。"
      }
    },
    {
      type: "done"
    }
  ];
}
```

## 4. 解释几个设计细节

① 为什么函数返回数组，而不是直接发送事件？

因为我们需要把事件数据和传输逻辑解耦。

例如：

```
const events = singleToolCallScenario();
```

此时只是获取事件数组，并没有发生任何网络请求。

后续由路由层获取数组，再交给 SSE 推送模块处理。

② 为什么 token 拆成两段？

这是为了模拟真实流式输出。

如果一次性返回完整回答，前端就无法充分测试增量渲染。

③ 为什么 tool_call 和 tool_result 都有 toolCallId？

它们是同一次工具调用的两个阶段。

前端可以通过这个 ID 找到对应的 Tool Card，将状态从执行中更新为成功。

④ 为什么 Scenario 不使用 setTimeout？

目前先将事件序列与发送节奏分开。

未来在 SSE 调度层决定每个事件的发送间隔，可以统一控制速度，也方便实现中断和清理。

## 5. 现在进行一次类型检查

进入 server：

```
cd server
npx tsc --noEmit
```

如果没有报错，说明 Scenario 使用共享类型成功。

注意：这只是类型检查，不代表 Scenario 已经通过 HTTP 或 SSE 发送。

## 6. 接下来做什么？

第一个 Scenario 完成后，我们还需要设计另外三个：

| Scenario           | 主要测试目标                |
| ------------------ | --------------------------- |
| `single-tool-call` | 基本工具调用流程            |
| `multi-tool-call`  | 多个 Tool Card 的关联与更新 |
| `tool-failure`     | 工具失败，但 Agent 继续运行 |
| `stream-error`     | 整个流异常终止              |

先完成这个文件并执行类型检查。通过后，我们再设计 `multi-tool-call.ts`，重点讨论多工具调用时的事件关联，而不是简单复制第一份代码。