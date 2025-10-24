import chalk from 'chalk';
import Table from 'cli-table3';
import open from 'open';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import { Config, SummaryData } from './types.js';
import { DataManager } from './data-manager.js';
import { VacationManager } from './vacation-manager.js';
import {
  calculateWorkingTime,
  dayjs,
  getCurrentDateTime,
  isValidDateString,
} from './date-utils.js';

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
      ['Total Hours Worked', this.formatHours(summaryData.totalHoursWorked)],
      ['Expected Hours/Week', `${summaryData.expectedHoursPerWeek.toFixed(1)}h`],
      ['Current Week Hours', this.formatHours(summaryData.currentWeekHours)],
      ['Overtime Hours', this.formatHours(summaryData.overtimeHours)],
      ['Vacation Days Used', `${summaryData.totalVacationDays}`],
      ['Vacation Days Remaining', `${summaryData.remainingVacationDays}`]
    );

    console.log(table.toString());
    console.log();
  }

  async showWeeklySummary(): Promise<void> {
    const timeEntries = await this.dataManager.loadTimeEntries();
    const nowTz = getCurrentDateTime(this.config.timezone); // Day.js instance in correct TZ

    const weekStart = nowTz.startOf('isoWeek');
    const weekEnd = nowTz.endOf('isoWeek');

    const weeklyEntries = timeEntries.filter((entry) => {
      if (!isValidDateString(entry.date)) return false;
      const entryDate = dayjs(entry.date).tz(this.config.timezone);
      return (
        entryDate.isSame(weekStart, 'day') ||
        entryDate.isSame(weekEnd, 'day') ||
        (entryDate.isAfter(weekStart) && entryDate.isBefore(weekEnd))
      );
    });

    console.log(
      chalk.blue.bold(
        `\n\ud83d\udcc5 Weekly Summary (${weekStart.format('MMM Do')} - ${weekEnd.format('MMM Do, YYYY')})\n`
      )
    );

    if (weeklyEntries.length === 0) {
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
      ],
      colWidths: [15, 10, 10, 10, 10],
    });

    let totalWeeklyHours = 0;

    const entriesByDate = new Map<string, typeof weeklyEntries>();
    weeklyEntries.forEach((entry) => {
      const dateKey = dayjs(entry.date).format('YYYY-MM-DD');
      if (!entriesByDate.has(dateKey)) {
        entriesByDate.set(dateKey, []);
      }
      entriesByDate.get(dateKey)?.push(entry);
    });

    entriesByDate.forEach((dayEntries, dateKey) => {
      let dailyTotal = 0;
      let hasValidEntries = false;

      dayEntries.forEach((entry) => {
        if (!entry.endTime) return;
        if (!isValidDateString(entry.startTime) || !isValidDateString(entry.endTime)) return;

        const startTime = dayjs(entry.startTime);
        const endTime = dayjs(entry.endTime);
        const breakTimeMs = (entry.pauseTime || 0) * 60 * 1000;
        const diffMs = endTime.diff(startTime) - breakTimeMs;

        if (!Number.isFinite(diffMs) || diffMs < 0) return;
        dailyTotal += diffMs;
        hasValidEntries = true;
      });

      if (hasValidEntries) {
        totalWeeklyHours += dailyTotal;

        // Show first and last entry times for the day
        const validEntries = dayEntries.filter(
          (e) => e.endTime && isValidDateString(e.startTime) && isValidDateString(e.endTime)
        );
        const firstEntry = validEntries.reduce((earliest, entry) =>
          dayjs(entry.startTime).isBefore(dayjs(earliest.startTime)) ? entry : earliest
        );
        const lastEntry = validEntries.reduce((latest, entry) =>
          dayjs(entry.endTime!).isAfter(dayjs(latest.endTime!)) ? entry : latest
        );

        const totalBreakTime = dayEntries.reduce((sum, entry) => sum + (entry.pauseTime || 0), 0);

        table.push([
          dayjs(dateKey).format('MMM Do'),
          dayjs(firstEntry.startTime).format('HH:mm'),
          dayjs(lastEntry.endTime!).format('HH:mm'),
          `${totalBreakTime}m`,
          this.formatHours(dailyTotal),
        ]);
      }
    });

    console.log(table.toString());
    console.log(chalk.cyan(`\nTotal weekly hours: ${this.formatHours(totalWeeklyHours)}`));
    console.log(chalk.cyan(`Expected weekly hours: ${this.config.hoursPerWeek}h`));

    const difference = totalWeeklyHours / 3_600_000 - this.config.hoursPerWeek;
    if (difference > 0) {
      console.log(chalk.green(`Overtime: +${difference.toFixed(1)}h`));
    } else if (difference < 0) {
      console.log(chalk.yellow(`Under time: ${difference.toFixed(1)}h`));
    } else {
      console.log(chalk.blue('Exactly on target! \ud83c\udfaf'));
    }
    console.log();
  }

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
    const nowTz = getCurrentDateTime(this.config.timezone);
    const weekStart = nowTz.startOf('isoWeek');
    const weekEnd = nowTz.endOf('isoWeek');

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
}
