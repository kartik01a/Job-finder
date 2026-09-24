import type { WorkMode } from "../../../shared/types";

type Country = {
  id: string;
  names: string[];
};

const COUNTRIES: Country[] = [
  { id: "india", names: ["india"] },
  { id: "united states", names: ["united states", "usa", "u.s.a", "u.s."] },
  { id: "united kingdom", names: ["united kingdom", "uk", "u.k.", "great britain"] },
  { id: "canada", names: ["canada"] },
  { id: "australia", names: ["australia"] },
  { id: "germany", names: ["germany"] },
];

const SHORT_ALIASES: Record<string, string> = {
  us: "united states",
};

export function locationAllowed(
  jobLocation: string | null,
  _workMode: WorkMode,
  target: string | null,
): boolean {
  if (!target || target.trim().toLowerCase() === "any") return true;
  const text = (jobLocation ?? "").trim();
  if (!text) return true;

  const targetKey = target.trim().toLowerCase();
  const targetCountry = resolveCountry(targetKey);
  const haystack = text.toLowerCase();

  if (haystack.includes(targetKey)) return true;
  if (targetCountry && mentionsCountry(haystack, targetCountry)) return true;
  if (isWorldwide(haystack)) return true;
  if (targetCountry && inclusiveRegion(haystack, targetCountry)) return true;
  if (exclusiveMismatch(haystack, targetCountry)) return false;
  return true;
}

function resolveCountry(value: string): string | null {
  if (SHORT_ALIASES[value]) return SHORT_ALIASES[value];
  for (const country of COUNTRIES) {
    if (country.id === value || country.names.includes(value)) return country.id;
  }
  return null;
}

function mentionsCountry(text: string, countryId: string): boolean {
  const country = COUNTRIES.find((item) => item.id === countryId);
  if (!country) return false;
  if (country.names.some((name) => text.includes(name))) return true;
  if (countryId === "united states" && /\bus\b/.test(text)) return true;
  if (countryId === "united kingdom" && /\buk\b/.test(text)) return true;
  return false;
}

function mentionedCountries(text: string): string[] {
  return COUNTRIES.filter((country) => mentionsCountry(text, country.id)).map((country) => country.id);
}

function isWorldwide(text: string): boolean {
  return /\b(worldwide|anywhere|global|international)\b/.test(text);
}

function inclusiveRegion(text: string, countryId: string): boolean {
  if (countryId === "india" && /\b(apac|asia|south asia)\b/.test(text)) return true;
  if ((countryId === "united states" || countryId === "canada") && /\b(north america)\b/.test(text)) return true;
  if ((countryId === "germany" || countryId === "united kingdom") && /\beurope\b/.test(text)) return true;
  if (countryId === "australia" && /\b(apac|oceania)\b/.test(text)) return true;
  return false;
}

function exclusiveMismatch(text: string, targetCountry: string | null): boolean {
  const countries = mentionedCountries(text);
  if (countries.length > 0 && (!targetCountry || !countries.includes(targetCountry))) return true;

  if (/\beurope\b/.test(text) && targetCountry !== "germany" && targetCountry !== "united kingdom") return true;
  if (/\b(north america)\b/.test(text) && targetCountry !== "united states" && targetCountry !== "canada") {
    return true;
  }
  if (/\b(latam|latin america|middle east|mena|africa)\b/.test(text)) {
    return true;
  }
  return false;
}
