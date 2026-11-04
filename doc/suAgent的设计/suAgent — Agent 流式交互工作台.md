# suAgent — Agent 流式交互工作台

PROJECT DEFINITION · V1.0

## 1. 项目定位

suAgent 是一个基于大语言模型的 Agent 流式交互工作台。

用户输入一个任务后，Agent 可以分析任务、选择并调用工具、获取工具执行结果，最终生成回答。整个执行过程通过 SSE 实时传递到前端，用户能够看到 Agent 的执行阶段、工具调用过程和最终输出。

它不是一个简单的 AI 聊天应用，而是一个强调 Agent 执行过程可视化的 Web 应用。

## 2. 项目目标

suAgent 的核心目标有两个层面。

产品层面：

+ 提供类似 ChatGPT 的对话交互体验。
+ 支持 Agent 多步骤任务执行。
+ 实时展示 Agent 的执行状态和工具调用过程。
+ 将工具调用、执行结果和最终回答组织成清晰的交互界面。

技术层面：

+ 深入实践 React + TypeScript 的复杂交互开发。
+ 掌握 SSE 流式数据接收与解析。
+ 掌握基于 Zustand 的事件驱动状态管理。
+ 理解 Agent Loop 和 Tool Calling 的基本运行机制。
+ 处理流式输出中的异步、异常、中断和状态一致性问题。

重点是：以 Agent 作为业务场景，以前端工程能力作为项目核心。

## 3. 功能范围

我建议将 V1 控制在以下六个模块。

![img](https://images.openai.com/static-rsc-4/JRTwmapkg_QQ4UK7SlIyG5PcGMU5pXsniz1S4X_c6ecrLVcQfAQESABfFNcUu9CTKzUG5iSBxkenMWUIA7471qWjIXh2R_KYj9tKwPqxTp3Ui1RW5KEijlQRxb11ZH8jOmtw-dENzFi7ryCqmbqlzA7t0SPo80gMXJayRTepubc?purpose=inline)

① 对话管理

+ 新建、切换、删除会话
+ 用户消息与 Agent 回复
+ 输入框、发送、停止生成
+ 基础历史记录持久化

![img](https://images.openai.com/static-rsc-4/lEAiwuNmPa5WLXnWcTImUL598TTWwvduwWelWQrODlGFW7oh3Mvu0UG5ow2mILXpjbse7l4qBiHhYiWbKysXWisWS7tLHmEd8ODzhm1T7MOJgSeG3pLQSTnqAwGa24YUhN3LPVTPQsWhIsDCHrv70F2tEAq56tIfmWVbxgOTfB8?purpose=inline)

② 流式对话

+ 实时接收模型输出
+ Markdown 渲染
+ 代码块与基础语法高亮
+ 流式输出结束后的消息整理

![img](https://images.openai.com/static-rsc-4/ypoVwUQkck-wIUr1J1h_0u0TEhjaZzE2ryxGzCshgxbyHhePZ4rjATfseEFgwTIINyjfn7phSBdcEREaquaftLg-ZWGZRQih_qeC5eXfVQ3CTL_r9C-uXoigQAMqf8U85gE9f0mzDgwRT_G4_sd9HOIM5y_1NW3_cN9ZSi5qa8Q?purpose=inline)

③ Agent 执行过程

+ 展示任务执行阶段
+ 展示工具调用与执行结果
+ 展示执行状态和错误信息
+ 按时间顺序组织执行事件

![img](https://images.openai.com/static-rsc-4/VjrxCIySviX4undl5krFrgdZ3AH_oM24Sv-IENfe2Fdv2JPo_-oYXPTlDjlcQPpR7mcKmDWRnCtV0i5En2nr1sV8MT-2YGe6AJ7X0pKbHplLgFp9KnOGbJ2x_HpuZMwFhbiROcQSE8eisISJqODBfmDxYzk86d9mFbbshwIF2vE?purpose=inline)

④ 工具调用展示

+ 工具名称和参数
+ 工具执行状态
+ 工具返回结果
+ 支持展开查看详情

![img](https://images.openai.com/static-rsc-4/Jy9ccxxDgLOsG2d_i5rMjtKUYQ5ezuPH032Odch93FH9XwfRI3xSYtYYecnVhGbhbl8MmbnB2dky8DRKFW27mBbxa_y_IuZmn83QQo7aHr0t_GykKmKjURm2RTXjX97fvVIui26viS_QZFwMWz5UoYtki0tywPM0jVdMS2swQSk?purpose=inline)

⑤ Agent 运行状态管理

+ THINKING、CALLING_TOOL、DONE、ERROR 等状态
+ 运行中停止任务
+ 异常提示与重新执行
+ 处理重复事件、过期事件等情况

![img](https://images.openai.com/static-rsc-4/b-BMIUQK8pObL6dLtPoGXAm7Qk_YvgoXkSIqHuo9TH4PSI1p1TNGib5jWxfXDjcG4zSKqxW9vChiMg7k0DqWxctSUhREsMd8Um_fac9TM2q_G2VX0gL-fEQpWswRW73zpzvLOBwmtyvoGf9S9I7SLKOiBO4D0B_7Gf292IwI-e0?purpose=inline)

⑥ 基础配置

+ LLM API 配置通过服务端环境变量管理
+ 基础模型参数配置
+ 不做复杂的用户权限和多模型管理

## 4. 技术栈范围

### 前端

| 技术            | 用途          | 优先级   |
| --------------- | ------------- | -------- |
| React           | UI 与组件开发 | 必须     |
| TypeScript      | 类型系统      | 必须     |
| Vite            | 构建工具      | 必须     |
| React Router    | 页面路由      | 基础使用 |
| Zustand         | 全局状态管理  | 必须     |
| Fetch API       | 发起请求      | 必须     |
| ReadableStream  | 流式数据读取  | 必须     |
| AbortController | 中断请求      | 必须     |
| SSE Parser      | SSE 协议解析  | 必须     |
| Markdown 渲染库 | 流式文本展示  | 必须     |
| Ant Design      | 基础 UI 组件  | 可选     |

其中，SSE 消费层是前端最重要的技术模块之一，建议独立设计，而不是把解析逻辑直接写在 React 组件中。

### 后端

| 技术         | 用途             | 优先级 |
| ------------ | ---------------- | ------ |
| Node.js      | 运行环境         | 必须   |
| Express 5    | HTTP 服务        | 必须   |
| TypeScript   | 类型系统         | 必须   |
| LLM API      | 模型调用         | 必须   |
| Tool Calling | 模型工具调用机制 | 必须   |
| Agent Loop   | 多步骤任务执行   | 必须   |
| SSE          | 向前端推送事件   | 必须   |
| Zod          | 参数校验         | 推荐   |

后端不需要设计得过于复杂。它主要承担三个职责：

1. 接收用户任务，调用 LLM。
2. 根据模型返回的 Tool Call 执行对应工具，并将结果交还模型。
3. 将 Agent 执行过程转换成 SSE 事件，持续推送给前端。

### Agent 工具

V1 只需要实现 2～3 个工具，重点是完整走通调用流程，而不是工具数量。

可以考虑：

+ `get_current_time`：获取当前时间。
+ `calculator`：执行数学计算。
+ `search_web`：搜索外部信息。

其中 Web 搜索需要接入真实搜索 API；如果时间不够，可以先用其他确定性工具完成完整流程。

## 5. 核心技术流程

suAgent 的整体运行流程如下：

React 前端

用户输入任务

Express 后端

接收请求，启动 Agent Loop

LLM API

分析任务，决定直接回答或调用工具

Tool Calling

执行工具，返回结果，再次请求模型

Agent 完成任务

SSE 事件推送到前端

thinking / tool_call / tool_result / token / done

Zustand 更新状态

React 根据状态变化更新 UI

这里有一个重要的设计原则：前端不直接依赖 LLM API 的原始返回格式，而是由后端统一转换成自己的 Agent 事件协议。

建议事件协议先确定为：

```
type AgentEvent =
  | { type: "thinking"; message: string }
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
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };
```

后续可以增加 `runId` 和 `sequence`，用于区分不同运行以及识别事件顺序。

注意：`thinking` 仅表示 Agent 当前处于思考或处理阶段，不展示模型隐藏的内部推理链。

## 6. 明确暂不涉及的技术

为了避免项目范围膨胀，以下内容暂时不纳入 V1：

| 技术或功能           | 处理方式                          |
| -------------------- | --------------------------------- |
| RAG、向量数据库      | 不做                              |
| MCP                  | 不做                              |
| Multi-Agent          | 不做                              |
| Python、FastAPI      | 不引入                            |
| LangChain、LangGraph | 暂不引入，自己实现基础 Agent Loop |
| MySQL、Prisma        | 暂不需要                          |
| 复杂用户认证与权限   | 不做                              |
| Docker、Kubernetes   | 了解即可                          |
| CI/CD                | 12 月视时间决定                   |
| 自动化测试           | 优先考虑 SSE Parser 单元测试      |
| 复杂监控系统         | 不做                              |

## 7. 项目最终技术定位

# suAgent

Agent Streaming Workspace

一个支持工具调用与执行过程可视化的 AI Agent 工作台。

核心技术关键词

React

TypeScript

Zustand

Node.js

Express

SSE

ReadableStream

AbortController

LLM API

Tool Calling

Agent Loop

项目能力侧重

前端工程能力

核心

AI 应用开发能力

重要

后端服务开发能力

基础支撑

DevOps / 工程化

可选

## 8. 11 月开发的最终验收目标

到 11 月底，suAgent 至少应该达到：

+ 一个完整可用的 Agent 对话工作台。
+ 能够调用真实 LLM API。
+ 能够完成至少两种真实工具调用。
+ 能够通过 SSE 实时展示 Agent 执行过程。
+ 自己实现独立的 SSE Parser。
+ 使用 Zustand 管理 Agent 运行状态和消息。
+ 支持停止生成、错误处理和基础历史会话。
+ 能够清楚解释前后端交互、Agent Loop 和状态管理设计。

我建议我们把这份内容作为 suAgent 的 V1 项目范围基线。

下一步应该进一步确定两个设计问题：一是工作台的具体 UI 布局和交互方式，二是 Agent 的运行机制与 SSE 事件协议。这两项确定后，再设计目录结构和开发顺序。