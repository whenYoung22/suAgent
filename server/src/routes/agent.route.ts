import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentEvent } from "@suagent/shared";

import { initSSE, sendSSE, endSSE } from "../lib/sse.js";

import { singleToolCallScenario } from "../scenarios/single-tool-call.js";
import { multiToolCallScenario } from "../scenarios/multi-tool-call.js";
import { toolFailureScenario } from "../scenarios/tool-failure.js";
import { streamErrorScenario } from "../scenarios/stream-error.js";

const router = Router();

/**
 * Scenario 注册表
 * 根据客户端传入的名称，获取对应的事件序列
 */
const scenarios: Record<string, () => AgentEvent[]> = {
    "single-tool-call": singleToolCallScenario,
    "multi-tool-call": multiToolCallScenario,
    "tool-failure": toolFailureScenario,
    "stream-error": streamErrorScenario
};

/**
 * POST /api/agent/run
 */
router.post(
    "/run",
    async (req: Request, res: Response) => {
        const scenarioName = req.body?.scenario;

        // 1. 验证 Scenario
        const scenarioFactory = scenarios[scenarioName];

        if (!scenarioFactory) {
            res.status(400).json({
                message: "Invalid scenario"
            });
            return;
        }

        const events = scenarioFactory();

        // 2. 初始化 SSE
        initSSE(res);

        let disconnected = false;
        let timer: NodeJS.Timeout | undefined;
        let resolveDelay: (() => void) | undefined;

        /**
         * 等待指定时间，同时允许客户端断开时提前结束等待
         */
        const delay = (ms: number): Promise<void> => {
            return new Promise((resolve) => {
                resolveDelay = resolve;

                timer = setTimeout(() => {
                    timer = undefined;
                    resolveDelay = undefined;
                    resolve();
                }, ms);
            });
        };

        /**
         * 监听客户端断开连接
         */
        res.on("close", () => {
            // 正常结束响应时也会触发 close
            if (res.writableEnded) {
                return;
            }

            disconnected = true;

            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }

            // 解除正在等待的 Promise
            resolveDelay?.();
            resolveDelay = undefined;

            console.log("Client disconnected, stopping scenario");
        });

        try {
            // 3. 按顺序发送事件
            for (const event of events) {
                if (disconnected || res.destroyed) {
                    return;
                }

                // 模拟事件之间的发送间隔
                await delay(600);

                if (disconnected || res.destroyed) {
                    return;
                }

                sendSSE(res, event);

                // 4. 收到终止事件后结束响应
                if (event.type === "done" || event.type === "error") {
                    break;
                }
            }
        } catch (error) {
            console.error("Agent stream error:", error);

            if (!disconnected && !res.destroyed && !res.writableEnded) {
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
            // 5. 清理定时器并结束响应
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }

            resolveDelay?.();
            resolveDelay = undefined;

            if (!disconnected) {
                endSSE(res);
            }
        }
    }
);

export default router;
