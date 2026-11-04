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
