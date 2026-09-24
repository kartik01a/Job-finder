import type { SearchRequest, SourceError } from "../../../shared/types";
import type { RawJob } from "../../services/normalization/normalize";
import type { FetchLike, JobSource, SourceSearchResult } from "../JobSource";
import { fetchText, isAccessChallenge, sleep } from "../JobSource";
import {
  extractWellfoundListings,
  keywordToSlug,
  parseWellfoundJobHtml,
  wellfoundRoleUrl,
  type WellfoundListing,
} from "./parser";

export function createWellfoundSource(options?: {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  delayMs?: number;
}): JobSource {
  const fetchImpl = options?.fetchImpl ?? fetchText;
  const sleepImpl = options?.sleepImpl ?? sleep;
  const delayMs = options?.delayMs ?? 400;

  return {
    name: "wellfound",
    async search(params: SearchRequest): Promise<SourceSearchResult> {
      const listings: WellfoundListing[] = [];
      const seen = new Set<string>();
      let blockedReason: string | null = null;
      let requestFailure: string | null = null;

      for (const keyword of params.keywords) {
        if (listings.length >= params.maxResultsPerSource) break;
        const slug = keywordToSlug(keyword);
        if (!slug) continue;
        const base = await firstReachableRole(fetchImpl, wellfoundRoleUrl(slug, params.location), sleepImpl, delayMs);
        if (base.status === "blocked") {
          blockedReason = base.reason;
          break;
        }
        if (base.status === "error") {
          requestFailure = base.reason;
          continue;
        }
        if (base.status !== "ok") continue;

        for (let page = 1; page <= 4; page += 1) {
          if (listings.length >= params.maxResultsPerSource) break;
          const url = page === 1 ? base.url : `${base.url}${base.url.includes("?") ? "&" : "?"}page=${page}`;
          if (page > 1) await sleepImpl(delayMs);
          let response;
          try {
            response = page === 1 ? base.response : await fetchImpl(url);
          } catch (error) {
            requestFailure = error instanceof Error ? error.message : "Wellfound request failed";
            break;
          }
          if (isAccessChallenge(response.status, response.text)) {
            blockedReason = "Wellfound returned an access challenge. This app does not bypass bot checks.";
            break;
          }
          if (response.status === 404) break;
          if (response.status >= 400) {
            requestFailure = `Wellfound returned HTTP ${response.status}`;
            break;
          }
          const pageListings = extractWellfoundListings(response.text);
          let added = 0;
          for (const listing of pageListings) {
            if (seen.has(listing.id)) continue;
            seen.add(listing.id);
            listings.push(listing);
            added += 1;
            if (listings.length >= params.maxResultsPerSource) break;
          }
          if (added === 0) break;
        }
        if (blockedReason) break;
      }

      const jobs: RawJob[] = [];
      for (const listing of listings.slice(0, params.maxResultsPerSource)) {
        await sleepImpl(delayMs);
        const pageUrl = `https://wellfound.com${listing.path}`;
        try {
          const response = await fetchImpl(pageUrl);
          if (isAccessChallenge(response.status, response.text)) {
            blockedReason = "Wellfound job pages returned an access challenge. This app does not bypass bot checks.";
            break;
          }
          const job = parseWellfoundJobHtml(response.text, response.url || pageUrl, listing);
          if (job) jobs.push(job);
        } catch (error) {
          requestFailure = error instanceof Error ? error.message : "Wellfound job request failed";
        }
      }

      if (jobs.length === 0 && blockedReason) {
        return { jobs: [], error: { source: "wellfound", status: "unavailable", reason: blockedReason } };
      }
      if (jobs.length === 0 && requestFailure && listings.length === 0) {
        return { jobs: [], error: { source: "wellfound", status: "error", reason: requestFailure } };
      }
      return { jobs, error: null };
    },
  };
}

async function firstReachableRole(
  fetchImpl: FetchLike,
  urls: string[],
  sleepImpl: (ms: number) => Promise<void>,
  delayMs: number,
): Promise<
  | { status: "ok"; url: string; response: Awaited<ReturnType<FetchLike>> }
  | { status: "missing" }
  | { status: "blocked"; reason: string }
  | { status: "error"; reason: string }
> {
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    if (!url) continue;
    if (index > 0) await sleepImpl(delayMs);
    try {
      const response = await fetchImpl(url);
      if (isAccessChallenge(response.status, response.text)) {
        return {
          status: "blocked",
          reason: "Wellfound returned an access challenge. This app does not bypass bot checks.",
        };
      }
      if (response.status === 404) continue;
      if (response.status >= 400) {
        return { status: "error", reason: `Wellfound returned HTTP ${response.status}` };
      }
      if (extractWellfoundListings(response.text).length === 0 && urls[index + 1]) continue;
      return { status: "ok", url: response.url || url, response };
    } catch (error) {
      return { status: "error", reason: error instanceof Error ? error.message : "Wellfound request failed" };
    }
  }
  return { status: "missing" };
}

export function wellfoundUnavailable(reason: string): SourceError {
  return { source: "wellfound", status: "unavailable", reason };
}
