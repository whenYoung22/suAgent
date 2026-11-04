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
