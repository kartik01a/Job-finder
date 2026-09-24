import type { CandidateProfile } from "../../config/profile";
import type { EmploymentType, WorkMode } from "../../../shared/types";
import { locationAllowed } from "../filters/location";
import { plainText, tokens } from "../text";

export type ScoreInput = {
  title: string;
  description: string;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryNormalizedInrMin: number | null;
  salaryNormalizedInrMax: number | null;
};

export type ScoreBreakdown = {
  role: number;
  skills: number;
  experience: number;
  location: number;
  workMode: number;
  employment: number;
  salary: number;
  total: number;
  matchedSkills: string[];
  requiredYears: number | null;
};

const ROLE_WEIGHT = 20;
const SKILL_WEIGHT = 35;
const EXPERIENCE_WEIGHT = 20;
const LOCATION_WEIGHT = 10;
const WORK_MODE_WEIGHT = 5;
const EMPLOYMENT_WEIGHT = 5;
const SALARY_WEIGHT = 5;

export function deterministicScore(
  job: ScoreInput,
  profile: CandidateProfile,
  options: {
    location: string | null;
    workModes: Array<"remote" | "onsite" | "hybrid"> | null;
    employmentTypes: string[];
    minimumMonthlySalaryInr: number;
  },
): ScoreBreakdown {
  const matchedSkills = matchedSkillNames(job, profile);
  const role = scoreRole(job.title, profile.preferredRoles);
  const skills = scoreSkills(matchedSkills, profile);
  const requiredYears = extractRequiredYears(`${job.title}\n${job.description}`);
  const experience = scoreExperience(requiredYears, profile.experienceYears);
  const location = scoreLocation(job, options.location);
  const workMode = scoreWorkMode(job.workMode, options.workModes);
  const employment = scoreEmployment(job.employmentType, options.employmentTypes);
  const salary = scoreSalary(job, options.minimumMonthlySalaryInr);
  const total = round(role + skills + experience + location + workMode + employment + salary);
  return {
    role: round(role),
    skills: round(skills),
    experience: round(experience),
    location: round(location),
    workMode: round(workMode),
    employment: round(employment),
    salary: round(salary),
    total,
    matchedSkills,
    requiredYears,
  };
}

export const AI_CANDIDATE_MIN_DETERMINISTIC_SCORE = 40;

export function selectAiCandidates<T extends { deterministicScore: number }>(jobs: T[]): T[] {
  return jobs.filter((job) => job.deterministicScore >= AI_CANDIDATE_MIN_DETERMINISTIC_SCORE);
}

function scoreRole(title: string, preferredRoles: string[]): number {
  const normalizedTitle = title.toLowerCase();
  for (const role of preferredRoles) {
    if (normalizedTitle.includes(role.toLowerCase())) return ROLE_WEIGHT;
  }
  const titleTokens = tokens(title);
  let best = 0;
  for (const role of preferredRoles) {
    const roleTokens = tokens(role);
    if (roleTokens.size === 0) continue;
    let overlap = 0;
    for (const token of roleTokens) {
      if (titleTokens.has(token)) overlap += 1;
    }
    best = Math.max(best, overlap / roleTokens.size);
  }
  return best * ROLE_WEIGHT;
}

function matchedSkillNames(job: ScoreInput, profile: CandidateProfile): string[] {
  const haystack = plainText(`${job.title}\n${job.description}`);
  return Object.keys(profile.skills).filter((skill) => skillPresent(haystack, skill));
}

function scoreSkills(matched: string[], profile: CandidateProfile): number {
  const weights = Object.values(profile.skills);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return 0;
  const matchedWeight = matched.reduce((sum, skill) => sum + (profile.skills[skill] ?? 0), 0);
  return (matchedWeight / total) * SKILL_WEIGHT;
}

export function skillPresent(text: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\./g, "\\.?");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return pattern.test(text);
}

export function extractRequiredYears(text: string): number | null {
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*(?:years|yrs)/i);
  if (range?.[1]) return Number(range[1]);
  const atLeast = text.match(/(?:at least|minimum|min\.?)\s*(\d+)\+?\s*(?:years|yrs)/i);
  if (atLeast?.[1]) return Number(atLeast[1]);
  const plus = text.match(/(\d+)\+\s*(?:years|yrs)/i);
  if (plus?.[1]) return Number(plus[1]);
  const plain = text.match(/(\d+)\s*(?:years|yrs)\s+of/i);
  if (plain?.[1]) return Number(plain[1]);
  return null;
}

function scoreExperience(requiredYears: number | null, experienceYears: number): number {
  if (requiredYears == null) return EXPERIENCE_WEIGHT * 0.8;
  if (experienceYears >= requiredYears) return EXPERIENCE_WEIGHT;
  const gap = requiredYears - experienceYears;
  if (gap <= 1) return EXPERIENCE_WEIGHT * 0.6;
  if (gap <= 2) return EXPERIENCE_WEIGHT * 0.3;
  return EXPERIENCE_WEIGHT * 0.1;
}

function scoreLocation(job: ScoreInput, target: string | null): number {
  if (!target) return LOCATION_WEIGHT * 0.8;
  if (locationAllowed(job.location, job.workMode, target) && job.location) {
    const text = job.location.toLowerCase();
    if (text.includes(target.toLowerCase()) || /\b(worldwide|anywhere|global|apac|asia)\b/.test(text)) {
      return LOCATION_WEIGHT;
    }
    return LOCATION_WEIGHT * 0.6;
  }
  if (!job.location) return LOCATION_WEIGHT * 0.6;
  return LOCATION_WEIGHT * 0.2;
}

function scoreWorkMode(mode: WorkMode, selected: Array<"remote" | "onsite" | "hybrid"> | null): number {
  if (!selected || selected.length === 0) return mode === "unknown" ? WORK_MODE_WEIGHT * 0.6 : WORK_MODE_WEIGHT;
  if (mode === "unknown") return WORK_MODE_WEIGHT * 0.6;
  return selected.includes(mode as "remote" | "onsite" | "hybrid") ? WORK_MODE_WEIGHT : 0;
}

function scoreEmployment(type: EmploymentType, selected: string[]): number {
  if (type === "unknown" || type === "other") return EMPLOYMENT_WEIGHT * 0.6;
  return selected.includes(type) ? EMPLOYMENT_WEIGHT : 0;
}

function scoreSalary(job: ScoreInput, minimumMonthlySalaryInr: number): number {
  const ceiling = job.salaryNormalizedInrMax ?? job.salaryNormalizedInrMin;
  if (ceiling == null) return SALARY_WEIGHT * 0.6;
  return ceiling >= minimumMonthlySalaryInr * 12 ? SALARY_WEIGHT : 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
