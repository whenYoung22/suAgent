# suAgent

suAgent 是一个基于 React、Express 和 TypeScript 构建的 Agent 流式交互工作台，用于可视化 Agent 工具调用全过程，并支持用户随时中断流式交互。

当前前端通过 SSE 接收结构化 Agent 事件，使用 Zustand 管理运行状态与消息/工具调用数据，并通过持久化会话接口支持会话列表、历史恢复、改名和删除。输入 `1`–`4` 选择预设模拟场景；Markdown 和代码高亮暂不在 MVP 范围内。



```
suAgent/
├── client/
│   └── src/
│       ├── api/              # 会话 REST API 与 SSE 运行流
│       ├── assets/
│       ├── components/       # 聊天消息、工具调用卡片、会话侧栏
│       ├── hooks/            # useAgentStream（SSE 消费与中断控制）
│       ├── pages/            # ChatPage 等
│       ├── stores/           # agentStore 与 sessionStore
│       ├── clientTypes/      # 前端 UI 专用类型
│       ├── utils/            # sseParser（帧切分、解析，可独立测试）
│       ├── App.tsx
│       └── main.tsx
│
├── server/
│   └── src/
│       ├── lib/              # sseSender.ts（SSE 响应生命周期与事件推送）
│       ├── routes/           # sessions.route.ts、session-runs.route.ts
│       ├── scenarios/        # 预设事件序列：singleToolCall、multiToolCall、toolFailure、streamError
│       ├── app.ts            # 创建 Express 应用
│       └── server.ts         # 启动 HTTP 服务
│
├── shared/                   # SSE 事件协议类型（六种事件的 discriminated union）
├── doc/                      # event-protocol.md、state-machine.md
└── package.json
```



## 项目简介

项目重点不在模型本身，而在**前端如何消费非确定性的流式事件**：自行实现 SSE 帧解析、用状态机约束事件序列、通过 `AbortController` 支持中断、将工具调用渲染为可读卡片、在工具失败时做局部降级。

## 功能特性

- **SSE 流式消费**：使用 `fetch` + `ReadableStream` + `TextDecoder` 自行实现帧切分与解析，不依赖第三方 SSE 库
- **Agent 状态机**：以 Zustand 管理 `IDLE / THINKING / CALLING_TOOL / DONE / ERROR / INTERRUPTED` 状态迁移
- **工具调用卡片**：每个工具调用渲染为独立卡片，展示工具名、参数、耗时与结果，通过 `callId` 关联调用与结果
- **用户中断**：通过 `AbortController` 终止流式响应，区分用户中断与流级错误，中断后保留已生成内容
- **增量渲染**：最终回答按 `token` 事件逐段追加
- **错误局部化**：工具调用失败时卡片内降级提示，不阻塞整个对话流
- **持久化会话**：创建、切换、改名、删除会话；刷新后从服务端恢复消息与工具调用记录
- **模拟场景**：在聊天输入框输入 `1` 单次工具调用、`2` 连续工具调用、`3` 工具调用失败或 `4` 流式错误
- **标题编辑**：client 将会话标题限制为 1–15 个字符

## 技术栈

| 层       | 选型                                       |
| -------- | ------------------------------------------ |
| 前端     | React 19 + TypeScript + Vite               |
| 状态管理 | Zustand                                    |
| UI       | Ant Design                                 |
| SSE 消费 | `fetch` + `ReadableStream` + `TextDecoder` |
| 中断控制 | `AbortController`                          |
| 后端     | Node.js + Express + TypeScript             |
| 部署     | 前端 Vercel，后端 Render                   |

## 架构

```
React 前端
   ├── 会话列表/创建/详情/改名/删除 ──▶ /api/sessions
   └── 输入 1–4 发起运行 ────────────▶ POST /api/sessions/:sessionId/runs
                                             │
                          持久化消息、工具调用与运行状态
                                             │
   ◀────────────────────── SSE 事件流 ───────┘
   │
   ▼
ReadableStream Reader ──▶ TextDecoder ──▶ SSEParser ──▶ Zustand
                                                         │
                              ┌──────────────────────────┼─────────────────┐
                              ▼                          ▼                 ▼
                         思考内容                  工具调用卡片       增量回答渲染
```

## SSE 事件协议

前后端唯一契约。事件类型固定，后端无论模拟还是真实模型，都按此协议推送。

| 事件          | `data` 内容                  | 前端动作                              |
| ------------- | ---------------------------- | ------------------------------------- |
| `thinking`    | 思考片段文本                 | 状态切到 `THINKING`，渲染思考气泡     |
| `tool_call`   | `{ toolCallId, toolName, arguments }` | 状态切到 `CALLING_TOOL`，插入工具卡片 |
| `tool_result` | `{ toolCallId, success, result?, error? }` | 按 `toolCallId` 更新对应卡片 |
| `token`       | 最终回答增量文本             | 追加渲染                              |
| `done`        | `{}`                         | 状态切到 `DONE`，清理连接             |
| `error`       | `{ message }`                | 状态切到 `ERROR`，展示可重试提示      |

## 核心实现

### SSE 消费层

`useAgentStream` 自定义 Hook 负责：

- 发起 `fetch` 请求，获取 `response.body.getReader()`
- 用 `TextDecoder` 增量解码字节流
- 维护缓冲区，按 `\n\n` 切帧，处理**不完整帧与跨 chunk 拼接**
- 解析每帧的 `event:` 与 `data:` 字段，分发到状态机
- 通过 `AbortController` 支持中断，捕获 `AbortError` 并区分于流级错误

### Agent 状态机

状态迁移规则显式定义，约束非法迁移：

```
IDLE → THINKING → CALLING_TOOL → (可循环) → DONE
任意状态 → ERROR（流级错误）
任意状态 → INTERRUPTED（用户中断）
```

`CALLING_TOOL` 允许回到自身，以支持模型连续调用多次工具的非确定性序列。

### 工具调用卡片

- 通过 `callId` 将 `tool_result` 关联回对应的 `tool_call` 卡片
- 状态：加载中 / 成功 / 失败
- 失败时卡片内展示降级提示，对话流继续推进

## 本地运行

```bash
# 前端
cd client
npm install
npm run dev

# 后端
cd server
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端默认 `http://localhost:3000`。Vite 开发服务器会将 `/api` 请求代理到后端；如需跨域直连其他后端，可通过 `VITE_API_BASE_URL` 配置 API 基地址。

## 开发阶段

1. **阶段一**：Express 硬编码事件流，前端跑通 SSE 解析与最小渲染链路
2. **阶段二**：Zustand 状态机、工具卡片、增量渲染，完成正常流程
3. **阶段三**：`AbortController` 中断、错误降级、跨 chunk 边界处理
4. **阶段四**（可选）：后端接入 DeepSeek Function Calling，前端协议不变，验证消费层对真实模型流的兼容性



```bash
# 创建会话，从响应中取得 session.id
curl.exe -X POST http://localhost:3000/api/sessions

# 将 <sessionId> 替换为创建响应中的 id；prompt 可为 1、2、3 或 4
curl.exe -N -X POST http://localhost:3000/api/sessions/<sessionId>/runs -H "Content-Type: application/json" -d "{\"prompt\":\"1\"}"
```



## 设计决策

- **为什么用 SSE 而不是 WebSocket**：Agent 输出是服务端到客户端的单向事件流，SSE 基于 HTTP、实现简单、自动重连；WebSocket 适合双向实时协作（见 whenTeam 项目）
- **为什么不用第三方 SSE 库**：手动实现帧解析是为了真正理解流式数据的边界问题（跨 chunk、不完整帧），这也是面试中最容易被追问的部分
- **为什么状态机要显式定义**：非确定性事件流下，显式迁移规则能防止非法状态、保证中断后一致性、让 UI 渲染有唯一依据
- **为什么工具失败不阻塞对话**：单次工具调用失败不应终止整个 Agent 回合，卡片级降级让 Agent 基于已有信息继续

## License

MIT