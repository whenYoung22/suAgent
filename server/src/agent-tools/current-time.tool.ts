import { AgentToolError } from "./types.js";
import { getStringArgument, validateArguments } from "./validation.js";
import type { AgentToolDefinition, AgentToolExecution } from "./types.js";

export const currentTimeToolDefinition: AgentToolDefinition = {
    type: "function",
    function: {
        name: "get_current_time",
        description: "获取当前时间。默认使用 Asia/Shanghai 时区。",
        parameters: {
            type: "object",
            properties: {
                timezone: {
                    type: "string",
                    description: "IANA 时区，例如 Asia/Shanghai；省略时使用 Asia/Shanghai。"
                }
            },
            additionalProperties: false
        }
    }
};

export function executeCurrentTimeTool(args: unknown): AgentToolExecution {
    const record = validateArguments(args, ["timezone"]);
    const timezone = getStringArgument(record, "timezone", false) ?? "Asia/Shanghai";
    try {
        const now = new Date();
        return {
            success: true,
            result: {
                timezone,
                iso: now.toISOString(),
                localTime: new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "full",
                    timeStyle: "long",
                    timeZone: timezone
                }).format(now)
            }
        };
    } catch (error) {
        if (error instanceof RangeError) {
            throw new AgentToolError("The timezone must be a valid IANA timezone.");
        }
        throw error;
    }
}
