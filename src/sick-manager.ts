import chalk from 'chalk';
import dayjs, { type Dayjs } from 'dayjs';
import { FORMAT_DATE, FORMAT_DATE_DAY, FORMAT_DATE_DAY_YEAR } from './date-utils.js';
import { Config, SickEntry } from './types.js';
import { BaseLeaveManager } from './base-leave-manager.js';

// String constants for consistent terminology
const OPERATION_NAME = 'sick days';
const SINGLE_DAY_LABEL = 'sick day';
const PLURAL_DAYS_LABEL = 'sick days';

export class SickManager extends BaseLeaveManager {
  constructor(config: Config) {
    super(config);
  }

  async addSickDays(days: number, description?: string, startDate?: string): Promise<void> {
    const requestedDays = days;

    if (requestedDays <= 0) {
      console.log(chalk.red(`\u274c Number of ${PLURAL_DAYS_LABEL} must be positive.`));
      return;
    }

    if (!Number.isInteger(requestedDays)) {
      console.log(
        chalk.red(
          `\u274c ${PLURAL_DAYS_LABEL.charAt(0).toUpperCase() + PLURAL_DAYS_LABEL.slice(1)} must be a whole number. Fractions are not allowed.`
        )
      );
      return;
    }

    const rawStart = startDate ? dayjs(startDate) : dayjs();
    const startDay = rawStart.startOf('day'); // Normalize to start of day

    // For sick days, we use consecutive calendar days, not working days
    // Someone sick for 7 days starting Dec 3rd should be sick Dec 3-9, regardless of weekends
    const sickDayDates: Dayjs[] = [];
    for (let i = 0; i < requestedDays; i++) {
      sickDayDates.push(startDay.add(i, 'day'));
    }

    // Check for overlapping vacation days
    if (await this.checkAndReportLeaveOverlap(sickDayDates, OPERATION_NAME, 'vacation')) {
      return;
    }

    // Check for overlapping sick days (self-overlap detection)
    const existingSickEntries = await this.dataManager.loadSickEntries();
    const overlappingSickDates = this.findOverlappingDates(sickDayDates, existingSickEntries);

    if (overlappingSickDates.length > 0) {
      const dateStrings = overlappingSickDates
        .map((date) => date.format(FORMAT_DATE_DAY))
        .join(', ');
      console.log(
        chalk.red(
          `\u274c Cannot add ${OPERATION_NAME}: ${OPERATION_NAME} already exist for ${dateStrings}. Please choose different dates or remove existing entries first.`
        )
      );
      return;
    }

    // Check for existing time entries on these dates
    if (await this.checkAndReportTimeEntryOverlap(sickDayDates, OPERATION_NAME)) {
      return;
    }

    const start = sickDayDates[0];
    const end = sickDayDates[sickDayDates.length - 1];

    const sickEntry: SickEntry = {
      id: this.generateId(),
      startDate: start.format(FORMAT_DATE),
      endDate: end.format(FORMAT_DATE),
      days: requestedDays,
      description:
        description ||
        `${requestedDays} ${requestedDays === 1 ? SINGLE_DAY_LABEL : PLURAL_DAYS_LABEL}`,
    };

    await this.dataManager.saveSickEntry(sickEntry);

    console.log(
      chalk.green(
        `\ud83e\udd12 ${PLURAL_DAYS_LABEL.charAt(0).toUpperCase() + PLURAL_DAYS_LABEL.slice(1)} added successfully!`
      )
    );

    if (requestedDays === 1) {
      console.log(chalk.cyan(`Date: ${start.format(FORMAT_DATE_DAY_YEAR)}`));
    } else {
      console.log(
        chalk.cyan(`Dates: ${start.format(FORMAT_DATE_DAY)} - ${end.format(FORMAT_DATE_DAY_YEAR)}`)
      );
    }
    console.log(
      chalk.cyan(
        `${PLURAL_DAYS_LABEL.charAt(0).toUpperCase() + PLURAL_DAYS_LABEL.slice(1)}: ${requestedDays}`
      )
    );
    if (description) {
      console.log(chalk.cyan(`Reason: ${description}`));
    }
  }

  async getTotalSickDays(): Promise<number> {
    const sickEntries = await this.dataManager.loadSickEntries();
    return sickEntries.reduce((total, entry) => total + entry.days, 0);
  }

  async getSickEntries(): Promise<SickEntry[]> {
    return await this.dataManager.loadSickEntries();
  }
}
