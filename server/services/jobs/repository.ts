import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { ApplicationStatus, WorkMode } from "../../../shared/types";
import type { AiScore } from "../../../shared/types";
import type { AppDatabase } from "../../db/client";
import { jobScores, jobSources, jobs, searchRuns } from "../../db/schema";
import type { NormalizedJob } from "../deduplication/DeduplicationService";
import { canMerge } from "../deduplication/DeduplicationService";
import type { CsvJob } from "../csv/exportCsv";
import { canonicalUrl } from "../text";

export type ExistingJob = {
  id: number;
  company: string;
  title: string;
  description: string;
  location: string | null;
  workMode: WorkMode;
  employmentType: string | null;
  postedAt: number | null;
  descriptionHash: string;
  lastSeenAt: number;
  status: string;
  isClosed: number;
  score: number | null;
  aiReason: string | null;
  sources: Array<{ source: string; sourceJobId: string | null; jobUrl: string; applyUrl: string }>;
};

export type JobListItem = {
  id: number;
  score: number | null;
  deterministicScore: number | null;
  aiScore: number | null;
  company: string;
  title: string;
  salaryText: string | null;
  workMode: string;
  status: string;
  applyUrl: string;
  jobUrl: string;
  isClosed: boolean;
  location: string | null;
  sources: string[];
  aiReason: string | null;
  postedAt: number | null;
};

export type RunRecord = {
  id: number;
  startedAt: number;
  completedAt: number | null;
  sources: string[];
  filters: unknown;
  jobsDiscovered: number;
  jobsAfterFiltering: number;
  duplicatesRemoved: number;
  jobsAiScored: number;
  jobsAboveThreshold: number;
  newJobs: number;
  errors: unknown[];
  status: string;
};

export class JobRepository {
  constructor(private readonly db: AppDatabase) {}

  loadExisting(): ExistingJob[] {
    const rows = this.db.select().from(jobs).all();
    const sources = this.db.select().from(jobSources).all();
    return rows.map((row) => ({
      id: row.id,
      company: row.company,
      title: row.title,
      description: row.description,
      location: row.location,
      workMode: row.workMode as WorkMode,
      employmentType: row.employmentType,
      postedAt: row.postedAt,
      descriptionHash: row.descriptionHash,
      lastSeenAt: row.lastSeenAt,
      status: row.status,
      isClosed: row.isClosed,
      score: row.score,
      aiReason: row.aiReason,
      sources: sources
        .filter((source) => source.jobId === row.id)
        .map((source) => ({
          source: source.source,
          sourceJobId: source.sourceJobId,
          jobUrl: source.jobUrl,
          applyUrl: source.applyUrl,
        })),
    }));
  }

  matchExisting(existing: ExistingJob[], job: NormalizedJob): ExistingJob | null {
    for (const candidate of existing) {
      if (candidate.descriptionHash === job.descriptionHash && sameCompany(candidate.company, job.company)) {
        return candidate;
      }
      for (const source of candidate.sources) {
        if (job.source === source.source && job.sourceJobId && job.sourceJobId === source.sourceJobId) {
          return candidate;
        }
        if (canonicalUrl(job.jobUrl) === canonicalUrl(source.jobUrl)) return candidate;
      }
      if (canMerge(job, existingAsNormalized(candidate))) return candidate;
    }
    return null;
  }

  touchSeen(id: number, now: number): void {
    this.db
      .update(jobs)
      .set({ lastSeenAt: now, isClosed: 0, updatedAt: now })
      .where(eq(jobs.id, id))
      .run();
  }

  upsert(input: {
    existing: ExistingJob | null;
    job: NormalizedJob;
    sources: Array<{ source: string; sourceJobId: string | null; jobUrl: string; applyUrl: string }>;
    deterministicScore: number;
    score: number | null;
    aiReason: string | null;
    profileVersion: number;
    now: number;
  }): { id: number; created: boolean } {
    const write = this.db.$sqlite.transaction(() => {
      if (!input.existing) {
        const inserted = this.db
          .insert(jobs)
          .values({
            company: input.job.company,
            title: input.job.title,
            description: input.job.description,
            location: input.job.location,
            workMode: input.job.workMode,
            employmentType: input.job.employmentType,
            salaryText: input.job.salaryText,
            salaryMin: input.job.salaryMin,
            salaryMax: input.job.salaryMax,
            salaryCurrency: input.job.salaryCurrency,
            salaryNormalizedInrMin: input.job.salaryNormalizedInrMin,
            salaryNormalizedInrMax: input.job.salaryNormalizedInrMax,
            postedAt: input.job.postedAt?.getTime() ?? null,
            firstSeenAt: input.now,
            lastSeenAt: input.now,
            score: input.score,
            deterministicScore: input.deterministicScore,
            aiScore: input.score,
            applyUrl: input.job.applyUrl,
            jobUrl: input.job.jobUrl,
            status: "NEW",
            isClosed: 0,
            descriptionHash: input.job.descriptionHash,
            profileVersion: input.profileVersion,
            aiReason: input.aiReason,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
          .get();
        if (!inserted) throw new Error("Failed to insert job");
        this.replaceSources(inserted.id, input.sources, input.now);
        return { id: inserted.id, created: true };
      }

      this.db
        .update(jobs)
        .set({
          company: input.job.company,
          title: input.job.title,
          description: input.job.description,
          location: input.job.location,
          workMode: input.job.workMode,
          employmentType: input.job.employmentType,
          salaryText: input.job.salaryText,
          salaryMin: input.job.salaryMin,
          salaryMax: input.job.salaryMax,
          salaryCurrency: input.job.salaryCurrency,
          salaryNormalizedInrMin: input.job.salaryNormalizedInrMin,
          salaryNormalizedInrMax: input.job.salaryNormalizedInrMax,
          postedAt: input.job.postedAt?.getTime() ?? input.existing.postedAt,
          lastSeenAt: input.now,
          score: input.score,
          deterministicScore: input.deterministicScore,
          aiScore: input.score,
          applyUrl: input.job.applyUrl,
          jobUrl: input.job.jobUrl,
          isClosed: 0,
          descriptionHash: input.job.descriptionHash,
          profileVersion: input.profileVersion,
          aiReason: input.aiReason,
          updatedAt: input.now,
        })
        .where(eq(jobs.id, input.existing.id))
        .run();
      this.replaceSources(input.existing.id, mergeSources(input.existing.sources, input.sources), input.now);
      return { id: input.existing.id, created: false };
    });
    return write();
  }

  saveScore(jobId: number, model: string, profileVersion: number, descriptionHash: string, score: AiScore, now: number): void {
    this.db
      .insert(jobScores)
      .values({
        jobId,
        model,
        profileVersion,
        descriptionHash,
        score: score.score,
        technicalMatch: score.technicalMatch,
        experienceMatch: score.experienceMatch,
        roleMatch: score.roleMatch,
        locationMatch: score.locationMatch,
        salaryMatch: score.salaryMatch,
        matchedSkillsJson: JSON.stringify(score.matchedSkills),
        missingSkillsJson: JSON.stringify(score.missingSkills),
        reason: score.reason,
        createdAt: now,
      })
      .run();
  }

  findCachedScore(descriptionHash: string, profileVersion: number, model: string): AiScore | null {
    const row = this.db
      .select()
      .from(jobScores)
      .where(
        and(
          eq(jobScores.descriptionHash, descriptionHash),
          eq(jobScores.profileVersion, profileVersion),
          eq(jobScores.model, model),
        ),
      )
      .orderBy(desc(jobScores.createdAt))
      .get();
    if (!row) return null;
    return {
      score: row.score,
      technicalMatch: row.technicalMatch,
      experienceMatch: row.experienceMatch,
      roleMatch: row.roleMatch,
      locationMatch: row.locationMatch,
      salaryMatch: row.salaryMatch,
      matchedSkills: JSON.parse(row.matchedSkillsJson) as string[],
      missingSkills: JSON.parse(row.missingSkillsJson) as string[],
      reason: row.reason,
    };
  }

  listJobs(filters: {
    minScore: number | null;
    status: string | null;
    workMode: string | null;
    source: string | null;
    includeUnscored: boolean;
    includeClosed: boolean;
  }): JobListItem[] {
    const rows = this.db.select().from(jobs).orderBy(desc(jobs.score), desc(jobs.postedAt)).all();
    const sources = this.db.select().from(jobSources).all();
    return rows
      .filter((row) => {
        if (!filters.includeClosed && row.isClosed) return false;
        if (filters.status && row.status !== filters.status) return false;
        if (filters.workMode && row.workMode !== filters.workMode) return false;
        if (row.score == null) return filters.includeUnscored;
        if (filters.minScore != null && row.score < filters.minScore) return false;
        return true;
      })
      .map((row) => {
        const jobSourceRows = sources.filter((source) => source.jobId === row.id);
        return {
          id: row.id,
          score: row.score,
          deterministicScore: row.deterministicScore,
          aiScore: row.aiScore,
          company: row.company,
          title: row.title,
          salaryText: row.salaryText,
          workMode: row.workMode,
          status: row.status,
          applyUrl: row.applyUrl,
          jobUrl: row.jobUrl,
          isClosed: row.isClosed === 1,
          location: row.location,
          sources: [...new Set(jobSourceRows.map((source) => source.source))],
          aiReason: row.aiReason,
          postedAt: row.postedAt,
        };
      })
      .filter((row) => (filters.source ? row.sources.includes(filters.source) : true));
  }

  getJob(id: number): JobListItem | null {
    return this.listJobs({
      minScore: null,
      status: null,
      workMode: null,
      source: null,
      includeUnscored: true,
      includeClosed: true,
    }).find((job) => job.id === id) ?? null;
  }

  updateStatus(id: number, status: ApplicationStatus, now: number): boolean {
    const result = this.db.update(jobs).set({ status, updatedAt: now }).where(eq(jobs.id, id)).run();
    return result.changes > 0;
  }

  stats(minScore: number): Record<string, number> {
    const rows = this.db.select().from(jobs).all();
    const relevant = rows.filter((row) => row.score != null && row.score >= minScore);
    const countStatus = (status: string) => rows.filter((row) => row.status === status).length;
    return {
      relevant: relevant.length,
      NEW: countStatus("NEW"),
      REVIEWED: countStatus("REVIEWED"),
      APPLIED: countStatus("APPLIED"),
      WAITING: countStatus("WAITING"),
      INTERVIEW: countStatus("INTERVIEW"),
      REJECTED: countStatus("REJECTED"),
      SKIPPED: countStatus("SKIPPED"),
      OFFER: countStatus("OFFER"),
      closed: rows.filter((row) => row.isClosed === 1).length,
    };
  }

  csvJobs(minScore: number): CsvJob[] {
    return this.db
      .select()
      .from(jobs)
      .where(and(isNotNull(jobs.score), gte(jobs.score, minScore)))
      .all()
      .map((row) => ({
        id: row.id,
        score: row.score ?? 0,
        company: row.company,
        title: row.title,
        salary: row.salaryText ?? "",
        applyUrl: row.applyUrl,
        jobUrl: row.jobUrl,
        workMode: row.workMode,
        status: row.status,
        postedAt: row.postedAt,
        firstSeenAt: row.firstSeenAt,
      }));
  }

  createRun(startedAt: number, sources: string[], filters: unknown): number {
    const row = this.db
      .insert(searchRuns)
      .values({
        startedAt,
        sourcesJson: JSON.stringify(sources),
        filtersJson: JSON.stringify(filters),
        errorsJson: "[]",
        status: "running",
      })
      .returning()
      .get();
    if (!row) throw new Error("Failed to create search run");
    return row.id;
  }

  finishRun(id: number, patch: {
    completedAt: number;
    filters: unknown;
    jobsDiscovered: number;
    jobsAfterFiltering: number;
    duplicatesRemoved: number;
    jobsAiScored: number;
    jobsAboveThreshold: number;
    newJobs: number;
    errors: unknown[];
    status: "completed" | "failed";
  }): void {
    this.db
      .update(searchRuns)
      .set({
        completedAt: patch.completedAt,
        filtersJson: JSON.stringify(patch.filters),
        jobsDiscovered: patch.jobsDiscovered,
        jobsAfterFiltering: patch.jobsAfterFiltering,
        duplicatesRemoved: patch.duplicatesRemoved,
        jobsAiScored: patch.jobsAiScored,
        jobsAboveThreshold: patch.jobsAboveThreshold,
        newJobs: patch.newJobs,
        errorsJson: JSON.stringify(patch.errors),
        status: patch.status,
      })
      .where(eq(searchRuns.id, id))
      .run();
  }

  listRuns(): RunRecord[] {
    return this.db.select().from(searchRuns).orderBy(desc(searchRuns.startedAt)).all().map(mapRun);
  }

  getRun(id: number): RunRecord | null {
    const row = this.db.select().from(searchRuns).where(eq(searchRuns.id, id)).get();
    return row ? mapRun(row) : null;
  }

  markClosed(id: number, now: number): void {
    this.db.update(jobs).set({ isClosed: 1, updatedAt: now }).where(eq(jobs.id, id)).run();
  }

  private replaceSources(
    jobId: number,
    sources: Array<{ source: string; sourceJobId: string | null; jobUrl: string; applyUrl: string }>,
    now: number,
  ): void {
    for (const source of sources) {
      const url = canonicalUrl(source.jobUrl);
      const existing = source.sourceJobId
        ? this.db
            .select()
            .from(jobSources)
            .where(and(eq(jobSources.source, source.source), eq(jobSources.sourceJobId, source.sourceJobId)))
            .get()
        : this.db
            .select()
            .from(jobSources)
            .where(and(eq(jobSources.source, source.source), eq(jobSources.jobUrl, url)))
            .get();
      if (existing) {
        this.db
          .update(jobSources)
          .set({
            jobId,
            jobUrl: url,
            applyUrl: source.applyUrl,
            sourceJobId: source.sourceJobId,
            lastSeenAt: now,
          })
          .where(eq(jobSources.id, existing.id))
          .run();
      } else {
        this.db
          .insert(jobSources)
          .values({
            jobId,
            source: source.source,
            sourceJobId: source.sourceJobId,
            jobUrl: url,
            applyUrl: source.applyUrl,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .run();
      }
    }
  }
}

function mapRun(row: typeof searchRuns.$inferSelect): RunRecord {
  return {
    id: row.id,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    sources: JSON.parse(row.sourcesJson) as string[],
    filters: JSON.parse(row.filtersJson) as unknown,
    jobsDiscovered: row.jobsDiscovered,
    jobsAfterFiltering: row.jobsAfterFiltering,
    duplicatesRemoved: row.duplicatesRemoved,
    jobsAiScored: row.jobsAiScored,
    jobsAboveThreshold: row.jobsAboveThreshold,
    newJobs: row.newJobs,
    errors: JSON.parse(row.errorsJson) as unknown[],
    status: row.status,
  };
}

function sameCompany(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function existingAsNormalized(existing: ExistingJob): NormalizedJob {
  const source = existing.sources[0];
  return {
    source: source?.source ?? "unknown",
    sourceJobId: source?.sourceJobId ?? null,
    title: existing.title,
    company: existing.company,
    description: existing.description,
    location: existing.location,
    workMode: existing.workMode,
    employmentType: (existing.employmentType ?? "unknown") as NormalizedJob["employmentType"],
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryNormalizedInrMin: null,
    salaryNormalizedInrMax: null,
    postedAt: existing.postedAt ? new Date(existing.postedAt) : null,
    jobUrl: source?.jobUrl ?? "",
    applyUrl: source?.applyUrl ?? "",
    descriptionHash: existing.descriptionHash,
  };
}

function mergeSources(
  current: ExistingJob["sources"],
  incoming: Array<{ source: string; sourceJobId: string | null; jobUrl: string; applyUrl: string }>,
): Array<{ source: string; sourceJobId: string | null; jobUrl: string; applyUrl: string }> {
  const merged = [...current];
  for (const source of incoming) {
    const exists = merged.some(
      (item) =>
        item.source === source.source &&
        ((source.sourceJobId && item.sourceJobId === source.sourceJobId) ||
          canonicalUrl(item.jobUrl) === canonicalUrl(source.jobUrl)),
    );
    if (!exists) merged.push(source);
  }
  return merged;
}
