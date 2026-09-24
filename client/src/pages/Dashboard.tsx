import { useEffect, useMemo, useState } from "react";
import {
  APPLICATION_STATUSES,
  LOCATION_OPTIONS,
  POSTED_WITHIN_OPTIONS,
  type ApplicationStatus,
  type SourceName,
} from "../../../shared/types";
import {
  getJobs,
  getRun,
  getStats,
  startSearch,
  updateStatus,
  type AppConfig,
  type JobRow,
  type Stats,
} from "../api";

type FormState = {
  sources: SourceName[];
  locationChoice: string;
  customLocation: string;
  workMode: "all" | "remote" | "onsite" | "hybrid";
  employmentTypes: string[];
  postedWithinDays: number | null;
  minimumScore: number;
  maximumExperienceYears: number | null;
  minimumMonthlySalaryInr: number;
  maxResultsPerSource: number;
  keywords: string[];
};

const EMPLOYMENT_OPTIONS = [
  "full-time",
  "contract",
  "freelance",
  "part-time",
  "internship",
  "temporary",
  "other",
] as const;

export function Dashboard({ config }: { config: AppConfig }) {
  const [form, setForm] = useState<FormState>({
    sources: config.sources.map((source) => source.id),
    locationChoice: (LOCATION_OPTIONS as readonly string[]).includes(config.profile.currentLocation)
      ? config.profile.currentLocation
      : "Any",
    customLocation: "",
    workMode: "all",
    employmentTypes: ["full-time", "contract", "freelance"],
    postedWithinDays: config.defaults.postedWithinDays,
    minimumScore: config.defaults.minimumScore,
    maximumExperienceYears: config.profile.experienceYears,
    minimumMonthlySalaryInr: config.defaults.minimumMonthlySalaryInr,
    maxResultsPerSource: config.defaults.maxResultsPerSource,
    keywords: config.profile.preferredRoles,
  });
  const [keywordDraft, setKeywordDraft] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableScore, setTableScore] = useState("");
  const [tableStatus, setTableStatus] = useState("");
  const [tableMode, setTableMode] = useState("");
  const [tableSource, setTableSource] = useState("");
  const [includeUnscored, setIncludeUnscored] = useState(false);
  const [savedJobCount, setSavedJobCount] = useState(0);

  const filters = useMemo(() => {
    const params = new URLSearchParams();
    if (tableScore.trim()) params.set("minScore", tableScore.trim());
    if (tableStatus) params.set("status", tableStatus);
    if (tableMode) params.set("workMode", tableMode);
    if (tableSource) params.set("source", tableSource);
    if (includeUnscored) params.set("includeUnscored", "true");
    return params;
  }, [includeUnscored, tableMode, tableScore, tableSource, tableStatus]);

  async function refresh() {
    const [nextStats, nextJobs] = await Promise.all([getStats(), getJobs(filters)]);
    setStats(nextStats);
    setJobs(nextJobs.jobs);
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load jobs"));
  }, [filters]);

  useEffect(() => {
    if (jobs.length > 0) {
      setSavedJobCount(jobs.length);
      return;
    }
    const params = new URLSearchParams();
    params.set("includeUnscored", "true");
    void getJobs(params)
      .then((result) => setSavedJobCount(result.jobs.length))
      .catch(() => setSavedJobCount(0));
  }, [jobs]);

  async function findJobs() {
    setError(null);
    setSearching(true);
    setProgress(["Starting..."]);
    const location =
      form.locationChoice === "Any" ? null : form.locationChoice === "Custom" ? form.customLocation.trim() : form.locationChoice;
    if (form.locationChoice === "Custom" && !location) {
      setError("Enter a custom location.");
      setSearching(false);
      return;
    }
    try {
      const { runId } = await startSearch({
        sources: form.sources,
        location,
        workModes: form.workMode === "all" ? null : [form.workMode],
        employmentTypes: form.employmentTypes,
        postedWithinDays: form.postedWithinDays,
        minimumScore: form.minimumScore,
        maximumExperienceYears: form.maximumExperienceYears,
        minimumMonthlySalaryInr: form.minimumMonthlySalaryInr,
        maxResultsPerSource: form.maxResultsPerSource,
        keywords: form.keywords,
      });
      let done = false;
      while (!done) {
        const run = await getRun(runId);
        setProgress(run.progress);
        done = run.status === "completed" || run.status === "failed";
        if (!done) await wait(1000);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function toggleSource(id: SourceName) {
    setForm((current) => {
      const sources = current.sources.includes(id)
        ? current.sources.filter((source) => source !== id)
        : [...current.sources, id];
      return { ...current, sources };
    });
  }

  function toggleEmployment(value: string) {
    setForm((current) => {
      const employmentTypes = current.employmentTypes.includes(value)
        ? current.employmentTypes.filter((item) => item !== value)
        : [...current.employmentTypes, value];
      return { ...current, employmentTypes };
    });
  }

  async function changeStatus(job: JobRow, status: ApplicationStatus) {
    await updateStatus(job.id, status);
    await refresh();
  }

  return (
    <main className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Local search</p>
          <h1>Job Finder</h1>
          <p className="lede">
            {config.profile.experienceYears} years · {config.profile.currentLocation}. Jobs are saved locally. Nothing is submitted for you.
          </p>
        </div>
        {!config.aiConfigured && <p className="banner">Add DEEPSEEK_API_KEY to .env to score jobs. Searches still collect and filter results.</p>}
      </header>

      <section className="cards">
        <Card label="Relevant" value={stats?.relevant ?? 0} />
        <Card label="New" value={stats?.NEW ?? 0} />
        <Card label="Applied" value={stats?.APPLIED ?? 0} />
        <Card label="Waiting" value={stats?.WAITING ?? 0} />
        <Card label="Interview" value={stats?.INTERVIEW ?? 0} />
        <Card label="Rejected" value={stats?.REJECTED ?? 0} />
        <Card label="Closed" value={stats?.closed ?? 0} />
      </section>

      <section className="panel">
        <div className="grid">
          <fieldset>
            <legend>Sources</legend>
            {config.sources.map((source) => (
              <label className="choice" key={source.id}>
                <input
                  type="checkbox"
                  checked={form.sources.includes(source.id)}
                  onChange={() => toggleSource(source.id)}
                />
                {source.label}
              </label>
            ))}
          </fieldset>

          <label>
            Location
            <select
              value={form.locationChoice}
              onChange={(event) => setForm({ ...form, locationChoice: event.target.value })}
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          {form.locationChoice === "Custom" && (
            <label>
              Custom location
              <input
                value={form.customLocation}
                onChange={(event) => setForm({ ...form, customLocation: event.target.value })}
              />
            </label>
          )}

          <label>
            Work mode
            <select
              value={form.workMode}
              onChange={(event) => setForm({ ...form, workMode: event.target.value as FormState["workMode"] })}
            >
              <option value="all">All</option>
              <option value="remote">Remote</option>
              <option value="onsite">On-site</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>

          <fieldset>
            <legend>Employment</legend>
            {EMPLOYMENT_OPTIONS.map((option) => (
              <label className="choice" key={option}>
                <input
                  type="checkbox"
                  checked={form.employmentTypes.includes(option)}
                  onChange={() => toggleEmployment(option)}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <label>
            Posted within
            <select
              value={form.postedWithinDays ?? "any"}
              onChange={(event) =>
                setForm({
                  ...form,
                  postedWithinDays: event.target.value === "any" ? null : Number(event.target.value),
                })
              }
            >
              {POSTED_WITHIN_OPTIONS.map((option) => (
                <option key={option.label} value={option.days ?? "any"}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Minimum score
            <input
              type="number"
              min={0}
              max={100}
              value={form.minimumScore}
              onChange={(event) => setForm({ ...form, minimumScore: Number(event.target.value) })}
            />
          </label>
          <label>
            Max experience (years)
            <input
              type="number"
              min={0}
              value={form.maximumExperienceYears ?? ""}
              placeholder="Any"
              onChange={(event) =>
                setForm({
                  ...form,
                  maximumExperienceYears: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Minimum monthly salary (INR)
            <input
              type="number"
              min={0}
              value={form.minimumMonthlySalaryInr}
              onChange={(event) => setForm({ ...form, minimumMonthlySalaryInr: Number(event.target.value) })}
            />
          </label>
          <label>
            Max results per source
            <input
              type="number"
              min={1}
              max={200}
              value={form.maxResultsPerSource}
              onChange={(event) => setForm({ ...form, maxResultsPerSource: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="keywords">
          <span>Search roles</span>
          <div className="chips">
            {form.keywords.map((keyword) => (
              <button
                key={keyword}
                type="button"
                className="chip"
                onClick={() => setForm({ ...form, keywords: form.keywords.filter((item) => item !== keyword) })}
              >
                {keyword} ×
              </button>
            ))}
          </div>
          <div className="keyword-add">
            <input
              value={keywordDraft}
              placeholder="Add a role"
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const next = keywordDraft.trim();
                  if (!next || form.keywords.includes(next)) return;
                  setForm({ ...form, keywords: [...form.keywords, next] });
                  setKeywordDraft("");
                }
              }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const next = keywordDraft.trim();
                if (!next || form.keywords.includes(next)) return;
                setForm({ ...form, keywords: [...form.keywords, next] });
                setKeywordDraft("");
              }}
            >
              Add
            </button>
          </div>
        </div>

        <button type="button" className="find" disabled={searching || form.sources.length === 0 || form.keywords.length === 0} onClick={() => void findJobs()}>
          FIND JOBS
        </button>
        {error && <p className="banner">{error}</p>}
        {progress.length > 0 && (
          <ol className="progress">
            {progress.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <div className="table-filters">
          <label>
            Min score
            <input value={tableScore} onChange={(event) => setTableScore(event.target.value)} />
          </label>
          <label>
            Status
            <select value={tableStatus} onChange={(event) => setTableStatus(event.target.value)}>
              <option value="">Any</option>
              {APPLICATION_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Work mode
            <select value={tableMode} onChange={(event) => setTableMode(event.target.value)}>
              <option value="">Any</option>
              <option value="remote">remote</option>
              <option value="onsite">onsite</option>
              <option value="hybrid">hybrid</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label>
            Source
            <select value={tableSource} onChange={(event) => setTableSource(event.target.value)}>
              <option value="">Any</option>
              {config.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.id}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeUnscored}
              onChange={(event) => setIncludeUnscored(event.target.checked)}
            />
            Include unscored
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th>Company</th>
                <th>Job title</th>
                <th>Salary</th>
                <th>Work mode</th>
                <th>Status</th>
                <th>Apply</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    {savedJobCount > 0
                      ? `${savedJobCount} saved jobs are hidden because none scored ${tableScore || "the minimum"} or above.`
                      : "No jobs match these filters."}
                    {savedJobCount > 0 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setTableScore("");
                          setIncludeUnscored(true);
                        }}
                      >
                        Show saved jobs
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.score ?? "—"}</td>
                  <td>{job.company}</td>
                  <td>
                    <div>{job.title}</div>
                    <div className="meta">
                      {job.sources.join(", ")}
                      {job.location ? ` · ${job.location}` : ""}
                      {job.isClosed ? " · closed" : ""}
                    </div>
                    {job.aiReason && <div className="meta">{job.aiReason}</div>}
                  </td>
                  <td>{job.salaryText || "—"}</td>
                  <td>{job.workMode}</td>
                  <td>
                    <select value={job.status} onChange={(event) => void changeStatus(job, event.target.value as ApplicationStatus)}>
                      {APPLICATION_STATUSES.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <a href={job.applyUrl} target="_blank" rel="noreferrer">
                      Apply
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <article className="card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
