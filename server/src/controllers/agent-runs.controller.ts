import type { Request, Response } from "express";
import type { AgentEvent } from "@suagent/shared";
import type { RunSessionRequest } from "@suagent/shared/session";
import { endSSE, initSSE, sendSSE } from "../http/sse-sender.js";
import { AgentRunServiceError, cancelRun, createRun, executeRun } from "../services/agent-runs.service.js";
import type { CreatedRun } from "../services/agent-runs.service.js";

// 错误映射辅助
function sendServiceError(res: Response, error: unknown): void {
    const status = error instanceof AgentRunServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Agent run failed";
    res.status(status).json({ message });
}

// 主控制器
export async function streamAgentRun(
    req: Request<{ sessionId: string }, unknown, RunSessionRequest>,
    res: Response
): Promise<void> {
    // 建立连接取消能力
    const connectionController = new AbortController();
    let run: CreatedRun | null = null;
    let executionStarted = false;
    const onClose = () => {
        if (!res.writableEnded) {
            connectionController.abort();
        }
    };
    res.on("close", onClose);

    try {
        // 创建 run（此时还没发任何 SSE）
        run = await createRun(req.params.sessionId, req.body?.prompt);

        res.setHeader("X-Run-Id", run.id);
        initSSE(res);
        if (res.destroyed || req.aborted) {
            connectionController.abort();
        }

        // 启动执行
        executionStarted = true;
        await executeRun(run, connectionController.signal, (event) => {
            sendSSE(res, event);
        });
    } catch (error) {
        if (run === null && !res.headersSent) {
            sendServiceError(res, error);
            return;
        }

        if (!res.headersSent) {
            connectionController.abort();
            sendServiceError(res, error);
            return;
        }

        if (!connectionController.signal.aborted) {
            console.error("Session run stream error:", error);
            const errorEvent: AgentEvent = {
                type: "error",
                data: {
                    code: "INTERNAL_ERROR",
                    message: "Agent stream failed"
                }
            };
            sendSSE(res, errorEvent);
        }
    } finally {
        if (run && !executionStarted) {
            connectionController.abort();
            try {
                await executeRun(run, connectionController.signal, (event) => {
                    sendSSE(res, event);
                });
            } catch (error) {
                console.error("Session run cleanup error:", error);
            }
        }
        res.removeListener("close", onClose);
        endSSE(res);
    }
}

export async function cancelAgentRun(
    req: Request<{ sessionId: string; runId: string }>,
    res: Response
): Promise<void> {
    try {
        const run = await cancelRun(req.params.sessionId, req.params.runId);
        res.json(run);
    } catch (error) {
        sendServiceError(res, error);
    }
}
