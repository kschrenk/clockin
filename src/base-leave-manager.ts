import dayjs, { type Dayjs } from 'dayjs';
import chalk from 'chalk';
import { addDays } from './date-utils.js';
import { Config, VacationEntry, SickEntry } from './types.js';
import { DataManager } from './data-manager.js';

export abstract class BaseLeaveManager {
  protected config: Config;
  protected dataManager: DataManager;

  protected constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
  }

  protected findNextWorkingDay(date: Dayjs): Dayjs | null {
    let cursor = date;
    for (let i = 0; i < 14; i++) {
      if (this.isWorkingDay(cursor)) return cursor;
      cursor = cursor.add(1, 'day');
    }
    return null;
  }

  protected isWorkingDay(date: Dayjs): boolean {
    const dayName = date.format('dddd').toLowerCase();
    const workingDay = this.config.workingDays.find((day) => day.day === dayName);
    return workingDay?.isWorkingDay ?? false;
  }

  protected calculateWorkingDaysInRange(startDate: Date, endDate: Date): Date[] {
    const workingDays: Date[] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      if (this.isWorkingDay(dayjs(currentDate))) {
        workingDays.push(new Date(currentDate));
      }
      currentDate = addDays(currentDate, 1);
    }

    return workingDays;
  }

  protected generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  protected findOverlappingDates(
    targetDates: Dayjs[],
    existingEntries: (VacationEntry | SickEntry)[]
  ): Dayjs[] {
    const overlapping: Dayjs[] = [];

    for (const targetDate of targetDates) {
      for (const entry of existingEntries) {
        const entryStart = dayjs(entry.startDate);
        const entryEnd = dayjs(entry.endDate);

        // Check if targetDate overlaps with existing leave entry
        //
        // Date semantics: Both startDate and endDate are INCLUSIVE
        // - startDate: First day of leave
        // - endDate: Last day of leave (NOT the day after)
        //
        // Example: 2-day sick leave starting Monday 2025-01-06
        // - startDate: '2025-01-06' (Monday)
        // - endDate: '2025-01-07' (Tuesday)
        // - Both Monday and Tuesday are leave days
        //
        // Overlap conditions:
        // 1. targetDate equals the start date (first day of leave)
        // 2. targetDate equals the end date (last day of leave)
        // 3. targetDate is between start and end (middle day of multi-day leave)
        //
        // Note: Use 'day' precision to avoid time-of-day comparison issues
        if (
          targetDate.isSame(entryStart, 'day') ||
          targetDate.isSame(entryEnd, 'day') ||
          (targetDate.isAfter(entryStart, 'day') && targetDate.isBefore(entryEnd, 'day'))
        ) {
          overlapping.push(targetDate);
          break; // No need to check other entries for this date
        }
      }
    }

    return overlapping;
  }

  protected async checkAndReportLeaveOverlap(
    workingDayDates: Dayjs[],
    operationName: string,
    checkAgainst: 'vacation' | 'sick'
  ): Promise<boolean> {
    const existingEntries =
      checkAgainst === 'vacation'
        ? await this.dataManager.loadVacationEntries()
        : await this.dataManager.loadSickEntries();

    const overlappingDates = this.findOverlappingDates(workingDayDates, existingEntries);

    if (overlappingDates.length > 0) {
      const dateStrings = overlappingDates.map((date) => dayjs(date).format('MMM Do')).join(', ');
      const conflictType = checkAgainst === 'vacation' ? 'vacation' : 'sick days';
      console.log(
        chalk.red(
          `\u274c Cannot add ${operationName}: ${conflictType} already scheduled for ${dateStrings}. Please remove ${conflictType} first or choose different dates.`
        )
      );
      return true; // Has overlap
    }

    return false; // No overlap
  }

  protected async checkAndReportTimeEntryOverlap(
    targetDates: Dayjs[],
    operationName: string
  ): Promise<boolean> {
    const timeEntries = await this.dataManager.loadTimeEntries();
    const conflictingTimeEntryDates = targetDates.filter((targetDate) => {
      return timeEntries.some((entry) => {
        return dayjs(entry.date).isSame(targetDate, 'day');
      });
    });

    if (conflictingTimeEntryDates.length > 0) {
      const dateStrings = conflictingTimeEntryDates
        .map((date) => dayjs(date).format('MMM Do'))
        .join(', ');
      console.log(
        chalk.red(
          `\u274c Cannot add ${operationName}: time entries already exist for ${dateStrings}. Please remove existing time entries first or choose different dates.`
        )
      );
      return true; // Has overlap
    }

    return false; // No overlap
  }
}
