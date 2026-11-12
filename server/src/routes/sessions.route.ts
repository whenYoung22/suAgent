import { Router } from "express";
import {
    createSession,
    deleteSession,
    getSession,
    listSessions,
    updateSessionTitle
} from "../controllers/sessions.controller.js";

// 处理会话列表、创建、详情、改名和删除
const router = Router();

router.get("/", listSessions);
router.post("/", createSession);
router.patch("/:id", updateSessionTitle);
router.get("/:id", getSession);
router.delete("/:id", deleteSession);

export default router;
