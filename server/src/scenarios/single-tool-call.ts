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
