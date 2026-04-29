import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import { ParentalLeaveManager } from '../parental-leave-manager.js';
import { SummaryManager } from '../summary-manager.js';
import { Config } from '../types.js';
import { DataManager } from '../data-manager.js';

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
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
  dataDirectory: process.env.CLOCKIN_CONFIG_PATH!,
  setupCompleted: true,
  timezone: 'Europe/Berlin',
  ...overrides,
});

describe('ParentalLeaveManager', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.setSystemTime(new Date('2025-06-01T10:00:00.000Z'));
    testDir = process.env.CLOCKIN_CONFIG_PATH!;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('adds parental leave as consecutive calendar days', async () => {
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);
    const saveSpy = vi
      .spyOn(DataManager.prototype, 'saveParentalLeaveEntry')
      .mockResolvedValue(undefined);

    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(7, 'Parental', '2025-06-02'); // Mon

    expect(saveSpy).toHaveBeenCalledOnce();
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.startDate).toBe('2025-06-02');
    expect(saved.endDate).toBe('2025-06-08'); // Sun — calendar days, incl. weekend
    expect(saved.days).toBe(7);
  });

  it('rejects fractional days', async () => {
    const saveSpy = vi
      .spyOn(DataManager.prototype, 'saveParentalLeaveEntry')
      .mockResolvedValue(undefined);
    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(1.5);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('rejects zero or negative days', async () => {
    const saveSpy = vi
      .spyOn(DataManager.prototype, 'saveParentalLeaveEntry')
      .mockResolvedValue(undefined);
    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(0);
    await manager.addParentalLeave(-1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('prevents overlap with existing parental leave', async () => {
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);

    const existingEntry = {
      id: 'p0',
      startDate: '2025-06-02',
      endDate: '2025-06-04',
      days: 3,
      description: 'First block',
    };
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries')
      .mockResolvedValueOnce([]) // first call: no existing entries → save succeeds
      .mockResolvedValue([existingEntry]); // subsequent calls: first entry exists
    const saveSpy = vi
      .spyOn(DataManager.prototype, 'saveParentalLeaveEntry')
      .mockResolvedValue(undefined);

    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(3, 'First block', '2025-06-02');
    await manager.addParentalLeave(3, 'Second block', '2025-06-04'); // overlaps Jun 4

    expect(saveSpy).toHaveBeenCalledOnce(); // only first save goes through
  });

  it('prevents overlap with vacation', async () => {
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([
      {
        id: 'v1',
        startDate: '2025-06-03',
        endDate: '2025-06-03',
        days: 1,
        description: 'Vacation',
      },
    ]);

    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(3, 'Parental', '2025-06-02');

    const entries = await new DataManager(makeConfig()).loadParentalLeaveEntries();
    expect(entries).toHaveLength(0);
  });

  it('prevents overlap with sick leave', async () => {
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([
      { id: 's1', startDate: '2025-06-03', endDate: '2025-06-03', days: 1, description: 'Flu' },
    ]);

    const manager = new ParentalLeaveManager(makeConfig());
    await manager.addParentalLeave(3, 'Parental', '2025-06-02');

    const entries = await new DataManager(makeConfig()).loadParentalLeaveEntries();
    expect(entries).toHaveLength(0);
  });
});

describe('SummaryManager — parental leave', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.setSystemTime(new Date('2025-11-16T23:59:59.999Z'));
    testDir = process.env.CLOCKIN_CONFIG_PATH!;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('parental leave spanning weekend counts only working days toward hours', async () => {
    const config = makeConfig({ startDate: '2025-11-10' });
    const summaryManager = new SummaryManager(config);

    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadHolidayEntries').mockResolvedValue([]);
    // Mon–Sun: 7 calendar days, 5 working days
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries').mockResolvedValue([
      {
        id: 'p1',
        startDate: '2025-11-10',
        endDate: '2025-11-16',
        days: 7,
        description: 'Parental',
      },
    ]);

    const summaryData = await (summaryManager as any).calculateSummaryData();

    expect(summaryData.totalParentalLeaveDays).toBe(7); // display: calendar days
    expect(summaryData.totalHoursWorked).toBe(5 * 8 * 3_600_000); // hours: 5 working days × 8h
  });

  it('parental leave weekdays only — all days contribute hours', async () => {
    const config = makeConfig({ startDate: '2025-11-10' });
    const summaryManager = new SummaryManager(config);

    vi.setSystemTime(new Date('2025-11-14T23:59:59.999Z'));

    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadHolidayEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries').mockResolvedValue([
      {
        id: 'p1',
        startDate: '2025-11-10',
        endDate: '2025-11-12',
        days: 3,
        description: 'Parental',
      },
    ]);

    const summaryData = await (summaryManager as any).calculateSummaryData();

    expect(summaryData.totalParentalLeaveDays).toBe(3);
    expect(summaryData.totalHoursWorked).toBe(3 * 8 * 3_600_000);
  });

  it('parental leave appears in weekly summary with correct entry type', async () => {
    const config = makeConfig({ startDate: '2025-11-10' });
    vi.setSystemTime(new Date('2025-11-14T16:00:00.000Z'));
    const summaryManager = new SummaryManager(config);

    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadHolidayEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries').mockResolvedValue([
      {
        id: 'p1',
        startDate: '2025-11-12',
        endDate: '2025-11-12',
        days: 1,
        description: 'Parental',
      },
    ]);

    const result = (await summaryManager.showWeeklySummary({ format: 'json' })) as any;

    const parentalRow = result.rows.find((r: any) => r.date === '2025-11-12');
    expect(parentalRow).toBeDefined();
    expect(parentalRow.entryType).toBe('parental');
    expect(parentalRow.hoursMs).toBe(8 * 3_600_000);
    expect(parentalRow.isVacation).toBe(false);
  });

  it('parental leave does not double-count with holidays', async () => {
    vi.setSystemTime(new Date('2025-01-12T23:59:59.999Z'));
    const config = makeConfig({ startDate: '2025-01-06' });
    const summaryManager = new SummaryManager(config);

    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadSickEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'loadHolidayEntries').mockResolvedValue([
      { id: 'h1', date: '2025-01-06', name: 'Holiday', country: 'DE', region: 'BY' },
    ]);
    vi.spyOn(DataManager.prototype, 'loadParentalLeaveEntries').mockResolvedValue([
      {
        id: 'p1',
        startDate: '2025-01-06',
        endDate: '2025-01-06',
        days: 1,
        description: 'Parental',
      },
    ]);

    const summaryData = await (summaryManager as any).calculateSummaryData();
    // Should count only once (8h), not twice
    expect(summaryData.totalHoursWorked).toBe(8 * 3_600_000);
  });
});
