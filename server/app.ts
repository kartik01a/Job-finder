import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { AppEnv } from "./config/env";
import type { CandidateProfile } from "./config/profile";
import type { AiClient } from "./ai/deepseek";
import type { JobSource } from "./sources/JobSource";
import { JobRepository } from "./services/jobs/repository";
import { configRouter, jobsRouter, runsRouter, searchRouter, statsRouter } from "./routes/api";

export function createApp(deps: {
  repository: JobRepository;
  sources: JobSource[];
  ai: AiClient;
  profile: CandidateProfile;
  env: AppEnv;
}): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/search", searchRouter(deps));
  app.use("/api/jobs", jobsRouter(deps.repository, deps.env));
  app.use("/api/stats", statsRouter(deps.repository, deps.env));
  app.use("/api/runs", runsRouter(deps.repository));
  app.use("/api/config", configRouter(deps.profile, deps.env));

  const clientDir = path.resolve("dist/client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDir, "index.html"), (error) => {
        if (error) next();
      });
    });
  }

  return app;
}
