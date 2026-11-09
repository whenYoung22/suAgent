// Agent 运行状态
export type AgentRunStatus = | 'running' | 'completed' | 'interrupted' | 'failed'

// 工具调用状态
export type SessionToolCallStatus = 'running' | 'succeeded' | 'failed'

// 回话摘要
export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  lastActivityAt: string
}

// 工具调用
export interface SessionToolCall {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  status: SessionToolCallStatus
  result?: unknown
  errorMessage?: string
  startedAt: string
  finishedAt: string | null
}

// 消息错误
export interface SessionMessageError {
  code: string
  message: string
}

// 消息模型 基础
interface SessionMessageBase {
  id: string
  runId: string
  content: string
  createdAt: string
}

// 用户消息
export interface UserSessionMessage extends SessionMessageBase {
  role: 'user'
}

// Agent消息
export interface AgentSessionMessage extends SessionMessageBase {
  role: 'agent'
  thinking: string
  toolCalls: SessionToolCall[]
  runStatus: AgentRunStatus
  error: SessionMessageError | null
}

// 判别联合消息类型 用户|Agent
export type SessionMessage = UserSessionMessage | AgentSessionMessage

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[]
}


// 列表与创建

export type ListSessionsRequest = Record<string, never>

export interface ListSessionsResponse {
  sessions: SessionSummary[]
}

export type CreateSessionRequest = Record<string, never>

export interface CreateSessionResponse {
  session: SessionSummary
}

export interface UpdateSessionTitleRequest {
  title: string
}

export interface UpdateSessionTitleResponse {
  session: SessionSummary
}

export interface RunSessionRequest {
  prompt: string
}


// 获取与删除

export interface GetSessionRequest {
  id: string
}

export interface GetSessionResponse {
  session: SessionDetail
}

export interface DeleteSessionRequest {
  id: string
}

export type DeleteSessionResponse = void

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
