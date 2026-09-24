import type { EmploymentType, WorkMode } from "../../../shared/types";
import { parseSalary, salaryFromStructured } from "../salary/parseSalary";
import { descriptionHash, plainText } from "../text";
import type { NormalizedJob } from "../deduplication/DeduplicationService";

export type RawJob = {
  source: string;
  sourceJobId: string | null;
  title: string;
  company: string;
  description: string;
  locationText: string | null;
  workModeText: string | null;
  employmentTypeText: string | null;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "year" | "month" | "week" | "hour" | null;
  postedAt: string | null;
  jobUrl: string;
  applyUrl: string | null;
};

export function normalizeJob(raw: RawJob, usdToInr: number): NormalizedJob {
  const description = plainText(raw.description).slice(0, 20000);
  const salary = raw.salaryMin != null || raw.salaryMax != null
    ? salaryFromStructured({
        min: raw.salaryMin,
        max: raw.salaryMax,
        currency: raw.salaryCurrency,
        period: raw.salaryPeriod,
        usdToInr,
        salaryText: raw.salaryText,
      })
    : parseSalary(raw.salaryText, usdToInr);
  const workMode = normalizeWorkMode(raw.workModeText ?? raw.locationText);
  const postedAt = raw.postedAt ? new Date(raw.postedAt) : null;
  return {
    source: raw.source,
    sourceJobId: raw.sourceJobId,
    title: raw.title.trim(),
    company: raw.company.trim() || "Unknown",
    description,
    location: raw.locationText?.trim() || null,
    workMode,
    employmentType: normalizeEmployment(raw.employmentTypeText),
    salaryText: raw.salaryText,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryCurrency: salary.salaryCurrency,
    salaryNormalizedInrMin: salary.salaryNormalizedInrMin,
    salaryNormalizedInrMax: salary.salaryNormalizedInrMax,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    jobUrl: raw.jobUrl,
    applyUrl: raw.applyUrl || raw.jobUrl,
    descriptionHash: descriptionHash(description),
  };
}

export function normalizeWorkMode(text: string | null | undefined): WorkMode {
  if (!text?.trim()) return "unknown";
  const value = text.toLowerCase();
  if (/\bhybrid\b/.test(value)) return "hybrid";
  if (/\b(remote|work from home|wfh|telecommut)/.test(value)) return "remote";
  if (/\b(on-?site|in[- ]office|office)\b/.test(value)) return "onsite";
  return "unknown";
}

export function normalizeEmployment(text: string | null | undefined): EmploymentType {
  if (!text?.trim()) return "unknown";
  const value = text.toLowerCase().replace(/_/g, "-");
  if (/full[- ]?time|permanent/.test(value)) return "full-time";
  if (/part[- ]?time/.test(value)) return "part-time";
  if (/freelance/.test(value)) return "freelance";
  if (/contract/.test(value)) return "contract";
  if (/intern/.test(value)) return "internship";
  if (/temp/.test(value)) return "temporary";
  return "other";
}
