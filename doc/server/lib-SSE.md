现在实现 `server/src/lib/sseSender.ts`。

这个模块是后端的 SSE 传输工具层。它不关心 Agent 做了什么，也不关心当前使用哪个 Scenario，只负责把 `AgentEvent` 转换成 SSE 格式，并通过 Express 的 Response 推送给客户端。

## 1. 先理解 SSE 的数据格式

我们之前定义的共享事件：

```
const event: AgentEvent = {
  type: "thinking",
  data: {
    content: "正在分析用户的问题..."
  }
};
```

它是一个普通 JavaScript 对象，并不能直接通过 SSE 推送。

SSE 有自己的消息格式：

```
data: {"type":"thinking","data":{"content":"正在分析用户的问题..."}}
```

注意最后有两个换行符 `\n\n`，它表示一条 SSE 消息结束。

一条 SSE 消息的基本结构是：

```
field: value
field: value
```

常见字段包括：

| 字段    | 作用                         |
| ------- | ---------------------------- |
| `event` | 指定事件名称                 |
| `data`  | 事件携带的数据               |
| `id`    | 事件 ID，可用于断线重连      |
| `retry` | 建议客户端重新连接的等待时间 |

我们 V1 暂时只使用 `data`。

为什么不使用 `event`？

因为我们的 JSON 对象本身已经有 `type` 字段，可以区分 `thinking`、`tool_call` 等事件。没必要重复定义事件名称。

## 2. 编写 sseSender.ts

创建：

```
server/src/lib/sseSender.ts
```

写入以下代码：

```
import type { Response } from "express";
import type { AgentEvent } from "@suagent/shared";

/**
 * 初始化 SSE 响应
 */
export function initSSE(res: Response): void {
  res.status(200);

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // 立即发送响应头，建立 SSE 响应
  res.flushHeaders();
}

/**
 * 将 AgentEvent 编码为 SSE 格式并推送
 */
export function sendSSE(
  res: Response,
  event: AgentEvent
): void {
  // 避免向已经关闭的连接写入数据
  if (res.writableEnded || res.destroyed) {
    return;
  }

  const message = `data: ${JSON.stringify(event)}\n\n`;

  res.write(message);
}

/**
 * 结束 SSE 响应
 */
export function endSSE(res: Response): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.end();
}
```

## 3. 理解三个函数的职责

### ① initSSE：初始化连接

```
initSSE(res);
```

这里设置了几个重要的 HTTP 响应头。

| Header              | 含义                         |
| ------------------- | ---------------------------- |
| `Content-Type`      | 告诉客户端响应内容是 SSE     |
| `Cache-Control`     | 禁止缓存及中间层转换响应     |
| `Connection`        | 保持 HTTP 连接               |
| `X-Accel-Buffering` | 提示 Nginx 不要缓冲 SSE 响应 |

其中：

```
res.flushHeaders();
```

很重要。

Express 默认可能会等到第一次写入响应内容时才发送响应头。这里主动刷新响应头，让客户端尽早建立流式响应。

### ② sendSSE：发送事件

```
sendSSE(res, event);
```

核心是：

```
const message = `data: ${JSON.stringify(event)}\n\n`;

res.write(message);
```

这里涉及两个概念：

+ `JSON.stringify()`：将 JavaScript 对象转换成 JSON 字符串。
+ `res.write()`：向 HTTP 响应流写入数据，但不结束连接。

为什么不用 `res.send()`？

因为 `res.send()` 通常用于发送完整 HTTP 响应，发送后响应就会结束。

而 SSE 需要在一个 HTTP 响应中持续发送多条消息，所以使用 `res.write()`。

### ③ endSSE：结束连接

```
endSSE(res);
```

底层调用：

```
res.end();
```

它表示服务端不再发送数据，本次 HTTP 响应结束。

例如收到 `done` 或 `error` 终止事件后，路由层就可以调用它。

## 4. 为什么要检查 writableEnded 和 destroyed？

```
if (res.writableEnded || res.destroyed) {
  return;
}
```

这是为了处理客户端提前断开连接的情况。

例如：

```
服务端正在推送事件
       ↓
用户关闭页面
       ↓
客户端连接断开
       ↓
服务端继续尝试推送？
       ↓
应该停止
```

这里要区分：

+ `writableEnded`：响应已经调用过 `end()`。
+ `destroyed`：底层响应流已经被销毁。

它们可以避免对已结束或已销毁的响应继续写入。

但要注意：这三个函数只是提供基本的安全检查，真正停止 Scenario 的事件调度，还需要路由层监听客户端断连并清理任务。 我们下一步会处理。



## 5. 下一步：实现 agent.ts

现在我们已经有了两块独立的能力：

+ `scenarios/`：提供预设的 `AgentEvent[]`。
+ `lib/sseSender.ts`：负责将 `AgentEvent` 推送给客户端。

接下来需要一个中间层把它们连接起来：

```
server/src/routes/agent.ts
```

它将负责：

1. 接收前端发起的 Agent 请求。
2. 根据请求选择 Scenario。
3. 初始化 SSE 响应。
4. 按顺序发送 Scenario 中的事件。
5. 处理客户端断连和任务清理。
6. 发送 `done` 或 `error` 后结束响应。

下一步我们重点设计事件调度机制。 尤其是 `setTimeout`、客户端断连监听和任务清理之间的关系，这部分会直接影响后续 AbortController 中断功能的实现。