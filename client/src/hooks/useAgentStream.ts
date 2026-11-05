// 这是客户端流式调用的 React 封装层:把上一节 runAgentScenario(命令式、一次性函数)和 AgentStore(状态管理)接起来,
// 对外暴露 start / stop / isRunning,让组件只需调用即可 ； 核心要解决三件事:并发保护、取消语义、异常状态归类

import { useCallback, useRef } from 'react'
import { runAgentScenario } from '../api/agentStream'
import type { AgentScenario } from '../clientTypes/agent'
import { useAgentStore } from '../stores/agentStore'

export function useAgentStream() {
  // ref + store 选择器
  const controllerRef = useRef<AbortController | null>(null)

  const beginRun = useAgentStore((state) => state.beginRun)
  const handleEvent = useAgentStore((state) => state.handleEvent)
  const interruptRun = useAgentStore((state) => state.interruptRun)
  const failRun = useAgentStore((state) => state.failRun)
  const isRunning = useAgentStore(
    (state) =>
      state.runStatus === 'thinking' || state.runStatus === 'calling_tool',
  )

  // 发起一次运行
  const start = useCallback(
    async (prompt: string, scenario: AgentScenario) => {
      if (controllerRef.current) return   // ① 并发保护

      const controller = new AbortController()
      controllerRef.current = controller
      beginRun(prompt)     // ② 同步进入"运行中"

      try {
        await runAgentScenario(
          scenario,
          controller.signal,
          handleEvent,
        )
      } catch (error) {
        if (controllerRef.current !== controller) {  
          return  // ③ 过期请求忽略
        }
        if (controller.signal.aborted) {
          interruptRun()       // ④ 主动取消
        } else {
          failRun(error instanceof Error ? error.message : 'The Agent request failed.')  // ⑤ 失败
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null         // ⑥ 只清理"自己的"引用
        }
      }
    },
    [beginRun, failRun, handleEvent, interruptRun],
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
