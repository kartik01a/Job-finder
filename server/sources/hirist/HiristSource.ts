import type { SearchRequest } from "../../../shared/types";
import type { RawJob } from "../../services/normalization/normalize";
import type { FetchLike, JobSource, SourceSearchResult } from "../JobSource";
import { fetchText, isAccessChallenge, sleep } from "../JobSource";
import { hiristSearchUrl, parseHiristJobs } from "./parser";

export function createHiristSource(options?: {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  delayMs?: number;
}): JobSource {
  const fetchImpl = options?.fetchImpl ?? fetchText;
  const sleepImpl = options?.sleepImpl ?? sleep;
  const delayMs = options?.delayMs ?? 400;

  return {
    name: "hirist",
    async search(params: SearchRequest): Promise<SourceSearchResult> {
      const jobs: RawJob[] = [];
      const seen = new Set<string>();
      let blocked = false;
      let requestFailure: string | null = null;

      for (const keyword of params.keywords) {
        if (jobs.length >= params.maxResultsPerSource || blocked) break;
        for (let page = 0; page < 5; page += 1) {
          if (jobs.length >= params.maxResultsPerSource) break;
          if (page > 0 || jobs.length > 0) await sleepImpl(delayMs);
          let response;
          try {
            response = await fetchImpl(hiristSearchUrl(keyword, page));
          } catch (error) {
            requestFailure = error instanceof Error ? error.message : "Hirist request failed";
            break;
          }
          if (isAccessChallenge(response.status, response.text)) {
            blocked = true;
            break;
          }
          if (response.status >= 400) {
            requestFailure = `Hirist returned HTTP ${response.status}`;
            break;
          }
          let parsed: RawJob[] = [];
          try {
            parsed = parseHiristJobs(JSON.parse(response.text) as unknown);
          } catch {
            requestFailure = "Hirist returned invalid JSON";
            break;
          }
          if (parsed.length === 0) break;
          let added = 0;
          for (const job of parsed) {
            if (!job.sourceJobId || seen.has(job.sourceJobId)) continue;
            seen.add(job.sourceJobId);
            jobs.push(job);
            added += 1;
            if (jobs.length >= params.maxResultsPerSource) break;
          }
          if (added === 0) break;
        }
      }

      if (jobs.length === 0 && blocked) {
        return {
          jobs: [],
          error: {
            source: "hirist",
            status: "unavailable",
            reason: "Hirist returned an access challenge. This app does not bypass bot checks.",
          },
        };
      }
      if (jobs.length === 0 && requestFailure) {
        return { jobs: [], error: { source: "hirist", status: "error", reason: requestFailure } };
      }
      return { jobs, error: null };
    },
  };
}
