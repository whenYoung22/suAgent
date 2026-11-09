// 把 SSE 事件流“归约(reduce)”成可渲染的聊天消息模型，同时维护 runStatus 状态机
// useAgentStream 只负责网络与生命周期，真正决定 UI 长什么样的全在这里
// 维护一份 messages 列表 + 一个运行状态机(runStatus)；handleEvent 把 AgentEvent 逐条“折叠”进当前 agent 消息；
// beginRun / interruptRun / failRun 管理一次运行的开始与两种非正常收尾


import { create } from 'zustand'
import type { AgentEvent } from '@suagent/shared'
import type {
  SessionMessage,
  SessionToolCall,
} from '@suagent/shared/session'
import { toToolCallStatus } from '../clientTypes/agent'
import type { ChatMessage, RunStatus } from '../clientTypes/agent'

interface AgentState {
  runStatus: RunStatus
  runError: string | null
  messages: ChatMessage[]
  activeAgentMessageId: string | null  //核心设计；用 id 定位比“位置”更稳：即使未来支持重排、并发多会话，也不会写错消息
  loadSessionMessages: (messages: SessionMessage[]) => void
  clearSession: () => void
  setActiveRunId: (runId: string) => void
  beginRun: (prompt: string) => void
  handleEvent: (event: AgentEvent) => void
  interruptRun: () => void
  failRun: (message: string) => void
}

// 消息工厂
function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    thinking: '',
    toolCalls: [],
  }
}

function toChatToolCall(tool: SessionToolCall): ChatMessage['toolCalls'][number] {
  return {
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    arguments: tool.arguments,
    status: toToolCallStatus(tool.status),
    ...(tool.result === undefined ? {} : { result: tool.result }),
    ...(tool.errorMessage === undefined ? {} : { error: tool.errorMessage }),
  }
}

function toChatMessage(message: SessionMessage): ChatMessage {
  if (message.role === 'user') {
    return {
      id: message.id,
      runId: message.runId,
      createdAt: message.createdAt,
      role: 'user',
      content: message.content,
      thinking: '',
      toolCalls: [],
    }
  }

  return {
    id: message.id,
    runId: message.runId,
    createdAt: message.createdAt,
    role: 'agent',
    content: message.content,
    thinking: message.thinking,
    toolCalls: message.toolCalls.map(toChatToolCall),
    runStatus: message.runStatus,
    error: message.error,
  }
}

function toRunStatus(status: NonNullable<ChatMessage['runStatus']>): RunStatus {
  switch (status) {
    case 'running':
      return 'thinking'
    case 'completed':
      return 'done'
    case 'interrupted':
      return 'interrupted'
    case 'failed':
      return 'error'
  }
}


export const useAgentStore = create<AgentState>((set, get) => ({
  runStatus: 'idle',
  runError: null,
  messages: [],
  activeAgentMessageId: null,

  loadSessionMessages: (sessionMessages) => {
    const messages = sessionMessages.map(toChatMessage)
    const latestAgent = [...messages].reverse().find((message) => message.role === 'agent')
    set({
      messages,
      activeAgentMessageId: null,
      runStatus: latestAgent?.runStatus ? toRunStatus(latestAgent.runStatus) : 'idle',
      runError: null,
    })
  },

  clearSession: () => {
    set({
      messages: [],
      activeAgentMessageId: null,
      runStatus: 'idle',
      runError: null,
    })
  },

  setActiveRunId: (runId) => {
    const activeAgentMessageId = get().activeAgentMessageId
    set((state) => {
      const activeAgentIndex = state.messages.findIndex(
        (message) => message.id === activeAgentMessageId,
      )
      return {
        messages: state.messages.map((message, index) =>
          message.id === activeAgentMessageId ||
          (index === activeAgentIndex - 1 && message.role === 'user')
            ? { ...message, runId }
            : message,
        ),
      }
    })
  },

  // 开始一次运行
  beginRun: (prompt) => {
    const userMessage = createMessage('user', prompt)
    const agentMessage = createMessage('agent', '')
    set((state) => ({
      // 一次 set 同时更新 4 个字段:状态、清错误、追加两条消息、设 active id；原子性，避免中间态渲染
      runStatus: 'thinking',
      runError: null,
      messages: [...state.messages, userMessage, agentMessage],
      activeAgentMessageId: agentMessage.id,
    }))
  },

  // 事件归约(核心)
  handleEvent: (event) => {
    const { activeAgentMessageId } = get()
    if (!activeAgentMessageId) return //运行已结束/未开始 → 丢弃

    switch (event.type) {
      case 'thinking':
        set((state) => ({
          runStatus: 'thinking',
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? { ...message, thinking: message.thinking + event.data.content }
              : message,
          ),
        }))
        break
      case 'tool_call':
        set((state) => ({
          runStatus: 'calling_tool',
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? {
                  ...message,
                  toolCalls: [
                    ...message.toolCalls,
                    {
                      toolCallId: event.data.toolCallId,
                      toolName: event.data.toolName,
                      arguments: event.data.arguments,
                      status: 'running',
                    },
                  ],
                }
              : message,
          ),
        }))
        break
      case 'tool_result':
        set((state) => ({
          runStatus: 'thinking',
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? {
                  ...message,
                  toolCalls: message.toolCalls.map((tool) =>
                    tool.toolCallId === event.data.toolCallId
                      ? {
                          ...tool,
                          status: event.data.success ? 'success' : 'error',
                          result: event.data.result,
                          error: event.data.error,
                        }
                      : tool,
                  ),
                }
              : message,
          ),
        }))
        break
      case 'token':
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? { ...message, content: message.content + event.data.content }
              : message,
          ),
        }))
        break
      case 'done':
        set((state) => ({
          runStatus: 'done',
          activeAgentMessageId: null,
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? { ...message, runStatus: 'completed' }
              : message,
          ),
        }))
        break
      case 'error':
        set((state) => ({
          runStatus: 'error',
          runError: event.data.message,
          activeAgentMessageId: null,
          messages: state.messages.map((message) =>
            message.id === activeAgentMessageId
              ? {
                  ...message,
                  runStatus: 'failed',
                  error: { code: event.data.code, message: event.data.message },
                }
              : message,
          ),
        }))
        break
    }
  },


  // 两种非流内收尾
  interruptRun: () => {
    if (!get().activeAgentMessageId) return  // 无运行则忽略(幂等保护)
    const activeAgentMessageId = get().activeAgentMessageId
    set((state) => ({
      runStatus: 'interrupted',
      activeAgentMessageId: null,
      messages: state.messages.map((message) =>
        message.id === activeAgentMessageId
          ? { ...message, runStatus: 'interrupted' }
          : message,
      ),
    }))
  },

  failRun: (message) => {
    const activeAgentMessageId = get().activeAgentMessageId
    set((state) => ({
      runStatus: 'error',
      runError: message,
      activeAgentMessageId: null,
      messages: state.messages.map((item) =>
        item.id === activeAgentMessageId
          ? {
              ...item,
              runStatus: 'failed',
              error: { code: 'CLIENT_ERROR', message },
            }
          : item,
      ),
    }))
  },
}))
