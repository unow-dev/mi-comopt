export const DEFAULT_NEW_KEYWORD_DISPLAY_DAYS = 14;

export function isNewCandidate(introducedAt, now = new Date(), displayDays = DEFAULT_NEW_KEYWORD_DISPLAY_DAYS) {
  if (introducedAt === null || introducedAt === undefined) return false;
  const start = Date.parse(introducedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(current) || !Number.isFinite(displayDays) || displayDays < 0) return false;
  return current < start + displayDays * 24 * 60 * 60 * 1000;
}
