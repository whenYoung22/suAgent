import { AgentToolError } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStringArgument(
    args: Record<string, unknown>,
    name: string,
    required: boolean
): string | undefined {
    const value = args[name];
    if (value === undefined && !required) {
        return undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new AgentToolError(`Tool argument "${name}" must be a non-empty string.`);
    }
    return value.trim();
}

export function validateArguments(
    args: unknown,
    allowedKeys: string[]
): Record<string, unknown> {
    if (!isRecord(args)) {
        throw new AgentToolError("Tool arguments must be a JSON object.");
    }
    const unexpectedKey = Object.keys(args).find((key) => !allowedKeys.includes(key));
    if (unexpectedKey) {
        throw new AgentToolError(`Unexpected tool argument "${unexpectedKey}".`);
    }
    return args;
}
