import type { CandidateProfile } from "../config/profile";
import type { NormalizedJob } from "../services/deduplication/DeduplicationService";
import { aiScoreSchema, type AiScore } from "../../shared/types";

export type AiScoreResult = { ok: true; score: AiScore } | { ok: false; reason: string };

export type AiClient = {
  score(input: {
    profile: CandidateProfile;
    job: NormalizedJob;
    deterministicScore: number;
    searchLocation: string | null;
  }): Promise<AiScoreResult>;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

export function createDeepSeekClient(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): AiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async score(input) {
      if (!options.apiKey) {
        return { ok: false, reason: "DEEPSEEK_API_KEY is not configured" };
      }
      const first = await requestScore(fetchImpl, options, input, true);
      if (first.ok || !shouldRetry(first.reason)) return first;
      return requestScore(fetchImpl, options, input, true);
    },
  };
}

async function requestScore(
  fetchImpl: typeof fetch,
  options: { apiKey: string; model: string },
  input: {
    profile: CandidateProfile;
    job: NormalizedJob;
    deterministicScore: number;
    searchLocation: string | null;
  },
  disableThinking: boolean,
): Promise<AiScoreResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    temperature: 0,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You score job fit and return JSON only. Required skills matter more than optional skills. Missing core skills (weight 5) are a larger penalty than missing optional skills. Experience mismatch matters. Do not reject a role only because the title says Senior, Lead, Principal, or Staff. Never invent candidate experience or job requirements. Example JSON: {\"score\":87,\"technicalMatch\":92,\"experienceMatch\":90,\"roleMatch\":95,\"locationMatch\":100,\"salaryMatch\":70,\"matchedSkills\":[\"React\"],\"missingSkills\":[\"Kubernetes\"],\"reason\":\"Strong full-stack match.\"}",
      },
      {
        role: "user",
        content: JSON.stringify({
          candidate: {
            experienceYears: input.profile.experienceYears,
            location: input.profile.currentLocation,
            skills: input.profile.skills,
            preferredRoles: input.profile.preferredRoles,
          },
          job: {
            title: input.job.title,
            company: input.job.company,
            description: input.job.description.slice(0, 6000),
            location: input.job.location,
            workMode: input.job.workMode,
            employmentType: input.job.employmentType,
            salary: input.job.salaryText,
            searchLocation: input.searchLocation,
          },
          deterministicScore: input.deterministicScore,
        }),
      },
    ],
  };
  if (disableThinking) body.thinking = { type: "disabled" };

  let response: Response;
  try {
    response = await fetchImpl("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "DeepSeek request failed" };
  }

  if (!response.ok) {
    return { ok: false, reason: `DeepSeek returned HTTP ${response.status}` };
  }

  let payload: ChatResponse;
  try {
    payload = (await response.json()) as ChatResponse;
  } catch {
    return { ok: false, reason: "DeepSeek returned invalid JSON envelope" };
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content?.trim()) return { ok: false, reason: "DeepSeek returned an empty score" };
  return parseAiScore(content);
}

function shouldRetry(reason: string): boolean {
  return /validation|not JSON|empty score|invalid JSON envelope/.test(reason);
}

export function parseAiScore(content: string): AiScoreResult {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  try {
    const parsed = aiScoreSchema.safeParse(JSON.parse(trimmed));
    if (!parsed.success) return { ok: false, reason: "DeepSeek score failed validation" };
    return { ok: true, score: parsed.data };
  } catch {
    return { ok: false, reason: "DeepSeek score was not JSON" };
  }
}
