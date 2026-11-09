import { describe, it, expect } from 'vitest';
import {
  looksLikeDate,
  normalizeDate,
  parseDayCount,
  parseWeekNumber,
  resolveDescriptionAndDate,
} from '../cli-utils.js';

describe('cli-utils', () => {
  describe('parseDayCount', () => {
    it('accepts plain positive numbers', () => {
      expect(parseDayCount('3')).toBe(3);
      expect(parseDayCount('0.5')).toBe(0.5);
    });

    it('rejects date-like input instead of truncating it', () => {
      expect(parseDayCount('2026-11-2')).toBeNull();
      expect(parseDayCount('2026-11-02')).toBeNull();
    });

    it('rejects non-numeric, zero and negative input', () => {
      expect(parseDayCount('5abc')).toBeNull();
      expect(parseDayCount('')).toBeNull();
      expect(parseDayCount('0')).toBeNull();
      expect(parseDayCount('-1')).toBeNull();
    });
  });

  describe('looksLikeDate', () => {
    it('matches padded and unpadded dates', () => {
      expect(looksLikeDate('2026-11-02')).toBe(true);
      expect(looksLikeDate('2026-11-2')).toBe(true);
      expect(looksLikeDate('Flu')).toBe(false);
    });
  });

  describe('normalizeDate', () => {
    it('zero-pads month and day', () => {
      expect(normalizeDate('2026-11-2')).toBe('2026-11-02');
      expect(normalizeDate('2026-1-5')).toBe('2026-01-05');
      expect(normalizeDate('2026-11-02')).toBe('2026-11-02');
    });

    it('rejects non-existent or malformed dates', () => {
      expect(normalizeDate('2026-13-40')).toBeNull();
      expect(normalizeDate('2026-02-30')).toBeNull();
      expect(normalizeDate('tomorrow')).toBeNull();
    });
  });

  describe('resolveDescriptionAndDate', () => {
    it('treats an unpadded date in the description slot as the start date', () => {
      expect(resolveDescriptionAndDate('2026-11-2')).toEqual({
        description: undefined,
        startDate: '2026-11-2',
      });
    });

    it('keeps description and start date when both are given', () => {
      expect(resolveDescriptionAndDate('Flu', '2026-1-5')).toEqual({
        description: 'Flu',
        startDate: '2026-1-5',
      });
    });

    it('keeps a regular description', () => {
      expect(resolveDescriptionAndDate('Flu')).toEqual({
        description: 'Flu',
        startDate: undefined,
      });
    });
  });

  describe('parseWeekNumber', () => {
    it('accepts integer weeks within the year', () => {
      expect(parseWeekNumber('1', 2025)).toBe(1);
      expect(parseWeekNumber('52', 2025)).toBe(52);
      expect(parseWeekNumber('53', 2026)).toBe(53);
    });

    it('rejects out-of-range and malformed weeks', () => {
      expect(parseWeekNumber('0', 2025)).toBeNull();
      expect(parseWeekNumber('53', 2025)).toBeNull();
      expect(parseWeekNumber('4.5', 2025)).toBeNull();
      expect(parseWeekNumber('abc', 2025)).toBeNull();
      expect(parseWeekNumber('-1', 2025)).toBeNull();
    });
  });
});
