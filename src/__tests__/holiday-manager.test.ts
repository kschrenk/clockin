import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HolidayManager } from '../holiday-manager.js';
import { ConfigManager } from '../config-manager.js';
import { Config } from '../types.js';
import { dayjs } from '../date-utils.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('HolidayManager', () => {
  let config: Config;
  let holidayManager: HolidayManager;
  let testDataDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test data
    testDataDir = path.join(os.tmpdir(), `clockin-test-holidays-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });

    const configManager = new ConfigManager();
    const defaultConfig = configManager.getDefaultConfig();
    config = {
      name: defaultConfig.name || 'Test User',
      hoursPerWeek: defaultConfig.hoursPerWeek || 40,
      vacationDaysPerYear: defaultConfig.vacationDaysPerYear || 25,
      workingDays: defaultConfig.workingDays || [],
      timezone: defaultConfig.timezone || 'UTC',
      setupCompleted: true,
      dataDirectory: testDataDir,
      startDate: defaultConfig.startDate,
    };

    holidayManager = new HolidayManager(config);
  });

  afterEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('initializes holidays for Germany (Bavaria) for current year', async () => {
    const currentYear = dayjs().year();
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const startDate = dayjs(`${currentYear}-01-01`);
    const endDate = dayjs(`${currentYear}-12-31`);
    const holidays = await holidayManager.getHolidayDates(startDate, endDate);

    // Bavaria has many holidays (13+ fixed + movable holidays)
    expect(holidays.length).toBeGreaterThan(10);
  });

  it('initializes holidays for US (California)', async () => {
    const currentYear = dayjs().year();
    await holidayManager.initHolidays(currentYear, 'US', 'CA');

    const startDate = dayjs(`${currentYear}-01-01`);
    const endDate = dayjs(`${currentYear}-12-31`);
    const holidays = await holidayManager.getHolidayDates(startDate, endDate);

    // California has ~9-10 federal holidays
    expect(holidays.length).toBeGreaterThan(8);
  });

  it('checks if a specific date is a holiday (New Year)', async () => {
    const currentYear = dayjs().year();
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const newYearsDay = dayjs(`${currentYear}-01-01`);
    const isHoliday = await holidayManager.isHoliday(newYearsDay);

    expect(isHoliday).toBe(true);
  });

  it('checks if a non-holiday date returns false', async () => {
    const currentYear = dayjs().year();
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const randomDay = dayjs(`${currentYear}-02-15`); // Unlikely to be a holiday
    const isHoliday = await holidayManager.isHoliday(randomDay);

    expect(isHoliday).toBe(false);
  });

  it('counts holidays in a date range', async () => {
    const currentYear = dayjs().year();
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const startDate = dayjs(`${currentYear}-12-01`);
    const endDate = dayjs(`${currentYear}-12-31`);
    const count = await holidayManager.getHolidayCount(startDate, endDate);

    // December typically has Christmas Day (25th) and Second Day of Christmas (26th) in Bavaria
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when no holidays are initialized', async () => {
    const startDate = dayjs('2025-01-01');
    const endDate = dayjs('2025-12-31');
    const holidays = await holidayManager.getHolidayDates(startDate, endDate);

    expect(holidays).toEqual([]);
  });

  it('filters holidays by date range correctly', async () => {
    const year = 2025;
    await holidayManager.initHolidays(year, 'DE', 'BY');

    // Get only January holidays
    const startDate = dayjs('2025-01-01');
    const endDate = dayjs('2025-01-31');
    const holidays = await holidayManager.getHolidayDates(startDate, endDate);

    // Assert at least New Year's Day and Epiphany are present in Bavaria.
    const dates = holidays.map((d) => d.format('YYYY-MM-DD'));
    expect(dates).toContain('2025-01-01');
    expect(dates).toContain('2025-01-06');
  });

  it('handles Easter-based holidays for Bavaria (Good Friday and Easter Monday)', async () => {
    await holidayManager.initHolidays(2025, 'DE', 'BY');

    // 2025: Good Friday Apr 18, Easter Monday Apr 21
    const goodFriday = dayjs('2025-04-18');
    const easterMonday = dayjs('2025-04-21');

    expect(await holidayManager.isHoliday(goodFriday)).toBe(true);
    expect(await holidayManager.isHoliday(easterMonday)).toBe(true);
  });

  it('calculates US movable holidays correctly (Thanksgiving)', async () => {
    await holidayManager.initHolidays(2025, 'US', 'CA');

    // Thanksgiving 2025 is on November 27th
    const thanksgiving = dayjs('2025-11-27');
    expect(await holidayManager.isHoliday(thanksgiving)).toBe(true);
  });

  it('prevents duplicate initialization for the same year/country/region', async () => {
    const currentYear = 2025;

    // Initialize holidays first time
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const startDate = dayjs(`${currentYear}-01-01`);
    const endDate = dayjs(`${currentYear}-12-31`);
    const firstCount = (await holidayManager.getHolidayDates(startDate, endDate)).length;

    // Try to initialize again (should be prevented)
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const secondCount = (await holidayManager.getHolidayDates(startDate, endDate)).length;

    // Count should be the same, not doubled
    expect(secondCount).toBe(firstCount);
    expect(secondCount).toBeGreaterThan(0);
  });

  it('allows re-initialization with force flag', async () => {
    const currentYear = 2025;

    // Initialize holidays first time
    await holidayManager.initHolidays(currentYear, 'DE', 'BY');

    const startDate = dayjs(`${currentYear}-01-01`);
    const endDate = dayjs(`${currentYear}-12-31`);
    const firstCount = (await holidayManager.getHolidayDates(startDate, endDate)).length;

    // Force re-initialize
    await holidayManager.initHolidays(currentYear, 'DE', 'BY', true);

    const secondCount = (await holidayManager.getHolidayDates(startDate, endDate)).length;

    // Count should be the same (replaced, not duplicated)
    expect(secondCount).toBe(firstCount);
    expect(secondCount).toBeGreaterThan(0);
  });

  it('does not import observances like Valentinstag as holidays (DE-BY)', async () => {
    await holidayManager.initHolidays(2025, 'DE', 'BY');

    // Valentinstag is an observance, not a public holiday.
    const valentines = dayjs('2025-02-14');
    expect(await holidayManager.isHoliday(valentines)).toBe(false);

    // Sanity: a real public holiday in Bavaria should still be present.
    const epiphany = dayjs('2025-01-06');
    expect(await holidayManager.isHoliday(epiphany)).toBe(true);
  });
});
