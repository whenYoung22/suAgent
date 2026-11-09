import type { RefObject } from 'react'
import { Spin, Typography } from 'antd'
import type { ChatMessage } from '../../clientTypes/agent'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  runError: string | null
  loading?: boolean
  transcriptRef: RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  runError,
  loading = false,
  transcriptRef,
}: MessageListProps) {
  return (
    <div className="transcript" ref={transcriptRef} aria-live="polite">
      {loading ? (
        <div className="session-loading">
          <Spin tip="正在加载会话…" />
        </div>
      ) : messages.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">✳</span>
          <Typography.Text strong>开始一次模拟运行</Typography.Text>
          <Typography.Text type="secondary">
            输入 1–4 选择演示场景，查看事件如何逐步到达。
          </Typography.Text>
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
  )
}
