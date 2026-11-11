import { create } from 'zustand'
import type { SessionSummary } from '@suagent/shared/session'
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  getSession,
  listSessions,
  updateSessionTitle,
} from '../api/sessions'
import { useAgentStore } from './agentStore'

interface SessionState {
  sessions: SessionSummary[]
  currentSessionId: string | null
  isLoadingSessions: boolean
  isLoadingSession: boolean
  isMutating: boolean
  initialized: boolean
  error: string | null
  initialize: () => Promise<void>
  selectSession: (id: string) => Promise<void>
  startNewChat: () => Promise<void>
  createSessionForPrompt: () => Promise<string | null>
  renameSession: (id: string, title: string) => Promise<boolean>
  deleteSession: (id: string) => Promise<void>
  refreshSession: (id: string) => Promise<void>
  clearError: () => void
}

let detailRequestVersion = 0

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '会话操作失败，请重试。'
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  isLoadingSessions: false,
  isLoadingSession: false,
  isMutating: false,
  initialized: false,
  error: null,

  initialize: async () => {
    if (get().initialized || get().isLoadingSessions) return
    set({ isLoadingSessions: true, error: null })

    try {
      const sessions = await listSessions()
      set({ sessions, initialized: true })
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set({ isLoadingSessions: false })
    }
  },

  selectSession: async (id) => {
    const requestVersion = ++detailRequestVersion
    set({
      currentSessionId: id,
      isLoadingSession: true,
      error: null,
    })
    useAgentStore.getState().clearSession()

    try {
      const session = await getSession(id)
      if (
        requestVersion !== detailRequestVersion ||
        get().currentSessionId !== id
      ) {
        return
      }
      useAgentStore.getState().loadSessionMessages(session.messages)
      set((state) => ({
        sessions: state.sessions.map((summary) =>
          summary.id === session.id ? session : summary,
        ),
      }))
    } catch (error) {
      if (requestVersion === detailRequestVersion) {
        set({ error: getErrorMessage(error) })
      }
    } finally {
      if (requestVersion === detailRequestVersion) {
        set({ isLoadingSession: false })
      }
    }
  },

  startNewChat: async () => {
    detailRequestVersion += 1
    set({
      currentSessionId: null,
      isLoadingSession: false,
      error: null,
    })
    useAgentStore.getState().clearSession()
  },

  createSessionForPrompt: async () => {
    set({ isMutating: true, error: null })
    try {
      const session = await createSessionRequest()
      detailRequestVersion += 1
      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSessionId: session.id,
        isLoadingSession: false,
      }))
      useAgentStore.getState().clearSession()
      return session.id
    } catch (error) {
      set({ error: getErrorMessage(error) })
      return null
    } finally {
      set({ isMutating: false })
    }
  },

  renameSession: async (id, title) => {
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0 || trimmedTitle.length > 15) {
      set({ error: '标题需为 1–15 个字符。' })
      return false
    }

    set({ isMutating: true, error: null })
    try {
      const session = await updateSessionTitle(id, trimmedTitle)
      set((state) => ({
        sessions: state.sessions.map((summary) =>
          summary.id === id ? session : summary,
        ),
      }))
      return true
    } catch (error) {
      set({ error: getErrorMessage(error) })
      return false
    } finally {
      set({ isMutating: false })
    }
  },

  deleteSession: async (id) => {
    set({ isMutating: true, error: null })
    try {
      await deleteSessionRequest(id)
      const remaining = get().sessions.filter((session) => session.id !== id)
      set({ sessions: remaining })

      if (get().currentSessionId === id) {
        detailRequestVersion += 1
        set({ currentSessionId: null })
        useAgentStore.getState().clearSession()
        if (remaining.length > 0) {
          await get().selectSession(remaining[0].id)
        }
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set({ isMutating: false })
    }
  },

  refreshSession: async (id) => {
    const requestVersion = ++detailRequestVersion
    try {
      const session = await getSession(id)
      if (
        requestVersion !== detailRequestVersion ||
        get().currentSessionId !== id
      ) {
        return
      }
      useAgentStore.getState().loadSessionMessages(session.messages)
      set((state) => ({
        sessions: [
          session,
          ...state.sessions.filter((summary) => summary.id !== id),
        ],
      }))
    } catch (error) {
      if (get().currentSessionId === id) {
        set({ error: getErrorMessage(error) })
      }
    }
  },

  clearError: () => set({ error: null }),
}))
