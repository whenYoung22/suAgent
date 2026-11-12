import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../clientTypes/agent'
import { Avatar } from 'antd'
import { ToolCallCard } from '../ToolCallCard'
import './index.css'

const remarkPlugins = [remarkGfm]

interface MessageItemProps {
  message: ChatMessage
}

export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
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
