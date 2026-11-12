import { Router } from "express";
import { cancelAgentRun, streamAgentRun } from "../controllers/agent-runs.controller.js";

const router = Router();

// 处理会话中的 Agent 运行，包括启动 SSE 流和中断运行
router.post("/:sessionId/runs", streamAgentRun);
router.delete("/:sessionId/runs/:runId", cancelAgentRun);

export default router;
