import path from "node:path";
import type { CandidateProfile } from "../../config/profile";
import type { AppEnv } from "../../config/env";
import type { AiScore, SearchRequest, SourceError } from "../../../shared/types";
import { SOURCE_LABELS, type SourceName } from "../../../shared/types";
import type { AiClient } from "../../ai/deepseek";
import { log } from "../../log";
import type { JobSource } from "../../sources/JobSource";
import { consecutiveMisses, shouldClose } from "../closedJobs/closedJobs";
import { jobsToCsv, writeJobsCsv } from "../csv/exportCsv";
import { DeduplicationService, type NormalizedJob } from "../deduplication/DeduplicationService";
import { applyHardFilters } from "../filters/hardFilters";
import { locationAllowed } from "../filters/location";
import { JobRepository, type ExistingJob } from "../jobs/repository";
import { normalizeJob } from "../normalization/normalize";
import { deterministicScore, selectAiCandidates } from "../scoring/deterministic";
import { tokens } from "../text";

export type ProgressFn = (line: string) => void;

type StoredFilters = SearchRequest & { successfulSources: string[] };

export class SearchOrchestrator {
  private readonly dedupe = new DeduplicationService();

  constructor(
    private readonly deps: {
      repository: JobRepository;
      sources: JobSource[];
      ai: AiClient;
      profile: CandidateProfile;
      env: AppEnv;
      csvPath?: string;
      now?: () => Date;
    },
  ) {}

  async run(request: SearchRequest, runId: number, onProgress: ProgressFn): Promise<void> {
    const now = this.deps.now ?? (() => new Date());
    const started = now();
    const errors: SourceError[] = [];
    const filters: StoredFilters = { ...request, successfulSources: [] };
    onProgress("Starting...");

    try {
      for (const source of this.selectedSources(request)) {
        onProgress(`${this.label(source.name)}: searching`);
      }

      const collected: NormalizedJob[] = [];
      for (const source of this.selectedSources(request)) {
        try {
          const result = await source.search(request);
          if (result.error) {
            errors.push(result.error);
            log({
              level: "warn",
              source: source.name,
              stage: "search",
              runId,
              message: result.error.reason,
            });
            onProgress(`${this.label(source.name)}: ${result.error.status}`);
            continue;
          }
          filters.successfulSources.push(source.name);
          const normalized = result.jobs.map((job) => normalizeJob(job, this.deps.env.DEFAULT_EXCHANGE_RATE_USD_INR));
          collected.push(...normalized);
          onProgress(`${this.label(source.name)}: ${normalized.length} found`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Source failed";
          errors.push({ source: source.name, status: "error", reason });
          log({ level: "error", source: source.name, stage: "search", runId, message: "Source failed", error: reason });
          onProgress(`${this.label(source.name)}: error`);
        }
      }

      onProgress(`${collected.length} discovered`);
      const filtered = applyHardFilters(collected, request, started);
      onProgress(`${filtered.length} passed filters`);
      const deduped = this.dedupe.dedupe(filtered);
      const duplicatesRemoved = filtered.length - deduped.length;
      onProgress(`${duplicatesRemoved} duplicates removed`);

      const scored = deduped.map((group) => {
        const breakdown = deterministicScore(group.job, this.deps.profile, {
          location: request.location,
          workModes: request.workModes,
          employmentTypes: request.employmentTypes,
          minimumMonthlySalaryInr: request.minimumMonthlySalaryInr,
        });
        return { group, deterministicScore: breakdown.total };
      });
      const candidates = selectAiCandidates(scored);
      onProgress(`${candidates.length} sent to AI`);

      const aiByHash = new Map<string, AiScore | null>();
      const freshScores = new Set<string>();
      let aiFailures = 0;
      let cached = 0;
      for (const candidate of candidates) {
        const hash = candidate.group.job.descriptionHash;
        if (aiByHash.has(hash)) continue;
        const hit = this.deps.repository.findCachedScore(
          hash,
          this.deps.profile.profileVersion,
          this.deps.env.DEEPSEEK_MODEL,
        );
        if (hit) {
          cached += 1;
          aiByHash.set(hash, hit);
          continue;
        }
        const result = await this.deps.ai.score({
          profile: this.deps.profile,
          job: candidate.group.job,
          deterministicScore: candidate.deterministicScore,
          searchLocation: request.location,
        });
        if (!result.ok) {
          aiFailures += 1;
          aiByHash.set(hash, null);
          if (!errors.some((item) => item.source === "deepseek" && item.reason === result.reason)) {
            errors.push({ source: "deepseek", status: "error", reason: result.reason });
          }
          log({
            level: "error",
            source: "deepseek",
            stage: "ai",
            runId,
            message: "AI scoring failed",
            error: result.reason,
          });
          continue;
        }
        freshScores.add(hash);
        aiByHash.set(hash, result.score);
      }
      if (aiFailures > 0) onProgress(`DeepSeek: ${aiFailures} scoring failure${aiFailures === 1 ? "" : "s"}`);
      if (cached > 0) onProgress(`${cached} AI scores reused from cache`);

      const above = scored.filter((item) => {
        const ai = aiByHash.get(item.group.job.descriptionHash);
        return ai != null && ai.score >= request.minimumScore;
      }).length;
      onProgress(`${above} scored >= ${request.minimumScore}`);

      onProgress("Updating database...");
      const writeTime = started.getTime();
      let existing = this.deps.repository.loadExisting();
      const seenIds = new Set<number>();
      for (const job of collected) {
        const match = this.deps.repository.matchExisting(existing, job);
        if (!match) continue;
        this.deps.repository.touchSeen(match.id, writeTime);
        match.lastSeenAt = writeTime;
        match.isClosed = 0;
        seenIds.add(match.id);
      }

      let newJobs = 0;
      for (const item of scored) {
        const hash = item.group.job.descriptionHash;
        const attempted = aiByHash.has(hash);
        const ai = aiByHash.get(hash) ?? null;
        const match = this.deps.repository.matchExisting(existing, item.group.job);
        const descriptionChanged = match != null && match.descriptionHash !== hash;
        const score = attempted ? (ai?.score ?? null) : descriptionChanged ? null : (match?.score ?? null);
        const saved = this.deps.repository.upsert({
          existing: match,
          job: item.group.job,
          sources: item.group.sources,
          deterministicScore: item.deterministicScore,
          score,
          aiReason: attempted ? (ai?.reason ?? null) : descriptionChanged ? null : (match?.aiReason ?? null),
          profileVersion: this.deps.profile.profileVersion,
          now: writeTime,
        });
        if (ai && freshScores.has(hash)) {
          this.deps.repository.saveScore(
            saved.id,
            this.deps.env.DEEPSEEK_MODEL,
            this.deps.profile.profileVersion,
            hash,
            ai,
            writeTime,
          );
          freshScores.delete(hash);
        }
        if (saved.created) newJobs += 1;
        seenIds.add(saved.id);
        existing = this.deps.repository.loadExisting();
      }

      const closed = this.closeMissingJobs(existing, seenIds, request, filters.successfulSources, runId, started.getTime(), writeTime);
      if (closed > 0) onProgress(`${closed} jobs marked closed`);
      onProgress(`${newJobs} new jobs`);

      onProgress("Generating CSV...");
      try {
        const csv = jobsToCsv(this.deps.repository.csvJobs(request.minimumScore));
        writeJobsCsv(this.deps.csvPath ?? path.resolve("data/jobs.csv"), csv);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "CSV export failed";
        errors.push({ source: "csv", status: "error", reason });
        log({ level: "error", stage: "csv", runId, message: "CSV export failed", error: reason });
        onProgress("CSV export failed");
      }

      this.deps.repository.finishRun(runId, {
        completedAt: writeTime,
        filters,
        jobsDiscovered: collected.length,
        jobsAfterFiltering: filtered.length,
        duplicatesRemoved,
        jobsAiScored: candidates.length,
        jobsAboveThreshold: above,
        newJobs,
        errors,
        status: "completed",
      });
      onProgress("Complete.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Search failed";
      errors.push({ source: "database", status: "error", reason });
      log({ level: "error", stage: "search", runId, message: "Search failed", error: reason });
      this.deps.repository.finishRun(runId, {
        completedAt: Date.now(),
        filters,
        jobsDiscovered: 0,
        jobsAfterFiltering: 0,
        duplicatesRemoved: 0,
        jobsAiScored: 0,
        jobsAboveThreshold: 0,
        newJobs: 0,
        errors,
        status: "failed",
      });
      onProgress(`Failed: ${reason}`);
    }
  }

  private closeMissingJobs(
    existing: ExistingJob[],
    seenIds: Set<number>,
    request: SearchRequest,
    successfulSources: string[],
    runId: number,
    startedAt: number,
    now: number,
  ): number {
    const currentFilters: StoredFilters = { ...request, successfulSources };
    const runs = [
      { id: runId, startedAt, filters: currentFilters, status: "running" },
      ...this.deps.repository.listRuns().filter((run) => run.id !== runId && run.status === "completed"),
    ].sort((left, right) => right.startedAt - left.startedAt);
    let closed = 0;
    for (const job of existing) {
      if (seenIds.has(job.id) || job.isClosed) continue;
      const relevant = runs
        .filter((run) => this.runIsRelevant(job, run.filters))
        .map((run) => run.startedAt);
      const misses = consecutiveMisses(job.lastSeenAt, relevant);
      if (shouldClose(misses)) {
        this.deps.repository.markClosed(job.id, now);
        closed += 1;
        log({ level: "info", stage: "closed", jobId: job.id, message: "Marked job closed after three misses" });
      }
    }
    return closed;
  }

  private runIsRelevant(job: ExistingJob, filters: unknown): boolean {
    const stored = filters as Partial<StoredFilters>;
    if (!stored.successfulSources || !stored.keywords) return false;
    const jobSources = job.sources.map((source) => source.source);
    if (!jobSources.some((source) => stored.successfulSources?.includes(source))) return false;
    if (!keywordCouldFind(job.title, stored.keywords)) return false;
    if (stored.location && !locationAllowed(job.location, job.workMode, stored.location)) return false;
    return true;
  }

  private selectedSources(request: SearchRequest): JobSource[] {
    return this.deps.sources.filter((source) => request.sources.includes(source.name as SourceName));
  }

  private label(name: string): string {
    return SOURCE_LABELS[name as SourceName] ?? name;
  }
}

function keywordCouldFind(title: string, keywords: string[]): boolean {
  const titleTokens = tokens(title);
  return keywords.some((keyword) => {
    const keywordTokens = tokens(keyword);
    if (keywordTokens.size === 0) return false;
    let overlap = 0;
    for (const token of keywordTokens) {
      if (titleTokens.has(token)) overlap += 1;
    }
    return overlap / keywordTokens.size >= 0.5;
  });
}
