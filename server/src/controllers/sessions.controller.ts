import type { Request, Response } from "express";
import type { UpdateSessionTitleRequest } from "@suagent/shared/session";
import {
    createSession as createSessionRecord,
    deleteSession as deleteSessionRecord,
    getSession as getSessionRecord,
    listSessions as listSessionRecords,
    SessionServiceError,
    updateSessionTitle as updateSessionTitleRecord
} from "../services/sessions.service.js";

function sendServiceError(res: Response, error: unknown): void {
    const status = error instanceof SessionServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Session operation failed";
    res.status(status).json({ message });
}

export async function listSessions(_req: Request, res: Response): Promise<void> {
    try {
        const sessions = await listSessionRecords();
        res.json({ sessions });
    } catch (error) {
        sendServiceError(res, error);
    }
}

export async function createSession(_req: Request, res: Response): Promise<void> {
    try {
        const session = await createSessionRecord();
        res.status(201).json({ session });
    } catch (error) {
        sendServiceError(res, error);
    }
}

export async function updateSessionTitle(
    req: Request<{ id: string }, unknown, UpdateSessionTitleRequest>,
    res: Response
): Promise<void> {
    const title = req.body?.title;
    if (typeof title !== "string" || title.trim().length === 0 || title.trim().length > 120) {
        res.status(400).json({ message: "Title must contain between 1 and 120 characters" });
        return;
    }

    try {
        const session = await updateSessionTitleRecord(req.params.id, title.trim());
        res.json({ session });
    } catch (error) {
        sendServiceError(res, error);
    }
}

export async function getSession(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        const session = await getSessionRecord(req.params.id);
        res.json({ session });
    } catch (error) {
        sendServiceError(res, error);
    }
}

export async function deleteSession(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        await deleteSessionRecord(req.params.id);
        res.status(204).end();
    } catch (error) {
        sendServiceError(res, error);
    }
}
