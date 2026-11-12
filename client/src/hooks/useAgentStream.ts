// 这是客户端流式调用的 React 封装层:把会话 API 和 AgentStore(状态管理)接起来,
// 对外暴露 start / stop / isRunning,让组件只需调用即可 ； 核心要解决三件事:并发保护、取消语义、异常状态归类

import { useCallback, useRef, useState } from 'react'
import { runSession } from '../api/agentStream'
import { cancelSessionRun } from '../api/sessions'
import { isScenarioInput } from '../clientTypes/agent'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'

export function useAgentStream() {
  const controllerRef = useRef<AbortController | null>(null)
  const activeRunRef = useRef<{
    sessionId: string
    runId: string | null
  } | null>(null)
  const cancelPromiseRef = useRef<Promise<void> | null>(null)
  const [isStopping, setIsStopping] = useState(false)

  const beginRun = useAgentStore((state) => state.beginRun)
  const handleEvent = useAgentStore((state) => state.handleEvent)
  const interruptRun = useAgentStore((state) => state.interruptRun)
  const failRun = useAgentStore((state) => state.failRun)
  const setActiveRunId = useAgentStore((state) => state.setActiveRunId)
  const refreshSession = useSessionStore((state) => state.refreshSession)
  const setSessionError = useSessionStore((state) => state.setError)
  const isRunningInStore = useAgentStore(
    (state) =>
      state.runStatus === 'thinking' || state.runStatus === 'calling_tool',
  )
  const isRunning = isRunningInStore || isStopping

  // 发起一次运行
  const start = useCallback(
    async (sessionId: string, prompt: string) => {
      if (controllerRef.current) return   // ① 并发保护
      const trimmedPrompt = prompt.trim()
      if (!sessionId) {
        failRun('请先选择或创建一个会话。')
        return
      }
      if (!isScenarioInput(trimmedPrompt)) {
        failRun('请输入 1、2、3 或 4 选择演示场景。')
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      activeRunRef.current = { sessionId, runId: null }
      cancelPromiseRef.current = null
      beginRun(trimmedPrompt)     // ② 同步进入"运行中"
      let requestError: string | null = null

      try {
        await runSession(
          sessionId,
          trimmedPrompt,
          controller.signal,
          handleEvent,
          (runId) => {
            if (activeRunRef.current?.sessionId === sessionId) {
              activeRunRef.current.runId = runId
            }
            setActiveRunId(runId)
          },
        )
      } catch (error) {
        if (controllerRef.current !== controller) {  
          return  // ③ 过期请求忽略
        }
        if (controller.signal.aborted) {
          interruptRun()       // ④ 主动取消
        } else {
          requestError =
            error instanceof Error ? error.message : 'The Agent request failed.'
          failRun(requestError)  // ⑤ 失败
        }
      } finally {
        if (cancelPromiseRef.current) {
          await cancelPromiseRef.current
        }
        const runIdKnown = Boolean(activeRunRef.current?.runId)
        if (!controller.signal.aborted || runIdKnown) {
          await refreshSession(sessionId)
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null
          activeRunRef.current = null
          cancelPromiseRef.current = null
        }
        if (requestError) failRun(requestError)
        setIsStopping(false)
      }
    },
    [
      beginRun,
      failRun,
      handleEvent,
      interruptRun,
      refreshSession,
      setActiveRunId,
    ],
  )

  const stop = useCallback(() => {
    const controller = controllerRef.current
    if (!controller || cancelPromiseRef.current) return

    interruptRun()
    setIsStopping(true)
    const activeRun = activeRunRef.current
    if (activeRun?.runId) {
      cancelPromiseRef.current = cancelSessionRun(
        activeRun.sessionId,
        activeRun.runId,
      ).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown cancellation error.'
        setSessionError(`无法确认服务端中断：${message}`)
      })
    }
    controller.abort()
  }, [interruptRun, setSessionError])

  return {
    start,
    stop,
    isRunning,
  }
}
