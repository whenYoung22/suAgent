// 这是客户端流式调用的 React 封装层:把会话 API 和 AgentStore(状态管理)接起来,
// 对外暴露 start / stop / isRunning,让组件只需调用即可 ； 核心要解决三件事:并发保护、取消语义、异常状态归类

import { useCallback, useRef } from 'react'
import { runSession } from '../api/agentStream'
import { isScenarioInput } from '../clientTypes/agent'
import { useAgentStore } from '../stores/agentStore'
import { useSessionStore } from '../stores/sessionStore'

export function useAgentStream() {
  // ref + store 选择器
  const controllerRef = useRef<AbortController | null>(null)

  const beginRun = useAgentStore((state) => state.beginRun)
  const handleEvent = useAgentStore((state) => state.handleEvent)
  const interruptRun = useAgentStore((state) => state.interruptRun)
  const failRun = useAgentStore((state) => state.failRun)
  const setActiveRunId = useAgentStore((state) => state.setActiveRunId)
  const refreshSession = useSessionStore((state) => state.refreshSession)
  const isRunning = useAgentStore(
    (state) =>
      state.runStatus === 'thinking' || state.runStatus === 'calling_tool',
  )

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
      beginRun(trimmedPrompt)     // ② 同步进入"运行中"
      let requestError: string | null = null

      try {
        await runSession(
          sessionId,
          trimmedPrompt,
          controller.signal,
          handleEvent,
          setActiveRunId,
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
        if (controllerRef.current === controller) {
          controllerRef.current = null         // ⑥ 只清理"自己的"引用
        }
        await refreshSession(sessionId)
        if (requestError) failRun(requestError)
      }
    },
    [beginRun, failRun, handleEvent, interruptRun, refreshSession, setActiveRunId],
  )

  const stop = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return

    interruptRun()   // ① 先更新 UI 状态
    controller.abort()  // ② 再中止请求
    controllerRef.current = null  // ③ 立即清 ref
  }, [interruptRun])

  return {
    start,
    stop,
    isRunning,
  }
}
