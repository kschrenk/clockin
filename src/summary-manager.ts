import chalk from 'chalk';
import Table from 'cli-table3';
import open from 'open';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import {
  Config,
  SummaryData,
  TimeEntry,
  VacationEntry,
  SickEntry,
  ParentalLeaveEntry,
} from './types.js';
import { DataManager } from './data-manager.js';
import { VacationManager } from './vacation-manager.js';
import { SickManager } from './sick-manager.js';
import { HolidayManager } from './holiday-manager.js';
import {
  calculateWorkingTime,
  countWorkingDaysInRange,
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

  async showSummary(options: { year?: number } = {}): Promise<void> {
    const targetYear = options.year ?? dayjs().year();
    const summaryData = await this.calculateSummaryData(targetYear);

    const startDate = dayjs(summaryData.startDate);
    const endDate = dayjs(summaryData.endDate);

    const dateRangeDisplay =
      startDate.year() !== endDate.year()
        ? `${startDate.format(FORMAT_DATE_DAY_YEAR)} - ${endDate.format(FORMAT_DATE_DAY_YEAR)}`
        : `${startDate.format(FORMAT_DATE_DAY)} - ${endDate.format(FORMAT_DATE_DAY_YEAR)}`;

    console.log(chalk.blue.bold(`\n📊 Work Summary (${dateRangeDisplay})\n`));

    const table = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      colWidths: [42, 20],
    });

    table.push(
      ['Total Hours Worked', dayjs.duration(summaryData.totalHoursWorked).asHours().toFixed(1)],
      ['Expected Hours/Week', summaryData.expectedHoursPerWeek.toFixed(1)],
      ['Current Week Hours', dayjs.duration(summaryData.currentWeekHours).asHours().toFixed(1)],
      ['Overtime (all-time)', this.formatHours(summaryData.overtimeHours)],
      [`Vacation Days Used (${targetYear})`, `${summaryData.totalVacationDays}`],
      ['Vacation Days Remaining (+ carryover)', `${summaryData.remainingVacationDays}`],
      [`Sick Days Used (${targetYear})`, `${summaryData.totalSickDays}`],
      [`Parental Leave Days Used (${targetYear})`, `${summaryData.totalParentalLeaveDays}`]
    );

    console.log(table.toString());

    if (targetYear === summaryData.firstTrackedYear) {
      console.log(
        chalk.gray(
          `ℹ️  ${targetYear} is your first tracked year. Unused vacation days will not carry over to ${targetYear + 1}.`
        )
      );
    }

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
    const weeklyParentalLeaveDates = await this.getWeeklyParentalLeaveEntries(weekStart, weekEnd);
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
        const isParentalLeaveDay = weeklyParentalLeaveDates.some((d) => d.isSame(cursor, 'day'));
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

        // Precedence: Holiday > Sick > Vacation > Parental Leave
        const leaveType = isHoliday
          ? 'holiday'
          : isSickDay
            ? 'sick'
            : isVacationDay
              ? 'vacation'
              : isParentalLeaveDay
                ? 'parental'
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

          case 'parental':
            rows.push({
              date: dateKey,
              displayDate,
              start: null,
              end: null,
              breakMinutes: null,
              hoursMs: leaveHoursMs,
              hoursFormatted: dayjs.duration(leaveHoursMs).format('HH:mm'),
              entryType: 'parental',
              isVacation: false,
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

  private getWeeklyParentalLeaveEntries = async (
    weekStart: Dayjs,
    weekEnd: Dayjs
  ): Promise<Dayjs[]> => {
    const entries = await this.dataManager.loadParentalLeaveEntries();
    const dates: Dayjs[] = [];

    entries.forEach((entry) => {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) return;

      const entryStartDate = dayjs(entry.startDate);
      const entryEndDate = dayjs(entry.endDate);

      let cursor = entryStartDate;
      while (isDateInWeekRange(weekStart, weekEnd, cursor) && cursor.isSameOrBefore(entryEndDate)) {
        dates.push(cursor);
        cursor = cursor.add(1, 'day');
      }
    });

    return dates;
  };

  async showLeaveSummary(options: { year?: number } = {}): Promise<void> {
    const targetYear = options.year ?? dayjs().year();

    const allVacationEntries = await this.dataManager.loadVacationEntries();
    const allSickEntries = await this.dataManager.loadSickEntries();
    const allParentalLeaveEntries = await this.dataManager.loadParentalLeaveEntries();

    const vacationEntries = allVacationEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );
    const sickEntries = allSickEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );
    const parentalEntries = allParentalLeaveEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );

    console.log(chalk.blue.bold(`\n🗓️  Leave Summary ${targetYear}\n`));

    type LeaveEntry = { startDate: string; endDate: string; days: number; description?: string };

    const renderSection = (
      label: string,
      emoji: string,
      entries: LeaveEntry[],
      budget?: number
    ): number => {
      const totalDays = entries.reduce((sum, e) => sum + e.days, 0);
      const entryWord = entries.length === 1 ? 'entry' : 'entries';
      console.log(
        chalk.blue.bold(
          `${emoji}  ${label}  (${entries.length} ${entryWord}${entries.length > 0 ? ` — ${totalDays} days` : ''})`
        )
      );

      if (entries.length === 0) {
        console.log(chalk.yellow(`  No ${label.toLowerCase()} entries for ${targetYear}.\n`));
        return 0;
      }

      const table = new Table({
        head: [
          chalk.cyan('#'),
          chalk.cyan('Date Range'),
          chalk.cyan('Days'),
          chalk.cyan('Description'),
        ],
        colWidths: [4, 30, 6, 35],
      });

      entries.forEach((entry, i) => {
        const start = dayjs(entry.startDate);
        const end = dayjs(entry.endDate);
        const dateRange =
          entry.startDate === entry.endDate
            ? start.format(FORMAT_DATE_DAY_YEAR)
            : `${start.format(FORMAT_DATE_DAY)} → ${end.format(FORMAT_DATE_DAY_YEAR)}`;
        table.push([`${i + 1}`, dateRange, `${entry.days}`, entry.description || '']);
      });

      console.log(table.toString());

      let totalLine = chalk.cyan(`Total: ${totalDays} day${totalDays !== 1 ? 's' : ''}`);
      if (budget !== undefined) {
        const remaining = Math.max(0, budget - totalDays);
        totalLine += chalk.gray(`  (${budget} entitlement — ${remaining} remaining)`);
      }
      console.log(totalLine + '\n');

      return totalDays;
    };

    const vacTotal = renderSection(
      'Vacation',
      '🏖️',
      vacationEntries,
      this.config.vacationDaysPerYear
    );
    const sickTotal = renderSection('Sick Leave', '🤒', sickEntries);
    const parentalTotal = renderSection('Parental Leave', '👶', parentalEntries);

    const grandTotal = vacTotal + sickTotal + parentalTotal;
    console.log(
      chalk.blue.bold(
        `Grand Total: ${grandTotal} leave day${grandTotal !== 1 ? 's' : ''} in ${targetYear}`
      )
    );
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

  private async calculateSummaryData(year?: number): Promise<SummaryData> {
    const now = dayjs();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEnd(now);

    // Load all data upfront so we can compute both year-scoped and all-time metrics
    const allTimeEntries = await this.dataManager.loadTimeEntries();
    const allVacationEntries = await this.dataManager.loadVacationEntries();
    const allSickEntries = await this.dataManager.loadSickEntries();
    const allParentalLeaveEntries = await this.dataManager.loadParentalLeaveEntries();

    const workingHoursPerDay = this.calculateWorkingHoursPerDay();
    const workingHoursPerDayMs = dayjs.duration(workingHoursPerDay, 'hours').asMilliseconds();
    const workingDayNames = new Set(
      this.config.workingDays.filter((d) => d.isWorkingDay).map((d) => d.day.toLowerCase())
    );

    const employmentStartDate = this.resolveEmploymentStartDate(allTimeEntries, now);

    // --- Year-scoped range ---
    const targetYear = year ?? now.year();
    const yearStart = dayjs(`${targetYear}-01-01`).startOf('day');
    const yearEnd = targetYear === now.year() ? now : dayjs(`${targetYear}-12-31`).endOf('day');
    // Display start is the later of Jan 1 and the employment start, clamped to yearEnd
    const rawRangeStart = employmentStartDate.isAfter(yearStart) ? employmentStartDate : yearStart;
    const rangeStart = rawRangeStart.isAfter(yearEnd) ? yearEnd : rawRangeStart;
    const rangeEnd = yearEnd;

    // Year-scoped time entries
    const yearTimeEntries = allTimeEntries.filter((e) => {
      if (!isValidDateString(e.date)) return false;
      const d = dayjs(e.date);
      return !d.isBefore(rangeStart, 'day') && d.isSameOrBefore(rangeEnd, 'day');
    });

    // Year-scoped vacation / sick / parental (keyed by startDate year so multi-day blocks aren't split)
    const yearVacationEntries = allVacationEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );
    const yearSickEntries = allSickEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );
    const yearParentalLeaveEntries = allParentalLeaveEntries.filter(
      (e) => isValidDateString(e.startDate) && dayjs(e.startDate).year() === targetYear
    );

    const totalVacationDays = yearVacationEntries.reduce((sum, e) => sum + e.days, 0);
    const totalSickDays = yearSickEntries.reduce((sum, e) => sum + e.days, 0);
    const totalParentalLeaveDays = yearParentalLeaveEntries.reduce((sum, e) => sum + e.days, 0);

    // Calendar-day entries (sick, parental): only working days contribute hours.
    const yearSickWorkingDays = yearSickEntries.reduce(
      (sum, e) =>
        sum + countWorkingDaysInRange(dayjs(e.startDate), dayjs(e.endDate), workingDayNames),
      0
    );
    const yearParentalWorkingDays = yearParentalLeaveEntries.reduce(
      (sum, e) =>
        sum + countWorkingDaysInRange(dayjs(e.startDate), dayjs(e.endDate), workingDayNames),
      0
    );

    // Year-scoped total hours
    let totalHoursWorked = 0;
    for (const entry of yearTimeEntries) {
      if (!entry.endTime) continue;
      totalHoursWorked += calculateWorkingTime(entry.startTime, entry.endTime, entry.pauseTime);
    }
    totalHoursWorked +=
      (totalVacationDays + yearSickWorkingDays + yearParentalWorkingDays) * workingHoursPerDayMs;

    // Year-scoped holidays (avoid double-counting with leave)
    const yearLeaveDates = this.buildLeaveDateSet(
      yearVacationEntries,
      yearSickEntries,
      yearParentalLeaveEntries
    );
    const yearHolidayDates = await this.holidayManager.getHolidayDates(rangeStart, rangeEnd);
    const yearWorkingHolidays = yearHolidayDates.filter(
      (d) =>
        workingDayNames.has(d.format('dddd').toLowerCase()) &&
        !yearLeaveDates.has(d.format(FORMAT_DATE))
    );
    totalHoursWorked += yearWorkingHolidays.length * workingHoursPerDayMs;

    // Current-week hours (always uses all entries, not year-scoped)
    let currentWeekHours = 0;
    for (const entry of allTimeEntries) {
      if (!entry.endTime || !isValidDateString(entry.date)) continue;
      const entryDate = dayjs(entry.date).tz(this.config.timezone);
      if (isDateInWeekRange(weekStart, weekEnd, entryDate)) {
        currentWeekHours += calculateWorkingTime(entry.startTime, entry.endTime, entry.pauseTime);
      }
    }

    // --- All-time overtime ---
    let allTimeHoursWorked = 0;
    for (const entry of allTimeEntries) {
      if (!entry.endTime) continue;
      allTimeHoursWorked += calculateWorkingTime(entry.startTime, entry.endTime, entry.pauseTime);
    }
    const allTimeVacDays = allVacationEntries.reduce((sum, e) => sum + e.days, 0);
    const allTimeSickWorkingDays = allSickEntries.reduce(
      (sum, e) =>
        sum + countWorkingDaysInRange(dayjs(e.startDate), dayjs(e.endDate), workingDayNames),
      0
    );
    const allTimeParentalWorkingDays = allParentalLeaveEntries.reduce(
      (sum, e) =>
        sum + countWorkingDaysInRange(dayjs(e.startDate), dayjs(e.endDate), workingDayNames),
      0
    );
    allTimeHoursWorked +=
      (allTimeVacDays + allTimeSickWorkingDays + allTimeParentalWorkingDays) * workingHoursPerDayMs;

    const allTimeLeaveDates = this.buildLeaveDateSet(
      allVacationEntries,
      allSickEntries,
      allParentalLeaveEntries
    );
    const allTimeHolidayDates = await this.holidayManager.getHolidayDates(employmentStartDate, now);
    const allTimeWorkingHolidays = allTimeHolidayDates.filter(
      (d) =>
        workingDayNames.has(d.format('dddd').toLowerCase()) &&
        !allTimeLeaveDates.has(d.format(FORMAT_DATE))
    );
    allTimeHoursWorked += allTimeWorkingHolidays.length * workingHoursPerDayMs;

    const elapsedWeeks = now.diff(employmentStartDate, 'week', true);
    const expectedTotalHours = elapsedWeeks * this.config.hoursPerWeek;
    const overtimeHours = dayjs
      .duration(dayjs.duration(allTimeHoursWorked).asHours() - expectedTotalHours, 'hours')
      .asMilliseconds();

    // --- Remaining vacation ---
    // Year 1 (first tracked year) is a clean slate: its unused days never carry forward.
    // This prevents incorrect carryover from a year where tracking was incomplete.
    // From year 2 onwards, unused days accumulate normally.
    const firstTrackedYear = employmentStartDate.year();
    let remainingVacationDays: number;

    if (targetYear === firstTrackedYear) {
      // Year 1: simple entitlement minus what was taken this year, no carryover
      remainingVacationDays = Math.max(0, this.config.vacationDaysPerYear - totalVacationDays);
    } else {
      // Year 2+: accumulate from year 2 onwards (year 1 is excluded from carryover)
      const yearsFromYear2 = targetYear - firstTrackedYear; // each year after year 1
      const vacDaysFromYear2ToTarget = allVacationEntries
        .filter((e) => {
          if (!isValidDateString(e.startDate)) return false;
          const y = dayjs(e.startDate).year();
          return y > firstTrackedYear && y <= targetYear;
        })
        .reduce((sum, e) => sum + e.days, 0);
      remainingVacationDays = Math.max(
        0,
        yearsFromYear2 * this.config.vacationDaysPerYear - vacDaysFromYear2ToTarget
      );
    }

    // For display, show the full year range when employment started after this year
    const displayStart = employmentStartDate.isAfter(yearEnd) ? yearStart : rangeStart;

    return {
      totalHoursWorked,
      totalVacationDays,
      totalSickDays,
      totalParentalLeaveDays,
      remainingVacationDays,
      expectedHoursPerWeek: this.config.hoursPerWeek,
      currentWeekHours,
      overtimeHours,
      startDate: displayStart.format(FORMAT_DATE),
      endDate: rangeEnd.format(FORMAT_DATE),
      firstTrackedYear,
    };
  }

  private resolveEmploymentStartDate(timeEntries: TimeEntry[], now: Dayjs): Dayjs {
    if (this.config.startDate && isValidDateString(this.config.startDate)) {
      return dayjs(this.config.startDate);
    }
    const sorted = timeEntries
      .filter((e) => isValidDateString(e.date))
      .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());
    return sorted.length > 0 ? dayjs(sorted[0].date) : now;
  }

  private buildLeaveDateSet(
    vacationEntries: VacationEntry[],
    sickEntries: SickEntry[],
    parentalLeaveEntries: ParentalLeaveEntry[] = []
  ): Set<string> {
    const dateKeys = new Set<string>();
    for (const entry of [...vacationEntries, ...sickEntries, ...parentalLeaveEntries]) {
      if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) continue;
      let cursor = dayjs(entry.startDate);
      const end = dayjs(entry.endDate);
      while (cursor.isSameOrBefore(end, 'day')) {
        dateKeys.add(cursor.format(FORMAT_DATE));
        cursor = cursor.add(1, 'day');
      }
    }
    return dateKeys;
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
