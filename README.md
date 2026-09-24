# Job Finder

Local web app that searches permitted job sources, filters and deduplicates the results, scores them against your profile, stores them in SQLite, and exports a CSV. It never applies to a job for you.

## Prerequisites

- Node.js 20 or newer
- npm

## Install

```bash
npm install
cp .env.example .env
```

## Environment

`.env` is local and is not committed. The server reads it. The browser never receives `DEEPSEEK_API_KEY`.

| Variable | Purpose |
| --- | --- |
| `PORT` | API port. Default `3000`. |
| `DATABASE_URL` | SQLite file. Default `./data/jobs.db`. |
| `DEEPSEEK_API_KEY` | Server-side key for scoring. Leave blank to collect jobs without AI scores. |
| `DEEPSEEK_MODEL` | Default `deepseek-v4-flash`. Calls use non-thinking mode. |
| `DEFAULT_MIN_SCORE` | Dashboard and CSV threshold. Default `65`. |
| `DEFAULT_MAX_RESULTS_PER_SOURCE` | Cap per source. Default `100`. |
| `DEFAULT_POSTED_WITHIN_DAYS` | Default search window. |
| `DEFAULT_MIN_MONTHLY_SALARY_INR` | Default salary floor. `50000` is ₹6,00,000 a year. |
| `DEFAULT_EXCHANGE_RATE_USD_INR` | Used when a posting is in USD. |

## Profile

Edit `config/profile.json`. Skill weights are 5 (core) through 1 (limited). Change `profileVersion` when you want existing AI scores to be recalculated. Restart the app after editing the file.

## Run

```bash
npm run dev
```

Open http://localhost:5173. The page talks to the API on port 3000.

`npm run build` typechecks and builds the static client. `npm test` runs the pipeline tests.

## Database and CSV

- SQLite is the source of truth: `data/jobs.db`
- `data/jobs.csv` is regenerated from SQLite after a search and after a status change
- Editing the CSV by hand does not update the database
- CSV columns are exactly `id`, `score`, `company`, `job_title`, `salary`, `apply_url`, `job_url`, `work_mode`, `status`

## How a search works

1. Each selected source is queried for every role keyword.
2. Results are normalized, then hard-filtered by work mode, location, employment type, posted date, and an explicitly too-low salary. Unknown salary, unknown work mode, and unknown location are kept.
3. Duplicates are merged. The same company and title are not merged when the description, location, or requisition id shows a different posting.
4. A deterministic score drops obviously irrelevant jobs before any model call. Jobs at or above 40 are sent to DeepSeek. Identical description, profile version, and model reuse the saved score.
5. The model score is the final score. Jobs at or above the minimum score are the relevant set and are written to the CSV. Lower scores and failed AI calls stay in SQLite.
6. A job that is missing from three consecutive relevant searches is marked `isClosed`. That does not change `NEW`, `APPLIED`, or any other status you set.

The Apply link opens `applyUrl` in a new tab. The app does not fill forms or submit applications.

## Sources

Adapters live in `server/sources`. The orchestrator does not contain source-specific parsing.

- **Wellfound.** Public role pages such as `/role/l/software-engineer/india` and public job pages. `robots.txt` allows these paths and disallows `/search`, so keyword search is not scraped. Requests are sequential and paced. If a role page does not exist, that keyword is skipped.
- **Instahyre and Hirist.** Public job JSON used by those sites, with no login. Listings are filtered with the same rules as Wellfound.

A failed source does not cancel the other sources.

## Status

Allowed values: `NEW`, `REVIEWED`, `APPLIED`, `WAITING`, `INTERVIEW`, `REJECTED`, `SKIPPED`, `OFFER`.

New rows start as `NEW`. Later searches update salary, score, and last-seen time, and they do not overwrite the status you chose.

## Adding a source

1. Add a folder under `server/sources` with a parser and a class that implements `JobSource`.
2. Return normalized raw jobs, or a structured `{ source, status, reason }` error when access is not permitted.
3. Register it in `server/sources/registry.ts` and add the id to `shared/types.ts`.

Do not add a source by bypassing its access controls.

## Troubleshooting

- **No rows in the table.** The default filter is the minimum score. Jobs without a DeepSeek score are hidden until you check "Include unscored" or set `DEEPSEEK_API_KEY`.
- **DeepSeek errors.** The run still keeps the collected jobs and their deterministic scores. Invalid model output is retried once, then marked failed.
- **Port in use.** Change `PORT` and restart. The Vite dev server proxies `/api` to that port.
- **Profile changes not applied.** Restart `npm run dev` and bump `profileVersion` if previous AI scores should be discarded.
