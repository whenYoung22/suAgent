import type { RefObject } from 'react'
import { Typography } from 'antd'
import type { ChatMessage } from '../../clientTypes/agent'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  runError: string | null
  transcriptRef: RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  runError,
  transcriptRef,
}: MessageListProps) {
  return (
    <div className="transcript" ref={transcriptRef} aria-live="polite">
      {messages.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">✳</span>
          <Typography.Text strong>开始一次模拟运行</Typography.Text>
          <Typography.Text type="secondary">
            选择场景并发送消息，查看事件如何逐步到达。
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
