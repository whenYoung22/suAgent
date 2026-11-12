import express from "express";
import cors from "cors";

import { requestLogger } from "./middleware/requestLogger.js";
import sessionRouter from "./routes/sessions.route.js";
import agentRunsRouter from "./routes/agent-runs.route.js";

const app = express();

app.use(requestLogger);
app.use(cors({ exposedHeaders: ["X-Run-Id"] }));
app.use(express.json());

app.use("/api/sessions", agentRunsRouter);
app.use("/api/sessions", sessionRouter);

export default app;