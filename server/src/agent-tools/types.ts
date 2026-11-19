export interface AgentToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required?: string[];
            additionalProperties: false;
        };
    };
}

export interface AgentToolExecution {
    success: boolean;
    result?: unknown;
    error?: string;
}

export interface AgentTool {
    definition: AgentToolDefinition;
    execute: (
        args: unknown,
        signal: AbortSignal
    ) => AgentToolExecution | Promise<AgentToolExecution>;
}

export class AgentToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgentToolError";
    }
}
