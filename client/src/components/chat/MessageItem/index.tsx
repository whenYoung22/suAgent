import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../clientTypes/agent'
import { Avatar, Spin } from 'antd'
import { ToolCallCard } from '../ToolCallCard'
import './index.css'

const remarkPlugins = [remarkGfm]

interface MessageItemProps {
  message: ChatMessage
  isWaitingForResponse?: boolean
}

export const MessageItem = memo(function MessageItem({
  message,
  isWaitingForResponse = false,
}: MessageItemProps) {
  return (
    <article className={`message message-${message.role}`}>
      {message.role === 'user' && (
        <Avatar className="message-avatar">苏</Avatar>
      )}
      <div className="message-body">
        <div className="message-label">
          {message.role === 'user' ? '你' : 'suAgent'}
        </div>
        {message.content && (
          <div className="message-content">
            <ReactMarkdown remarkPlugins={remarkPlugins}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {isWaitingForResponse && (
          <div className="thinking-indicator" role="status">
            <Spin size="small" />
            <span>思考中…</span>
          </div>
        )}
        {message.thinking && (
          <div className="thinking-block">
            <span>处理中</span>
            <p>{message.thinking}</p>
          </div>
        )}
        {message.toolCalls.map((tool) => (
          <ToolCallCard key={tool.toolCallId} tool={tool} />
        ))}
        {message.error && (
          <div className="run-error" role="alert">
            {message.error.message}
          </div>
        )}
      </div>
    </article>
  )
})
