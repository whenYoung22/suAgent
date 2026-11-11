import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Typography } from 'antd'
import { isScenarioInput } from '../../clientTypes/agent'
import { ChatComposer } from '../../components/chat/ChatComposer'
import { MessageList } from '../../components/chat/MessageList'
import { SessionSidebar } from '../../components/sessions/SessionSidebar'
import { useAgentStream } from '../../hooks/useAgentStream'
import { useAgentStore } from '../../stores/agentStore'
import { useSessionStore } from '../../stores/sessionStore'
import './index.css'

function ChatPage() {
  const [prompt, setPrompt] = useState('')
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const { start, stop, isRunning } = useAgentStream()
  const messages = useAgentStore((state) => state.messages)
  const runError = useAgentStore((state) => state.runError)
  const sessions = useSessionStore((state) => state.sessions)
  const currentSessionId = useSessionStore((state) => state.currentSessionId)
  const isLoadingSessions = useSessionStore((state) => state.isLoadingSessions)
  const isLoadingSession = useSessionStore((state) => state.isLoadingSession)
  const isMutating = useSessionStore((state) => state.isMutating)
  const sessionError = useSessionStore((state) => state.error)
  const initialize = useSessionStore((state) => state.initialize)
  const selectSession = useSessionStore((state) => state.selectSession)
  const startNewChat = useSessionStore((state) => state.startNewChat)
  const createSessionForPrompt = useSessionStore(
    (state) => state.createSessionForPrompt,
  )
  const renameSession = useSessionStore((state) => state.renameSession)
  const deleteSession = useSessionStore((state) => state.deleteSession)
  const clearError = useSessionStore((state) => state.clearError)
  const chatContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const chatContent = chatContentRef.current
    if (chatContent) chatContent.scrollTop = chatContent.scrollHeight
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
    if (isLoadingSessions || isLoadingSession || isMutating) return

    const sessionId =
      currentSessionId ?? (await createSessionForPrompt())
    if (!sessionId) return

    setPrompt('')
    await start(sessionId, trimmedPrompt)
  }

  const sidebarProps = {
    sessions,
    currentSessionId,
    isLoading: isLoadingSessions,
    isBusy: isRunning || isLoadingSession || isMutating,
    isCollapsed: isSidebarCollapsed,
    onToggleCollapse: () => setIsSidebarCollapsed((collapsed) => !collapsed),
    onCreate: () => void startNewChat(),
    onSelect: (id: string) => {
      if (id !== currentSessionId) void selectSession(id)
      setIsSessionDrawerOpen(false)
    },
    onRename: renameSession,
    onDelete: deleteSession,
  }

  return (
    <main className="workspace">
      <div className="workspace-body">
        <div
          className={`desktop-session-sidebar${isSidebarCollapsed ? ' collapsed' : ''}`}
        >
          <SessionSidebar {...sidebarProps} />
        </div>


        <section className="chat-shell">
          <div className="mobile-chat-toolbar">
            <Button onClick={() => setIsSessionDrawerOpen(true)}>会话</Button>
            <Typography.Text className="mobile-current-session" ellipsis>
              {currentSession?.title ?? '会话'}
            </Typography.Text>
          </div>
          <div className="chat-content-scroll" ref={chatContentRef}>
            <div className="chat-content-inner">
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
              />
            </div>
          </div>
          <div className="chat-composer-overlay">
            <ChatComposer
              prompt={prompt}
              promptError={promptError}
              isRunning={isRunning}
              disabled={
                isLoadingSessions || isLoadingSession || isMutating
              }
              onPromptChange={setPrompt}
              onSubmit={() => void submit()}
              onStop={stop}
            />
          </div>
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
        <SessionSidebar {...sidebarProps} isCollapsed={false} />
      </Drawer>
    </main>
  )
}

export default ChatPage
