# suAgent 项目上下文与开发规划

## 一、项目基本信息

**项目名称：** suAgent

**英文副标题：** Agent Streaming Workspace

**项目定位：**

suAgent 是一个基于 React 和 TypeScript 构建的 Agent 流式交互工作台，通过 SSE 接收结构化 Agent 事件，使用 Zustand 管理运行状态，实现工具调用过程可视化、流式 Markdown 渲染、异步请求中断及异常处理。

项目主要面向前端开发实习求职，核心是展示 AI 应用场景下的前端工程能力，而不是开发一个完整的 Agent 后端框架。

### 核心设计思路

传统聊天应用主要关注：
- 用户输入消息。
- 模型返回回答。
- 前端展示对话内容。

suAgent 更关注 Agent 执行过程：
- Agent 当前处于什么阶段？
- 是否正在调用工具？
- 工具执行是否成功？
- 模型是否还在生成内容？
- 用户能否中断当前任务？
- 前端如何保证异步事件到达时的状态一致性？

因此，项目的核心是：

**基于 SSE 事件驱动的前端异步交互系统。**

---

## 二、项目与 whenTeam 的区别

用户已经完成另一个全栈项目 whenTeam。

| 对比维度 | whenTeam                   | suAgent                                                  |
| -------- | -------------------------- | -------------------------------------------------------- |
| 项目类型 | 任务协作管理系统           | Agent 流式交互工作台                                     |
| 核心场景 | CRUD 业务                  | 长时间运行的异步任务                                     |
| 前端重点 | 页面、表单、业务状态       | 流式数据、事件处理、状态机                               |
| 状态管理 | 常规业务状态               | Agent Run 生命周期                                       |
| 通信方式 | REST API                   | Fetch + SSE                                              |
| 数据库   | MySQL + Prisma             | V1 不需要                                                |
| 核心技术 | React、TS、Express、Prisma | ReadableStream、TextDecoder、SSE Parser、AbortController |
| 工程重点 | 前后端分离、业务建模       | 实时交互、异步控制、事件驱动                             |

两个项目都使用 React、TypeScript、Zustand、Express，但解决的问题不同。

whenTeam 证明具备全栈业务开发能力。

suAgent 进一步证明具备复杂前端交互、流式数据处理和 AI 应用开发能力。

---

## 三、最重要的项目范围约束

这一部分必须严格遵守，不能在后续设计中擅自扩大项目范围。

### V1 不实现真正的 Agent Loop

V1 后端使用 Mock Agent Runner，通过预设事件脚本模拟 Agent 执行过程。

例如：

```text
thinking
  ↓
tool_call
  ↓
tool_result
  ↓
thinking
  ↓
token
  ↓
done
```

这些事件由后端预设脚本产生，并不是由真实 LLM 动态决定的。

### V1 不实现真正的 Tool Calling

虽然 Mock 事件中存在：

- tool_call
- tool_result

但这只是模拟工具调用过程，目的是让前端能够展示工具执行状态。

后端并没有真正实现：
- 模型根据上下文自主决定调用工具。
- 根据模型返回的工具参数执行真实函数。
- 将工具结果重新提交给模型。
- 根据模型后续输出继续执行。

因此，不能把模拟的 tool_call/tool_result 描述为真正实现了 Tool Calling。

### Agent Loop 与前端状态机的关系

真正的 Agent Loop 通常包括：

1. Thinking：模型分析任务。
2. Action：模型决定调用工具。
3. Observation：获取工具执行结果。
4. 将结果重新交给模型，进入下一轮。
5. 直到模型生成最终回答或达到终止条件。

suAgent V1 只是参考这些执行阶段的语义设计前端状态机。

**前端负责展示和管理执行状态，不负责 Agent Loop 的循环调度。**

### V1 后端定位

后端只需要实现：

1. Express SSE 推送。
2. 统一的 Agent Event 事件协议。
3. Mock Agent Runner。
4. 连接断开、请求取消及资源清理。

---

## 四、技术栈与核心技术亮点

### Client：核心开发部分

技术栈：

- React
- TypeScript
- Vite
- React Router
- Zustand
- Ant Design

核心技术：

#### 1. Fetch + ReadableStream + TextDecoder

使用浏览器原生 API 消费 SSE 流。

基本流程：

```ts
const response = await fetch("/api/agent/run", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt }),
  signal: controller.signal,
});

const reader = response.body?.getReader();

while (reader) {
  const { value, done } = await reader.read();

  if (done) break;

  const chunk = decoder.decode(value, {
    stream: true,
  });

  // 将数据交给 SSE Parser
}
```

需要理解：

- Fetch：发起 HTTP 请求。
- ReadableStream：持续读取响应体。
- reader.read()：读取数据块，得到 Uint8Array。
- TextDecoder：将字节流解码成字符串。
- SSE Parser：将字符串解析成符合 SSE 协议的事件。

注意：ReadableStream 的 chunk 不等于一个完整 SSE 事件。

一个 SSE 事件可能被拆分到多个 chunk 中；一个 chunk 也可能包含多个 SSE 事件。

#### 2. 独立实现 SSE Parser

不使用 SSE 客户端解析库，自己实现解析器。

需要考虑：

- 数据块不完整。
- 一个 chunk 包含多个事件。
- 事件跨 chunk。
- UTF-8 字符跨 chunk。
- LF 和 CRLF 换行。
- SSE 注释行。
- 多行 data 字段。
- 空行作为事件结束标记。
- 流结束时的残留数据。

这是项目的重要技术亮点。

#### 3. AbortController

支持用户主动停止当前 Agent 运行。

主要涉及：

- 中断 Fetch 请求。
- 取消正在进行的流式读取。
- 更新前端运行状态。
- 通知后端连接已经断开。
- 后端停止后续 Mock 事件推送。
- 清理 Reader、定时任务等资源。

需要区分：

前端 AbortController 取消请求，不代表后端业务代码自动停止执行。后端也需要处理连接断开事件。

#### 4. 增量渲染

模型文本不是一次性返回，而是通过 token 事件逐步到达。

前端需要将每个 token 追加到当前消息，实现实时输出。

需要考虑：

- 高频状态更新。
- Markdown 尚未完整时的渲染。
- 长文本反复解析的性能问题。
- React 组件不必要的重复渲染。

可以考虑 token batching 或 requestAnimationFrame 优化，但不需要一开始就过度设计。

#### 5. Zustand + Agent 状态机

使用 Zustand 管理 Agent Run 状态。

初步状态：

```ts
type AgentStatus =
  | "IDLE"
  | "THINKING"
  | "CALLING_TOOL"
  | "GENERATING"
  | "DONE"
  | "ERROR"
  | "CANCELLED";
```

事件与状态之间不是简单的一对一关系，需要考虑合法迁移。

例如：

| 事件        | 可能的状态变化       |
| ----------- | -------------------- |
| thinking    | THINKING             |
| tool_call   | CALLING_TOOL         |
| tool_result | 根据后续执行阶段更新 |
| token       | GENERATING           |
| done        | DONE                 |
| error       | ERROR                |
| 用户取消    | CANCELLED            |

需要特别注意：

tool_result 不代表整个 Agent 任务完成，通常只是一次工具执行结束。

建议区分三层状态：

- Run State：当前 Agent 整体运行状态。
- Tool Call State：单个工具调用状态。
- Message State：消息内容及生成状态。

Tool Call 可以有独立状态：

```ts
type ToolCallStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "ERROR";
```

#### 6. 工具调用可视化（Tool Cards）

这是前端业务 UI 组件，不是某种技术库。

通过 toolCallId 关联 tool_call 和 tool_result。

展示内容：
- 工具名称。
- 工具参数。
- 执行状态。
- 工具结果。
- 错误信息。
- 折叠和展开。

注意：V1 展示的是 Mock 工具调用事件，不代表后端实现了真实 Tool Calling。

---

### Server：辅助开发部分

技术栈：

- Node.js
- Express 5
- TypeScript

核心功能：

#### 1. Express SSE 推送

提供接口：

```text
POST /api/agent/run
```

前端提交任务，后端返回 SSE 流。

需要正确设置 SSE 响应头，例如：

```ts
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
```

具体还需要考虑响应头发送、连接关闭、错误处理及资源清理。

#### 2. 统一 Agent Event 协议

前后端通过共享事件类型约定通信格式。

初始版本：

```ts
type AgentEvent =
  | {
      type: "thinking";
      message: string;
    }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      result: unknown;
    }
  | {
      type: "token";
      content: string;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      message: string;
    };
```

后续可以增加：
- runId：标识一次运行。
- sequence：事件序号。
- tool_error 或 tool_result 中的错误字段。
- 更明确的事件时间和关联信息。

具体协议尚未最终确定，需要在开发时进一步讨论。

#### 3. Mock Agent Runner

后端按照预设事件脚本产生事件。

例如：

```ts
const mockEvents = [
  { type: "thinking", message: "正在分析任务" },
  {
    type: "tool_call",
    toolCallId: "tool-001",
    toolName: "search",
    args: { query: "React" },
  },
  {
    type: "tool_result",
    toolCallId: "tool-001",
    result: { items: [] },
  },
  { type: "token", content: "这是最终回答。" },
  { type: "done" },
];
```

这里只是示意，正式实现需要补充类型约束和事件发送逻辑。

Mock 场景至少覆盖：

1. 正常完成。
2. 多次工具调用。
3. 工具执行失败。
4. 用户主动中断。
5. 网络异常或连接断开。
6. 不完整事件。
7. 重复或过期事件。

Mock Agent 不需要理解用户自然语言，也不需要调用模型 API。

---

## 五、SSE 的理解与实现流程

整体数据链路：

```text
用户输入任务
    ↓
React 前端
    ↓
Fetch POST /api/agent/run
    ↓
Express Server
    ↓
Mock Agent Runner
    ↓
产生 AgentEvent
    ↓
SSE 编码并推送
    ↓
ReadableStream
    ↓
TextDecoder
    ↓
SSE Parser
    ↓
Event Handler
    ↓
Zustand Store
    ↓
React UI 更新
```

其中需要重点理解：

### SSE 与 Fetch 的关系

SSE 是一种服务端向客户端持续推送事件的通信机制。

浏览器常见的 EventSource API 主要用于 GET 请求，不适合直接满足本项目 POST 请求携带 JSON body 的需求。

因此使用 Fetch + ReadableStream 自己消费 SSE。

### Axios 与 Fetch

Axios 并不是完全不能处理流式响应。

但在浏览器环境中，Fetch 原生支持 ReadableStream，能够直接控制数据块读取，更适合本项目自行实现 SSE Parser。

可以混用：

- 普通 REST 请求：Axios。
- Agent 流式请求：Fetch。

AbortController 可以用于 Fetch，也可以用于 Axios 的取消控制。

---

## 六、后续可选扩展：真实接入 DeepSeek

这一部分不是 V1 的必要要求。

如果核心功能完成，可以在最后考虑接入 DeepSeek API。

需要区分三个层次：

### 方案 A：只接入 LLM API

调用 DeepSeek，获取模型回答，通过 SSE 推送给前端。

这只是 LLM API 集成和流式对话，不算实现 Agent Loop。

### 方案 B：LLM + Tool Calling

模型返回工具调用请求，后端解析参数并执行对应函数。

这可以称为实现了 Function Calling / Tool Calling 机制，但如果只执行一次工具调用，没有继续请求模型，不算完整的 Agent Loop。

### 方案 C：LLM + Tool Calling + 循环调度

基本逻辑：

```ts
while (true) {
  const response = await callDeepSeek(messages);

  const toolCalls = response.toolCalls;

  if (!toolCalls?.length) {
    break;
  }

  for (const toolCall of toolCalls) {
    const result = await executeTool(toolCall);

    messages.push({
      role: "tool",
      content: JSON.stringify(result),
    });
  }
}
```

这是 Agent Loop 的基本形式。

真实实现还需要处理：
- 最大循环次数。
- 工具调用失败。
- 模型请求失败。
- 多个工具调用。
- 用户取消。
- 上下文管理。
- 工具权限和参数校验。
- 最终回答生成。

只有真正实现模型决策、工具执行、结果回传模型、继续循环的调度过程，才能说实现了 Agent Loop。

**建议：先完成 V1，不要为了简历增加 Agent Loop 而牺牲前端核心功能的开发质量。**

---

## 七、推荐项目目录（尚未最终确定）

```text
suAgent/
├── client/
│   └── src/
│       ├── api/
│       ├── services/
│       │   └── agent/
│       ├── components/
│       │   ├── chat/
│       │   ├── execution/
│       │   └── tools/
│       ├── pages/
│       ├── stores/
│       ├── hooks/
│       ├── types/
│       └── utils/
│
└── server/
    └── src/
        ├── routes/
        ├── controllers/
        ├── services/
        │   └── agent/
        │       └── mock.runner.ts
        └── types/
```

目录仅为初步建议，开发过程中可以根据实际职责调整。

---

## 八、开发计划与求职时间安排

用户当前是云南师范大学人工智能专业研一，准备寻找前端开发实习。

目标时间：
- 2026 年 11 月：主攻 suAgent。
- 2026 年 12 月：项目整理、简历优化、面试基础准备。
- 2027 年 1 月：期末考试与面试准备并行，开始投递。
- 预计 2027 年 1 月 25 日后：学校事务基本结束，集中投递和面试。
- 目标在 2027 年 2 月中旬前争取获得实习机会。

### 11 月：项目开发

优先完成：

1. 项目初始化和基础 UI。
2. Agent Event 协议。
3. Express SSE 服务端。
4. Mock Agent Runner。
5. Fetch + ReadableStream + TextDecoder。
6. 自己实现 SSE Parser。
7. Zustand + Agent 状态机。
8. Tool Cards。
9. 增量 Markdown 渲染。
10. AbortController 和异常处理。

### 12 月：项目整理

重点：

- 梳理整体架构。
- 优化代码结构和类型设计。
- 整理关键技术难点。
- 补充必要的测试。
- 优化 README 和项目演示。
- 准备简历和面试讲解。

可选：
- SSE Parser 单元测试。
- 基础 CI/CD。
- Docker 基础实践。
- DeepSeek API 接入。

不建议把完整自动化测试、复杂部署、监控系统作为硬性验收条件。

---

## 九、简历定位与面试讲解

suAgent 的核心简历亮点应该围绕前端技术展开。

### 可以强调的技术亮点

1. 基于 Fetch、ReadableStream 和 TextDecoder 实现浏览器端 SSE 流式消费，并独立实现 SSE Parser，处理数据分块、跨 chunk 事件、UTF-8 解码及多行 data 等情况。
2. 基于 Zustand 设计 Agent 运行状态管理机制，结合事件驱动模型处理多阶段执行状态、工具调用状态及异常状态。
3. 使用 AbortController 实现流式请求中断，并配合服务端连接生命周期管理完成资源清理。
4. 实现 Token 增量更新及 Markdown 渲染，支持 Agent 执行过程的实时展示。
5. 基于 toolCallId 关联工具调用与执行结果，实现工具执行过程的可视化展示。

注意：这些内容应在对应功能实际完成后再写入简历，不能把计划实现写成已实现。

### 面试时如何介绍 Agent Loop

建议使用以下表述：

“这个项目 V1 没有实现真正的 Agent Loop 调度，后端通过预设脚本模拟 Agent 的执行过程，并按照统一的事件协议通过 SSE 推送给前端。项目重点在于前端如何消费结构化事件，以及如何管理多阶段执行过程中的异步任务。

我参考 Agent Loop 的执行语义，将其抽象为 Thinking、Tool Calling、Observation 等阶段，并围绕这些阶段设计前端状态管理机制，实现工具调用可视化、运行状态管理和异常处理。”

如果后续真的实现了方案 C，再补充 Agent Loop 的后端实现。

---

## 十、后续对话的协作要求

请在后续讨论中遵循以下原则：

1. 以本文档作为 suAgent 的项目背景和范围基线。
2. 不要将 Agent Loop 或真正的 Tool Calling 默认列为 V1 已实现功能。
3. Mock tool_call/tool_result 只是事件模拟，不是真实工具调用。
4. 优先考虑前端开发实习所需要展示的工程能力。
5. 不要随意增加 RAG、MCP、Multi-Agent、数据库、权限系统等功能。
6. 用户希望通过项目学习真实开发过程，因此回答技术问题时，除了提供代码，还需要解释设计原因、模块职责和数据流。
7. 不要为了技术复杂度而过度设计，优先保证核心功能完整、代码可维护、项目可以演示。
8. 讨论简历内容时，严格区分已经实现、正在开发和可选扩展，避免夸大项目能力。

**当前最重要的任务：围绕 Mock Agent Runner + SSE 事件协议 + 前端事件驱动系统，完成 suAgent V1。**