import type { AgentEvent } from "@suagent/shared";

const event: AgentEvent = {
  type: "token",
  data: {
    content: "Hello suAgent"
  }
};

console.log(event);