import type { Response } from "express";
import type { AgentEvent } from "@suagent/shared";

/**
 * 初始化 SSE 响应；此处只发送响应头，因此需要 flushHeaders()
 */
export function initSSE(res: Response): void {
  res.status(200);

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // 立即发送响应头，建立 SSE 响应
  res.flushHeaders();
}

/**
 * 将 AgentEvent 编码为 SSE 格式并推送
 */
export function sendSSE(
  res: Response,
  event: AgentEvent
): void {
  // 避免向已经关闭的连接写入数据
  if (res.writableEnded || res.destroyed) {
    return;
  }

  const message = `data: ${JSON.stringify(event)}\n\n`;

  res.write(message);
}

/**
 * 结束 SSE 响应
 */
export function endSSE(res: Response): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.end();
}
