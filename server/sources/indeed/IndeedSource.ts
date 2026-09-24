import type { SearchRequest, SourceError } from "../../../shared/types";
import type { RawJob } from "../../services/normalization/normalize";
import type { JobSource, FetchLike, SourceSearchResult } from "../JobSource";
import { fetchText, isAccessChallenge, sleep } from "../JobSource";
import { indeedSearchUrl, parseIndeedSearchHtml } from "./parser";

const UNAVAILABLE: SourceError = {
  source: "indeed",
  status: "unavailable",
  reason:
    "Indeed did not return a public results page. Its job-search API is not open, and this app does not bypass bot checks. Use Wellfound, or an authorized Indeed integration if you have one.",
};

export function createIndeedSource(options?: {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  delayMs?: number;
}): JobSource {
  const fetchImpl = options?.fetchImpl ?? fetchText;
  const sleepImpl = options?.sleepImpl ?? sleep;
  const delayMs = options?.delayMs ?? 1000;

  return {
    name: "indeed",
    async search(params: SearchRequest): Promise<SourceSearchResult> {
      const jobs: RawJob[] = [];
      const seen = new Set<string>();
      let blocked = false;

      for (const keyword of params.keywords) {
        if (jobs.length >= params.maxResultsPerSource) break;
        for (const start of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]) {
          if (jobs.length >= params.maxResultsPerSource) break;
          if (start > 0) await sleepImpl(delayMs);
          let response;
          try {
            response = await fetchImpl(indeedSearchUrl(keyword, params.location, params.postedWithinDays, start));
          } catch (error) {
            return {
              jobs,
              error: {
                source: "indeed",
                status: "error",
                reason: error instanceof Error ? error.message : "Indeed request failed",
              },
            };
          }
          if (isAccessChallenge(response.status, response.text)) {
            blocked = true;
            break;
          }
          const parsed = parseIndeedSearchHtml(response.text, new Date());
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
        if (blocked) break;
      }

      if (blocked && jobs.length === 0) return { jobs: [], error: UNAVAILABLE };
      return { jobs, error: null };
    },
  };
}
