import { describe, it, expect, beforeEach, afterEach, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { VacationManager } from '../vacation-manager.js';
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

describe('VacationManager', () => {
  let tempDir: string;
  let config: Config;
  let vacationManager: VacationManager;
  let dataManager: DataManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-vac-'));
    config = buildConfig(tempDir);
    vacationManager = new VacationManager(config);
    dataManager = new DataManager(config);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('calculates remaining vacation days with no usage', async () => {
    expect(await vacationManager.getRemainingVacationDays()).toBe(25);
  });

  it('generates unique IDs', () => {
    const id1 = (vacationManager as any).generateId();
    const id2 = (vacationManager as any).generateId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });

  it('adds a single vacation day (skips weekend logic implicitly)', async () => {
    await vacationManager.addVacation(1, '2025-01-06'); // Monday
    const entries = await dataManager.loadVacationEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(1);
    expect(await vacationManager.getRemainingVacationDays()).toBe(24);
  });

  it('adds multiple vacation days skipping weekends', async () => {
    // Start Thursday, expect Thu+Fri+Mon for 3 working days
    await vacationManager.addVacation(3, '2025-01-09'); // Thursday
    const entries = await dataManager.loadVacationEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(3);
    expect(await vacationManager.getRemainingVacationDays()).toBe(22);
  });

  it('adds vacation range counting only working days', async () => {
    // Range Mon–Sun, expects 5 working days
    await vacationManager.addVacationRange('2025-01-06', '2025-01-12');
    const entries = await dataManager.loadVacationEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].days).toBe(5);
    expect(await vacationManager.getRemainingVacationDays()).toBe(20);
  });

  test.each([
    { value: 0.5, label: 'fractional 0.5' },
    { value: 1.2, label: 'fractional 1.2' },
    { value: -1, label: 'negative -1' },
    { value: 0, label: 'zero 0' },
  ])('rejects invalid day input: $label', async ({ value }) => {
    await vacationManager.addVacation(value, '2025-01-06');
    const entries = await dataManager.loadVacationEntries();
    expect(entries.length).toBe(0);
    expect(await vacationManager.getRemainingVacationDays()).toBe(25);
  });

  it('does not create entry when start date is non-working and no future working day found (pathological config)', async () => {
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
    const badManager = new VacationManager(badConfig);
    await badManager.addVacation(2, '2025-01-06');
    expect((await new DataManager(badConfig).loadVacationEntries()).length).toBe(0);
  });

  it('prevents adding vacation days on dates that already have vacation entries (self-overlap)', async () => {
    // Add first vacation entry
    await vacationManager.addVacation(1, '2025-01-06');

    // Try to add another vacation on the same date - should be prevented
    await vacationManager.addVacation(1, '2025-01-06');

    // Should only have the first entry
    const vacationEntries = await dataManager.loadVacationEntries();
    expect(vacationEntries.length).toBe(1);
    expect(await vacationManager.getTotalVacationDays()).toBe(1);
  });

  it('prevents adding vacation range when some dates already have vacation entries', async () => {
    // Add vacation on Wednesday
    await vacationManager.addVacation(1, '2025-01-08'); // Wednesday

    // Try to add range that overlaps - should be prevented
    await vacationManager.addVacationRange('2025-01-06', '2025-01-10'); // Mon-Fri range

    // Should only have the original entry
    const vacationEntries = await dataManager.loadVacationEntries();
    expect(vacationEntries.length).toBe(1);
    expect(await vacationManager.getTotalVacationDays()).toBe(1);
  });

  it('prevents adding vacation when sick days already exist for same dates', async () => {
    const { SickManager } = await import('../sick-manager.js');
    const sickManager = new SickManager(config);

    // Add sick day first
    await sickManager.addSickDays(1, 'Flu', '2025-01-06');

    // Try to add vacation on the same date - should be prevented
    await vacationManager.addVacation(1, '2025-01-06');

    // Only sick entry should exist, no vacation entry
    const sickTotal = await sickManager.getTotalSickDays();
    const vacationEntries = await dataManager.loadVacationEntries();

    expect(sickTotal).toBe(1); // Sick day should still exist
    expect(vacationEntries.length).toBe(0); // Vacation should be rejected
  });

  it('prevents adding vacation range when sick days overlap', async () => {
    const { SickManager } = await import('../sick-manager.js');
    const sickManager = new SickManager(config);

    // Add sick days first
    await sickManager.addSickDays(2, 'Illness', '2025-01-07'); // Tue-Wed

    // Try to add vacation range that overlaps - should be prevented
    await vacationManager.addVacationRange('2025-01-06', '2025-01-10'); // Mon-Fri, overlaps with sick days

    // Only sick days should exist
    const sickTotal = await sickManager.getTotalSickDays();
    const vacationEntries = await dataManager.loadVacationEntries();

    expect(sickTotal).toBe(2); // Sick days should still exist
    expect(vacationEntries.length).toBe(0); // Vacation range should be rejected
  });

  it('prevents adding vacation when time entries exist for those dates', async () => {
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

    // Try to add vacation on the same date - should be prevented
    await vacationManager.addVacation(1, '2025-01-06');

    // Should not create vacation entry
    const vacationEntries = await dataManager.loadVacationEntries();
    expect(vacationEntries.length).toBe(0);
  });

  it('prevents adding vacation range when time entries exist in the range', async () => {
    // Simulate time entries for Jan 7th and 8th
    await dataManager.saveTimeEntry({
      id: 'test-entry-1',
      date: '2025-01-07',
      startTime: '2025-01-07T09:00:00.000Z',
      endTime: '2025-01-07T17:00:00.000Z',
      pauseTime: 60,
      type: 'work',
      description: 'Test work',
    });

    // Try to add vacation range that includes those dates - should be prevented
    await vacationManager.addVacationRange('2025-01-06', '2025-01-10');

    // Should not create vacation entry
    const vacationEntries = await dataManager.loadVacationEntries();
    expect(vacationEntries.length).toBe(0);
  });
});
