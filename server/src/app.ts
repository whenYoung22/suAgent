import express from "express";
import cors from "cors";

import sessionRouter from "./routes/sessions.route.js";
import sessionRunsRouter from "./routes/session-runs.route.js";

const app = express();

app.use(cors({ exposedHeaders: ["X-Run-Id"] }));
app.use(express.json());

app.use("/api/sessions", sessionRunsRouter);
app.use("/api/sessions", sessionRouter);

export default app;