export const CLOSED_AFTER_MISSES = 3;

export function consecutiveMisses(lastSeenAt: number, relevantRunStartedAtsDesc: number[]): number {
  let misses = 0;
  for (const startedAt of relevantRunStartedAtsDesc) {
    if (lastSeenAt >= startedAt) break;
    misses += 1;
  }
  return misses;
}

export function shouldClose(misses: number): boolean {
  return misses >= CLOSED_AFTER_MISSES;
}
