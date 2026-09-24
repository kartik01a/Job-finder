import type { ApplicationStatus, SourceName } from "../../shared/types";

export type AppConfig = {
  defaults: {
    minimumScore: number;
    maxResultsPerSource: number;
    postedWithinDays: number;
    minimumMonthlySalaryInr: number;
  };
  profile: {
    profileVersion: number;
    experienceYears: number;
    currentLocation: string;
    skills: Record<string, number>;
    preferredRoles: string[];
  };
  sources: Array<{ id: SourceName; label: string }>;
  aiConfigured: boolean;
};

export type JobRow = {
  id: number;
  score: number | null;
  deterministicScore: number | null;
  company: string;
  title: string;
  salaryText: string | null;
  workMode: string;
  status: ApplicationStatus;
  applyUrl: string;
  jobUrl: string;
  isClosed: boolean;
  location: string | null;
  sources: string[];
  aiReason: string | null;
};

export type Stats = {
  relevant: number;
  NEW: number;
  APPLIED: number;
  WAITING: number;
  INTERVIEW: number;
  REJECTED: number;
  closed: number;
};

export type RunView = {
  id: number;
  status: string;
  progress: string[];
  jobsDiscovered: number;
  jobsAfterFiltering: number;
  duplicatesRemoved: number;
  jobsAiScored: number;
  jobsAboveThreshold: number;
  newJobs: number;
  errors: Array<{ source?: string; status?: string; reason?: string }>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getConfig(): Promise<AppConfig> {
  return request("/api/config");
}

export function getStats(): Promise<Stats> {
  return request("/api/stats");
}

export function getJobs(params: URLSearchParams): Promise<{ jobs: JobRow[] }> {
  return request(`/api/jobs?${params.toString()}`);
}

export function updateStatus(id: number, status: ApplicationStatus): Promise<{ job: JobRow }> {
  return request(`/api/jobs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function startSearch(body: unknown): Promise<{ runId: number }> {
  return request("/api/search", { method: "POST", body: JSON.stringify(body) });
}

export function getRun(id: number): Promise<RunView> {
  return request(`/api/runs/${id}`);
}
