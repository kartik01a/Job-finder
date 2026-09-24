import { z } from "zod";

export const SOURCES = ["indeed", "wellfound"] as const;
export type SourceName = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<SourceName, string> = {
  indeed: "Indeed",
  wellfound: "Wellfound",
};

export const APPLICATION_STATUSES = [
  "NEW",
  "REVIEWED",
  "APPLIED",
  "WAITING",
  "INTERVIEW",
  "REJECTED",
  "SKIPPED",
  "OFFER",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const WORK_MODES = ["remote", "onsite", "hybrid", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = [
  "full-time",
  "contract",
  "freelance",
  "part-time",
  "internship",
  "temporary",
  "other",
  "unknown",
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const LOCATION_OPTIONS = [
  "Any",
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "Custom",
] as const;

export const POSTED_WITHIN_OPTIONS = [
  { label: "24 hours", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "Any", days: null },
] as const;

export const searchRequestSchema = z.object({
  sources: z.array(z.enum(SOURCES)).min(1),
  location: z.string().trim().min(1).nullable(),
  workModes: z.array(z.enum(["remote", "onsite", "hybrid"])).nullable(),
  employmentTypes: z
    .array(
      z.enum([
        "full-time",
        "contract",
        "freelance",
        "part-time",
        "internship",
        "temporary",
        "other",
      ]),
    )
    .min(1),
  postedWithinDays: z.number().int().positive().nullable(),
  minimumScore: z.number().min(0).max(100),
  minimumMonthlySalaryInr: z.number().nonnegative(),
  maxResultsPerSource: z.number().int().positive().max(200),
  keywords: z.array(z.string().trim().min(1)).min(1).max(20),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const statusUpdateSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
});

export const aiScoreSchema = z.object({
  score: z.number().min(0).max(100),
  technicalMatch: z.number().min(0).max(100),
  experienceMatch: z.number().min(0).max(100),
  roleMatch: z.number().min(0).max(100),
  locationMatch: z.number().min(0).max(100),
  salaryMatch: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reason: z.string().min(1),
});

export type AiScore = z.infer<typeof aiScoreSchema>;

export type SourceError = {
  source: string;
  status: "unavailable" | "error";
  reason: string;
};
