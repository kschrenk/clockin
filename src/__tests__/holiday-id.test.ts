import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock date-holidays so we can control holiday names/types without relying on upstream data.
vi.mock('date-holidays', () => {
  return {
    default: class Holidays {
      init() {
        // no-op
      }

      getHolidays() {
        return [
          {
            date: '2025-01-01 00:00:00',
            name: 'New-Year',
            type: 'public',
          },
          {
            date: '2025-01-01 00:00:00',
            name: 'New Year',
            type: 'public',
          },
        ];
      }
    },
  };
});

import { HolidayManager } from '../holiday-manager.js';
import { DataManager } from '../data-manager.js';
import type { Config } from '../types.js';

describe('HolidayManager ID generation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates collision-safe IDs for names containing hyphens', async () => {
    const config: Config = {
      name: 'Test',
      hoursPerWeek: 40,
      vacationDaysPerYear: 25,
      workingDays: [],
      timezone: 'UTC',
      setupCompleted: true,
      dataDirectory: '/tmp/clockin-test',
      startDate: '2025-01-01',
    };

    const saved: any[] = [];
    vi.spyOn(DataManager.prototype, 'loadHolidayEntries').mockResolvedValue([]);
    vi.spyOn(DataManager.prototype, 'saveHolidayEntry').mockImplementation(async (entry: any) => {
      saved.push(entry);
    });

    const hm = new HolidayManager(config);
    await hm.initHolidays(2025, 'DE', 'BY', true);

    expect(saved).toHaveLength(2);
    expect(saved[0].id).toMatch(/^hol_[0-9a-f]{24}$/);
    expect(saved[1].id).toMatch(/^hol_[0-9a-f]{24}$/);
    expect(saved[0].id).not.toBe(saved[1].id);
  });
});
