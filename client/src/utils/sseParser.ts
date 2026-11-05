// 客户端侧的 SSE 解析器   用来把服务端推来的字节流还原成 AgentEvent 对象的解析器
// 三件事:帧切分(处理粘包/半包)、SSE 帧解析、JSON→AgentEvent 安全校验

import type { AgentEvent } from '@suagent/shared'


// 类型守卫:是不是普通对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


// JSON 字符串 → 校验 → AgentEvent
function parseAgentEvent(payload: string): AgentEvent {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new Error('The server sent invalid JSON in an SSE data frame.')
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('The server sent an invalid Agent event.')
  }

  switch (value.type) {
    case 'thinking':
    case 'token': {
      if (!isRecord(value.data) || typeof value.data.content !== 'string') {
        throw new Error(`The server sent an invalid ${value.type} event.`)
      }
      return { type: value.type, data: { content: value.data.content } }
    }
    case 'tool_call': {
      if (
        !isRecord(value.data) ||
        typeof value.data.toolCallId !== 'string' ||
        typeof value.data.toolName !== 'string' ||
        !isRecord(value.data.arguments)
      ) {
        throw new Error('The server sent an invalid tool_call event.')
      }
      return {
        type: 'tool_call',
        data: {
          toolCallId: value.data.toolCallId,
          toolName: value.data.toolName,
          arguments: value.data.arguments,
        },
      }
    }
    case 'tool_result': {
      if (
        !isRecord(value.data) ||
        typeof value.data.toolCallId !== 'string' ||
        typeof value.data.success !== 'boolean' ||
        (value.data.error !== undefined && typeof value.data.error !== 'string')
      ) {
        throw new Error('The server sent an invalid tool_result event.')
      }
      return {
        type: 'tool_result',
        data: {
          toolCallId: value.data.toolCallId,
          success: value.data.success,
          ...(value.data.result !== undefined ? { result: value.data.result } : {}),
          ...(typeof value.data.error === 'string' ? { error: value.data.error } : {}),
        },
      }
    }
    case 'done':
      return { type: 'done' }
    case 'error': {
      if (
        !isRecord(value.data) ||
        typeof value.data.code !== 'string' ||
        typeof value.data.message !== 'string'
      ) {
        throw new Error('The server sent an invalid error event.')
      }
      return {
        type: 'error',
        data: { code: value.data.code, message: value.data.message },
      }
    }
    default:
      throw new Error(`The server sent an unsupported Agent event: ${value.type}`)
  }
}


// 单个 SSE 帧文本 → AgentEvent | undefined
function parseFrame(frame: string): AgentEvent | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))

  if (data.length === 0) return undefined
  return parseAgentEvent(data.join('\n'))
}

// 有状态:push(chunk) 分帧,finish() 收尾
export class SSEParser {
  private buffer = ''

  push(chunk: string): AgentEvent[] {
    this.buffer += chunk
    const events: AgentEvent[] = []
    let boundary = this.buffer.search(/\r?\n\r?\n/)

    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary)
      const separator = this.buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0]
      if (!separator) break
      this.buffer = this.buffer.slice(boundary + separator.length)
      const event = parseFrame(frame)
      if (event) events.push(event)
      boundary = this.buffer.search(/\r?\n\r?\n/)
    }

    return events
  }

  finish(): AgentEvent[] {
    const frame = this.buffer
    this.buffer = ''
    const event = parseFrame(frame)
    return event ? [event] : []
  }
}
