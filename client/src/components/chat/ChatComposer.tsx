import { Button, Input, Select, Typography } from 'antd'
import type { AgentScenario } from '../../clientTypes/agent'

const { TextArea } = Input

const scenarios = [
  { value: 'single-tool-call', label: '单次工具调用' },
  { value: 'multi-tool-call', label: '连续工具调用' },
  { value: 'tool-failure', label: '工具调用失败' },
  { value: 'stream-error', label: '流式错误' },
] satisfies { value: AgentScenario; label: string }[]

interface ChatComposerProps {
  prompt: string
  scenario: AgentScenario
  isRunning: boolean
  onPromptChange: (prompt: string) => void
  onScenarioChange: (scenario: AgentScenario) => void
  onSubmit: () => void
  onStop: () => void
}

export function ChatComposer({
  prompt,
  scenario,
  isRunning,
  onPromptChange,
  onScenarioChange,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  return (
    <div className="composer-wrap">
      <div className="composer-tools">
        <Typography.Text type="secondary">调试场景</Typography.Text>
        <Select
          aria-label="选择调试场景"
          value={scenario}
          options={scenarios}
          onChange={onScenarioChange}
          disabled={isRunning}
        />
      </div>
      <div className="composer">
        <TextArea
          aria-label="输入消息"
          placeholder="输入一条消息…"
          value={prompt}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onChange={(event) => onPromptChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
        />
        {isRunning ? (
          <Button danger onClick={onStop}>
            停止
          </Button>
        ) : (
          <Button type="primary" onClick={onSubmit} disabled={!prompt.trim()}>
            发送
          </Button>
        )}
      </div>
      <Typography.Text className="composer-note" type="secondary">
        当前使用预设事件场景；输入内容仅显示在对话中，不会改变模拟结果。Enter
        发送，Shift + Enter 换行。
      </Typography.Text>
    </div>
  )
}
