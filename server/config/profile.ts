import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const profileSchema = z.object({
  profileVersion: z.number().int().positive(),
  experienceYears: z.number().nonnegative(),
  currentLocation: z.string().min(1),
  skills: z.record(z.string(), z.number().min(1).max(5)),
  preferredRoles: z.array(z.string().min(1)).min(1),
});

export type CandidateProfile = z.infer<typeof profileSchema>;

export function loadProfile(filePath = path.resolve("config/profile.json")): CandidateProfile {
  const raw = readFileSync(filePath, "utf8");
  const parsed = profileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config/profile.json: ${details}`);
  }
  return parsed.data;
}
