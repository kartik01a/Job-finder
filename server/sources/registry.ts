import { createIndeedSource } from "./indeed/IndeedSource";
import { createWellfoundSource } from "./wellfound/WellfoundSource";
import type { JobSource } from "./JobSource";

export function createSources(): JobSource[] {
  return [createIndeedSource(), createWellfoundSource()];
}
