import chalk from 'chalk';
import Table from 'cli-table3';
import open from 'open';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import { Config, SummaryData, TimeEntry } from './types.js';
import { DataManager } from './data-manager.js';
import { VacationManager } from './vacation-manager.js';
import {
  calculateWorkingTime,
  dayjs,
  isValidDateString,
  getWeekStart,
  getWeekEnd,
  isDateInWeekRange,
  FORMAT_DATE,
  FORMAT_DATE_DAY,
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

function isTimeEntry(obj: unknown): obj is TimeEntry {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'date' in obj &&
    'startTime' in obj &&
    'endTime' in obj &&
    'type' in obj
  );
}

function isDayjs(obj: unknown): obj is Dayjs {
  return dayjs.isDayjs(obj);
}

export class SummaryManager {
  private config: Config;
  private dataManager: DataManager;
  private vacationManager: VacationManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
    this.vacationManager = new VacationManager(config);
  }

  async showSummary(): Promise<void> {
    const summaryData = await this.calculateSummaryData();
    console.log(chalk.blue.bold('\n\ud83d\udcca Work Summary\n'));

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
      ['Vacation Days Remaining', `${summaryData.remainingVacationDays}`]
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

    const weeklyTimeEntries = await this.getWeeklyTimeEntries(weekStart, weekEnd, now);
    const weeklyVacationDates = await this.getWeeklyVacationEntries(weekStart, weekEnd, now);

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

        // Vacation row (if vacation covers this day)
        if (isVacationDay) {
          const workingHoursPerDay = this.calculateWorkingHoursPerDay();
          const vacHoursMs = dayjs.duration(workingHoursPerDay, 'hours').asMilliseconds();
          rows.push({
            date: dateKey,
            displayDate,
            start: null,
            end: null,
            breakMinutes: null,
            hoursMs: vacHoursMs,
            hoursFormatted: dayjs.duration(vacHoursMs).format('HH:mm'),
            entryType: 'vacation',
            isVacation: true,
          });
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
        `\n\ud83d\udcc5 Weekly Summary (${weekStart.format(FORMAT_DATE_DAY)} - ${weekEnd.format('MMM Do, YYYY')})\n`
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

    const totalVacationDays = await this.vacationManager.getTotalVacationDays();
    const remainingVacationDays = await this.vacationManager.getRemainingVacationDays();

    const totalHoursInHours = totalHoursWorked / 3_600_000;
    const weeksWorked = timeEntries.length > 0 ? Math.max(1, Math.ceil(timeEntries.length / 5)) : 0;
    const expectedTotalHours = weeksWorked * this.config.hoursPerWeek;
    const overtimeHours = Math.max(0, (totalHoursInHours - expectedTotalHours) * 3_600_000);

    return {
      totalHoursWorked,
      totalVacationDays,
      remainingVacationDays,
      expectedHoursPerWeek: this.config.hoursPerWeek,
      currentWeekHours,
      overtimeHours,
    };
  }

  private formatHours(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0.0h';
    const hours = milliseconds / 3_600_000;
    return `${hours.toFixed(1)}h`;
  }

  private calculateWorkingHoursPerDay(): number {
    const workingDaysCount = this.config.workingDays.filter((day) => day.isWorkingDay).length;
    return workingDaysCount > 0 ? this.config.hoursPerWeek / workingDaysCount : 0;
  }
}
