import type { SearchRequest } from "../../../shared/types";
import type { RawJob } from "../../services/normalization/normalize";
import type { FetchLike, JobSource, SourceSearchResult } from "../JobSource";
import { fetchText, isAccessChallenge, sleep } from "../JobSource";
import { instahyreFunctionIds, instahyreSearchUrl, parseInstahyreJobs } from "./parser";

export function createInstahyreSource(options?: {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  delayMs?: number;
}): JobSource {
  const fetchImpl = options?.fetchImpl ?? fetchText;
  const sleepImpl = options?.sleepImpl ?? sleep;
  const delayMs = options?.delayMs ?? 400;

  return {
    name: "instahyre",
    async search(params: SearchRequest): Promise<SourceSearchResult> {
      const jobs: RawJob[] = [];
      const seen = new Set<string>();
      let blocked = false;
      let requestFailure: string | null = null;
      const functionIds = instahyreFunctionIds(params.keywords);

      for (const functionId of functionIds) {
        if (jobs.length >= params.maxResultsPerSource || blocked) break;
        for (let offset = 0; offset < 200; offset += 20) {
          if (jobs.length >= params.maxResultsPerSource) break;
          if (offset > 0 || jobs.length > 0) await sleepImpl(delayMs);
          let response;
          try {
            response = await fetchImpl(instahyreSearchUrl(functionId, offset));
          } catch (error) {
            requestFailure = error instanceof Error ? error.message : "Instahyre request failed";
            break;
          }
          if (isAccessChallenge(response.status, response.text)) {
            blocked = true;
            break;
          }
          if (response.status >= 400) {
            requestFailure = `Instahyre returned HTTP ${response.status}`;
            break;
          }
          let parsed: RawJob[] = [];
          try {
            parsed = parseInstahyreJobs(JSON.parse(response.text) as unknown);
          } catch {
            requestFailure = "Instahyre returned invalid JSON";
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
            source: "instahyre",
            status: "unavailable",
            reason: "Instahyre returned an access challenge. This app does not bypass bot checks.",
          },
        };
      }
      if (jobs.length === 0 && requestFailure) {
        return { jobs: [], error: { source: "instahyre", status: "error", reason: requestFailure } };
      }
      return { jobs, error: null };
    },
  };
}
