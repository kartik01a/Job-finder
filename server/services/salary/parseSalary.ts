export type ParsedSalary = {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: "INR" | "USD" | null;
  salaryNormalizedInrMin: number | null;
  salaryNormalizedInrMax: number | null;
};

const EMPTY: ParsedSalary = {
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryNormalizedInrMin: null,
  salaryNormalizedInrMax: null,
};

export function parseSalary(text: string | null | undefined, usdToInr: number): ParsedSalary {
  if (!text?.trim()) return { ...EMPTY };
  const portion = text.split("•")[0]?.split("|")[0]?.trim() ?? text.trim();

  const lpa = portion.match(
    /(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?(?:\s+per\s+annum)?)/i,
  );
  if (lpa?.[1] && lpa[2]) {
    return annualInr(Number(lpa[1]) * 100000, Number(lpa[2]) * 100000);
  }
  const lpaSingle = portion.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?(?:\s+per\s+annum)?)/i);
  if (lpaSingle?.[1]) {
    const annual = Number(lpaSingle[1]) * 100000;
    return annualInr(annual, annual);
  }

  const range = portion.match(
    /(?:(₹|\$|inr|usd)\s*)?(\d[\d,]*(?:\.\d+)?\s*k?)\s*(?:[-–—]|to)\s*(?:(₹|\$|inr|usd)\s*)?(\d[\d,]*(?:\.\d+)?\s*k?)/i,
  );
  if (range?.[2] && range[4]) {
    const currency = detectCurrency(portion, range[1] ?? range[3]);
    const min = parseAmount(range[2]);
    const max = parseAmount(range[4]);
    if (min == null || max == null || !currency) return { ...EMPTY };
    return toAnnual(currency, min, max, detectPeriod(portion, currency, min), usdToInr);
  }

  const single = portion.match(/(?:(₹|\$|inr|usd)\s*)(\d[\d,]*(?:\.\d+)?\s*k?)/i);
  if (single?.[2]) {
    const currency = detectCurrency(portion, single[1]);
    const amount = parseAmount(single[2]);
    if (amount == null || !currency) return { ...EMPTY };
    return toAnnual(currency, amount, amount, detectPeriod(portion, currency, amount), usdToInr);
  }

  return { ...EMPTY };
}

export function salaryFromStructured(input: {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "week" | "hour" | null;
  usdToInr: number;
  salaryText: string | null;
}): ParsedSalary {
  if (input.min == null && input.max == null) return parseSalary(input.salaryText, input.usdToInr);
  const currency = input.currency?.toUpperCase() === "USD" ? "USD" : input.currency?.toUpperCase() === "INR" ? "INR" : null;
  const min = input.min ?? input.max;
  const max = input.max ?? input.min;
  if (!currency || min == null || max == null || !input.period) {
    return parseSalary(input.salaryText, input.usdToInr);
  }
  return toAnnual(currency, min, max, input.period, input.usdToInr);
}

function annualInr(min: number, max: number): ParsedSalary {
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: "INR",
    salaryNormalizedInrMin: min,
    salaryNormalizedInrMax: max,
  };
}

function toAnnual(
  currency: "INR" | "USD",
  min: number,
  max: number,
  period: "year" | "month" | "week" | "hour" | null,
  usdToInr: number,
): ParsedSalary {
  if (!period) return { ...EMPTY };
  const multiplier = period === "year" ? 1 : period === "month" ? 12 : period === "week" ? 52 : 2080;
  const rate = currency === "USD" ? usdToInr : 1;
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: currency,
    salaryNormalizedInrMin: min * multiplier * rate,
    salaryNormalizedInrMax: max * multiplier * rate,
  };
}

function detectCurrency(text: string, symbol: string | undefined): "INR" | "USD" | null {
  const token = `${symbol ?? ""} ${text}`.toLowerCase();
  if (token.includes("₹") || token.includes("inr") || token.includes("lpa") || token.includes("lakh")) return "INR";
  if (token.includes("$") || token.includes("usd")) return "USD";
  return null;
}

function detectPeriod(
  text: string,
  currency: "INR" | "USD",
  amount: number,
): "year" | "month" | "week" | "hour" | null {
  const value = text.toLowerCase();
  if (/\b(lpa|per annum|p\.a\.|a year|per year|\/year|\/yr)\b/.test(value)) return "year";
  if (/\b(a month|per month|\/month|p\.m\.|pm)\b/.test(value)) return "month";
  if (/\b(a week|per week|\/week|hourly|per hour|\/hour)\b/.test(value)) {
    return /hour/.test(value) ? "hour" : "week";
  }
  if (currency === "USD" && /\bk\b|\d\s*k/.test(value)) return "year";
  if (currency === "USD" && amount >= 10000) return "year";
  return null;
}

function parseAmount(token: string): number | null {
  const cleaned = token.toLowerCase().replace(/[₹$,\s]/g, "");
  const thousands = cleaned.match(/^(\d+(?:\.\d+)?)k$/);
  if (thousands?.[1]) return Number(thousands[1]) * 1000;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function isExplicitlyBelowMinimum(
  salary: Pick<ParsedSalary, "salaryNormalizedInrMin" | "salaryNormalizedInrMax">,
  minimumMonthlyInr: number,
): boolean {
  const annualMinimum = minimumMonthlyInr * 12;
  const ceiling = salary.salaryNormalizedInrMax ?? salary.salaryNormalizedInrMin;
  if (ceiling == null) return false;
  return ceiling < annualMinimum;
}
