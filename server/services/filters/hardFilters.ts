import type { EmploymentType, SearchRequest, WorkMode } from "../../../shared/types";
import { locationAllowed } from "./location";
import { isExplicitlyBelowMinimum } from "../salary/parseSalary";

export type FilterableJob = {
  title: string;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  postedAt: Date | null;
  salaryNormalizedInrMin: number | null;
  salaryNormalizedInrMax: number | null;
};

export type FilterRejection = "work-mode" | "location" | "employment" | "posted-date" | "salary";

export function rejectionReason(
  job: FilterableJob,
  request: Pick<SearchRequest, "location" | "workModes" | "employmentTypes" | "postedWithinDays" | "minimumMonthlySalaryInr">,
  now: Date,
): FilterRejection | null {
  if (request.workModes && request.workModes.length > 0) {
    if (job.workMode !== "unknown" && !request.workModes.includes(job.workMode as "remote" | "onsite" | "hybrid")) {
      return "work-mode";
    }
  }

  if (!locationAllowed(job.location, job.workMode, request.location)) return "location";

  if (job.employmentType !== "unknown" && job.employmentType !== "other") {
    if (!request.employmentTypes.includes(job.employmentType)) return "employment";
  }

  if (request.postedWithinDays != null && job.postedAt) {
    const ageMs = now.getTime() - job.postedAt.getTime();
    if (ageMs > request.postedWithinDays * 24 * 60 * 60 * 1000) return "posted-date";
  }

  if (
    isExplicitlyBelowMinimum(
      {
        salaryNormalizedInrMin: job.salaryNormalizedInrMin,
        salaryNormalizedInrMax: job.salaryNormalizedInrMax,
      },
      request.minimumMonthlySalaryInr,
    )
  ) {
    return "salary";
  }

  return null;
}

export function applyHardFilters<T extends FilterableJob>(jobs: T[], request: SearchRequest, now: Date): T[] {
  return jobs.filter((job) => rejectionReason(job, request, now) == null);
}
