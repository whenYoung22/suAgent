import type { ChatMessage } from '../../clientTypes/agent'
import { ToolCallCard } from './ToolCallCard'

interface MessageItemProps {
  message: ChatMessage
}

export function MessageItem({ message }: MessageItemProps) {
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-label">
        {message.role === 'user' ? '你' : 'suAgent'}
      </div>
      {message.content && (
        <div className="message-content">{message.content}</div>
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
    </article>
  )
}
