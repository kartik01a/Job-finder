import { Router } from "express";
import path from "node:path";
import type { AppEnv } from "../config/env";
import type { CandidateProfile } from "../config/profile";
import type { AiClient } from "../ai/deepseek";
import { searchRequestSchema, SOURCE_LABELS, type SourceName } from "../../shared/types";
import type { JobSource } from "../sources/JobSource";
import { JobRepository } from "../services/jobs/repository";
import { SearchOrchestrator } from "../services/search/orchestrator";
import { jobsToCsv, writeJobsCsv } from "../services/csv/exportCsv";

const progressLogs = new Map<number, string[]>();
let searchInFlight = false;

export function searchRouter(deps: {
  repository: JobRepository;
  sources: JobSource[];
  ai: AiClient;
  profile: CandidateProfile;
  env: AppEnv;
}): Router {
  const router = Router();
  const orchestrator = new SearchOrchestrator({
    repository: deps.repository,
    sources: deps.sources,
    ai: deps.ai,
    profile: deps.profile,
    env: deps.env,
  });

  router.post("/", (req, res) => {
    const parsed = searchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid search", details: parsed.error.flatten() });
      return;
    }
    if (searchInFlight) {
      res.status(409).json({ error: "A search is already running" });
      return;
    }
    searchInFlight = true;
    const startedAt = Date.now();
    const runId = deps.repository.createRun(startedAt, parsed.data.sources, parsed.data);
    progressLogs.set(runId, []);
    res.status(202).json({ runId });

    void orchestrator
      .run(parsed.data, runId, (line) => {
        const lines = progressLogs.get(runId) ?? [];
        lines.push(line);
        progressLogs.set(runId, lines);
      })
      .finally(() => {
        searchInFlight = false;
      });
  });

  router.get("/progress/:id", (req, res) => {
    const id = Number(req.params.id);
    const run = deps.repository.getRun(id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ ...run, progress: progressLogs.get(id) ?? [] });
  });

  return router;
}

export function jobsRouter(repository: JobRepository, env: AppEnv): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const minScore = queryNumber(req.query.minScore);
    const jobs = repository.listJobs({
      minScore,
      status: queryString(req.query.status),
      workMode: queryString(req.query.workMode),
      source: queryString(req.query.source),
      includeUnscored: req.query.includeUnscored === "true",
      includeClosed: req.query.includeClosed !== "false",
    });
    res.json({ jobs });
  });

  router.get("/:id", (req, res) => {
    const job = repository.getJob(Number(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job });
  });

  router.patch("/:id/status", (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    const allowed = ["NEW", "REVIEWED", "APPLIED", "WAITING", "INTERVIEW", "REJECTED", "SKIPPED", "OFFER"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const updated = repository.updateStatus(id, status, Date.now());
    if (!updated) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    try {
      writeJobsCsv(path.resolve("data/jobs.csv"), jobsToCsv(repository.csvJobs(env.DEFAULT_MIN_SCORE)));
    } catch (error) {
      res.status(200).json({
        job: repository.getJob(id),
        warning: error instanceof Error ? error.message : "CSV export failed",
      });
      return;
    }
    res.json({ job: repository.getJob(id) });
  });

  return router;
}

export function statsRouter(repository: JobRepository, env: AppEnv): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json(repository.stats(env.DEFAULT_MIN_SCORE));
  });
  return router;
}

export function runsRouter(repository: JobRepository): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      runs: repository.listRuns().map((run) => ({
        ...run,
        progress: progressLogs.get(run.id) ?? [],
      })),
    });
  });
  router.get("/:id", (req, res) => {
    const run = repository.getRun(Number(req.params.id));
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ ...run, progress: progressLogs.get(run.id) ?? [] });
  });
  return router;
}

export function configRouter(profile: CandidateProfile, env: AppEnv): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      defaults: {
        minimumScore: env.DEFAULT_MIN_SCORE,
        maxResultsPerSource: env.DEFAULT_MAX_RESULTS_PER_SOURCE,
        postedWithinDays: env.DEFAULT_POSTED_WITHIN_DAYS,
        minimumMonthlySalaryInr: env.DEFAULT_MIN_MONTHLY_SALARY_INR,
      },
      profile: {
        profileVersion: profile.profileVersion,
        experienceYears: profile.experienceYears,
        currentLocation: profile.currentLocation,
        skills: profile.skills,
        preferredRoles: profile.preferredRoles,
      },
      sources: (Object.keys(SOURCE_LABELS) as SourceName[]).map((id) => ({
        id,
        label: SOURCE_LABELS[id],
      })),
      aiConfigured: Boolean(env.DEEPSEEK_API_KEY),
    });
  });
  return router;
}

function queryString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function queryNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
