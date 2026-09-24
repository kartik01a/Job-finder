import type { SearchRequest, SourceError } from "../../shared/types";
import type { RawJob } from "../services/normalization/normalize";

export type SourceSearchResult = {
  jobs: RawJob[];
  error: SourceError | null;
};

export interface JobSource {
  name: string;
  search(params: SearchRequest): Promise<SourceSearchResult>;
  getJobDetails?(url: string): Promise<RawJob | null>;
}

export type FetchResponse = {
  status: number;
  url: string;
  text: string;
};

export type FetchLike = (url: string) => Promise<FetchResponse>;

export const USER_AGENT = "JobFinder/1.0 (personal local job search; +http://localhost)";

export async function fetchText(url: string): Promise<FetchResponse> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    url: response.url,
    text: await response.text(),
  };
}

export function isAccessChallenge(status: number, html: string): boolean {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true;
  const sample = html.slice(0, 2500).toLowerCase();
  const title = sample.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  if (title.includes("just a moment") || title.includes("attention required")) return true;
  return sample.includes("verify you are human") && !sample.includes("/jobs/");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
