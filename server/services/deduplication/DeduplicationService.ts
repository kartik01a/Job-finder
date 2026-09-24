import type { EmploymentType, WorkMode } from "../../../shared/types";
import {
  canonicalUrl,
  daysBetween,
  descriptionSimilarity,
  normalizeCompany,
  normalizeTitle,
} from "../text";

export type NormalizedJob = {
  source: string;
  sourceJobId: string | null;
  title: string;
  company: string;
  description: string;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryNormalizedInrMin: number | null;
  salaryNormalizedInrMax: number | null;
  postedAt: Date | null;
  jobUrl: string;
  applyUrl: string;
  descriptionHash: string;
};

export type DedupedJob = {
  job: NormalizedJob;
  sources: Array<{
    source: string;
    sourceJobId: string | null;
    jobUrl: string;
    applyUrl: string;
  }>;
};

const SIMILAR_DESCRIPTION = 0.72;
const NEAR_DUPLICATE = 0.92;
const REPOST_GAP_DAYS = 45;

export class DeduplicationService {
  dedupe(jobs: NormalizedJob[]): DedupedJob[] {
    const parent = jobs.map((_, index) => index);
    const find = (index: number): number => {
      let current = index;
      while (parent[current] !== current) {
        parent[current] = parent[parent[current] ?? current] ?? current;
        current = parent[current] ?? current;
      }
      return current;
    };
    const union = (left: number, right: number) => {
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[b] = a;
    };

    for (let i = 0; i < jobs.length; i += 1) {
      for (let j = i + 1; j < jobs.length; j += 1) {
        const left = jobs[i];
        const right = jobs[j];
        if (left && right && canMerge(left, right)) union(i, j);
      }
    }

    const groups = new Map<number, NormalizedJob[]>();
    jobs.forEach((job, index) => {
      const root = find(index);
      const list = groups.get(root) ?? [];
      list.push(job);
      groups.set(root, list);
    });

    return [...groups.values()].map((group) => ({
      job: pickCanonical(group),
      sources: group.map((job) => ({
        source: job.source,
        sourceJobId: job.sourceJobId,
        jobUrl: job.jobUrl,
        applyUrl: job.applyUrl,
      })),
    }));
  }
}

export function canMerge(left: NormalizedJob, right: NormalizedJob): boolean {
  if (canonicalUrl(left.jobUrl) === canonicalUrl(right.jobUrl)) return true;
  if (
    left.source === right.source &&
    left.sourceJobId &&
    left.sourceJobId === right.sourceJobId
  ) {
    return true;
  }

  if (normalizeCompany(left.company) !== normalizeCompany(right.company)) return false;
  if (normalizeTitle(left.title) !== normalizeTitle(right.title)) return false;

  const similarity = descriptionSimilarity(left.description, right.description);
  const sameLocation = locationsCompatible(left.location, right.location);
  const sameEmployment =
    left.employmentType === "unknown" ||
    right.employmentType === "unknown" ||
    left.employmentType === right.employmentType;
  const gap = daysBetween(left.postedAt, right.postedAt);
  const largeGap = gap != null && gap > REPOST_GAP_DAYS;
  const differentIds =
    left.source === right.source &&
    Boolean(left.sourceJobId) &&
    Boolean(right.sourceJobId) &&
    left.sourceJobId !== right.sourceJobId;

  if (differentIds) {
    return similarity >= NEAR_DUPLICATE && sameLocation && sameEmployment && !largeGap;
  }

  if (!sameLocation || !sameEmployment || largeGap) return false;
  return similarity >= SIMILAR_DESCRIPTION;
}

function locationsCompatible(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;
  return normalizeTitle(left) === normalizeTitle(right);
}

function pickCanonical(jobs: NormalizedJob[]): NormalizedJob {
  const sorted = [...jobs].sort((left, right) => right.description.length - left.description.length);
  const base = sorted[0];
  if (!base) {
    throw new Error("Cannot canonicalize an empty job group");
  }
  const withSalary = jobs.find((job) => job.salaryNormalizedInrMin != null) ?? base;
  const posted = jobs
    .map((job) => job.postedAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  return {
    ...base,
    salaryText: withSalary.salaryText ?? base.salaryText,
    salaryMin: withSalary.salaryMin,
    salaryMax: withSalary.salaryMax,
    salaryCurrency: withSalary.salaryCurrency,
    salaryNormalizedInrMin: withSalary.salaryNormalizedInrMin,
    salaryNormalizedInrMax: withSalary.salaryNormalizedInrMax,
    postedAt: posted,
    applyUrl: bestApplyUrl(jobs),
    jobUrl: base.jobUrl,
  };
}

export function bestApplyUrl(jobs: Array<Pick<NormalizedJob, "applyUrl" | "jobUrl">>): string {
  const external = jobs.find((job) => job.applyUrl && canonicalUrl(job.applyUrl) !== canonicalUrl(job.jobUrl));
  return external?.applyUrl || jobs[0]?.applyUrl || jobs[0]?.jobUrl || "";
}
