import { dayjs, FORMAT_DATE, getIsoWeeksInYear } from './date-utils.js';

const DATE_LIKE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_COUNT_RE = /^\d+(\.\d+)?$/;
const WEEK_NUMBER_RE = /^\d+$/;

/** True for YYYY-M-D style input, with or without zero padding. Does not check calendar validity. */
export function looksLikeDate(value: string): boolean {
  return DATE_LIKE_RE.test(value);
}

/**
 * Parse a day-count argument strictly. Returns null for anything that isn't a plain positive number,
 * so inputs like "2026-11-2" are rejected instead of being truncated to 2026 by parseFloat.
 */
export function parseDayCount(raw: string): number | null {
  if (!DAY_COUNT_RE.test(raw)) return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

/** Parse an ISO week number strictly. Returns null unless it's an integer within 1..(weeks in that year). */
export function parseWeekNumber(raw: string, year: number): number | null {
  if (!WEEK_NUMBER_RE.test(raw)) return null;
  const week = Number(raw);
  return week >= 1 && week <= getIsoWeeksInYear(year) ? week : null;
}

/** Normalize YYYY-M-D to YYYY-MM-DD. Returns null for malformed or non-existent dates (e.g. 2026-02-30). */
export function normalizeDate(raw: string): string | null {
  const match = DATE_LIKE_RE.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = dayjs(new Date(year, month - 1, day));
  if (date.year() !== year || date.month() !== month - 1 || date.date() !== day) return null;
  return date.format(FORMAT_DATE);
}

/** When the user omits description and passes a date as the second arg, remap it. */
export function resolveDescriptionAndDate(
  description?: string,
  startDate?: string
): { description: string | undefined; startDate: string | undefined } {
  if (startDate === undefined && description !== undefined && looksLikeDate(description)) {
    return { description: undefined, startDate: description };
  }
  return { description, startDate };
}
