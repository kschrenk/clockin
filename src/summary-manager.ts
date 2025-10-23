import chalk from 'chalk';
import Table from 'cli-table3';
import open from 'open';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import {
  format,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
  parseISO,
  differenceInMilliseconds,
} from 'date-fns';
import { Config, SummaryData } from './types.js';
import { DataManager } from './data-manager.js';
import { VacationManager } from './vacation-manager.js';

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

    console.log(chalk.blue.bold('\n📊 Work Summary\n'));

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
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 }); // Sunday

    const weeklyEntries = timeEntries.filter((entry) => {
      const entryDate = parseISO(entry.date);
      return isWithinInterval(entryDate, { start: weekStart, end: weekEnd });
    });

    console.log(
      chalk.blue.bold(
        `\n📅 Weekly Summary (${format(weekStart, 'MMM do')} - ${format(weekEnd, 'MMM do, yyyy')})\n`
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

    weeklyEntries.forEach((entry) => {
      if (entry.endTime) {
        const startTime = new Date(entry.startTime);
        const endTime = new Date(entry.endTime);
        const breakTime = (entry.pauseTime || 0) * 60 * 1000; // Convert minutes to milliseconds
        const workingTime = differenceInMilliseconds(endTime, startTime) - breakTime;

        totalWeeklyHours += workingTime;

        table.push([
          format(parseISO(entry.date), 'MMM do'),
          format(startTime, 'HH:mm'),
          format(endTime, 'HH:mm'),
          `${entry.pauseTime || 0}m`,
          this.formatHours(workingTime),
        ]);
      }
    });

    console.log(table.toString());
    console.log(chalk.cyan(`\nTotal weekly hours: ${this.formatHours(totalWeeklyHours)}`));
    console.log(chalk.cyan(`Expected weekly hours: ${this.config.hoursPerWeek}h`));

    const difference = totalWeeklyHours / (1000 * 60 * 60) - this.config.hoursPerWeek;
    if (difference > 0) {
      console.log(chalk.green(`Overtime: +${difference.toFixed(1)}h`));
    } else if (difference < 0) {
      console.log(chalk.yellow(`Under time: ${difference.toFixed(1)}h`));
    } else {
      console.log(chalk.blue('Exactly on target! 🎯'));
    }
    console.log();
  }

  async openCsvFile(): Promise<void> {
    const csvPath = this.dataManager.getTimeEntriesPath();

    // Ensure the CSV file exists by creating it with headers if it doesn't exist
    await this.dataManager.ensureDataDirectory();

    try {
      await fs.access(csvPath);
    } catch {
      // Create empty CSV with headers
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
      await csvWriter.writeRecords([]); // Write empty file with headers
      console.log(chalk.yellow('📋 Created empty time entries CSV file.'));
    }

    try {
      await open(csvPath);
      console.log(chalk.green('📊 Opening CSV file...'));
    } catch (error) {
      console.log(chalk.red('❌ Failed to open CSV file:'), error);
      console.log(chalk.gray(`File location: ${csvPath}`));
    }
  }

  private async calculateSummaryData(): Promise<SummaryData> {
    const timeEntries = await this.dataManager.loadTimeEntries();
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    // Calculate total hours worked
    let totalHoursWorked = 0;
    let currentWeekHours = 0;

    timeEntries.forEach((entry) => {
      if (entry.endTime) {
        const startTime = new Date(entry.startTime);
        const endTime = new Date(entry.endTime);
        const breakTime = (entry.pauseTime || 0) * 60 * 1000;
        const workingTime = differenceInMilliseconds(endTime, startTime) - breakTime;

        totalHoursWorked += workingTime;

        // Check if entry is in current week
        const entryDate = parseISO(entry.date);
        if (isWithinInterval(entryDate, { start: weekStart, end: weekEnd })) {
          currentWeekHours += workingTime;
        }
      }
    });

    // Calculate vacation data
    const totalVacationDays = await this.vacationManager.getTotalVacationDays();
    const remainingVacationDays = await this.vacationManager.getRemainingVacationDays();

    // Calculate overtime (simplified calculation)
    const totalHoursInHours = totalHoursWorked / (1000 * 60 * 60);
    const weeksWorked = timeEntries.length > 0 ? Math.max(1, timeEntries.length / 5) : 0; // Rough estimate
    const expectedTotalHours = weeksWorked * this.config.hoursPerWeek;
    const overtimeHours = Math.max(0, (totalHoursInHours - expectedTotalHours) * (1000 * 60 * 60));

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
    const hours = milliseconds / (1000 * 60 * 60);
    return `${hours.toFixed(1)}h`;
  }
}
