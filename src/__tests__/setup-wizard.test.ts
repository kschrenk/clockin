import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import inquirer from 'inquirer';
import { SetupWizard } from '../setup-wizard.js';
import { ConfigManager } from '../config-manager.js';
import { HolidayManager } from '../holiday-manager.js';

// These tests validate that the setup wizard optionally initializes holidays.
// We mock prompts + persistence to keep this unit-level (no filesystem writes).

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes holidays for current and next year when user opts in', async () => {
    // Force "current date" to Dec 29, 2025 so we expect 2025 + 2026.
    vi.setSystemTime(new Date('2025-12-29T12:00:00.000Z'));

    // Mock prompts in the exact order SetupWizard calls them.
    // 1) collectUserInput (name/hours/vacation/startDate)
    // 2) collectTimezone
    // 3) collectWorkingDays (useDefault)
    // 4) confirm summary
    // 5) init holidays confirm
    // 6) country/region
    const promptSpy = vi
      .spyOn(inquirer, 'prompt' as any)
      .mockImplementation(async (questions: any) => {
        const q = Array.isArray(questions) ? questions : [questions];
        const names = q.map((x) => x.name);

        if (names.includes('name')) {
          return {
            name: 'Test User',
            hoursPerWeek: 40,
            vacationDaysPerYear: 25,
            startDate: '2025-01-01',
          };
        }

        if (names.includes('timezone')) {
          return { timezone: 'Europe/Berlin' };
        }

        if (names.includes('useDefault')) {
          return { useDefault: true };
        }

        if (names.includes('confirmed')) {
          return { confirmed: true };
        }

        if (names.includes('initHolidays')) {
          return { initHolidays: true };
        }

        if (names.includes('country') && names.includes('region')) {
          return { country: 'DE', region: 'BY' };
        }

        throw new Error(`Unexpected prompt: ${names.join(',')}`);
      });

    // Avoid filesystem writes.
    vi.spyOn(ConfigManager.prototype, 'saveConfig').mockResolvedValue();

    // Avoid actually generating and writing holidays.
    const initSpy = vi.spyOn(HolidayManager.prototype, 'initHolidays').mockResolvedValue();

    const wizard = new SetupWizard();
    const config = await wizard.runSetup();

    expect(config.setupCompleted).toBe(true);

    expect(initSpy).toHaveBeenCalledWith(2025, 'DE', 'BY');
    expect(initSpy).toHaveBeenCalledWith(2026, 'DE', 'BY');

    // Ensure we did prompt (sanity check that our mocks executed)
    expect(promptSpy).toHaveBeenCalled();
  });

  it('does not initialize holidays when user opts out', async () => {
    vi.setSystemTime(new Date('2025-12-29T12:00:00.000Z'));

    vi.spyOn(inquirer, 'prompt' as any).mockImplementation(async (questions: any) => {
      const q = Array.isArray(questions) ? questions : [questions];
      const names = q.map((x) => x.name);

      if (names.includes('name')) {
        return {
          name: 'Test User',
          hoursPerWeek: 40,
          vacationDaysPerYear: 25,
          startDate: '2025-01-01',
        };
      }

      if (names.includes('timezone')) {
        return { timezone: 'Europe/Berlin' };
      }

      if (names.includes('useDefault')) {
        return { useDefault: true };
      }

      if (names.includes('confirmed')) {
        return { confirmed: true };
      }

      if (names.includes('initHolidays')) {
        return { initHolidays: false };
      }

      // If we opted out, no further holiday prompts should happen.
      if (names.includes('country') || names.includes('region')) {
        throw new Error('Should not ask for country/region when initHolidays is false');
      }

      throw new Error(`Unexpected prompt: ${names.join(',')}`);
    });

    vi.spyOn(ConfigManager.prototype, 'saveConfig').mockResolvedValue();
    const initSpy = vi.spyOn(HolidayManager.prototype, 'initHolidays').mockResolvedValue();

    const wizard = new SetupWizard();
    const config = await wizard.runSetup();

    expect(config.setupCompleted).toBe(true);
    expect(initSpy).not.toHaveBeenCalled();
  });
});
