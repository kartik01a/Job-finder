import { createHiristSource } from "./hirist/HiristSource";
import { createInstahyreSource } from "./instahyre/InstahyreSource";
import { createWellfoundSource } from "./wellfound/WellfoundSource";
import type { JobSource } from "./JobSource";

export function createSources(homeLocation?: string | null): JobSource[] {
  return [createWellfoundSource({ homeLocation }), createInstahyreSource(), createHiristSource()];
}
