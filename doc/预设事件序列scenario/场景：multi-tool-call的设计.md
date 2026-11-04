接下来实现第二个场景：`multi-tool-call.ts`。

这次重点不是增加事件数量，而是验证前端能否同时管理多个 Tool Card，并正确关联各自的调用和执行结果。

## 1. 先明确事件流程

我们模拟 Agent 连续调用两个工具：

```
thinking：分析用户问题
    ↓
tool_call：调用 search
    ↓
tool_result：search 成功
    ↓
thinking：分析搜索结果
    ↓
tool_call：调用 weather
    ↓
tool_result：weather 成功
    ↓
thinking：整理最终回答
    ↓
token：输出回答片段
    ↓
token：继续输出回答片段
    ↓
done：结束
```

这里两个工具分别是：

+ `search`：搜索相关信息。
+ `weather`：获取天气信息。

注意：它们只是模拟工具，不会真正执行搜索或查询天气。

## 2. 创建 multi-tool-call.ts

在 `server/src/scenarios/` 下新建文件：

```
import type { AgentEvent } from "@suagent/shared";

/**
 * 模拟 Agent 连续调用两个工具
 */
export function multiToolCallScenario(): AgentEvent[] {
  return [
    {
      type: "thinking",
      data: {
        content: "需要先搜索目的地信息，再获取当地天气..."
      }
    },

    // 第一次工具调用：搜索
    {
      type: "tool_call",
      data: {
        toolCallId: "tool-001",
        toolName: "search",
        arguments: {
          query: "云南大理旅游景点"
        }
      }
    },
    {
      type: "tool_result",
      data: {
        toolCallId: "tool-001",
        success: true,
        result: {
          summary: "搜索到大理古城、洱海等热门景点"
        }
      }
    },

    {
      type: "thinking",
      data: {
        content: "已获取目的地信息，接下来查询当地天气..."
      }
    },

    // 第二次工具调用：天气
    {
      type: "tool_call",
      data: {
        toolCallId: "tool-002",
        toolName: "weather",
        arguments: {
          city: "大理"
        }
      }
    },
    {
      type: "tool_result",
      data: {
        toolCallId: "tool-002",
        success: true,
        result: {
          temperature: "18°C",
          condition: "晴"
        }
      }
    },

    {
      type: "thinking",
      data: {
        content: "信息已收集完毕，正在组织回答..."
      }
    },

    // 模拟流式输出
    {
      type: "token",
      data: {
        content: "大理有大理古城和洱海等热门景点。"
      }
    },
    {
      type: "token",
      data: {
        content: "目前模拟天气为晴天，气温 18°C。"
      }
    },
    {
      type: "done"
    }
  ];
}
```

## 3. 这里有三个值得注意的设计

### ① 为什么 toolCallId 必须唯一？

现在有两组调用和结果：

| 事件               | toolCallId |
| ------------------ | ---------- |
| 第一次 tool_call   | tool-001   |
| 第一次 tool_result | tool-001   |
| 第二次 tool_call   | tool-002   |
| 第二次 tool_result | tool-002   |

前端后续会根据 `toolCallId` 更新对应的 Tool Card。

如果两个工具都使用 `tool-001`，就可能出现结果关联错误。

### ② 为什么第二次调用之前有 thinking？

这是为了模拟 Agent 在获得第一次工具结果后，再进行下一步分析。

但需要明确：当前的 thinking 是预设事件，不代表后端真的进行了推理或决策。

### ③ 为什么这里采用串行工具调用？

当前事件顺序是：

```
tool-001 调用 → tool-001 结果
                    ↓
tool-002 调用 → tool-002 结果
```

这是连续调用，不是并行调用。

未来如果需要测试并行工具调用，可以设计：

```
tool-001 调用
tool-002 调用
    ↓
tool-002 结果
tool-001 结果
```

这样能进一步测试前端的异步结果关联能力，但 V1 暂时不需要增加这个场景。

## 4. 类型检查

在 `server` 目录执行：

```
npx tsc --noEmit
```

没有报错即可。

## 5. 当前 Scenario 进度

| 文件                  | 状态     | 测试目标           |
| --------------------- | -------- | ------------------ |
| `single-tool-call.ts` | 已设计   | 单次工具调用       |
| `multi-tool-call.ts`  | 当前实现 | 连续多次工具调用   |
| `tool-failure.ts`     | 待实现   | 工具失败后继续回答 |
| `stream-error.ts`     | 待实现   | SSE 流异常终止     |

下一步实现 `tool-failure.ts`。需要特别区分：工具执行失败不等于 Agent 整个运行失败。 这个场景会帮助我们明确 `tool_result` 和 `error` 两种事件的边界。