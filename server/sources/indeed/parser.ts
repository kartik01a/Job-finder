import type { RawJob } from "../../services/normalization/normalize";

export type IndeedCard = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  snippet: string;
  postedText: string | null;
};

export function parseIndeedSearchHtml(html: string, now: Date): RawJob[] {
  const cards = extractIndeedCards(html);
  return cards.map((card) => ({
    source: "indeed",
    sourceJobId: card.id,
    title: card.title,
    company: card.company,
    description: card.snippet,
    locationText: card.location,
    workModeText: card.location,
    employmentTypeText: card.snippet,
    salaryText: card.salaryText,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    postedAt: parseRelativePostedAt(card.postedText, now),
    jobUrl: `https://www.indeed.com/viewjob?jk=${encodeURIComponent(card.id)}`,
    applyUrl: `https://www.indeed.com/viewjob?jk=${encodeURIComponent(card.id)}`,
  }));
}

export function extractIndeedCards(html: string): IndeedCard[] {
  const pattern = /data-jk="([a-zA-Z0-9]+)"([\s\S]*?)(?=data-jk="|<\/body>|$)/g;
  const cards: IndeedCard[] = [];
  for (const match of html.matchAll(pattern)) {
    const id = match[1];
    const block = match[2] ?? "";
    if (!id) continue;
    const title =
      block.match(/class="jobTitle"[\s\S]*?<a[^>]*>(?:<span[^>]*>)?([^<]+)/i)?.[1]?.trim() ||
      block.match(/class="jcs-JobTitle"[^>]*>([^<]+)/i)?.[1]?.trim() ||
      "";
    if (!title) continue;
    const company =
      block.match(/data-testid="company-name"[^>]*>([^<]+)/i)?.[1]?.trim() ||
      block.match(/class="companyName"[^>]*>(?:<a[^>]*>)?([^<]+)/i)?.[1]?.trim() ||
      "Unknown";
    const location = block.match(/data-testid="text-location"[^>]*>([^<]+)/i)?.[1]?.trim() ?? null;
    const salaryText =
      block.match(/class="salary-snippet[^"]*"[^>]*>([\s\S]*?)<\//i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      null;
    const snippet =
      block.match(/class="job-snippet"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
      "";
    const postedText = block.match(/class="date"[^>]*>([^<]+)/i)?.[1]?.trim() ?? null;
    cards.push({ id, title, company, location, salaryText, snippet, postedText });
  }
  return cards;
}

export function parseRelativePostedAt(text: string | null, now: Date): string | null {
  if (!text) return null;
  const value = text.toLowerCase();
  if (/just posted|today/.test(value)) return now.toISOString();
  const days = value.match(/(\d+)\s+day/);
  if (days?.[1]) return new Date(now.getTime() - Number(days[1]) * 86400000).toISOString();
  const hours = value.match(/(\d+)\s+hour/);
  if (hours?.[1]) return new Date(now.getTime() - Number(hours[1]) * 3600000).toISOString();
  return null;
}

export function indeedSearchUrl(keyword: string, location: string | null, postedWithinDays: number | null, start: number): string {
  const params = new URLSearchParams();
  params.set("q", keyword);
  params.set("l", location ?? "");
  params.set("start", String(start));
  if (postedWithinDays != null) params.set("fromage", String(postedWithinDays));
  return `https://www.indeed.com/jobs?${params.toString()}`;
}
