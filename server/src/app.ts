import express from "express";
import cors from "cors";

import agentRouter from "./routes/agent.route.js";
import sessionRouter from "./routes/sessions.route.js";
import sessionRunsRouter from "./routes/session-runs.route.js";

const app = express();

app.use(cors({ exposedHeaders: ["X-Run-Id"] }));
app.use(express.json());

// Agent 路由
app.use("/api/agent", agentRouter);
app.use("/api/sessions", sessionRunsRouter);
app.use("/api/sessions", sessionRouter);

export default app;