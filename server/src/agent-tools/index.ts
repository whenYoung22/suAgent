import { executeCurrentTimeTool, currentTimeToolDefinition } from "./current-time.tool.js";
import { executeWeatherTool, weatherToolDefinition } from "./weather.tool.js";
import { AgentToolError } from "./types.js";
import type { AgentTool } from "./types.js";

// 唯一的工具注册表：只有登记在这里的工具才会暴露给模型并允许服务端执行。
const tools: AgentTool[] = [
    {
        definition: currentTimeToolDefinition,
        execute: executeCurrentTimeTool
    },
    {
        definition: weatherToolDefinition,
        execute: executeWeatherTool
    }
];

// 模型只返回工具名；运行时通过此表分发到对应的服务端实现。
const toolsByName = new Map(
    tools.map((tool) => [tool.definition.function.name, tool])
);

// 发送给模型的工具 schema 与服务端执行器来自同一注册表，避免声明和实现脱节。
export const agentToolDefinitions = tools.map((tool) => tool.definition);

export async function executeAgentTool(
    name: string,
    args: unknown,
    signal: AbortSignal
) {
    try {
        const tool = toolsByName.get(name);
        if (!tool) {
            throw new AgentToolError(`Unknown tool "${name}".`);
        }
        return await tool.execute(args, signal);
    } catch (error) {
        if (signal.aborted) {
            throw error;
        }
        if (error instanceof AgentToolError) {
            return { success: false, error: error.message };
        }
        throw error;
    }
}
