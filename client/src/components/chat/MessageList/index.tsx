import { Spin, Typography } from "antd";
import type { ChatMessage, RunStatus } from "../../../clientTypes/agent";
import { MessageItem } from "../MessageItem";
import "./index.css";

interface MessageListProps {
  messages: ChatMessage[];
  runStatus: RunStatus;
  activeAgentMessageId: string | null;
  runError: string | null;
  loading?: boolean;
}

export function MessageList({
  messages,
  runStatus,
  activeAgentMessageId,
  runError,
  loading = false,
}: MessageListProps) {
  const isEmpty = !loading && messages.length === 0

  return (
    <div
      className={`transcript${isEmpty ? ' transcript-empty' : ''}`}
      aria-live="polite"
    >
      {loading ? (
        <div className="message-list-loading">
          <Spin description="正在加载会话…" />
        </div>
      ) : messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-intro">
            <span className="empty-icon">✳</span>
            <span className="eyebrow">AGENT WORKSPACE</span>
            <Typography.Title level={3}>你好，有什么可以帮你？</Typography.Title>
          </div>
          <div className="empty-prompt">
            <Typography.Text strong>开始一次对话</Typography.Text>
            <Typography.Text type="secondary">
              输入自然语言开始对话；Mock 模式下输入 1–4 可查看演示场景。
            </Typography.Text>
          </div>
        </div>
      ) : (
        messages.map((message) => {
          const hasRunningTool = message.toolCalls.some(
            (tool) => tool.status === 'running',
          )
          const isWaitingForResponse =
            message.id === activeAgentMessageId &&
            runStatus === 'thinking' &&
            !message.content &&
            !message.thinking &&
            !hasRunningTool

          return (
            <MessageItem
              key={message.id}
              message={message}
              isWaitingForResponse={isWaitingForResponse}
            />
          )
        })
      )}
      {runError && (
        <div className="run-error" role="alert">
          {runError}
        </div>
      )}
    </div>
  );
}
