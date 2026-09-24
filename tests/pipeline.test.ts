import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAiScore, createDeepSeekClient } from "../server/ai/deepseek";
import { loadEnv } from "../server/config/env";
import { loadProfile } from "../server/config/profile";
import { openDatabase } from "../server/db/client";
import { consecutiveMisses, shouldClose } from "../server/services/closedJobs/closedJobs";
import { jobsToCsv } from "../server/services/csv/exportCsv";
import { DeduplicationService, type NormalizedJob } from "../server/services/deduplication/DeduplicationService";
import { applyHardFilters, rejectionReason } from "../server/services/filters/hardFilters";
import { locationAllowed } from "../server/services/filters/location";
import { JobRepository } from "../server/services/jobs/repository";
import { normalizeJob, type RawJob } from "../server/services/normalization/normalize";
import { isExplicitlyBelowMinimum, parseSalary } from "../server/services/salary/parseSalary";
import { deterministicScore, skillPresent } from "../server/services/scoring/deterministic";
import { SearchOrchestrator } from "../server/services/search/orchestrator";
import type { JobSource } from "../server/sources/JobSource";
import { parseHiristJobs } from "../server/sources/hirist/parser";
import { instahyreFunctionIds, parseInstahyreJobs } from "../server/sources/instahyre/parser";
import { extractWellfoundListings, parseWellfoundJobHtml, wellfoundRoleUrl } from "../server/sources/wellfound/parser";
import { descriptionHash } from "../server/services/text";
import type { AiScore, SearchRequest } from "../shared/types";

const RATE = 90;
const profile = loadProfile();
const env = loadEnv({
  DEEPSEEK_API_KEY: "test-key",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
  DEFAULT_MIN_SCORE: "75",
  DEFAULT_EXCHANGE_RATE_USD_INR: "90",
});

const validScore: AiScore = {
  score: 88,
  technicalMatch: 90,
  experienceMatch: 80,
  roleMatch: 92,
  locationMatch: 100,
  salaryMatch: 70,
  matchedSkills: ["React", "TypeScript"],
  missingSkills: ["Kubernetes"],
  reason: "Strong full-stack match with relevant React and TypeScript experience.",
};

function normalized(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const description =
    overrides.description ??
    "Build React TypeScript Node.js services with REST APIs, PostgreSQL, and Git for a product used by many customers across teams.";
  const job: NormalizedJob = {
    source: "wellfound",
    sourceJobId: "1",
    title: "Software Engineer",
    company: "Acme",
    description,
    location: "Remote — India",
    workMode: "remote",
    employmentType: "full-time",
    salaryText: "₹6 LPA",
    salaryMin: 600000,
    salaryMax: 600000,
    salaryCurrency: "INR",
    salaryNormalizedInrMin: 600000,
    salaryNormalizedInrMax: 600000,
    postedAt: new Date("2026-09-01T00:00:00Z"),
    jobUrl: "https://wellfound.com/jobs/1-software-engineer",
    applyUrl: "https://wellfound.com/jobs/1-software-engineer",
    descriptionHash: descriptionHash(description),
    ...overrides,
  };
  job.descriptionHash = descriptionHash(job.description);
  return job;
}

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    sources: ["wellfound"],
    location: "India",
    workModes: ["remote"],
    employmentTypes: ["full-time", "contract", "freelance"],
    postedWithinDays: 14,
    minimumScore: 65,
    maximumExperienceYears: 3,
    minimumMonthlySalaryInr: 50000,
    maxResultsPerSource: 100,
    keywords: ["Software Engineer"],
    ...overrides,
  };
}

describe("salary", () => {
  it("converts monthly rupees, LPA, ranges, and missing pay", () => {
    expect(parseSalary("₹50,000/month", RATE)).toMatchObject({
      salaryNormalizedInrMin: 600000,
      salaryNormalizedInrMax: 600000,
    });
    expect(parseSalary("₹6 LPA", RATE)).toMatchObject({
      salaryNormalizedInrMin: 600000,
      salaryNormalizedInrMax: 600000,
    });
    expect(parseSalary("₹8-12 LPA", RATE)).toMatchObject({
      salaryNormalizedInrMin: 800000,
      salaryNormalizedInrMax: 1200000,
    });
    expect(parseSalary("$60,000/year", RATE).salaryNormalizedInrMin).toBe(5400000);
    const missing = parseSalary(null, RATE);
    expect(isExplicitlyBelowMinimum(missing, 50000)).toBe(false);
    expect(isExplicitlyBelowMinimum(parseSalary("₹20,000/month", RATE), 50000)).toBe(true);
  });
});

describe("location and work mode", () => {
  it("accepts India-compatible remote jobs and rejects clear restrictions", () => {
    expect(locationAllowed("Remote — India", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — India only", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — Worldwide", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — Anywhere", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — APAC", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — Asia", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote", "remote", "India")).toBe(true);
    expect(locationAllowed("Remote — US only", "remote", "India")).toBe(false);
    expect(locationAllowed("United States", "onsite", "India")).toBe(false);
    expect(locationAllowed("Remote only • Canada", "remote", "India")).toBe(false);
    expect(locationAllowed("Europe only", "remote", "India")).toBe(false);
    expect(locationAllowed("Austin, United States", "remote", null)).toBe(true);
    expect(locationAllowed(null, "unknown", "India")).toBe(true);
  });

  it("filters work mode, employment, and keeps unknown values", () => {
    const filters = request();
    const onsite = normalized({ workMode: "onsite", location: "Bengaluru, India" });
    expect(rejectionReason(onsite, filters, new Date("2026-09-10"))).toBe("work-mode");
    const all = request({ workModes: null });
    expect(applyHardFilters([normalized(), onsite, normalized({ workMode: "hybrid", location: "Pune, India" })], all, new Date("2026-09-10"))).toHaveLength(3);
    expect(rejectionReason(normalized({ workMode: "unknown" }), filters, new Date("2026-09-10"))).toBeNull();
    expect(rejectionReason(normalized({ employmentType: "internship" }), filters, new Date("2026-09-10"))).toBe("employment");
    expect(rejectionReason(normalized({ title: "Senior Staff Engineer" }), filters, new Date("2026-09-10"))).toBeNull();
    expect(
      rejectionReason(
        normalized({ description: "Experience: 5+ years. Build React services." }),
        filters,
        new Date("2026-09-10"),
      ),
    ).toBe("experience");
    expect(
      rejectionReason(
        normalized({ description: "Experience Required: 6–12 Years in Pune." }),
        filters,
        new Date("2026-09-10"),
      ),
    ).toBe("experience");
    expect(
      rejectionReason(
        normalized({ description: "3+ years of experience with React and Node." }),
        filters,
        new Date("2026-09-10"),
      ),
    ).toBeNull();
    expect(rejectionReason(normalized({ description: "Hands-on product role." }), filters, new Date("2026-09-10"))).toBeNull();
  });
});

describe("deduplication", () => {
  const service = new DeduplicationService();

  it("merges canonical urls, source ids, and cross-source copies", () => {
    const left = normalized({
      jobUrl: "https://wellfound.com/jobs/1-software-engineer?utm_source=google&utm_campaign=ads",
    });
    const right = normalized({
      source: "indeed",
      sourceJobId: "abc",
      jobUrl: "https://wellfound.com/jobs/1-software-engineer/",
      applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    });
    const groups = service.dedupe([left, right]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sources).toHaveLength(2);
    expect(groups[0]?.job.applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });

  it("keeps similar titles and reposts apart when the description changed", () => {
    const original = normalized({ description: words("react typescript node platform billing invoices customers") });
    const similarTitle = normalized({
      sourceJobId: "2",
      title: "Full-Stack Engineer",
      jobUrl: "https://wellfound.com/jobs/2-full-stack",
      description: words("designer figma brand marketing campaign social content"),
    });
    const repost = normalized({
      sourceJobId: "3",
      title: "Software Engineer",
      jobUrl: "https://wellfound.com/jobs/3-software-engineer",
      postedAt: new Date("2026-01-01T00:00:00Z"),
      description: words("embedded firmware microcontroller hardware pcb manufacturing plant"),
    });
    expect(service.dedupe([original, similarTitle, repost])).toHaveLength(3);

    const cross = normalized({
      source: "indeed",
      sourceJobId: "jk1",
      jobUrl: "https://www.indeed.com/viewjob?jk=jk1",
      description: original.description,
    });
    expect(service.dedupe([original, cross])).toHaveLength(1);
  });
});

describe("scoring and csv", () => {
  it("scores skills without treating senior titles as an automatic miss", () => {
    const score = deterministicScore(normalized({ title: "Senior Software Engineer" }), profile, {
      location: "India",
      workModes: ["remote"],
      employmentTypes: ["full-time"],
      minimumMonthlySalaryInr: 50000,
    });
    expect(score.total).toBeGreaterThan(40);
    expect(score.role).toBeGreaterThan(0);
    expect(skillPresent("We use React and Node.js", "React")).toBe(true);
    expect(skillPresent("digital transformation", "Git")).toBe(false);
  });

  it("writes the minimal csv columns in score order", () => {
    const csv = jobsToCsv([
      {
        id: 2,
        score: 80,
        company: "Beta, Inc",
        title: "Backend Engineer",
        salary: "₹8 LPA",
        applyUrl: "https://example.com/apply",
        jobUrl: "https://example.com/job",
        workMode: "remote",
        status: "APPLIED",
        postedAt: 200,
        firstSeenAt: 100,
      },
      {
        id: 1,
        score: 91,
        company: "Acme",
        title: "Software Engineer",
        salary: "",
        applyUrl: "https://example.com/a",
        jobUrl: "https://example.com/j",
        workMode: "remote",
        status: "NEW",
        postedAt: 100,
        firstSeenAt: 100,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("id,score,company,job_title,salary,apply_url,job_url,work_mode,status");
    expect(lines[1]?.startsWith("1,91,")).toBe(true);
    expect(lines[2]).toContain('"Beta, Inc"');
    expect(lines[2]).toContain("APPLIED");
  });
});

describe("ai parsing", () => {
  it("accepts valid json and retries invalid json once", async () => {
    expect(parseAiScore(JSON.stringify(validScore)).ok).toBe(true);
    let calls = 0;
    const client = createDeepSeekClient({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fetchImpl: (async () => {
        calls += 1;
        const content = calls === 1 ? "nope" : JSON.stringify(validScore);
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }) as typeof fetch,
    });
    const retried = await client.score({
      profile,
      job: normalized(),
      deterministicScore: 60,
      searchLocation: "India",
    });
    expect(retried.ok).toBe(true);
    expect(calls).toBe(2);

    const failing = createDeepSeekClient({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{" } }] }), { status: 200 })) as typeof fetch,
    });
    const failed = await failing.score({
      profile,
      job: normalized(),
      deterministicScore: 60,
      searchLocation: "India",
    });
    expect(failed.ok).toBe(false);
  });
});

describe("status, closure, and orchestration", () => {
  it("preserves status and closes a job only after three relevant misses", async () => {
    expect(shouldClose(consecutiveMisses(1, [4, 3, 2]))).toBe(true);
    expect(shouldClose(consecutiveMisses(3, [4, 2]))).toBe(false);

    const db = openDatabase(":memory:");
    const repository = new JobRepository(db);
    let mode: "same" | "changed" | "empty" = "same";
    let clock = Date.parse("2026-01-01T00:00:00Z");
    const source: JobSource = {
      name: "wellfound",
      async search() {
        if (mode === "empty") return { jobs: [], error: null };
        if (mode === "changed") {
          const job = sampleRaw("1");
          job.description = `${job.description} The team now wants Kubernetes and a different on-call rotation.`;
          return { jobs: [job], error: null };
        }
        return { jobs: [sampleRaw("1")], error: null };
      },
    };
    const calls = { count: 0 };
    const orchestrator = new SearchOrchestrator({
      repository,
      sources: [source],
      profile,
      env,
      csvPath: path.join(os.tmpdir(), `jobs-${Date.now()}.csv`),
      now: () => new Date(clock),
      ai: {
        async score() {
          calls.count += 1;
          return { ok: true, score: validScore };
        },
      },
    });
    const search = request({ location: null, workModes: null, postedWithinDays: null });
    const runOnce = async () => {
      clock += 86_400_000;
      await orchestrator.run(search, repository.createRun(clock, search.sources, search), () => undefined);
    };

    await runOnce();
    expect(repository.listJobs({ minScore: null, status: null, workMode: null, source: null, includeUnscored: true, includeClosed: true })).toHaveLength(1);
    expect(repository.getJob(1)?.status).toBe("NEW");
    expect(repository.getJob(1)?.score).toBe(88);
    repository.updateStatus(1, "APPLIED", clock);

    await runOnce();
    expect(repository.getJob(1)?.status).toBe("APPLIED");
    expect(repository.listJobs({ minScore: null, status: null, workMode: null, source: null, includeUnscored: true, includeClosed: true })).toHaveLength(1);
    expect(calls.count).toBe(1);

    mode = "changed";
    await runOnce();
    expect(calls.count).toBe(2);
    expect(repository.getJob(1)?.status).toBe("APPLIED");

    mode = "empty";
    await runOnce();
    await runOnce();
    expect(repository.getJob(1)?.isClosed).toBe(false);
    await runOnce();
    expect(repository.getJob(1)?.isClosed).toBe(true);
    expect(repository.getJob(1)?.status).toBe("APPLIED");
  });

  it("keeps going when one source or the model fails", async () => {
    const db = openDatabase(":memory:");
    const repository = new JobRepository(db);
    const hirist: JobSource = {
      name: "hirist",
      async search() {
        return { jobs: [], error: { source: "hirist", status: "unavailable", reason: "blocked" } };
      },
    };
    const wellfound: JobSource = {
      name: "wellfound",
      async search() {
        return { jobs: [sampleRaw("9")], error: null };
      },
    };
    const orchestrator = new SearchOrchestrator({
      repository,
      sources: [hirist, wellfound],
      profile,
      env,
      csvPath: path.join(os.tmpdir(), `jobs-fail-${Date.now()}.csv`),
      ai: { async score() { return { ok: false, reason: "DeepSeek score was not JSON" }; } },
    });
    const search = request({
      sources: ["hirist", "wellfound"],
      location: null,
      workModes: null,
      postedWithinDays: null,
    });
    const lines: string[] = [];
    await orchestrator.run(search, repository.createRun(1, search.sources, search), (line) => lines.push(line));
    const jobs = repository.listJobs({
      minScore: null,
      status: null,
      workMode: null,
      source: null,
      includeUnscored: true,
      includeClosed: true,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.score).toBeNull();
    expect(jobs[0]?.deterministicScore).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("Hirist: unavailable"))).toBe(true);
    expect(lines.some((line) => line.includes("Complete"))).toBe(true);
  });
});

describe("source parsers", () => {
  it("reads wellfound listing hints and job posting json-ld", () => {
    const html = `
      <div data-testid="startup-header"><h2 class="inline">Boom</h2></div>
      <a href="/jobs/4716782-software-engineer">Software Engineer</a>
      <span>Full-time</span>
      <span class="pl-1 text-xs">$120k – $200k • 0.01%</span>
      <span class="pl-1 text-xs">Remote — India</span>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Software Engineer",
        description: "<p>React, TypeScript, and Node.js. 3 years of experience.</p>",
        employmentType: "FULL_TIME",
        datePosted: "2026-09-15T00:00:00Z",
        identifier: { value: "4716782" },
        hiringOrganization: { name: "Boom" },
        jobLocation: [{ address: { addressLocality: "Bengaluru", addressCountry: "India" } }],
        baseSalary: { currency: "USD", value: { unitText: "YEAR", minValue: 120000, maxValue: 200000 } },
      })}</script>`;
    const listings = extractWellfoundListings(html);
    expect(listings[0]?.company).toBe("Boom");
    expect(listings[0]?.locationText).toBe("Remote — India");
    const job = parseWellfoundJobHtml(html, "https://wellfound.com/jobs/4716782-software-engineer", listings[0]);
    expect(job?.company).toBe("Boom");
    expect(job?.salaryMin).toBe(120000);
    expect(job?.applyUrl).toBe("https://wellfound.com/jobs/4716782-software-engineer");
    expect(job?.description).toContain("React");
  });

  it("searches the India role page when location is India or unset", () => {
    expect(wellfoundRoleUrl("full-stack-engineer", "India")).toEqual([
      "https://wellfound.com/role/l/full-stack-engineer/india",
    ]);
    expect(wellfoundRoleUrl("full-stack-engineer", null, "India")).toEqual([
      "https://wellfound.com/role/l/full-stack-engineer/india",
      "https://wellfound.com/role/full-stack-engineer",
    ]);
  });

  it("reads Instahyre and Hirist search JSON", () => {
    expect(instahyreFunctionIds(["Full Stack Engineer", "Backend Engineer"])).toEqual([1, 10]);
    const instahyre = parseInstahyreJobs({
      objects: [
        {
          id: 42,
          title: "Full Stack Engineer",
          locations: "Bangalore",
          keywords: ["React", "Node.js"],
          public_url: "https://www.instahyre.com/job-42",
          employer: { company_name: "Acme", instahyre_note: "Product company." },
        },
      ],
    });
    expect(instahyre[0]?.company).toBe("Acme");
    expect(instahyre[0]?.applyUrl).toBe("https://www.instahyre.com/job-42");
    const hirist = parseHiristJobs({
      data: [
        {
          id: 7,
          title: "Full Stack Engineer",
          min: 5,
          max: 8,
          jobDetailUrl: "https://www.hirist.tech/j/full-stack-engineer-7",
          locations: [{ name: "Pune" }],
          companyData: { companyName: "AHEAD" },
          tags: [{ name: "React" }],
        },
      ],
    });
    expect(hirist[0]?.company).toBe("AHEAD");
    expect(hirist[0]?.description).toContain("Experience: 5-8 years");
    expect(rejectionReason(normalizeJob(hirist[0]!, 90), request(), new Date("2026-09-24"))).toBe("experience");
  });
});

function sampleRaw(id: string): RawJob {
  return {
    source: "wellfound",
    sourceJobId: id,
    title: "Software Engineer",
    company: "Acme",
    description:
      "Software Engineer role using React, TypeScript, Node.js, and REST APIs. 3 years of experience building product features with Git and PostgreSQL for customers.",
    locationText: "Remote — India",
    workModeText: "Remote — India",
    employmentTypeText: "Full-time",
    salaryText: "₹8 LPA",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    postedAt: "2026-09-18T00:00:00Z",
    jobUrl: `https://wellfound.com/jobs/${id}-software-engineer`,
    applyUrl: `https://wellfound.com/jobs/${id}-software-engineer`,
  };
}

function words(text: string): string {
  return `${text} ${text} ${text} with additional implementation details for customers teams services platform reliability product quality`;
}

describe("environment", () => {
  it("rejects an invalid port and loads the profile", () => {
    expect(() => loadEnv({ PORT: "0" })).toThrow(/Invalid environment/);
    expect(profile.preferredRoles).toContain("Software Engineer");
    expect(fs.existsSync(path.resolve("config/profile.json"))).toBe(true);
  });
});
