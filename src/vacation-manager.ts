import chalk from 'chalk';
import dayjs, { type Dayjs } from 'dayjs';
import { FORMAT_DATE, FORMAT_DATE_DAY, FORMAT_DATE_DAY_YEAR, formatDate } from './date-utils.js';
import { Config, VacationEntry } from './types.js';
import { BaseLeaveManager } from './base-leave-manager.js';

export class VacationManager extends BaseLeaveManager {
  constructor(config: Config) {
    super(config);
  }

  async addVacation(days: number, startDate?: string): Promise<void> {
    const requestedDays = days;

    if (requestedDays <= 0) {
      console.log(chalk.red('\u274c Number of vacation days must be positive.'));
      return;
    }

    if (!Number.isInteger(requestedDays)) {
      console.log(
        chalk.red('\u274c Vacation days must be a whole number. Fractions are not allowed.')
      );
      return;
    }

    const rawStart = startDate ? dayjs(startDate) : dayjs();
    const firstWorkingDay = this.findNextWorkingDay(rawStart);

    if (!firstWorkingDay) {
      console.log(chalk.red('\u274c Could not determine a working day to start vacation.'));
      return;
    }

    // Collect the exact number of working days
    const maxSearchDays = 365;
    const workingDayDates: Dayjs[] = [];
    let cursor = firstWorkingDay;

    while (
      workingDayDates.length < requestedDays &&
      cursor.diff(firstWorkingDay, 'day') <= maxSearchDays
    ) {
      if (this.isWorkingDay(cursor)) {
        workingDayDates.push(cursor);
      }
      cursor = cursor.add(1, 'day');
    }

    if (workingDayDates.length < requestedDays) {
      console.log(
        chalk.red('\u274c Could not find enough working days within a reasonable timeframe.')
      );
      return;
    }

    // Check for overlapping sick days
    if (await this.checkAndReportLeaveOverlap(workingDayDates, 'vacation', 'sick')) {
      return;
    }

    /*
     * TODO: The code loads vacation entries twice in the same method (lines 63 and duplicated in addVacationRange at line 134).
     *  Consider caching the result or refactoring to avoid redundant data loading operations
     */
    // Check for overlapping vacation days (self-overlap detection)
    const existingVacationEntries = await this.dataManager.loadVacationEntries();
    const overlappingVacationDates = this.findOverlappingDates(
      workingDayDates,
      existingVacationEntries
    );

    if (overlappingVacationDates.length > 0) {
      const dateStrings = overlappingVacationDates
        .map((date) => date.format(FORMAT_DATE_DAY))
        .join(', ');
      console.log(
        chalk.red(
          `\u274c Cannot add vacation: vacation days already exist for ${dateStrings}. Please choose different dates or remove existing entries first.`
        )
      );
      return;
    }

    // Check for existing time entries on these dates
    if (await this.checkAndReportTimeEntryOverlap(workingDayDates, 'vacation')) {
      return;
    }

    const start = workingDayDates[0];
    const end = workingDayDates[workingDayDates.length - 1];

    const vacationEntry: VacationEntry = {
      id: this.generateId(),
      startDate: start.format(FORMAT_DATE),
      endDate: end.format(FORMAT_DATE),
      days: requestedDays,
      description: `${requestedDays} vacation day${requestedDays !== 1 ? 's' : ''}`,
    };

    await this.dataManager.saveVacationEntry(vacationEntry);

    console.log(chalk.green('\ud83c\udfd6\ufe0f  Vacation added successfully!'));

    if (requestedDays === 1) {
      console.log(chalk.cyan(`Date: ${start.format(FORMAT_DATE_DAY_YEAR)}`));
    } else {
      console.log(
        chalk.cyan(`Dates: ${start.format(FORMAT_DATE_DAY)} - ${end.format(FORMAT_DATE_DAY_YEAR)}`)
      );
    }
    console.log(chalk.cyan(`Vacation days: ${requestedDays}`));
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

    // Check for overlapping sick days in the range
    const workingDayjs = workingDays.map((date) => dayjs(date));
    if (await this.checkAndReportLeaveOverlap(workingDayjs, 'vacation range', 'sick')) {
      return;
    }

    // Check for overlapping vacation days in the range (self-overlap detection)
    const existingVacationEntries = await this.dataManager.loadVacationEntries();
    const overlappingVacationDates = this.findOverlappingDates(
      workingDayjs,
      existingVacationEntries
    );

    if (overlappingVacationDates.length > 0) {
      const dateStrings = overlappingVacationDates
        .map((date) => date.format(FORMAT_DATE_DAY))
        .join(', ');
      console.log(
        chalk.red(
          `\u274c Cannot add vacation range: vacation days already exist for ${dateStrings}. Please choose different dates or remove existing entries first.`
        )
      );
      return;
    }

    // Check for existing time entries in the range
    if (await this.checkAndReportTimeEntryOverlap(workingDayjs, 'vacation range')) {
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

  async getTotalVacationDays(): Promise<number> {
    const vacationEntries = await this.dataManager.loadVacationEntries();
    return vacationEntries.reduce((total, entry) => total + entry.days, 0);
  }

  async getRemainingVacationDays(): Promise<number> {
    const totalUsed = await this.getTotalVacationDays();
    return Math.max(0, this.config.vacationDaysPerYear - totalUsed);
  }
}
