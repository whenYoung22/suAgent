import { useEffect, useRef, useState } from 'react'
import { Alert, Drawer } from 'antd'
import { isScenarioInput } from '../clientTypes/agent'
import { ChatComposer } from '../components/chat/ChatComposer'
import { ChatHeader } from '../components/chat/ChatHeader'
import { MessageList } from '../components/chat/MessageList'
import { SessionSidebar } from '../components/sessions/SessionSidebar'
import { useAgentStream } from '../hooks/useAgentStream'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'
import './ChatPage.css'

function ChatPage() {
  const [prompt, setPrompt] = useState('')
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false)
  const { start, stop, isRunning } = useAgentStream()
  const messages = useAgentStore((state) => state.messages)
  const runStatus = useAgentStore((state) => state.runStatus)
  const runError = useAgentStore((state) => state.runError)
  const sessions = useSessionStore((state) => state.sessions)
  const currentSessionId = useSessionStore((state) => state.currentSessionId)
  const isLoadingSessions = useSessionStore((state) => state.isLoadingSessions)
  const isLoadingSession = useSessionStore((state) => state.isLoadingSession)
  const isMutating = useSessionStore((state) => state.isMutating)
  const sessionError = useSessionStore((state) => state.error)
  const initialize = useSessionStore((state) => state.initialize)
  const selectSession = useSessionStore((state) => state.selectSession)
  const createNewSession = useSessionStore((state) => state.createNewSession)
  const renameSession = useSessionStore((state) => state.renameSession)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const clearError = useSessionStore((state) => state.clearError)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages])

  const currentSession = sessions.find(
    (session) => session.id === currentSessionId,
  )
  const trimmedPrompt = prompt.trim()
  const promptError =
    trimmedPrompt && !isScenarioInput(trimmedPrompt)
      ? '请输入 1、2、3 或 4。'
      : null

  const submit = async () => {
    if (!trimmedPrompt || !isScenarioInput(trimmedPrompt) || isRunning) return
    if (!currentSessionId || isLoadingSession) return

    setPrompt('')
    await start(currentSessionId, trimmedPrompt)
  }

  const sidebarProps = {
    sessions,
    currentSessionId,
    isLoading: isLoadingSessions,
    isBusy: isRunning || isLoadingSession || isMutating,
    onCreate: () => void createNewSession(),
    onSelect: (id: string) => {
      if (id !== currentSessionId) void selectSession(id)
      setIsSessionDrawerOpen(false)
    },
    onRename: renameSession,
    onDelete: (id: string) => void deleteSession(id),
  }

  return (
    <main className="workspace">
      <ChatHeader
        runStatus={runStatus}
        isRunning={isRunning}
        sessionTitle={currentSession?.title ?? '会话'}
        onOpenSessions={() => setIsSessionDrawerOpen(true)}
      />
      <div className="workspace-body">
        <div className="desktop-session-sidebar">
          <SessionSidebar {...sidebarProps} />
        </div>
        <section className="chat-shell">
          <div className="intro">
            <span className="eyebrow">AGENT WORKSPACE</span>
            <h1>你好，有什么可以帮你？</h1>
            <p>输入 1–4 选择演示场景，运行记录会保存在当前会话中。</p>
          </div>
          {sessionError && (
            <Alert
              className="session-error"
              type="error"
              showIcon
              closable
              message={sessionError}
              onClose={clearError}
            />
          )}
          {runError && (
            <Alert
              className="session-error"
              type="error"
              showIcon
              message={runError}
            />
          )}
          <MessageList
            messages={messages}
            runError={null}
            loading={isLoadingSession}
            transcriptRef={transcriptRef}
          />
          <ChatComposer
            prompt={prompt}
            promptError={promptError}
            isRunning={isRunning}
            disabled={!currentSessionId || isLoadingSession}
            onPromptChange={setPrompt}
            onSubmit={() => void submit()}
            onStop={stop}
          />
        </section>
      </div>
      <Drawer
        className="mobile-session-drawer"
        title="会话"
        placement="left"
        width={300}
        open={isSessionDrawerOpen}
        onClose={() => setIsSessionDrawerOpen(false)}
        destroyOnHidden
      >
        <SessionSidebar {...sidebarProps} />
      </Drawer>
    </main>
  )
}

export default ChatPage
