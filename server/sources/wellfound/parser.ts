import { z } from "zod";
import type { RawJob } from "../../services/normalization/normalize";
import { plainText } from "../../services/text";

export type WellfoundListing = {
  id: string;
  path: string;
  title: string;
  company: string;
  employmentText: string | null;
  salaryText: string | null;
  locationText: string | null;
};

const postingSchema = z
  .object({
    "@type": z.union([z.literal("JobPosting"), z.array(z.string())]),
    title: z.string().optional(),
    description: z.string().optional(),
    employmentType: z.union([z.string(), z.array(z.string())]).optional(),
    datePosted: z.string().optional(),
    identifier: z
      .object({
        value: z.union([z.string(), z.number()]).optional(),
      })
      .optional(),
    hiringOrganization: z
      .object({
        name: z.string().optional(),
      })
      .optional(),
    jobLocation: z.unknown().optional(),
    jobLocationType: z.unknown().optional(),
    baseSalary: z.unknown().optional(),
  })
  .passthrough();

export function extractWellfoundListings(html: string): WellfoundListing[] {
  const matches = [...html.matchAll(/href="(\/jobs\/(\d+)-[^"#?]*)"/g)];
  const seen = new Set<string>();
  const listings: WellfoundListing[] = [];
  for (const match of matches) {
    const path = match[1];
    const id = match[2];
    const index = match.index ?? 0;
    if (!path || !id || seen.has(id)) continue;
    seen.add(id);
    const before = html.slice(Math.max(0, index - 8000), index);
    const company = [...before.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].at(-1)?.[1]?.trim() || "Unknown";
    const windowHtml = html.slice(index, index + 4500);
    const title = windowHtml.match(/>([^<]+)<\/a>/)?.[1]?.trim() || "";
    const employmentText =
      windowHtml.match(/>(Full-time|Part-time|Contract|Freelance|Internship|Temporary|Intern)</i)?.[1] ?? null;
    const spans = [...windowHtml.matchAll(/<span class="pl-1 text-xs">([^<]*)<\/span>/g)].map((item) =>
      (item[1] ?? "").trim(),
    );
    const salaryText = spans.find((span) => /[$₹]|lpa|\d\s*k\b/i.test(span)) ?? null;
    const locationText =
      spans.find((span) => span && span !== salaryText && !/equity/i.test(span)) ?? null;
    listings.push({ id, path, title, company, employmentText, salaryText, locationText });
  }
  return listings;
}

export function parseWellfoundJobHtml(html: string, pageUrl: string, hint?: WellfoundListing): RawJob | null {
  const posting = readJobPosting(html);
  if (!posting && !hint) return null;
  const idFromUrl = pageUrl.match(/\/jobs\/(\d+)/)?.[1] ?? hint?.id ?? null;
  const locations = posting ? readLocations(posting.jobLocation) : [];
  const salary = posting ? readSalary(posting.baseSalary) : null;
  const remoteHint = [hint?.locationText, posting ? readLocationType(posting.jobLocationType) : null]
    .filter(Boolean)
    .join(" ");
  const locationText = [hint?.locationText, ...locations].filter(Boolean).join(" · ") || null;
  const employment = posting ? readEmployment(posting.employmentType) : hint?.employmentText ?? null;
  return {
    source: "wellfound",
    sourceJobId: posting?.identifier?.value != null ? String(posting.identifier.value) : idFromUrl,
    title: posting?.title?.trim() || hint?.title || "Untitled role",
    company: posting?.hiringOrganization?.name?.trim() || hint?.company || "Unknown",
    description: plainText(posting?.description ?? ""),
    locationText,
    workModeText: remoteHint || locationText,
    employmentTypeText: employment,
    salaryText: salary?.text ?? hint?.salaryText ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    postedAt: posting?.datePosted ?? null,
    jobUrl: pageUrl.split("?")[0] ?? pageUrl,
    applyUrl: pageUrl.split("?")[0] ?? pageUrl,
  };
}

function readJobPosting(html: string): z.infer<typeof postingSchema> | null {
  const scripts = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const body = script[1];
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const result = postingSchema.safeParse(node);
        if (!result.success) continue;
        const type = result.data["@type"];
        const isPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
        if (isPosting && result.data.title) return result.data;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function readLocations(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const locations: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("address" in item)) continue;
    const address = (item as { address?: unknown }).address;
    if (!address || typeof address !== "object") continue;
    const record = address as Record<string, unknown>;
    const parts = [record.addressLocality, record.addressRegion, record.addressCountry].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    if (parts.length > 0) locations.push(parts.join(", "));
  }
  return locations;
}

function readLocationType(value: unknown): string | null {
  const text = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
  if (/TELECOMMUTE/i.test(text)) return "remote";
  return null;
}

function readEmployment(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value.join(" ") : value;
}

function readSalary(value: unknown): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "week" | "hour" | null;
  text: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const currency = typeof record.currency === "string" ? record.currency : null;
  const rawValue = record.value;
  let min: number | null = null;
  let max: number | null = null;
  let unit: string | null = null;
  if (typeof rawValue === "number") {
    min = rawValue;
    max = rawValue;
  } else if (rawValue && typeof rawValue === "object") {
    const amount = rawValue as Record<string, unknown>;
    if (typeof amount.minValue === "number") min = amount.minValue;
    if (typeof amount.maxValue === "number") max = amount.maxValue;
    if (typeof amount.value === "number") {
      min = min ?? amount.value;
      max = max ?? amount.value;
    }
    if (typeof amount.unitText === "string") unit = amount.unitText;
  }
  const period = unit?.toLowerCase().includes("month")
    ? "month"
    : unit?.toLowerCase().includes("hour")
      ? "hour"
      : unit?.toLowerCase().includes("week")
        ? "week"
        : unit?.toLowerCase().includes("year")
          ? "year"
          : null;
  if (min == null && max == null) return null;
  const text = currency && (min != null || max != null) ? `${currency} ${min ?? ""}-${max ?? ""} ${unit ?? ""}`.trim() : null;
  return { min, max, currency, period, text };
}

export function keywordToSlug(keyword: string): string {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function wellfoundRoleUrl(slug: string, location: string | null): string[] {
  const urls: string[] = [];
  if (location && location.toLowerCase() !== "any") {
    urls.push(`https://wellfound.com/role/l/${slug}/${keywordToSlug(location)}`);
  }
  urls.push(`https://wellfound.com/role/${slug}`);
  return urls;
}
