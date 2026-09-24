import type { RawJob } from "../../services/normalization/normalize";

export type InstahyreJob = {
  id?: number;
  title?: string;
  locations?: string;
  keywords?: string[];
  public_url?: string;
  employer?: {
    company_name?: string;
    company_tagline?: string;
    instahyre_note?: string;
  };
};

const FUNCTION_IDS: Array<{ id: number; pattern: RegExp }> = [
  { id: 1, pattern: /full[\s-]*stack|software|product|founding|frontend|front-end|react|next/i },
  { id: 10, pattern: /backend|back-end|node/i },
];

export function instahyreFunctionIds(keywords: string[]): number[] {
  const ids = new Set<number>();
  for (const keyword of keywords) {
    for (const item of FUNCTION_IDS) {
      if (item.pattern.test(keyword)) ids.add(item.id);
    }
  }
  if (ids.size === 0) ids.add(1);
  return [...ids];
}

export function instahyreSearchUrl(functionId: number, offset: number): string {
  const params = new URLSearchParams({
    job_functions: String(functionId),
    offset: String(offset),
    limit: "20",
  });
  return `https://www.instahyre.com/api/v1/job_search/?${params.toString()}`;
}

export function parseInstahyreJobs(payload: unknown): RawJob[] {
  if (!payload || typeof payload !== "object" || !("objects" in payload)) return [];
  const objects = (payload as { objects?: InstahyreJob[] }).objects ?? [];
  const jobs: RawJob[] = [];
  for (const job of objects) {
    if (!job.id || !job.title) continue;
    const company = job.employer?.company_name?.trim() || "Unknown";
    const skills = (job.keywords ?? []).filter(Boolean).join(", ");
    const note = [job.employer?.company_tagline, job.employer?.instahyre_note].filter(Boolean).join(" ");
    const url = job.public_url || `https://www.instahyre.com/job-${job.id}`;
    jobs.push({
      source: "instahyre",
      sourceJobId: String(job.id),
      title: job.title,
      company,
      description: [note, skills ? `Skills: ${skills}` : "", job.locations ? `Locations: ${job.locations}` : ""]
        .filter(Boolean)
        .join("\n"),
      locationText: job.locations?.replace(/,/g, ", ") || null,
      workModeText: job.locations ?? null,
      employmentTypeText: "full-time",
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: null,
      jobUrl: url,
      applyUrl: url,
    });
  }
  return jobs;
}
