import chalk from 'chalk';
import dayjs from 'dayjs';
import { addDays, formatDate } from './date-utils.js';
import { Config, VacationEntry } from './types.js';
import { DataManager } from './data-manager.js';

export class VacationManager {
  private config: Config;
  private dataManager: DataManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
  }

  async addVacation(days: number, startDate?: string): Promise<void> {
    const requestedDays = days;
    if (requestedDays <= 0) {
      console.log(chalk.red('\u274c Number of vacation days must be positive.'));
      return;
    }

    const rawStart = startDate ? dayjs(startDate).toDate() : new Date();
    const firstWorkingDay = this.findNextWorkingDay(rawStart);
    if (!firstWorkingDay) {
      console.log(chalk.red('\u274c Could not determine a working day to start vacation.'));
      return;
    }

    const fullDays = Math.floor(requestedDays);
    const remainder = +(requestedDays - fullDays).toFixed(2);

    const workingDayDates: Date[] = [];
    let cursor = new Date(firstWorkingDay);
    let fullDaysAdded = 0;
    while (fullDaysAdded < fullDays) {
      if (this.isWorkingDay(cursor)) {
        workingDayDates.push(new Date(cursor));
        fullDaysAdded++;
      }
      cursor = addDays(cursor, 1);
    }

    let endDate: Date;
    if (remainder > 0) {
      const fractionalDayDate = fullDays === 0 ? firstWorkingDay : this.findNextWorkingDay(cursor);
      if (!fractionalDayDate) {
        console.log(
          chalk.red('\u274c Could not find a working day for the fractional part of the vacation.')
        );
        return;
      }
      endDate = fractionalDayDate;
    } else if (workingDayDates.length > 0) {
      endDate = workingDayDates[workingDayDates.length - 1];
    } else {
      endDate = firstWorkingDay;
    }

    const totalWorkingSpanDays = fullDays + (remainder > 0 ? remainder : 0);

    const vacationEntry: VacationEntry = {
      id: this.generateId(),
      startDate: formatDate(firstWorkingDay, 'YYYY-MM-DD'),
      endDate: formatDate(endDate, 'YYYY-MM-DD'),
      days: totalWorkingSpanDays,
      description: `${totalWorkingSpanDays} vacation day${totalWorkingSpanDays !== 1 ? 's' : ''}`,
    };

    await this.dataManager.saveVacationEntry(vacationEntry);

    console.log(chalk.green('\ud83c\udfd6\ufe0f  Vacation added successfully!'));
    if (fullDays > 0 || remainder > 0) {
      console.log(
        chalk.cyan(
          `Dates: ${formatDate(firstWorkingDay, 'MMM Do')} - ${formatDate(endDate, 'MMM Do, YYYY')}`
        )
      );
    } else {
      console.log(chalk.cyan(`Date: ${formatDate(firstWorkingDay, 'MMM Do, YYYY')}`));
    }
    console.log(chalk.cyan(`Vacation days (counting fractions): ${totalWorkingSpanDays}`));
  }

  private findNextWorkingDay(date: Date): Date | null {
    let cursor = new Date(date);
    for (let i = 0; i < 14; i++) {
      if (this.isWorkingDay(cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    return null;
  }

  async addVacationRange(startDate: string, endDate: string): Promise<void> {
    const start = dayjs(startDate).toDate();
    const end = dayjs(endDate).toDate();

    if (start > end) {
      console.log(chalk.red('\u274c Start date must be before end date.'));
      return;
    }

    const workingDays = this.calculateWorkingDaysInRange(start, end);

    if (workingDays.length === 0) {
      console.log(chalk.yellow('\u26a0\ufe0f  No working days found in the specified date range.'));
      return;
    }

    const vacationEntry: VacationEntry = {
      id: this.generateId(),
      startDate: formatDate(start, 'YYYY-MM-DD'),
      endDate: formatDate(end, 'YYYY-MM-DD'),
      days: workingDays.length,
      description: `Vacation range: ${workingDays.length} working day${workingDays.length > 1 ? 's' : ''}`,
    };

    await this.dataManager.saveVacationEntry(vacationEntry);

    console.log(chalk.green('\ud83c\udfd6\ufe0f  Vacation range added successfully!'));
    console.log(
      chalk.cyan(`Date range: ${formatDate(start, 'MMM Do')} - ${formatDate(end, 'MMM Do, YYYY')}`)
    );
    console.log(chalk.cyan(`Working days: ${workingDays.length}`));
  }

  private calculateWorkingDaysInRange(startDate: Date, endDate: Date): Date[] {
    const workingDays: Date[] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      if (this.isWorkingDay(currentDate)) {
        workingDays.push(new Date(currentDate));
      }
      currentDate = addDays(currentDate, 1);
    }

    return workingDays;
  }

  private isWorkingDay(date: Date): boolean {
    const dayName = dayjs(date).format('dddd').toLowerCase();
    const workingDay = this.config.workingDays.find((day) => day.day === dayName);
    return workingDay?.isWorkingDay ?? false;
  }

  async getTotalVacationDays(): Promise<number> {
    const vacationEntries = await this.dataManager.loadVacationEntries();
    return vacationEntries.reduce((total, entry) => total + entry.days, 0);
  }

  async getRemainingVacationDays(): Promise<number> {
    const totalUsed = await this.getTotalVacationDays();
    return Math.max(0, this.config.vacationDaysPerYear - totalUsed);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
