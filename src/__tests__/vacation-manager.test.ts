import { describe, it, expect } from 'vitest';
import { VacationManager } from '../vacation-manager.js';
import { Config } from '../types.js';

describe('VacationManager', () => {
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
    dataDirectory: '/tmp/test-clockin',
    setupCompleted: true,
  };

  it('should calculate remaining vacation days correctly', async () => {
    const vacationManager = new VacationManager(mockConfig);
    const remaining = await vacationManager.getRemainingVacationDays();

    expect(remaining).toBe(25); // No vacation used yet
  });

  it('should generate unique IDs', () => {
    const vacationManager = new VacationManager(mockConfig);
    const id1 = (vacationManager as any).generateId();
    const id2 = (vacationManager as any).generateId();

    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });
});
