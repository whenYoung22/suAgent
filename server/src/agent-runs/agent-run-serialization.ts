// JSON 序列化辅助逻辑；在把任意 unknown 值写进 Prisma 的 Json 字段、或拼进工具结果消息之前，安全地校验并规范化

import { Prisma } from "../generated/prisma/client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON 值类型守卫（核心）；判断"值能否作为 JSON 写入"的递归类型守卫
function isJsonInputValue(value: unknown): value is Prisma.InputJsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value !== null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value);
    }

    if (Array.isArray(value)) {
        return value.every((item) => item === null || isJsonInputValue(item));
    }

    return isRecord(value) && Object.values(value).every(
        (item) => item === null || isJsonInputValue(item)
    );
}

// 从任意值到 Prisma 可写 JSON
export function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) {
        return Prisma.JsonNull;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error("Value cannot be serialized as JSON");
    }

    const parsed: unknown = JSON.parse(serialized);
    if (!isJsonInputValue(parsed)) {
        throw new Error("Value contains unsupported JSON data");
    }

    return parsed;
}

// 工具结果 → 消息内容字符串
export function toToolResultMessage(result: unknown, error: string | null): string {
    const value = error ? { error } : result ?? null;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error("Tool result cannot be serialized as JSON");
    }
    return serialized;
}
