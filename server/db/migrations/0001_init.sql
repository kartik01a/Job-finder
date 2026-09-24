CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  work_mode TEXT NOT NULL,
  employment_type TEXT,
  salary_text TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_normalized_inr_min REAL,
  salary_normalized_inr_max REAL,
  posted_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  score REAL,
  deterministic_score REAL,
  ai_score REAL,
  apply_url TEXT NOT NULL,
  job_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  is_closed INTEGER NOT NULL DEFAULT 0,
  description_hash TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  ai_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  source TEXT NOT NULL,
  source_job_id TEXT,
  job_url TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS job_sources_source_job_id
  ON job_sources(source, source_job_id)
  WHERE source_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_sources_source_url
  ON job_sources(source, job_url);

CREATE TABLE IF NOT EXISTS job_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  model TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  description_hash TEXT NOT NULL,
  score REAL NOT NULL,
  technical_match REAL NOT NULL,
  experience_match REAL NOT NULL,
  role_match REAL NOT NULL,
  location_match REAL NOT NULL,
  salary_match REAL NOT NULL,
  matched_skills_json TEXT NOT NULL,
  missing_skills_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS job_scores_cache
  ON job_scores(description_hash, profile_version, model, created_at);

CREATE TABLE IF NOT EXISTS search_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  sources_json TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  jobs_discovered INTEGER NOT NULL DEFAULT 0,
  jobs_after_filtering INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  jobs_ai_scored INTEGER NOT NULL DEFAULT 0,
  jobs_above_threshold INTEGER NOT NULL DEFAULT 0,
  new_jobs INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'running'
);
