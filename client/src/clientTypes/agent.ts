// 定义客户端自己的运行状态、消息、工具调用和场景类型

import type { AgentEvent } from '@suagent/shared'

export type RunStatus = | 'idle' | 'thinking' | 'calling_tool' | 'done' | 'error' | 'interrupted'

export type ToolCallStatus = 'running' | 'success' | 'error'

export interface ToolCall {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: unknown
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  thinking: string
  toolCalls: ToolCall[]
}

export type AgentScenario = | 'single-tool-call' | 'multi-tool-call' | 'tool-failure' | 'stream-error'

export type AgentEventHandler = (event: AgentEvent) => void
