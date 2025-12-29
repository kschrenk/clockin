import chalk from 'chalk';
import Table from 'cli-table3';
import open from 'open';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import { Config, SummaryData, TimeEntry } from './types.js';
import { DataManager } from './data-manager.js';
import { VacationManager } from './vacation-manager.js';
import { SickManager } from './sick-manager.js';
import { HolidayManager } from './holiday-manager.js';
import {
  calculateWorkingTime,
  dayjs,
  isValidDateString,
  getWeekStart,
  getWeekEnd,
  isDateInWeekRange,
  FORMAT_DATE,
  FORMAT_DATE_DAY,
  FORMAT_DATE_DAY_YEAR,
} from './date-utils.js';
import { Dayjs } from 'dayjs';

// Exported interfaces for testability (JSON mode)
export interface WeeklySummaryRow {
  date: string;
  displayDate: string;
  start: string | null;
  end: string | null;
  breakMinutes: number | null;
  hoursMs: number;
  hoursFormatted: string;
  entryType: string; // work | vacation | other
  timeEntries?: TimeEntry[];
  isVacation?: boolean;
}

export interface WeeklySummaryResult {
  weekStart: string;
  weekEnd: string;
  rows: WeeklySummaryRow[];
  totalWeeklyHoursMs: number;
  totalWeeklyHoursFormatted: string;
  expectedWeeklyHours: number;
  differenceHours: number;
  differenceFormatted: string;
  overtime: boolean;
  undertime: boolean;
}

export class SummaryManager {
  private config: Config;
  private dataManager: DataManager;
  private vacationManager: VacationManager;
  private sickManager: SickManager;
  private holidayManager: HolidayManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
    this.vacationManager = new VacationManager(config);
    this.sickManager = new SickManager(config);
    this.holidayManager = new HolidayManager(config);
  }

  async showSummary(): Promise<void> {
    const summaryData = await this.calculateSummaryData();

    const startDate = dayjs(summaryData.startDate);
    const endDate = dayjs(summaryData.endDate);

    // Show year on both dates if they span multiple years, otherwise use compact format
    const dateRangeDisplay =
      startDate.year() !== endDate.year()
        ? `${startDate.format(FORMAT_DATE_DAY_YEAR)} - ${endDate.format(FORMAT_DATE_DAY_YEAR)}`
        : `${startDate.format(FORMAT_DATE_DAY)} - ${endDate.format(FORMAT_DATE_DAY_YEAR)}`;

    console.log(chalk.blue.bold(`\n📊 Work Summary (${dateRangeDisplay})\n`));

    const table = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      colWidths: [30, 20],
    });

    table.push(
      ['Total Hours Worked', dayjs.duration(summaryData.totalHoursWorked).asHours().toFixed(1)],
      ['Expected Hours/Week', summaryData.expectedHoursPerWeek.toFixed(1)],
      ['Current Week Hours', dayjs.duration(summaryData.currentWeekHours).asHours().toFixed(1)],
      ['Overtime Hours', this.formatHours(summaryData.overtimeHours)], // in 0.0h
      ['Vacation Days Used', `${summaryData.totalVacationDays}`],
      ['Vacation Days Remaining', `${summaryData.remainingVacationDays}`],
      ['Sick Days Used', `${summaryData.totalSickDays}`]
    );

    console.log(table.toString());
    console.log();
  }

  async showWeeklySummary(
    options: { format?: 'table' | 'json' } = {}
  ): Promise<void | WeeklySummaryResult> {
    const outputFormat = options.format || 'table';
    const now = dayjs();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEnd(now);

    const weeklyTimeEntries = await this.getWeeklyTimeEntries(weekStart, weekEnd);
    const weeklyVacationDates = await this.getWeeklyVacationEntries(weekStart, weekEnd);
    const weeklySickDates = await this.getWeeklySickEntries(weekStart, weekEnd);
    const weeklyHolidayDates = await this.holidayManager.getHolidayDates(weekStart, weekEnd);
    const rows: WeeklySummaryRow[] = [];

    // Only iterate over configured working days within the calendar week
    let cursor = weekStart;
    const workingDayNames = new Set(
      this.config.workingDays.filter((d) => d.isWorkingDay).map((d) => d.day.toLowerCase())
    );

    while (cursor.isSameOrBefore(weekEnd, 'day')) {
      const weekday = cursor.format('dddd').toLowerCase();
      if (workingDayNames.has(weekday)) {
        const dateKey = cursor.format(FORMAT_DATE);
        const displayDate = cursor.format('MMM Do');

        const dayTimeEntries = weeklyTimeEntries.filter((e) => dayjs(e.date).isSame(cursor, 'day'));
        const isVacationDay = weeklyVacationDates.some((d) => d.isSame(cursor, 'day'));
        const isSickDay = weeklySickDates.some((d) => d.isSame(cursor, 'day'));
        const isHoliday = weeklyHolidayDates.some((d) => d.isSame(cursor, 'day'));

        // Handle leave days (vacation/sick/holiday)
        // Note: Overlap prevention exists in SickManager.addSickDays() and VacationManager.addVacation()
        // methods using BaseLeaveManager.checkAndReportLeaveOverlap() to prevent users from adding
        // conflicting leave types for the same dates. This precedence logic serves as a safety fallback
        // for edge cases or data imported from external systems.
        //
        // Design decision precedence: Holiday > Sick > Vacation because:
        // 1. Holidays are mandatory and cannot be overridden by other leave types
        // 2. Sick leave is typically unplanned and takes priority over scheduled vacation
        // 3. Legal/compliance requirements often treat sick leave differently than vacation
        // 4. In payroll systems, sick days may have different accrual rules than vacation days

        // Determine leave type based on precedence
        const leaveType = isHoliday
          ? 'holiday'
          : isSickDay
            ? 'sick'
            : isVacationDay
              ? 'vacation'
              : null;

        // Calculate hours for leave days (used by all leave types)
        const workingHoursPerDay = this.calculateWorkingHoursPerDay();
        const leaveHoursMs = dayjs.duration(workingHoursPerDay, 'hours').asMilliseconds();

        switch (leaveType) {
          case 'holiday':
            rows.push({
              date: dateKey,
              displayDate,
              start: null,
              end: null,
              breakMinutes: null,
              hoursMs: leaveHoursMs,
              hoursFormatted: dayjs.duration(leaveHoursMs).format('HH:mm'),
              entryType: 'holiday',
              isVacation: false,
            });
            break;

          case 'sick':
            rows.push({
              date: dateKey,
              displayDate,
              start: null,
              end: null,
              breakMinutes: null,
              hoursMs: leaveHoursMs,
              hoursFormatted: dayjs.duration(leaveHoursMs).format('HH:mm'),
              entryType: 'sick',
              isVacation: false,
            });
            break;

          case 'vacation':
            rows.push({
              date: dateKey,
              displayDate,
              start: null,
              end: null,
              breakMinutes: null,
              hoursMs: leaveHoursMs,
              hoursFormatted: dayjs.duration(leaveHoursMs).format('HH:mm'),
              entryType: 'vacation',
              isVacation: true,
            });
            break;
        }

        if (dayTimeEntries.length > 0) {
          // Aggregate work entries into a single row for the day
          let dailyTotalMs = 0;
          let totalBreakMinutes = 0;
          dayTimeEntries.forEach((e) => {
            const ms = calculateWorkingTime(e.startTime, e.endTime, e.pauseTime);
            if (ms > 0) dailyTotalMs += ms;
            totalBreakMinutes += e.pauseTime || 0;
          });
          const firstEntry = dayTimeEntries[0];
          const lastEntry = dayTimeEntries[dayTimeEntries.length - 1];
          rows.push({
            date: dateKey,
            displayDate,
            start: firstEntry
              ? dayjs(firstEntry.startTime).tz(this.config.timezone).format('HH:mm')
              : null,
            end:
              lastEntry && lastEntry.endTime
                ? dayjs(lastEntry.endTime).tz(this.config.timezone).format('HH:mm')
                : null,
            breakMinutes: totalBreakMinutes,
            hoursMs: dailyTotalMs,
            hoursFormatted: dayjs.duration(dailyTotalMs).format('HH:mm'),
            entryType: firstEntry ? firstEntry.type : 'work',
            timeEntries: dayTimeEntries,
            isVacation: isVacationDay || false,
          });
        }
      }
      cursor = cursor.add(1, 'day');
    }

    const totalWeeklyHoursMs = rows.reduce((sum, r) => sum + r.hoursMs, 0);
    const expectedWeeklyHours = this.config.hoursPerWeek;
    const totalWeeklyHoursFormatted = dayjs.duration(totalWeeklyHoursMs).format('HH:mm');
    const differenceHours = totalWeeklyHoursMs / 3_600_000 - expectedWeeklyHours;
    const differenceFormatted = `${differenceHours >= 0 ? '+' : ''}${differenceHours.toFixed(1)}h`;
    const overtime = differenceHours > 0;
    const undertime = differenceHours < 0;

    const result: WeeklySummaryResult = {
      weekStart: weekStart.format(FORMAT_DATE),
      weekEnd: weekEnd.format(FORMAT_DATE),
      rows,
      totalWeeklyHoursMs,
      totalWeeklyHoursFormatted,
      expectedWeeklyHours,
      differenceHours,
      differenceFormatted,
      overtime,
      undertime,
    };

    if (outputFormat === 'json') {
      // Return structured data for tests (no console output besides optional JSON string)
      return result;
    }

    console.log(
      chalk.blue.bold(
        `\n\ud83d\udcc5 Weekly Summary (${weekStart.format(FORMAT_DATE_DAY)} - ${weekEnd.format(FORMAT_DATE_DAY_YEAR)})\n`
      )
    );

    if (rows.length === 0) {
      console.log(chalk.yellow('No time entries found for this week.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Date'),
        chalk.cyan('Start'),
        chalk.cyan('End'),
        chalk.cyan('Break'),
        chalk.cyan('Hours'),
        chalk.cyan('Type'),
      ],
      colWidths: [15, 10, 10, 10, 10, 15],
    });

    rows.forEach((r) => {
      table.push([
        r.displayDate,
        r.start || '-',
        r.end || '-',
        r.breakMinutes !== null ? `${r.breakMinutes}m` : '-',
        r.hoursFormatted,
        r.entryType,
      ]);
    });

    console.log(table.toString());
    console.log(chalk.cyan(`\nTotal weekly hours: ${this.formatHours(totalWeeklyHoursMs)}`));
    console.log(chalk.cyan(`Expected weekly hours: ${expectedWeeklyHours}h`));
    if (overtime) {
      console.log(chalk.green(`Overtime: ${differenceFormatted}`));
    } else if (undertime) {
      console.log(chalk.yellow(`Under time: ${differenceFormatted}`));
    } else {
      console.log(chalk.blue('Exactly on target! \ud83c\udfaf'));
    }
    console.log();
  }

  private getWeeklyTimeEntries = async (weekStart: Dayjs, weekEnd: Dayjs, now?: Dayjs) => {
    const timeEntries = await this.dataManager.loadTimeEntries();

    return timeEntries.filter((entry) => {
      if (!isValidDateString(entry.date)) {
        return false;
      }

      const entryDate = dayjs(entry.date);
      const isDateInRange = isDateInWeekRange(weekStart, weekEnd, entryDate);

      if (now) {
        return isDateInRange && entryDate.isSameOrBefore(now);
      }

      return isDateInRange;
    });
  };

  private getWeeklyVacationEntries = async (
    weekStart: Dayjs,
    weekEnd: Dayjs,
    now?: Dayjs
  ): Promise<Dayjs[]> => {
    const vacationEntries = await this.dataManager.loadVacationEntries();
    const vacationDates: Dayjs[] = [];

    vacationEntries.forEach((entry) => {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) {
        return;
      }
      const entryStartDate = dayjs(entry.startDate);
      const entryEndDate = dayjs(entry.endDate);
      let cursor = entryStartDate;
      while (isDateInWeekRange(weekStart, weekEnd, cursor) && cursor.isSameOrBefore(entryEndDate)) {
        vacationDates.push(cursor);
        cursor = cursor.add(1, 'day');
      }
    });

    if (now) {
      return vacationDates.filter((date) => date.isSameOrBefore(now));
    }

    return vacationDates;
  };

  private getWeeklySickEntries = async (weekStart: Dayjs, weekEnd: Dayjs): Promise<Dayjs[]> => {
    const sickEntries = await this.dataManager.loadSickEntries();
    const sickDates: Dayjs[] = [];

    sickEntries.forEach((entry) => {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) {
        return;
      }

      const entryStartDate = dayjs(entry.startDate);
      const entryEndDate = dayjs(entry.endDate);

      let cursor = entryStartDate;
      while (isDateInWeekRange(weekStart, weekEnd, cursor) && cursor.isSameOrBefore(entryEndDate)) {
        sickDates.push(cursor);
        cursor = cursor.add(1, 'day');
      }
    });

    return sickDates;
  };

  async openCsvFile(): Promise<void> {
    const csvPath = this.dataManager.getTimeEntriesPath();
    await this.dataManager.ensureDataDirectory();

    try {
      await fs.access(csvPath);
    } catch {
      const csvWriter = createObjectCsvWriter({
        path: csvPath,
        header: [
          { id: 'id', title: 'ID' },
          { id: 'date', title: 'Date' },
          { id: 'startTime', title: 'Start Time' },
          { id: 'endTime', title: 'End Time' },
          { id: 'pauseTime', title: 'Pause Time (minutes)' },
          { id: 'type', title: 'Type' },
          { id: 'description', title: 'Description' },
        ],
      });
      await csvWriter.writeRecords([]);
      console.log(chalk.yellow('\ud83d\udccb Created empty time entries CSV file.'));
    }

    try {
      await open(csvPath);
      console.log(chalk.green('\ud83d\udcca Opening CSV file...'));
    } catch (error) {
      console.log(chalk.red('\u274c Failed to open CSV file:'), error);
      console.log(chalk.gray(`File location: ${csvPath}`));
    }
  }

  private async calculateSummaryData(): Promise<SummaryData> {
    const timeEntries = await this.dataManager.loadTimeEntries();

    const now = dayjs();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEnd(now);

    // Determine start date: use config.startDate, or fall back to first time entry date, or today
    // This is the employment start date used for calculating expected hours
    let employmentStartDate: Dayjs;
    if (this.config.startDate && isValidDateString(this.config.startDate)) {
      employmentStartDate = dayjs(this.config.startDate);
    } else if (timeEntries.length > 0) {
      const sortedEntries = timeEntries
        .filter((e) => isValidDateString(e.date))
        .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());
      employmentStartDate = sortedEntries.length > 0 ? dayjs(sortedEntries[0].date) : now;
    } else {
      employmentStartDate = now;
    }

    // Calculate elapsed weeks from employment start date to now (use fractional value for accuracy)
    // For example, if someone starts on Friday, ~0.4 weeks have elapsed, not 1 full week
    const elapsedWeeks = now.diff(employmentStartDate, 'week', true);
    const expectedTotalHours = elapsedWeeks * this.config.hoursPerWeek;

    // Sum up all time entries
    let totalHoursWorked = 0;
    let currentWeekHours = 0;

    for (const entry of timeEntries) {
      if (!entry.endTime) continue;
      const workingMs = calculateWorkingTime(entry.startTime, entry.endTime, entry.pauseTime);
      totalHoursWorked += workingMs;

      if (isValidDateString(entry.date)) {
        const entryDate = dayjs(entry.date).tz(this.config.timezone);
        if (
          entryDate.isSame(weekStart, 'day') ||
          entryDate.isSame(weekEnd, 'day') ||
          (entryDate.isAfter(weekStart) && entryDate.isBefore(weekEnd))
        ) {
          currentWeekHours += workingMs;
        }
      }
    }

    // Add vacation days as hours worked (full working day hours)
    const workingHoursPerDay = this.calculateWorkingHoursPerDay();
    const workingHoursPerDayMs = dayjs.duration(workingHoursPerDay, 'hours').asMilliseconds();

    const totalVacationDays = await this.vacationManager.getTotalVacationDays();
    totalHoursWorked += totalVacationDays * workingHoursPerDayMs;

    // Add sick days as hours worked (full working day hours)
    const totalSickDays = await this.sickManager.getTotalSickDays();
    totalHoursWorked += totalSickDays * workingHoursPerDayMs;

    // Add holidays as hours worked (full working day hours)
    // Only count holidays from employment start date onward to avoid counting holidays
    // that occurred before the user started working.
    //
    // Important: Avoid double-counting when a holiday overlaps with a vacation or sick day.
    // Holidays are imported separately and overlap prevention currently only exists for
    // vacation<->sick and leave<->time-entries.

    const [vacationEntries, sickEntries] = await Promise.all([
      this.dataManager.loadVacationEntries(),
      this.dataManager.loadSickEntries(),
    ]);

    const leaveDateKeys = new Set<string>();

    for (const entry of vacationEntries) {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) continue;
      let cursor = dayjs(entry.startDate);
      const end = dayjs(entry.endDate);
      while (cursor.isSameOrBefore(end, 'day')) {
        leaveDateKeys.add(cursor.format(FORMAT_DATE));
        cursor = cursor.add(1, 'day');
      }
    }

    for (const entry of sickEntries) {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) continue;
      let cursor = dayjs(entry.startDate);
      const end = dayjs(entry.endDate);
      while (cursor.isSameOrBefore(end, 'day')) {
        leaveDateKeys.add(cursor.format(FORMAT_DATE));
        cursor = cursor.add(1, 'day');
      }
    }

    const holidayDates = await this.holidayManager.getHolidayDates(employmentStartDate, now);
    const workingDayNames = new Set(
      this.config.workingDays.filter((d) => d.isWorkingDay).map((d) => d.day.toLowerCase())
    );

    const workingHolidays = holidayDates.filter((date) => {
      if (!workingDayNames.has(date.format('dddd').toLowerCase())) return false;
      return !leaveDateKeys.has(date.format(FORMAT_DATE));
    });

    totalHoursWorked += workingHolidays.length * workingHoursPerDayMs;

    const remainingVacationDays = await this.vacationManager.getRemainingVacationDays();

    // Calculate overtime (can be negative for undertime)
    const totalWorkedHours = dayjs.duration(totalHoursWorked).asHours();
    const overtimeHours = dayjs
      .duration(totalWorkedHours - expectedTotalHours, 'hours')
      .asMilliseconds();

    return {
      totalHoursWorked,
      totalVacationDays,
      totalSickDays,
      remainingVacationDays,
      expectedHoursPerWeek: this.config.hoursPerWeek,
      currentWeekHours,
      overtimeHours,
      startDate: employmentStartDate.format(FORMAT_DATE),
      endDate: now.format(FORMAT_DATE),
    };
  }

  private formatHours(milliseconds: number): string {
    // Normalize -0 (and 0) to avoid any negative-zero edge cases.
    if (Object.is(milliseconds, -0) || milliseconds === 0) return '0.0h';

    if (!Number.isFinite(milliseconds)) return '0.0h';

    const hours = dayjs.duration(milliseconds).asHours();
    const absRoundedStr = Math.abs(hours).toFixed(1);

    // Avoid displaying "-0.0h" for tiny negative values due to rounding.
    if (absRoundedStr === '0.0') return '0.0h';

    const sign = hours < 0 ? '-' : '';
    return `${sign}${absRoundedStr}h`;
  }

  private calculateWorkingHoursPerDay(): number {
    const workingDaysCount = this.config.workingDays.filter((day) => day.isWorkingDay).length;
    return workingDaysCount > 0 ? this.config.hoursPerWeek / workingDaysCount : 0;
  }
}
