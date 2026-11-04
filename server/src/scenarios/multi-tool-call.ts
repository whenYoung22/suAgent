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
