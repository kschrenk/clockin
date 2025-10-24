import dayjs from 'dayjs';
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

export function formatInTz(date: Date | string | number, tz: string, pattern: string): string {
  return dayjs(date).tz(tz).format(pattern);
}

export function parseDate(input: string): dayjs.Dayjs {
  return dayjs(input);
}

export function diffMs(a: Date, b: Date): number {
  return dayjs(a).diff(dayjs(b)); // milliseconds
}

export function addDays(date: Date, days: number): Date {
  return dayjs(date).add(days, 'day').toDate();
}

export function startOfIsoWeek(date: Date): Date {
  return dayjs(date).startOf('isoWeek').toDate();
}

export function endOfIsoWeek(date: Date): Date {
  return dayjs(date).endOf('isoWeek').toDate();
}

export function formatDate(date: Date | string | number, pattern: string, tz?: string): string {
  return tz ? dayjs(date).tz(tz).format(pattern) : dayjs(date).format(pattern);
}

export function getCurrentDateTime(timezone: string = 'Europe/Berlin') {
  return dayjs().tz(timezone); // return Day.js instance preserving timezone context
}

export function safeParse(dateString: string): dayjs.Dayjs {
  return dayjs(dateString);
}

export function isValidDateString(dateString: string): boolean {
  const d = dayjs(dateString);
  return d.isValid();
}

export function formatDurationHms(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '00:00:00';
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

export { dayjs };
