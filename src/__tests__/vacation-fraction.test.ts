import { describe, it, expect } from 'vitest';
import { VacationManager } from '../vacation-manager.js';
import { DataManager } from '../data-manager.js';
import { Config } from '../types.js';
import fs from 'fs/promises';

const dataDir = '/tmp/test-clockin-fraction';

describe('VacationManager fractional days', () => {
  const mockConfig: Config = {
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

  it('stores a half day vacation correctly', async () => {
    // Clean up before test
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch {}
    const vacationManager = new VacationManager(mockConfig);
    await vacationManager.addVacation(0.5, '2025-01-06'); // Monday

    const dataManager = new DataManager(mockConfig);
    const vacations = await dataManager.loadVacationEntries();
    expect(vacations.length).toBe(1);
    expect(vacations[0].days).toBeCloseTo(0.5, 5);
    expect(vacations[0].startDate).toBe('2025-01-06');
    expect(vacations[0].endDate).toBe('2025-01-06');
  });
});
