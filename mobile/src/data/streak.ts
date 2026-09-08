import type { Drink } from "@/state/AppState";

/** Calendar days (local time) with at least one drink logged, deduped. */
function loggedDays(drinks: Drink[]): Set<string> {
  return new Set(drinks.map((d) => new Date(d.at).toDateString()));
}

/** Consecutive days ending today with at least one can logged. Breaks the
 *  moment a day is skipped — including today, so a quiet day reads as 0
 *  rather than quietly keeping yesterday's number alive. */
export function currentStreak(drinks: Drink[], now: Date = new Date()): number {
  const days = loggedDays(drinks);
  let streak = 0;
  const cursor = new Date(now);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** The longest run of consecutive days anywhere in the log, not just the
 *  current one — the number worth bragging about even after a streak breaks. */
export function longestStreak(drinks: Drink[]): number {
  const days = [...loggedDays(drinks)]
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev !== null && d - prev === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return longest;
}

/** The variant with the most logs — "what you actually drink", for bragging
 *  or just curiosity. Null once there's nothing logged yet. */
export function favouriteVariantId(drinks: Drink[]): string | null {
  if (drinks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const d of drinks) counts.set(d.variantId, (counts.get(d.variantId) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
