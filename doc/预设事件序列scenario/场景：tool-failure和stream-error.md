接下来完成剩余两个 Scenario：`tool-failure.ts` 和 `stream-error.ts`。按照你的要求，这两个文件完成后暂时不做类型检查。

## 1. tool-failure.ts

这个场景模拟：工具执行失败，但 Agent 没有终止，而是继续生成回答。

事件流程：

```
thinking
   ↓
tool_call
   ↓
tool_result（success: false）
   ↓
thinking
   ↓
token
   ↓
token
   ↓
done
```

在 `server/src/scenarios/tool-failure.ts` 中：

```
import type { AgentEvent } from "@suagent/shared";

/**
 * 模拟工具执行失败，但 Agent 继续运行
 */
export function toolFailureScenario(): AgentEvent[] {
  return [
    {
      type: "thinking",
      data: {
        content: "正在搜索用户需要的信息..."
      }
    },
    {
      type: "tool_call",
      data: {
        toolCallId: "tool-001",
        toolName: "search",
        arguments: {
          query: "React 19 新特性"
        }
      }
    },
    {
      type: "tool_result",
      data: {
        toolCallId: "tool-001",
        success: false,
        error: "搜索服务暂时不可用"
      }
    },
    {
      type: "thinking",
      data: {
        content: "搜索工具执行失败，尝试根据已有知识回答..."
      }
    },
    {
      type: "token",
      data: {
        content: "搜索服务暂时不可用，"
      }
    },
    {
      type: "token",
      data: {
        content: "我可以先根据已有知识介绍 React 19 的主要特性。"
      }
    },
    {
      type: "done"
    }
  ];
}
```

这里有一个重要区别：

```
{
  type: "tool_result",
  data: {
    toolCallId: "tool-001",
    success: false,
    error: "搜索服务暂时不可用"
  }
}
```

它表示工具调用失败，但 Agent Run 仍然可以继续。

因此，前端应该：

1. 将对应 Tool Card 标记为失败。
2. 展示错误信息。
3. 继续接收后续 thinking 和 token。
4. 最终接收 done，结束本次运行。

## 2. stream-error.ts

这个场景模拟：SSE 流在传输过程中发生异常，Agent Run 被迫终止。

事件流程：

```
thinking
   ↓
tool_call
   ↓
tool_result（success: true）
   ↓
token
   ↓
error
```

在 `server/src/scenarios/stream-error.ts` 中：

```
import type { AgentEvent } from "@suagent/shared";

/**
 * 模拟 SSE 推送过程中发生异常
 */
export function streamErrorScenario(): AgentEvent[] {
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
          query: "React SSE 流式传输"
        }
      }
    },
    {
      type: "tool_result",
      data: {
        toolCallId: "tool-001",
        success: true,
        result: {
          summary: "SSE 是一种基于 HTTP 的服务器推送技术"
        }
      }
    },
    {
      type: "token",
      data: {
        content: "SSE（Server-Sent Events）是一种"
      }
    },
    {
      type: "error",
      data: {
        code: "STREAM_INTERRUPTED",
        message: "流式传输过程中发生异常，连接被迫终止"
      }
    }
  ];
}
```

这里要特别说明：

当前的 `error` 是我们定义的应用层异常事件，并不等同于浏览器底层的网络断开。

后续实现 SSE 时，两者需要分别处理：

| 异常类型     | 来源            | 前端处理                      |
| ------------ | --------------- | ----------------------------- |
| `error` 事件 | 服务端主动推送  | 读取错误信息，更新 ERROR 状态 |
| 网络断开     | HTTP / 网络层   | 捕获读取异常，更新 ERROR 状态 |
| 用户主动停止 | AbortController | 更新 CANCELLED 状态           |

另外，`stream-error` 只是场景名称。真正的网络中断需要在 SSE 推送层模拟，不能仅靠发送一个 `error` 事件实现。

## 3. 当前 Scenario 目录

```
server/src/scenarios/
├── single-tool-call.ts
├── multi-tool-call.ts
├── tool-failure.ts
└── stream-error.ts
```

四个场景的职责：

| Scenario         | 工具调用             | Agent 最终状态 |
| ---------------- | -------------------- | -------------- |
| single-tool-call | 一次成功             | DONE           |
| multi-tool-call  | 多次成功             | DONE           |
| tool-failure     | 工具失败             | DONE           |
| stream-error     | 工具成功，随后流异常 | ERROR          |

## 4. 下一步：SSE 推送模块

接下来进入 `server/src/lib/sse.ts`。

这里我们要解决三个问题：

1. 如何将 `AgentEvent` 转换成标准 SSE 格式？
2. 如何通过 Express 的 `Response` 持续推送事件？
3. 如何处理客户端断开连接，避免继续向已经关闭的连接写入数据？

这一步会把之前定义的 Scenario 和真正的 HTTP 流式传输连接起来。