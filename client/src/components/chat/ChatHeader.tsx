import { Tag, Typography } from 'antd'
import type { RunStatus } from '../../clientTypes/agent'

const statusLabels: Record<RunStatus, string> = {
  idle: '就绪',
  thinking: '思考中',
  calling_tool: '调用工具',
  done: '已完成',
  error: '发生错误',
  interrupted: '已停止',
}

interface ChatHeaderProps {
  runStatus: RunStatus
  isRunning: boolean
}

export function ChatHeader({ runStatus, isRunning }: ChatHeaderProps) {
  const statusColor =
    runStatus === 'error'
      ? 'error'
      : runStatus === 'done'
        ? 'success'
        : isRunning
          ? 'processing'
          : 'default'

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">s</span>
        <span>suAgent</span>
        <Typography.Text className="brand-caption">
          Agent Streaming Workspace
        </Typography.Text>
      </div>
      <Tag color={statusColor}>{statusLabels[runStatus]}</Tag>
    </header>
  )
}
