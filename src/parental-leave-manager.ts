import chalk from 'chalk';
import dayjs, { type Dayjs } from 'dayjs';
import Table from 'cli-table3';
import { FORMAT_DATE, FORMAT_DATE_DAY, FORMAT_DATE_DAY_YEAR } from './date-utils.js';
import { Config, ParentalLeaveEntry } from './types.js';
import { BaseLeaveManager } from './base-leave-manager.js';

export class ParentalLeaveManager extends BaseLeaveManager {
  constructor(config: Config) {
    super(config);
  }

  async addParentalLeave(days: number, description?: string, startDate?: string): Promise<void> {
    if (days <= 0) {
      console.log(chalk.red('❌ Number of parental leave days must be positive.'));
      return;
    }

    if (!Number.isInteger(days)) {
      console.log(
        chalk.red('❌ Parental leave days must be a whole number. Fractions are not allowed.')
      );
      return;
    }

    const rawStart = startDate ? dayjs(startDate) : dayjs();
    const startDay = rawStart.startOf('day');

    // Calendar days — consecutive, same as sick leave
    const leaveDates: Dayjs[] = [];
    for (let i = 0; i < days; i++) {
      leaveDates.push(startDay.add(i, 'day'));
    }

    if (await this.checkAndReportLeaveOverlap(leaveDates, 'parental leave', 'vacation')) return;
    if (await this.checkAndReportLeaveOverlap(leaveDates, 'parental leave', 'sick')) return;

    const existingEntries = await this.dataManager.loadParentalLeaveEntries();
    const overlapping = this.findOverlappingDates(leaveDates, existingEntries);
    if (overlapping.length > 0) {
      const dateStrings = overlapping.map((d) => d.format(FORMAT_DATE_DAY)).join(', ');
      console.log(
        chalk.red(
          `❌ Cannot add parental leave: parental leave already exists for ${dateStrings}. Please choose different dates or remove existing entries first.`
        )
      );
      return;
    }

    if (await this.checkAndReportTimeEntryOverlap(leaveDates, 'parental leave')) return;

    const start = leaveDates[0];
    const end = leaveDates[leaveDates.length - 1];

    const entry: ParentalLeaveEntry = {
      id: this.generateId(),
      startDate: start.format(FORMAT_DATE),
      endDate: end.format(FORMAT_DATE),
      days,
      description: description || `${days} parental leave day${days !== 1 ? 's' : ''}`,
    };

    await this.dataManager.saveParentalLeaveEntry(entry);

    console.log(chalk.green('👶 Parental leave added successfully!'));
    if (days === 1) {
      console.log(chalk.cyan(`Date: ${start.format(FORMAT_DATE_DAY_YEAR)}`));
    } else {
      console.log(
        chalk.cyan(`Dates: ${start.format(FORMAT_DATE_DAY)} - ${end.format(FORMAT_DATE_DAY_YEAR)}`)
      );
    }
    console.log(chalk.cyan(`Days: ${days}`));
    if (description) console.log(chalk.cyan(`Note: ${description}`));
  }

  async listParentalLeave(year?: number): Promise<void> {
    const targetYear = year ?? dayjs().year();
    const allEntries = await this.dataManager.loadParentalLeaveEntries();
    const entries = allEntries.filter((e) => dayjs(e.startDate).year() === targetYear);

    console.log(chalk.blue.bold(`\n👶 Parental Leave Overview ${targetYear}\n`));

    if (entries.length === 0) {
      console.log(chalk.yellow(`No parental leave entries found for ${targetYear}.`));
    } else {
      const table = new Table({
        head: [chalk.cyan('#'), chalk.cyan('Date Range'), chalk.cyan('Days'), chalk.cyan('Note')],
        colWidths: [4, 30, 6, 35],
      });

      entries.forEach((entry, i) => {
        const start = dayjs(entry.startDate);
        const end = dayjs(entry.endDate);
        const dateRange =
          entry.startDate === entry.endDate
            ? start.format(FORMAT_DATE_DAY_YEAR)
            : `${start.format(FORMAT_DATE_DAY)} – ${end.format(FORMAT_DATE_DAY_YEAR)}`;
        table.push([String(i + 1), dateRange, String(entry.days), entry.description ?? '']);
      });

      console.log(table.toString());
    }

    const usedDays = entries.reduce((sum, e) => sum + e.days, 0);
    console.log(
      chalk.cyan(`Total parental leave ${targetYear}: `) + chalk.white(`${usedDays} days`)
    );
    console.log();
  }
}
