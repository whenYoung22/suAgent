import type { Request, Response, NextFunction } from "express";

export function requestLogger(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (process.env.NODE_ENV === "production") {
        next();
        return;
    }

    const startedAt = Date.now();
    const { method, path } = req;
    let responseLogged = false;

    console.log(`[HTTP] --> ${method} ${path}`);

    const logResponse = (outcome: string): void => {
        if (responseLogged) {
            return;
        }
        responseLogged = true;
        console.log(
            `[HTTP] ${outcome} ${method} ${path} ${res.statusCode} (${Date.now() - startedAt} ms)`
        );
    };

    res.once("finish", () => logResponse("<--"));
    res.once("close", () => {
        if (!res.writableEnded) {
            logResponse("ABORTED");
        }
    });

    next();
}
