// 用 fetch 发起 POST,拿到流式响应
// 边读边解析成 AgentEvent,通过 onEvent 逐条回调,并保证"要么收到终止事件,要么抛错"。

import type { AgentEventHandler, AgentScenario } from '../clientTypes/agent'
import { SSEParser } from '../utils/sseParser'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function runAgentScenario(
  scenario: AgentScenario,  // 选哪个场景
  signal: AbortSignal,  // 外部取消信号
  onEvent: AgentEventHandler,   // 每解析出一个事件就回调
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
    signal,
  })

  // 两层前置校验
  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      details || `Agent request failed with HTTP ${response.status}.`,
    )
  }
  if (!response.body) {
    throw new Error('The server did not provide an event stream.')
  }

  // 读取三件套
  const reader = response.body.getReader()  // 字节流读取器
  const decoder = new TextDecoder()     // 字节 → 字符串
  const parser = new SSEParser()   // 字符串 → AgentEvent
  let receivedTerminalEvent = false

  // 统一消费入口
  const dispatch = (events: ReturnType<SSEParser['finish']>) => {
    for (const event of events) {
      onEvent(event)
      if (event.type === 'done' || event.type === 'error') {
        receivedTerminalEvent = true
      }
    }
  }

  // 主读取循环(核心)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      dispatch(parser.push(decoder.decode(value, { stream: true })))
    }

    dispatch(parser.push(decoder.decode()))  // ① 冲刷解码器残留
    dispatch(parser.finish())        // ② 处理 parser 残留帧
  } finally {
    reader.releaseLock()
  }

  // 收尾校验:必须收到终止事件
  if (!receivedTerminalEvent) {
    throw new Error('The event stream ended before the Agent completed.')
  }
}