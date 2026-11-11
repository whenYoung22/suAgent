import { Spin, Typography } from "antd";
import type { ChatMessage } from "../../../clientTypes/agent";
import { MessageItem } from "../MessageItem";
import "./index.css";

interface MessageListProps {
  messages: ChatMessage[];
  runError: string | null;
  loading?: boolean;
}

export function MessageList({
  messages,
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
          <Spin tip="正在加载会话…" />
        </div>
      ) : messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-intro">
            <span className="empty-icon">✳</span>
            <span className="eyebrow">AGENT WORKSPACE</span>
            <Typography.Title level={3}>你好，有什么可以帮你？</Typography.Title>
          </div>
          <div className="empty-prompt">
            <Typography.Text strong>开始一次模拟运行</Typography.Text>
            <Typography.Text type="secondary">
              输入 1–4 选择演示场景，查看事件如何逐步到达。
            </Typography.Text>
          </div>
        </div>
      ) : (
        messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))
      )}
      {runError && (
        <div className="run-error" role="alert">
          {runError}
        </div>
      )}
    </div>
  );
}
