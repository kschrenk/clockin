import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import { getDataDirectory } from './getDataDirectory';

describe('getDataDirectory', () => {
  const mockHome = '/mock/home';

  beforeEach(() => {
    vi.spyOn(os, 'homedir').mockReturnValue(mockHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns configPath when provided as absolute path', () => {
    const configPath = '/custom/config/path';
    expect(getDataDirectory(configPath)).toBe('/custom/config/path/clockin-data');
  });

  it('returns os.homedir() when configPath is undefined', () => {
    expect(getDataDirectory(undefined)).toBe(mockHome + '/clockin-data');
  });

  it('returns os.homedir() when configPath is empty string', () => {
    expect(getDataDirectory('')).toBe(mockHome + '/clockin-data');
  });
});
