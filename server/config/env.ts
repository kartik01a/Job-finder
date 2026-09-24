import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("./data/jobs.db"),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  DEFAULT_MIN_SCORE: z.coerce.number().min(0).max(100).default(75),
  DEFAULT_MAX_RESULTS_PER_SOURCE: z.coerce.number().int().positive().max(200).default(100),
  DEFAULT_POSTED_WITHIN_DAYS: z.coerce.number().int().positive().default(14),
  DEFAULT_MIN_MONTHLY_SALARY_INR: z.coerce.number().nonnegative().default(50000),
  DEFAULT_EXCHANGE_RATE_USD_INR: z.coerce.number().positive().default(90),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
