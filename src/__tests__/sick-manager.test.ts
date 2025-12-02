import { describe, it, expect, beforeEach, afterEach, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SickManager } from '../sick-manager.js';
import { DataManager } from '../data-manager.js';
import { Config } from '../types.js';

function buildConfig(dataDir: string): Config {
  return {
    name: 'Test User',
    hoursPerWeek: 40,
    vacationDaysPerYear: 25,
    workingDays: [
      { day: 'monday', isWorkingDay: true },
      { day: 'tuesday', isWorkingDay: true },
      { day: 'wednesday', isWorkingDay: true },
      { day: 'thursday', isWorkingDay: true },
      { day: 'friday', isWorkingDay: true },
      { day: 'saturday', isWorkingDay: false },
      { day: 'sunday', isWorkingDay: false },
    ],
    dataDirectory: dataDir,
    setupCompleted: true,
    timezone: 'Europe/Berlin',
  };
}

describe('SickManager', () => {
  let tempDir: string;
  let config: Config;
  let sickManager: SickManager;
  let dataManager: DataManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-sick-'));
    config = buildConfig(tempDir);
    sickManager = new SickManager(config);
    dataManager = new DataManager(config);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('calculates total sick days with no usage', async () => {
    expect(await sickManager.getTotalSickDays()).toBe(0);
  });

  it('generates unique IDs', () => {
    const id1 = (sickManager as any).generateId();
    const id2 = (sickManager as any).generateId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });

  it('adds a single sick day', async () => {
    await sickManager.addSickDays(1, 'Flu', '2025-01-06'); // Monday
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(1);
    expect(entries[0].description).toBe('Flu');
    expect(entries[0].startDate).toBe('2025-01-06');
    expect(entries[0].endDate).toBe('2025-01-06');
    expect(await sickManager.getTotalSickDays()).toBe(1);
  });

  it('adds multiple sick days as consecutive calendar days', async () => {
    // Start Thursday, 3 consecutive days = Thu+Fri+Sat (not skipping weekends for sick days)
    await sickManager.addSickDays(3, 'Food poisoning', '2025-01-09'); // Thursday
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(3);
    expect(entries[0].description).toBe('Food poisoning');
    expect(entries[0].startDate).toBe('2025-01-09'); // Thursday
    expect(entries[0].endDate).toBe('2025-01-11'); // Saturday (consecutive calendar days)
    expect(await sickManager.getTotalSickDays()).toBe(3);
  });

  it('adds sick days with default description when none provided', async () => {
    await sickManager.addSickDays(2, undefined, '2025-01-06'); // Monday
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(2);
    expect(entries[0].description).toBe('2 sick days');
    expect(await sickManager.getTotalSickDays()).toBe(2);
  });

  it('uses singular form in default description for one day', async () => {
    await sickManager.addSickDays(1, undefined, '2025-01-06'); // Monday
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].description).toBe('1 sick day');
  });

  it('accumulates total sick days across multiple entries', async () => {
    await sickManager.addSickDays(1, 'Headache', '2025-01-06');
    await sickManager.addSickDays(2, 'Flu', '2025-01-08');

    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(2);
    expect(await sickManager.getTotalSickDays()).toBe(3);
  });

  test.each([
    { value: 0.5, label: 'fractional 0.5' },
    { value: 1.2, label: 'fractional 1.2' },
    { value: -1, label: 'negative -1' },
    { value: 0, label: 'zero 0' },
  ])('rejects invalid day input: $label', async ({ value }) => {
    await sickManager.addSickDays(value, 'Test', '2025-01-06');
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(0);
    expect(await sickManager.getTotalSickDays()).toBe(0);
  });

  it('defaults to current day when start date not provided', async () => {
    // We can't easily mock dayjs, so we'll just verify the entry is created
    await sickManager.addSickDays(1, 'Cold');
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(1);
    expect(entries[0].description).toBe('Cold');
    // The start date should be a valid date string
    expect(entries[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses exact start date even if weekend', async () => {
    // Saturday should be used as-is for sick days (consecutive calendar days)
    await sickManager.addSickDays(1, 'Illness', '2025-01-04'); // Saturday
    const entries = await sickManager.getSickEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].startDate).toBe('2025-01-04'); // Saturday (exact date)
    expect(entries[0].endDate).toBe('2025-01-04'); // Saturday (exact date)
  });

  it('works even with no working days configured (sick days are calendar-based)', async () => {
    // Reconfigure with no working days
    const badConfig: Config = {
      ...config,
      workingDays: [
        { day: 'monday', isWorkingDay: false },
        { day: 'tuesday', isWorkingDay: false },
        { day: 'wednesday', isWorkingDay: false },
        { day: 'thursday', isWorkingDay: false },
        { day: 'friday', isWorkingDay: false },
        { day: 'saturday', isWorkingDay: false },
        { day: 'sunday', isWorkingDay: false },
      ],
    };
    const badManager = new SickManager(badConfig);
    await badManager.addSickDays(2, 'Illness', '2025-01-06');
    // Should still work since sick days are consecutive calendar days, not dependent on working day config
    expect((await new DataManager(badConfig).loadSickEntries()).length).toBe(1);
  });

  it('persists data correctly to CSV file', async () => {
    await sickManager.addSickDays(2, 'Migraine', '2025-01-06');

    // Load data using DataManager directly
    const persistedEntries = await dataManager.loadSickEntries();
    expect(persistedEntries.length).toBe(1);
    expect(persistedEntries[0].days).toBe(2);
    expect(persistedEntries[0].description).toBe('Migraine');
    expect(persistedEntries[0].startDate).toBe('2025-01-06');
    expect(persistedEntries[0].endDate).toBe('2025-01-07');
  });

  it('works with sparse working day configurations (sick days are calendar-based)', async () => {
    // Config with only one working day per year (very sparse)
    const sparseConfig: Config = {
      ...config,
      workingDays: [
        { day: 'monday', isWorkingDay: true },
        { day: 'tuesday', isWorkingDay: false },
        { day: 'wednesday', isWorkingDay: false },
        { day: 'thursday', isWorkingDay: false },
        { day: 'friday', isWorkingDay: false },
        { day: 'saturday', isWorkingDay: false },
        { day: 'sunday', isWorkingDay: false },
      ],
    };

    const sparseManager = new SickManager(sparseConfig);
    // Add 100 sick days - should work since they're consecutive calendar days
    await sparseManager.addSickDays(100, 'Long illness', '2025-01-06'); // Monday

    const entries = await new DataManager(sparseConfig).loadSickEntries();
    expect(entries.length).toBe(1); // Should successfully create entry
    expect(entries[0].days).toBe(100);
    expect(entries[0].startDate).toBe('2025-01-06');
    expect(entries[0].endDate).toBe('2025-04-15'); // 100 consecutive calendar days later
  });

  it('prevents adding sick days on dates that already have sick day entries (self-overlap)', async () => {
    // Add first sick day entry
    await sickManager.addSickDays(1, 'Headache', '2025-01-06');

    // Try to add another sick day on the same date - should be prevented
    await sickManager.addSickDays(1, 'Migraine', '2025-01-06');

    // Should only have the first entry
    const sickEntries = await sickManager.getSickEntries();
    expect(sickEntries.length).toBe(1);
    expect(sickEntries[0].description).toBe('Headache'); // Original entry should remain
    expect(await sickManager.getTotalSickDays()).toBe(1);
  });

  it('prevents adding sick day range when some dates already have sick day entries', async () => {
    // Add sick day on Wednesday
    await sickManager.addSickDays(1, 'Flu', '2025-01-08'); // Wednesday

    // Try to add range that includes Wednesday (Mon-Fri) - should be prevented
    await sickManager.addSickDays(5, 'Long illness', '2025-01-06'); // Monday-Friday range

    // Should only have the original entry
    const sickEntries = await sickManager.getSickEntries();
    expect(sickEntries.length).toBe(1);
    expect(sickEntries[0].description).toBe('Flu');
    expect(await sickManager.getTotalSickDays()).toBe(1);
  });

  it('prevents adding sick days when vacation already exists for same dates', async () => {
    const { VacationManager } = await import('../vacation-manager.js');
    const vacationManager = new VacationManager(config);

    // Add vacation first
    await vacationManager.addVacation(1, '2025-01-06');

    // Try to add sick day on the same date - should be prevented
    await sickManager.addSickDays(1, 'Emergency illness', '2025-01-06');

    // Only vacation entry should exist, no sick entry
    const sickEntries = await sickManager.getSickEntries();
    const vacationTotal = await vacationManager.getTotalVacationDays();

    expect(sickEntries.length).toBe(0); // Sick day should be rejected
    expect(vacationTotal).toBe(1); // Vacation entry should still exist
  });

  it('prevents adding sick days when vacation range overlaps', async () => {
    const { VacationManager } = await import('../vacation-manager.js');
    const vacationManager = new VacationManager(config);

    // Add vacation range first (Mon-Fri: Jan 6-10)
    await vacationManager.addVacationRange('2025-01-06', '2025-01-10');

    // Try to add sick days that overlap - should be prevented
    await sickManager.addSickDays(2, 'Flu', '2025-01-07'); // Tue-Wed, overlaps with vacation

    // Only vacation should exist
    const sickEntries = await sickManager.getSickEntries();
    const vacationTotal = await vacationManager.getTotalVacationDays();

    expect(sickEntries.length).toBe(0); // Sick days should be rejected
    expect(vacationTotal).toBe(5); // Vacation range should still exist (5 working days)
  });

  it('prevents adding sick days when time entries exist for those dates', async () => {
    // Simulate a time entry for Jan 6th
    await dataManager.saveTimeEntry({
      id: 'test-entry',
      date: '2025-01-06',
      startTime: '2025-01-06T09:00:00.000Z',
      endTime: '2025-01-06T17:00:00.000Z',
      pauseTime: 60,
      type: 'work',
      description: 'Test work',
    });

    // Try to add sick day on the same date - should be prevented
    await sickManager.addSickDays(1, 'Flu', '2025-01-06');

    // Should not create sick entry
    const sickEntries = await sickManager.getSickEntries();
    expect(sickEntries.length).toBe(0);
  });
});
