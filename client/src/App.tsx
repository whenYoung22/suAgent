import { useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Select, Tag, Typography } from 'antd'
import type { AgentScenario } from './clientTypes/agent'
import { useAgentStream } from './hooks/useAgentStream'
import { useAgentStore } from './stores/agentStore'
import './App.css'

const { Text, Title } = Typography
const { TextArea } = Input

const scenarios = [
  { value: 'single-tool-call', label: '单次工具调用' },
  { value: 'multi-tool-call', label: '连续工具调用' },
  { value: 'tool-failure', label: '工具调用失败' },
  { value: 'stream-error', label: '流式错误' },
] satisfies { value: AgentScenario; label: string }[]

const statusLabels = {
  idle: '就绪',
  thinking: '思考中',
  calling_tool: '调用工具',
  done: '已完成',
  error: '发生错误',
  interrupted: '已停止',
} as const

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2) ?? String(value)
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [scenario, setScenario] = useState<AgentScenario>(scenarios[0].value)
  const { start, stop, isRunning } = useAgentStream()
  const { messages, runStatus, runError } = useAgentStore()
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages])

  const submit = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isRunning) return

    setPrompt('')
    await start(trimmedPrompt, scenario)
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">s</span>
          <span>suAgent</span>
          <Text className="brand-caption">Agent Streaming Workspace</Text>
        </div>
        <Tag color={runStatus === 'error' ? 'error' : runStatus === 'done' ? 'success' : isRunning ? 'processing' : 'default'}>
          {statusLabels[runStatus]}
        </Tag>
      </header>

      <section className="chat-shell">
        <div className="intro">
          <Text className="eyebrow">AGENT WORKSPACE</Text>
          <Title level={2}>你好，有什么可以帮你？</Title>
          <Text type="secondary">观察 Agent 的思考阶段、工具调用和实时回答。</Text>
        </div>

        <div className="transcript" ref={transcriptRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">✳</span>
              <Text strong>开始一次模拟运行</Text>
              <Text type="secondary">选择场景并发送消息，查看事件如何逐步到达。</Text>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <div className="message-label">{message.role === 'user' ? '你' : 'suAgent'}</div>
                {message.content && <div className="message-content">{message.content}</div>}
                {message.thinking && (
                  <div className="thinking-block">
                    <Text type="secondary">处理中</Text>
                    <p>{message.thinking}</p>
                  </div>
                )}
                {message.toolCalls.map((tool) => (
                  <Card className="tool-card" size="small" key={tool.toolCallId}>
                    <div className="tool-heading">
                      <Text strong>{tool.toolName}</Text>
                      <Tag color={tool.status === 'error' ? 'error' : tool.status === 'success' ? 'success' : 'processing'}>
                        {tool.status === 'running' ? '运行中' : tool.status === 'success' ? '成功' : '失败'}
                      </Tag>
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
                ))}
              </article>
            ))
          )}
          {runError && <div className="run-error" role="alert">{runError}</div>}
        </div>

        <div className="composer-wrap">
          <div className="composer-tools">
            <Text type="secondary">调试场景</Text>
            <Select
              aria-label="选择调试场景"
              value={scenario}
              options={scenarios}
              onChange={(value: AgentScenario) => setScenario(value)}
              disabled={isRunning}
            />
          </div>
          <div className="composer">
            <TextArea
              aria-label="输入消息"
              placeholder="输入一条消息…"
              value={prompt}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(event) => setPrompt(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            {isRunning ? (
              <Button danger onClick={stop}>停止</Button>
            ) : (
              <Button type="primary" onClick={() => void submit()} disabled={!prompt.trim()}>
                发送
              </Button>
            )}
          </div>
          <Text className="composer-note" type="secondary">
            当前使用预设事件场景；输入内容仅显示在对话中，不会改变模拟结果。Enter 发送，Shift + Enter 换行。
          </Text>
        </div>
      </section>
    </main>
  )
}

export default App
