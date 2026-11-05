你的 whenTeam 目录结构说明你对 monorepo 的包分层和前后端职责划分已经有清晰的理解。suAgent 可以沿用同样的顶层结构（`client` / `server` / `shared` / `doc` + 根 `package.json`），但**内部的子目录要大幅精简**——因为 suAgent 的后端复杂度只有 whenTeam 的十分之一，照搬 controllers/services/mappers/validations 这套分层反而是一种负担。

## suAgent 目录规划（基于 whenTeam 结构精简）

text

```
suAgent/
├── client/
│   └── src/
│       ├── api/              # HTTP 请求（fetch 发起 SSE 的薄封装）
│       ├── assets/
│       ├── components/       # ThinkingBubble、ToolCallCard、StreamingAnswer、StopButton
│       ├── hooks/            # useAgentStream（SSE 消费核心）
│       ├── pages/            # ChatPage 等
│       ├── stores/           # agentStore（Zustand 状态机）
│       ├── clientTypes/      # 前端 UI 专用类型
│       ├── utils/            # sseParser（帧切分、解析，可独立测试）
│       ├── App.tsx
│       └── main.tsx
│
├── server/
│   └── src/
│       ├── lib/              # sseSender.ts（SSE 响应生命周期与事件推送）
│       ├── routes/           # agent.ts（/api/agent/stream）
│       ├── scenarios/        # 预设事件序列：singleToolCall、multiToolCall、toolFailure、streamError
│       ├── app.ts            # 创建 Express 应用
│       └── server.ts         # 启动 HTTP 服务
│
├── shared/                   # SSE 事件协议类型（六种事件的 discriminated union）
├── doc/                      # event-protocol.md、state-machine.md
└── package.json
```



## 和 whenTeam 的对应关系

**直接沿用的**：顶层 `client` / `server` / `shared` / `doc` 结构、根 `package.json` 的 workspace 配置、`client` 下的 `api` / `components` / `hooks` / `pages` / `stores` / `clientTypes` 命名习惯、`server` 下的 `lib` / `routes` / `app.ts` / `server.ts` 分层。这些你都熟，搭骨架时直接照搬，不用重新设计。

**大幅精简的**：`server` 里的 `controllers` / `services` / `mappers` / `validations` / `middlewares` / `prisma` / `generated` / `websocket` / `config` 全部不需要。suAgent 后端只有一个路由、一个 SSE 推送逻辑、四个场景脚本，没有数据库、没有认证、没有请求体校验、没有 WebSocket。**如果硬套 whenTeam 的分层，你会为了一个 `res.write` 写 controller + service + mapper 三层，纯属自找麻烦。**

**新增的**：`server/src/scenarios/` 是 suAgent 特有的——把不同的事件序列（单工具调用、连续工具调用、工具失败、流级错误）拆成独立文件，路由根据 query 参数选择场景。这个设计让前端可以在不同异常场景之间切换测试，不需要改后端代码。

**`shared` 的内容不同**：whenTeam 的 `shared` 可能放请求/响应 DTO、实体类型；suAgent 的 `shared` 只放 SSE 事件协议类型。内容少，但重要性更高——它是前后端唯一的契约，改一处两边都编译报错。

## 一个建议

**whenTeam 的 `server/src/lib/` 放的是 Prisma Client 这类共享实例，suAgent 的 `lib/` 放 `sseSender.ts`（事件格式化 + 推送封装）。** 命名一样，职责不同，但都是“被多处引用的基础工具”，这个习惯可以延续。

另外，你 whenTeam 里 `client` 有 `service/`（封装 axios 实例），suAgent 不需要——因为 SSE 用 `fetch` 且只调一个接口，`api/agentStream.ts` 一个文件就够，不需要单独的 axios 实例封装层。**该省的分层要省，否则目录会显得臃肿。**

整体来说，suAgent 的目录是 whenTeam 的“减法版”：保留你熟悉的顶层结构和前端组织方式，砍掉后端所有用不上的分层，新增 `scenarios/` 这一个 suAgent 特有的目录。搭骨架时对照 whenTeam 改，比从零设计快得多。