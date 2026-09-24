import "dotenv/config";
import { createDeepSeekClient } from "./ai/deepseek";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { loadProfile } from "./config/profile";
import { getDatabase } from "./db/client";
import { log } from "./log";
import { createSources } from "./sources/registry";
import { JobRepository } from "./services/jobs/repository";

const env = loadEnv();
const profile = loadProfile();
const db = getDatabase(env.DATABASE_URL);
const repository = new JobRepository(db);
const app = createApp({
  repository,
  sources: createSources(),
  ai: createDeepSeekClient({ apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL }),
  profile,
  env,
});

app.listen(env.PORT, () => {
  log({
    stage: "server",
    message: `Job finder listening on http://localhost:${env.PORT}`,
  });
});
