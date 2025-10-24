import { describe, it, expect } from 'vitest';
import { isValidDateString, calculateWorkingTime } from '../date-utils.js';

describe('utils', () => {
  describe('isValidDateString', () => {
    it('should return true for valid ISO date strings', () => {
      expect(isValidDateString('2025-10-24T14:30:41.408+02:00')).toBe(true);
      expect(isValidDateString("22025-10-24'T'14:30:41.408+02:00")).toBe(false);
    });

    it('should return true for various valid date formats', () => {
      expect(isValidDateString('2025-10-24')).toBe(true);
      expect(isValidDateString('2025-10-24T09:00:00Z')).toBe(true);
      expect(isValidDateString('2025-10-24T09:00:00+00:00')).toBe(true);
    });

    it('should return false for invalid dates', () => {
      expect(isValidDateString('invalid-date')).toBe(false);
      expect(isValidDateString('')).toBe(false);
    });
  });

  describe('calculateWorkingTime', () => {
    it('should calculate working time in milliseconds with pause', () => {
      const start = '2025-10-20T09:00:00.000+02:00';
      const end = '2025-10-20T17:00:00.000+02:00';
      const pause = 30; // minutes

      const workingTimeMs = calculateWorkingTime(start, end, pause);
      const expectedMs = (8 * 60 - 30) * 60 * 1000; // 7.5 hours in ms

      expect(workingTimeMs).toBe(expectedMs);
    });

    it('should calculate working time without pause', () => {
      const start = '2025-10-20T09:00:00.000+02:00';
      const end = '2025-10-20T17:00:00.000+02:00';

      const workingTimeMs = calculateWorkingTime(start, end);
      const expectedMs = 8 * 60 * 60 * 1000; // 8 hours in ms

      expect(workingTimeMs).toBe(expectedMs);
    });

    it('should return 0 for invalid date strings', () => {
      const start = 'invalid-date';
      const end = '2025-10-20T17:00:00.000+02:00';

      expect(calculateWorkingTime(start, end)).toBe(0);
      expect(calculateWorkingTime('2025-10-20T09:00:00.000+02:00', 'invalid-date')).toBe(0);
    });

    it('should return 0 for negative working time', () => {
      const start = '2025-10-20T17:00:00.000+02:00';
      const end = '2025-10-20T09:00:00.000+02:00'; // end before start

      expect(calculateWorkingTime(start, end)).toBe(0);
    });

    it('should handle pause time longer than work time', () => {
      const start = '2025-10-20T09:00:00.000+02:00';
      const end = '2025-10-20T10:00:00.000+02:00'; // 1 hour
      const pause = 120; // 2 hours pause

      expect(calculateWorkingTime(start, end, pause)).toBe(0);
    });
  });
});
