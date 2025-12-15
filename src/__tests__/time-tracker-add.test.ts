import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TimeTracker } from '../time-tracker.js';
import { DataManager } from '../data-manager.js';
import { Config, TimeEntry, VacationEntry, SickEntry } from '../types.js';

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

describe('TimeTracker - Manual Time Entry', () => {
  let tempDir: string;
  let config: Config;
  let timeTracker: TimeTracker;
  let dataManager: DataManager;
  let consoleSpy: any;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-time-'));
    config = buildConfig(tempDir);
    timeTracker = new TimeTracker(config);
    dataManager = new DataManager(config);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Input Validation', () => {
    it('rejects invalid date format', async () => {
      await timeTracker.addTimeEntry('invalid-date', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid date format. Please use YYYY-MM-DD format.')
      );
    });

    it('rejects invalid start time format', async () => {
      await timeTracker.addTimeEntry('2025-01-14', 'invalid-time', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid start time format. Please use HH:MM format (24-hour).')
      );
    });

    it('rejects invalid end time format', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', 'invalid-time');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid end time format. Please use HH:MM format (24-hour).')
      );
    });

    it('rejects negative pause time', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00', undefined, -30);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Pause time cannot be negative.')
      );
    });

    it('rejects future dates', async () => {
      const futureDate = '2030-01-01';
      await timeTracker.addTimeEntry(futureDate, '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Cannot add time entries for future dates.')
      );
    });

    it('rejects end time before start time', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '17:00', '09:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ End time must be after start time.')
      );
    });

    it('allows sessions close to but under 24 hours', async () => {
      // Test with 23:59 (23 hours and 59 minutes) which should be allowed
      await timeTracker.addTimeEntry('2025-01-14', '00:00', '23:59', undefined, 0);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Time entry added successfully!')
      );
    });

    it('rejects sessions where pause time exceeds work time', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '10:00', undefined, 120); // 2 hours pause for 1 hour work

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Work session must be longer than the pause time.')
      );
    });
  });

  describe('Conflict Detection', () => {
    it('prevents adding time entry on date with existing time entry', async () => {
      // Add first time entry
      const existingEntry: TimeEntry = {
        id: 'existing-1',
        date: '2025-01-14',
        startTime: '2025-01-14T08:00:00.000Z',
        endTime: '2025-01-14T16:00:00.000Z',
        pauseTime: 0,
        type: 'work',
      };
      await dataManager.saveTimeEntry(existingEntry);

      // Try to add conflicting entry
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ A time entry already exists for Jan 14th, 2025.')
      );
    });

    it('prevents adding time entry on date with vacation', async () => {
      // Add vacation entry
      const vacationEntry: VacationEntry = {
        id: 'vacation-1',
        startDate: '2025-01-14',
        endDate: '2025-01-14',
        days: 1,
        description: 'Personal vacation',
      };
      await dataManager.saveVacationEntry(vacationEntry);

      // Try to add time entry on same date
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '❌ Cannot add time entry: vacation day scheduled for Jan 14th, 2025.'
        )
      );
    });

    it('prevents adding time entry on date within vacation range', async () => {
      // Add multi-day vacation entry
      const vacationEntry: VacationEntry = {
        id: 'vacation-2',
        startDate: '2025-01-13',
        endDate: '2025-01-15',
        days: 3,
        description: 'Multi-day vacation',
      };
      await dataManager.saveVacationEntry(vacationEntry);

      // Try to add time entry on middle day of vacation
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '❌ Cannot add time entry: vacation day scheduled for Jan 14th, 2025.'
        )
      );
    });

    it('prevents adding time entry on date with sick day', async () => {
      // Add sick entry
      const sickEntry: SickEntry = {
        id: 'sick-1',
        startDate: '2025-01-14',
        endDate: '2025-01-14',
        days: 1,
        description: 'Flu',
      };
      await dataManager.saveSickEntry(sickEntry);

      // Try to add time entry on same date
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Cannot add time entry: sick day scheduled for Jan 14th, 2025.')
      );
    });

    it('prevents adding time entry on date within sick day range', async () => {
      // Add multi-day sick entry
      const sickEntry: SickEntry = {
        id: 'sick-2',
        startDate: '2025-01-13',
        endDate: '2025-01-15',
        days: 3,
        description: 'Extended illness',
      };
      await dataManager.saveSickEntry(sickEntry);

      // Try to add time entry on middle day of sick period
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Cannot add time entry: sick day scheduled for Jan 14th, 2025.')
      );
    });
  });

  describe('Successful Entry Creation', () => {
    it('successfully adds a basic time entry', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);
      expect(timeEntries[0].date).toBe('2025-01-14');
      expect(timeEntries[0].pauseTime).toBe(0);
      expect(timeEntries[0].type).toBe('work');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Time entry added successfully!')
      );
    });

    it('successfully adds time entry with description', async () => {
      const description = 'Important project work';
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00', description);

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);
      expect(timeEntries[0].description).toBe(description);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('📝 Description: Important project work')
      );
    });

    it('successfully adds time entry with pause time', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:30', undefined, 30);

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);
      expect(timeEntries[0].pauseTime).toBe(30);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⏸️  Pause time: 30 minutes')
      );
    });

    it('generates unique IDs for entries', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');
      await timeTracker.addTimeEntry('2025-01-15', '09:00', '17:00');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(2);
      expect(timeEntries[0].id).not.toBe(timeEntries[1].id);
    });

    it('correctly handles different time formats', async () => {
      // Test single digit hours
      await timeTracker.addTimeEntry('2025-01-14', '9:00', '17:00');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Time entry added successfully!')
      );
    });

    it('calculates and displays working time correctly', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:30', undefined, 30);

      // Working time should be 8 hours (8.5 - 0.5 pause)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🕐 Working time: 08:00:00'));
    });

    it('allows adding entries on different dates', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');
      await timeTracker.addTimeEntry('2025-01-15', '08:30', '16:30');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(2);
      expect(timeEntries.map((e) => e.date)).toEqual(['2025-01-14', '2025-01-15']);
    });
  });

  describe('Edge Cases', () => {
    it('handles exact boundary times', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '00:00', '23:59', undefined, 0);

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Time entry added successfully!')
      );
    });

    it('handles minimal work session', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '09:01');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries).toHaveLength(1);
    });

    it('preserves timezone information in datetime strings', async () => {
      await timeTracker.addTimeEntry('2025-01-14', '09:00', '17:00');

      const timeEntries = await dataManager.loadTimeEntries();
      expect(timeEntries[0].startTime).toMatch(/T\d{2}:\d{2}:\d{2}/);
      expect(timeEntries[0].endTime).toMatch(/T\d{2}:\d{2}:\d{2}/);
    });
  });
});
