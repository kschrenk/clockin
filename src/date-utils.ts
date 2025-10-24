import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import duration from 'dayjs/plugin/duration.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);
dayjs.extend(duration);

export const FORMAT_DATE = 'YYYY-MM-DD';
export const FORMAT_TIME = 'HH:mm:ss';
export const FORMAT_HH_MM = 'HH:mm';

export function formatInTz(date: Date | string | number, tz: string, pattern: string): string {
  return dayjs(date).tz(tz).format(pattern);
}

export function addDays(date: Date, days: number): Date {
  return dayjs(date).add(days, 'day').toDate();
}

export function getWeekStart(date: Dayjs): Dayjs {
  return date.startOf('isoWeek');
}

export function getWeekEnd(date: Dayjs): Dayjs {
  return date.endOf('isoWeek');
}

export function formatDate(date: Date | string | number, pattern: string, tz?: string): string {
  return tz ? dayjs(date).tz(tz).format(pattern) : dayjs(date).format(pattern);
}

export function isValidDateString(dateString?: string): boolean {
  if (!dateString) return false;
  const d = dayjs(dateString);
  return d.isValid();
}

export function calculateWorkingTime(
  startTime: string,
  endTime: string,
  pauseTimeMinutes: number = 0
): number {
  if (!isValidDateString(startTime) || !isValidDateString(endTime)) return 0;
  const start = dayjs(startTime);
  const end = dayjs(endTime);
  const pauseTimeMs = pauseTimeMinutes * 60 * 1000;
  const workingMs = end.diff(start) - pauseTimeMs;

  return Number.isFinite(workingMs) && workingMs > 0 ? workingMs : 0;
}

export function isDateInWeekRange(weekStart: Dayjs, weekEnd: Dayjs, date: Dayjs) {
  return (
    date.isSame(weekStart, 'day') ||
    date.isSame(weekEnd, 'day') ||
    (date.isAfter(weekStart) && date.isBefore(weekEnd))
  );
}

export { dayjs };
