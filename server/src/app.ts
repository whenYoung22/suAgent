import express from "express";
import cors from "cors";

import agentRouter from "./routes/agent.route.js";

const app = express();

app.use(cors());
app.use(express.json());

// Agent 路由
app.use("/api/agent", agentRouter);

export default app;