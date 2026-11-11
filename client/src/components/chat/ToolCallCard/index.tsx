import { Card, Tag, Typography } from 'antd'
import type { ToolCall } from '../../../clientTypes/agent'
import './index.css'

const { Text } = Typography

interface ToolCallCardProps {
  tool: ToolCall
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2) ?? String(value)
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const statusColor =
    tool.status === 'error'
      ? 'error'
      : tool.status === 'success'
        ? 'success'
        : 'processing'
  const statusLabel =
    tool.status === 'running'
      ? '运行中'
      : tool.status === 'success'
        ? '成功'
        : '失败'

  return (
    <Card className="tool-card" size="small">
      <div className="tool-heading">
        <Text strong>{tool.toolName}</Text>
        <Tag color={statusColor}>{statusLabel}</Tag>
      </div>
      <details>
        <summary>查看参数与结果</summary>
        <Text className="code-label">参数</Text>
        <pre>{formatValue(tool.arguments)}</pre>
        {tool.result !== undefined && (
          <>
            <Text className="code-label">结果</Text>
            <pre>{formatValue(tool.result)}</pre>
          </>
        )}
        {tool.error && <Text type="danger">{tool.error}</Text>}
      </details>
    </Card>
  )
}
