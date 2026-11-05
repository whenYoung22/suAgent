import { useEffect, useRef, useState } from 'react'
import type { AgentScenario } from '../clientTypes/agent'
import { ChatComposer } from '../components/chat/ChatComposer'
import { ChatHeader } from '../components/chat/ChatHeader'
import { MessageList } from '../components/chat/MessageList'
import { useAgentStream } from '../hooks/useAgentStream'
import { useAgentStore } from '../stores/agentStore'
import './ChatPage.css'

function ChatPage() {
  const [prompt, setPrompt] = useState('')
  const [scenario, setScenario] = useState<AgentScenario>('single-tool-call')
  const { start, stop, isRunning } = useAgentStream()
  const messages = useAgentStore((state) => state.messages)
  const runStatus = useAgentStore((state) => state.runStatus)
  const runError = useAgentStore((state) => state.runError)
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
      <ChatHeader runStatus={runStatus} isRunning={isRunning} />
      <section className="chat-shell">
        <div className="intro">
          <span className="eyebrow">AGENT WORKSPACE</span>
          <h1>你好，有什么可以帮你？</h1>
          <p>观察 Agent 的思考阶段、工具调用和实时回答。</p>
        </div>
        <MessageList
          messages={messages}
          runError={runError}
          transcriptRef={transcriptRef}
        />
        <ChatComposer
          prompt={prompt}
          scenario={scenario}
          isRunning={isRunning}
          onPromptChange={setPrompt}
          onScenarioChange={setScenario}
          onSubmit={() => void submit()}
          onStop={stop}
        />
      </section>
    </main>
  )
}

export default ChatPage
