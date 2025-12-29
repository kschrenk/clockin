import { Config, HolidayEntry } from './types.js';
import { DataManager } from './data-manager.js';
import { dayjs, isValidDateString } from './date-utils.js';
import { Dayjs } from 'dayjs';
import chalk from 'chalk';
import Holidays from 'date-holidays';
import { createHash } from 'crypto';

// Types from `date-holidays` that should count as work-free days within clockin.
// Extend this set if you want to treat other types (e.g. "optional") as work-free.
const WORK_FREE_HOLIDAY_TYPES = new Set(['public', 'bank']);

export class HolidayManager {
  private config: Config;
  private dataManager: DataManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
  }

  /**
   * Initialize holidays for a given year and region
   * @param year - The year to initialize holidays for (defaults to current year)
   * @param country - Country code (e.g., 'DE', 'US')
   * @param region - Region/state code (e.g., 'BY' for Bavaria, 'CA' for California)
   * @param force - Force re-initialization even if holidays already exist
   */
  async initHolidays(
    year?: number,
    country?: string,
    region?: string,
    force?: boolean
  ): Promise<void> {
    const targetYear = year || dayjs().year();
    const targetCountry = country || 'DE';
    const targetRegion = region || 'BY';

    console.log(
      chalk.blue(
        `\n🌍 Initializing holidays for ${targetYear} (${targetCountry}-${targetRegion})...\n`
      )
    );

    // Check if holidays for this year/country/region already exist
    const existingHolidays = await this.dataManager.loadHolidayEntries();
    const existingForYear = existingHolidays.filter(
      (h) =>
        h.country === targetCountry &&
        h.region === targetRegion &&
        h.date.startsWith(`${targetYear}-`)
    );

    if (existingForYear.length > 0 && !force) {
      console.log(
        chalk.yellow(
          `⚠️  Holidays for ${targetYear} (${targetCountry}-${targetRegion}) already exist (${existingForYear.length} entries).`
        )
      );
      console.log(
        chalk.yellow('Use --force flag to re-initialize and replace existing holidays.\n')
      );
      return;
    }

    // If forcing, remove existing holidays for this year/country/region
    if (force && existingForYear.length > 0) {
      console.log(
        chalk.yellow(
          `🔄 Removing ${existingForYear.length} existing holidays before re-initialization...\n`
        )
      );
      await this.removeHolidaysForYear(targetYear, targetCountry, targetRegion);
    }

    // Fetch holidays from API or use static data
    const holidays = await this.fetchHolidays(targetYear, targetCountry, targetRegion);

    // Save holidays
    for (const holiday of holidays) {
      await this.dataManager.saveHolidayEntry(holiday);
    }

    console.log(chalk.green(`✅ Added ${holidays.length} holidays for ${targetYear}\n`));
  }

  /**
   * Get all holiday dates for a given date range
   */
  async getHolidayDates(startDate: Dayjs, endDate: Dayjs): Promise<Dayjs[]> {
    const holidays = await this.dataManager.loadHolidayEntries();
    const holidayDates: Dayjs[] = [];

    holidays.forEach((holiday) => {
      if (!isValidDateString(holiday.date)) {
        return;
      }

      const holidayDate = dayjs(holiday.date);
      if (
        (holidayDate.isAfter(startDate) || holidayDate.isSame(startDate, 'day')) &&
        (holidayDate.isBefore(endDate) || holidayDate.isSame(endDate, 'day'))
      ) {
        holidayDates.push(holidayDate);
      }
    });

    return holidayDates;
  }

  /**
   * Check if a given date is a holiday
   */
  async isHoliday(date: Dayjs): Promise<boolean> {
    const holidays = await this.dataManager.loadHolidayEntries();
    return holidays.some((holiday) => {
      if (!isValidDateString(holiday.date)) return false;
      return dayjs(holiday.date).isSame(date, 'day');
    });
  }

  /**
   * Get the total number of holidays in a date range
   */
  async getHolidayCount(startDate: Dayjs, endDate: Dayjs): Promise<number> {
    const holidayDates = await this.getHolidayDates(startDate, endDate);
    return holidayDates.length;
  }

  /**
   * Fetch holidays from a data source.
   * Uses `date-holidays` to generate holidays for the given country/region.
   */
  private async fetchHolidays(
    year: number,
    country: string,
    region: string
  ): Promise<HolidayEntry[]> {
    const hd = new Holidays();

    // `date-holidays` uses country, state, region hierarchy (depending on country).
    // Our CLI currently exposes `country` and `region`.
    // - For DE, region usually maps to state (e.g., BY)
    // - For US, region usually maps to state (e.g., CA)
    hd.init(country, region);

    const holidayDefs = hd.getHolidays(year) as Array<{
      date: string;
      name: string;
      type?: string;
      substitute?: boolean;
    }>;

    if (!Array.isArray(holidayDefs) || holidayDefs.length === 0) {
      // `date-holidays` doesn't clearly signal "unknown region" via return types,
      // so treat empty results as unsupported/misconfigured input.
      throw new Error(
        `No holidays found for ${country}-${region} in ${year}. Check that the country/region codes are supported by date-holidays.`
      );
    }

    const entries: HolidayEntry[] = [];

    for (const h of holidayDefs) {
      // Only import days that are typically work-free.
      // date-holidays also returns "observance" (e.g., Valentinstag) which we must ignore.
      // See https://github.com/commenthol/date-holidays#holiday-types
      const type = (h.type || '').toLowerCase();
      if (!WORK_FREE_HOLIDAY_TYPES.has(type)) continue;

      // date-holidays may include timestamps; normalize to YYYY-MM-DD.
      const dateStr = dayjs(h.date).format('YYYY-MM-DD');
      if (!isValidDateString(dateStr)) continue;

      // Skip "observed/substitute" entries so we don't double-book a holiday.
      if (h.substitute) continue;

      entries.push({
        id: this.buildHolidayId(country, region, dateStr, h.name),
        date: dateStr,
        name: h.name,
        country,
        region,
      });
    }

    // De-dupe by date+name (defensive; some calendars may contain duplicates)
    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      const key = `${e.date}::${e.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort for stable output/tests
    deduped.sort((a, b) =>
      a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)
    );

    return deduped;
  }

  private buildHolidayId(country: string, region: string, date: string, name: string): string {
    // Use a deterministic hash so IDs are stable across runs but don't depend on delimiters.
    const payload = `${country}|${region}|${date}|${name}`;
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 24);
    return `hol_${digest}`;
  }

  /**
   * Remove holidays for a specific year, country, and region
   * Used for force re-initialization
   */
  private async removeHolidaysForYear(
    year: number,
    country: string,
    region: string
  ): Promise<void> {
    const allHolidays = await this.dataManager.loadHolidayEntries();
    const filteredHolidays = allHolidays.filter(
      (h) => !(h.country === country && h.region === region && h.date.startsWith(`${year}-`))
    );

    // Rewrite the CSV with only the filtered holidays
    await this.dataManager.rewriteHolidayEntries(filteredHolidays);
  }
}
