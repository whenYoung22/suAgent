// 定义客户端自己的运行状态、消息、工具调用和场景类型

import type { AgentEvent } from '@suagent/shared'
import type {
  AgentLoopStopReason,
  AgentRunStatus,
  SessionMessageError,
  SessionToolCallStatus,
} from '@suagent/shared/session'

export type RunStatus = | 'idle' | 'thinking' | 'calling_tool' | 'done' | 'error' | 'interrupted'

export type ToolCallStatus = 'running' | 'success' | 'error'

export interface ToolCall {
  toolCallId: string
  toolName: string
  modelRound?: number
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: unknown
  error?: string
}

export interface ChatMessage {
  id: string
  runId?: string
  createdAt?: string
  role: 'user' | 'agent'
  content: string
  thinking: string
  toolCalls: ToolCall[]
  runStatus?: AgentRunStatus
  error?: SessionMessageError | null
  modelRounds?: number
  toolCallCount?: number
  stopReason?: AgentLoopStopReason | null
}

export type AgentEventHandler = (event: AgentEvent) => void

export function toToolCallStatus(status: SessionToolCallStatus): ToolCall['status'] {
  switch (status) {
    case 'running':
      return 'running'
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
  }
}
