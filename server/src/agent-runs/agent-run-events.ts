// 事件推送及数据库持久化；是 Agent 运行时把事件流同时落库并推给前端的枢纽

import type { AgentEvent } from "@suagent/shared";
import { prisma } from "../db/prisma.js";
import { recordToolCallStarted } from "./agent-loop-policy.js";
import type { AgentLoopState } from "./agent-loop-policy.js";
import { toPrismaJson } from "./agent-run-serialization.js";

export class AgentRunEventWriter {
    // 状态字段
    private readonly toolCallSequences = new Map<string, number>(); //toolCallId → sequence 映射，供 tool_result 回填时校验
    private nextToolCallSequence = 0; //自增的工具调用序号（持久化到 sequence）
    private content = "";  //累积 token 拼接成完整回复文本
    private thinking = "";  //累积思考过程文本

    constructor(
        private readonly runId: string,
        private readonly sessionId: string,
        private readonly signal: AbortSignal, //取消信号，用于中断
        private readonly loopState: AgentLoopState,
        private readonly onEvent: (event: AgentEvent) => void  //推送回调
    ) { }

    //整体是 "检查 → 按类型落库 → 检查 → 更新活跃时间 → 检查 → 推送 → 检查" 的流水线
    async emit(event: AgentEvent): Promise<void> {
        //入口检查
        if (this.signal.aborted) {
            throw new Error("Run interrupted");
        }

        //按事件类型分支
        // thinking / token：累积并回写
        if (event.type === "thinking") {
            this.thinking += event.data.content;
            await prisma.message.update({
                where: { runId_role: { runId: this.runId, role: "agent" } },
                data: { thinking: this.thinking }
            });
        } else if (event.type === "token") {
            this.content += event.data.content;
            await prisma.message.update({
                where: { runId_role: { runId: this.runId, role: "agent" } },
                data: { content: this.content }
            });
        } else if (event.type === "tool_call") { //创建工具调用记录 + 事务内同步计数器
            this.nextToolCallSequence += 1;
            const nextToolCallCount = this.loopState.toolCallCount + 1;
            await prisma.$transaction([
                prisma.toolCall.create({
                    data: {
                        runId: this.runId,
                        toolCallId: event.data.toolCallId,
                        sequence: this.nextToolCallSequence,
                        modelRound: this.loopState.modelRounds,
                        toolName: event.data.toolName,
                        arguments: toPrismaJson(event.data.arguments)
                    }
                }),
                prisma.agentRun.update({
                    where: { id: this.runId },
                    data: { toolCallCount: nextToolCallCount }
                })
            ]);
            recordToolCallStarted(this.loopState);
            this.toolCallSequences.set(event.data.toolCallId, this.nextToolCallSequence);
        } else if (event.type === "tool_result") { //回填状态、结果、错误、完成时间
            if (!this.toolCallSequences.has(event.data.toolCallId)) {
                throw new Error(`Unknown tool call: ${event.data.toolCallId}`);
            }

            await prisma.toolCall.update({
                where: {
                    runId_toolCallId: {
                        runId: this.runId,
                        toolCallId: event.data.toolCallId
                    }
                },
                data: {
                    status: event.data.success ? "succeeded" : "failed",
                    ...(event.data.result === undefined
                        ? {}
                        : { result: toPrismaJson(event.data.result) }),
                    errorMessage: event.data.error ?? null,
                    finishedAt: new Date()
                }
            });
        } else if (event.type === "done") {  //标记成功完成
            this.loopState.stopReason = "completed";
            await prisma.agentRun.update({
                where: { id: this.runId },
                data: {
                    status: "completed",
                    finishedAt: new Date(),
                    modelRounds: this.loopState.modelRounds,
                    toolCallCount: this.loopState.toolCallCount,
                    stopReason: this.loopState.stopReason
                }
            });
        } else if (event.type === "error") { //标记失败
            this.loopState.stopReason = "error";
            await prisma.agentRun.update({
                where: { id: this.runId },
                data: {
                    status: "failed",
                    finishedAt: new Date(),
                    errorCode: event.data.code,
                    errorMessage: event.data.message,
                    modelRounds: this.loopState.modelRounds,
                    toolCallCount: this.loopState.toolCallCount,
                    stopReason: this.loopState.stopReason
                }
            });
        }

        // 更新活跃时间 + 推送
        if (this.signal.aborted) {
            throw new Error("Run interrupted");
        }

        await prisma.session.update({
            where: { id: this.sessionId },
            data: { lastActivityAt: new Date() }
        });
        if (this.signal.aborted) {
            throw new Error("Run interrupted");
        }
        this.onEvent(event);
        if (this.signal.aborted) {
            throw new Error("Run interrupted");
        }
    }
}
