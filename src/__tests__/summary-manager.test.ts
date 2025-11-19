import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SummaryManager, WeeklySummaryResult } from '../summary-manager.js';
import { Config, TimeEntry, VacationEntry } from '../types.js';
import fs from 'fs/promises';
import { DataManager } from '../data-manager';

const mockTimeEntries: TimeEntry[] = [
  // Monday - 7 hours work (09:00-17:00 with 60m break => 7h)
  {
    id: '1',
    date: '2025-11-10',
    startTime: '2025-11-10T09:00:00.000Z',
    endTime: '2025-11-10T17:00:00.000Z',
    pauseTime: 60,
    type: 'work',
    description: 'Development work',
  },
  // Tuesday - 7 hours work
  {
    id: '2',
    date: '2025-11-11',
    startTime: '2025-11-11T09:00:00.000Z',
    endTime: '2025-11-11T17:00:00.000Z',
    pauseTime: 60,
    type: 'work',
    description: 'Development work',
  },
];

describe('SummaryManager (JSON weekly summary)', () => {
  let summaryManager: SummaryManager;
  let testGlobalConfigDir: string;

  beforeEach(async () => {
    // Fixed system time: Friday of target week
    vi.setSystemTime(new Date('2025-11-14T16:00:00.000Z'));

    testGlobalConfigDir = process.env.CLOCKIN_CONFIG_PATH!;

    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
    } catch {}

    const testConfig: Config = {
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
      dataDirectory: testGlobalConfigDir,
      setupCompleted: true,
      timezone: 'Europe/Berlin',
    };

    summaryManager = new SummaryManager(testConfig);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
    } catch {}
  });

  it('returns correct weekly JSON summary without vacation', async () => {
    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue(mockTimeEntries);
    // Explicitly mock vacation entries to empty to avoid file access
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([]);

    const result = (await summaryManager.showWeeklySummary({
      format: 'json',
    })) as WeeklySummaryResult;

    expect(result.weekStart).toBe('2025-11-10');
    expect(result.weekEnd).toBe('2025-11-16');
    expect(result.rows.length).toBe(2); // Monday + Tuesday

    const monday = result.rows.find((r) => r.date === '2025-11-10');
    const tuesday = result.rows.find((r) => r.date === '2025-11-11');

    expect(monday).toBeDefined();
    expect(tuesday).toBeDefined();

    // 7 hours -> 7 * 3600000
    expect(monday!.hoursMs).toBe(7 * 3_600_000);
    expect(tuesday!.hoursMs).toBe(7 * 3_600_000);

    expect(result.totalWeeklyHoursMs).toBe(14 * 3_600_000);
    expect(result.totalWeeklyHoursFormatted).toBe('14:00');
    expect(result.expectedWeeklyHours).toBe(40);
    expect(result.differenceHours).toBe(-26);
    expect(result.differenceFormatted).toBe('-26.0h');
    expect(result.overtime).toBe(false);
    expect(result.undertime).toBe(true);
  });

  it('includes vacation day and aggregates hours correctly', async () => {
    const vacationEntry: VacationEntry = {
      id: 'v1',
      startDate: '2025-11-12',
      endDate: '2025-11-12',
      days: 1,
      description: 'Vacation',
    };

    vi.spyOn(DataManager.prototype, 'loadTimeEntries').mockResolvedValue(mockTimeEntries);
    vi.spyOn(DataManager.prototype, 'loadVacationEntries').mockResolvedValue([vacationEntry]);

    const result = (await summaryManager.showWeeklySummary({
      format: 'json',
    })) as WeeklySummaryResult;

    // Rows: Monday work, Tuesday work, Wednesday vacation
    expect(result.rows.length).toBe(3);

    const workRows = result.rows.filter((r) => r.entryType === 'work');
    const vacationRows = result.rows.filter((r) => r.entryType === 'vacation');

    expect(workRows.length).toBe(2);
    expect(vacationRows.length).toBe(1);

    // Vacation credited hours per day: 40h / 5 working days = 8h
    expect(vacationRows[0].hoursMs).toBe(8 * 3_600_000);
    expect(vacationRows[0].hoursFormatted).toBe('08:00');

    // Total weekly: 7 + 7 + 8 = 22h
    expect(result.totalWeeklyHoursMs).toBe(22 * 3_600_000);
    expect(result.totalWeeklyHoursFormatted).toBe('22:00');
    expect(result.differenceHours).toBe(-18);
    expect(result.differenceFormatted).toBe('-18.0h');
    expect(result.overtime).toBe(false);
    expect(result.undertime).toBe(true);
  });
});
