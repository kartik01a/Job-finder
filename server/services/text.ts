import { createHash } from "node:crypto";

export function plainText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function descriptionHash(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}

export function normalizeForHash(text: string): string {
  return plainText(text).toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(value: string): string {
  return normalizeTitle(value)
    .replace(/\b(inc|llc|ltd|pvt|private|limited|corp|corporation|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(" ").filter((token) => token.length > 1));
}

export function descriptionSimilarity(left: string, right: string): number {
  const a = tokens(plainText(left));
  const b = tokens(plainText(right));
  if (a.size < 8 || b.size < 8) {
    const aa = normalizeForHash(left);
    const bb = normalizeForHash(right);
    if (!aa || !bb) return 0;
    return aa === bb ? 1 : 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_eid",
  "igshid",
  "si",
  "ref",
  "from",
]);

export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of kept) url.searchParams.append(key, value);
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return input.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function daysBetween(left: Date | null, right: Date | null): number | null {
  if (!left || !right) return null;
  return Math.abs(left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24);
}
