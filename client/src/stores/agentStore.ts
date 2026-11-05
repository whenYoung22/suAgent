// 把 SSE 事件流“归约(reduce)”成可渲染的聊天消息模型，同时维护 runStatus 状态机
// useAgentStream 只负责网络与生命周期，真正决定 UI 长什么样的全在这里
// 维护一份 messages 列表 + 一个运行状态机(runStatus)；handleEvent 把 AgentEvent 逐条“折叠”进当前 assistant 消息；
// beginRun / interruptRun / failRun 管理一次运行的开始与两种非正常收尾


import { create } from 'zustand'
import type { AgentEvent } from '@suagent/shared'
import type { ChatMessage, RunStatus } from '../clientTypes/agent'

interface AgentState {
  runStatus: RunStatus
  runError: string | null
  messages: ChatMessage[]
  activeAssistantId: string | null  //核心设计；用 id 定位比“位置”更稳：即使未来支持重排、并发多会话，也不会写错消息
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


export const useAgentStore = create<AgentState>((set, get) => ({
  runStatus: 'idle',
  runError: null,
  messages: [],
  activeAssistantId: null,

  // 开始一次运行
  beginRun: (prompt) => {
    const userMessage = createMessage('user', prompt)
    const assistantMessage = createMessage('assistant', '')
    set((state) => ({
      // 一次 set 同时更新 4 个字段:状态、清错误、追加两条消息、设 active id；原子性，避免中间态渲染
      runStatus: 'thinking',
      runError: null,
      messages: [...state.messages, userMessage, assistantMessage],
      activeAssistantId: assistantMessage.id,
    }))
  },

  // 事件归约(核心)
  handleEvent: (event) => {
    const { activeAssistantId } = get()
    if (!activeAssistantId) return //运行已结束/未开始 → 丢弃

    switch (event.type) {
      case 'thinking':
        set((state) => ({
          runStatus: 'thinking',
          messages: state.messages.map((message) =>
            message.id === activeAssistantId
              ? { ...message, thinking: message.thinking + event.data.content }
              : message,
          ),
        }))
        break
      case 'tool_call':
        set((state) => ({
          runStatus: 'calling_tool',
          messages: state.messages.map((message) =>
            message.id === activeAssistantId
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
            message.id === activeAssistantId
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
            message.id === activeAssistantId
              ? { ...message, content: message.content + event.data.content }
              : message,
          ),
        }))
        break
      case 'done':
        set({ runStatus: 'done', activeAssistantId: null })
        break
      case 'error':
        set({
          runStatus: 'error',
          runError: event.data.message,
          activeAssistantId: null,
        })
        break
    }
  },


  // 两种非流内收尾
  interruptRun: () => {
    if (!get().activeAssistantId) return  // 无运行则忽略(幂等保护)
    set({ runStatus: 'interrupted', activeAssistantId: null })
  },

  failRun: (message) => {
    set({
      runStatus: 'error',
      runError: message,
      activeAssistantId: null,
    })
  },
}))
