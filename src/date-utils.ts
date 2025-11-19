import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import duration from 'dayjs/plugin/duration.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

import { WorkSession } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);
dayjs.extend(duration);
dayjs.extend(isSameOrBefore);

export const FORMAT_DATE = 'YYYY-MM-DD';
export const FORMAT_TIME = 'HH:mm:ss';
export const FORMAT_HH_MM = 'HH:mm';
export const FORMAT_DATE_DAY = 'MMM Do';

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
  endTime?: string,
  pauseTimeMinutes: number = 0
): number {
  if (!isValidDateString(startTime) || !isValidDateString(endTime)) return 0;

  const start = dayjs(startTime);
  const end = dayjs(endTime);
  const pauseTimeMs = dayjs.duration(pauseTimeMinutes, 'minutes').asMilliseconds();
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

/**
 * Returns the pause duration in milliseconds between now and the given pauseStartTime.
 * If pauseStartTime is undefined or invalid, returns 0.
 */
export function getPauseDurationMs(now: Dayjs, pauseStartTime: string): number {
  const start = dayjs(pauseStartTime);
  if (!start.isValid()) return 0;

  return now.diff(start);
}

/**
 * Calculates the elapsed time in milliseconds for a work session, accounting for paused periods.
 * @param session - The work session object containing start time, paused time, and pause status.
 * @param now - The current dayjs instance.
 * @returns The elapsed time in milliseconds.
 */
export function calculateElapsedMs(session: WorkSession, now: Dayjs): number {
  let elapsedMs = now.valueOf() - dayjs(session.startTime).valueOf() - session.pausedTime;
  if (session.isPaused && session.pauseStartTime) {
    elapsedMs -= now.valueOf() - dayjs(session.pauseStartTime).valueOf();
  }
  return elapsedMs;
}

/**
 * Calculates the current total paused time in milliseconds for a work session, including any ongoing pause.
 * @param session - The work session object containing paused time and pause status.
 * @param now - The current dayjs instance.
 * @returns The total paused time in milliseconds.
 */
export function calculateCurrentPausedTimeMs(session: WorkSession, now: Dayjs): number {
  let currentPausedTimeMs = session.pausedTime;
  if (session.isPaused && session.pauseStartTime) {
    currentPausedTimeMs += getPauseDurationMs(now, session.pauseStartTime);
  }
  return currentPausedTimeMs;
}

export { dayjs };
