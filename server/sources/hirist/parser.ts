import type { RawJob } from "../../services/normalization/normalize";

export type HiristJob = {
  id?: number;
  title?: string;
  min?: number;
  max?: number;
  jobDetailUrl?: string;
  applyUrl?: string;
  workFromHome?: number;
  createdTimeMs?: number;
  minSal?: number;
  maxSal?: number;
  hideSal?: number;
  tags?: Array<{ name?: string }>;
  locations?: Array<{ name?: string }>;
  location?: Array<{ name?: string }>;
  companyData?: { companyName?: string };
};

export function hiristSearchUrl(keyword: string, page: number): string {
  const params = new URLSearchParams({
    query: keyword,
    page: String(page),
    size: "20",
  });
  return `https://gladiator.hirist.tech/job/search?${params.toString()}`;
}

export function parseHiristJobs(payload: unknown): RawJob[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return [];
  const rows = (payload as { data?: HiristJob[] }).data ?? [];
  const jobs: RawJob[] = [];
  for (const job of rows) {
    if (!job.id || !job.title) continue;
    const places = [...(job.locations ?? []), ...(job.location ?? [])]
      .map((place) => place.name?.trim())
      .filter((name): name is string => Boolean(name));
    const location = [...new Set(places)].join(", ");
    const skills = (job.tags ?? []).map((tag) => tag.name).filter(Boolean).join(", ");
    const experience =
      job.min != null && job.max != null && (job.min > 0 || job.max > 0)
        ? `Experience: ${job.min}-${job.max} years.`
        : "";
    const salary = hiristSalary(job);
    const url = job.jobDetailUrl || `https://www.hirist.tech/j/${job.id}`;
    const company = job.companyData?.companyName?.trim() || "Unknown";
    jobs.push({
      source: "hirist",
      sourceJobId: String(job.id),
      title: job.title,
      company,
      description: [`${job.title} at ${company}.`, experience, location ? `Location: ${location}.` : "", skills ? `Skills: ${skills}.` : ""]
        .filter(Boolean)
        .join(" "),
      locationText: location || null,
      workModeText: job.workFromHome === 1 ? "remote" : location || null,
      employmentTypeText: "full-time",
      salaryText: salary.text,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.min != null ? "INR" : null,
      salaryPeriod: salary.min != null ? "year" : null,
      postedAt: job.createdTimeMs ? new Date(job.createdTimeMs).toISOString() : null,
      jobUrl: url,
      applyUrl: job.applyUrl?.trim() || url,
    });
  }
  return jobs;
}

function hiristSalary(job: HiristJob): { min: number | null; max: number | null; text: string | null } {
  if (job.hideSal === 1 || job.minSal == null || job.maxSal == null || (job.minSal <= 0 && job.maxSal <= 0)) {
    return { min: null, max: null, text: null };
  }
  const annual = (value: number) => (value > 0 && value <= 200 ? value * 100000 : value);
  const min = annual(job.minSal);
  const max = annual(job.maxSal);
  return { min, max, text: `₹${job.minSal}-${job.maxSal}` };
}
