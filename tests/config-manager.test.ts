import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../src/config-manager.js';
import { Config } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let testConfigPath: string;

  beforeEach(() => {
    configManager = new ConfigManager();
    testConfigPath = path.join(os.homedir(), '.clockin', 'config.json');
  });

  afterEach(async () => {
    // Clean up test config file
    try {
      await fs.unlink(testConfigPath);
    } catch {
      // File doesn't exist, which is fine
    }
  });

  it('should create default config', () => {
    const defaultConfig = configManager.getDefaultConfig();

    expect(defaultConfig.workingDays).toBeDefined();
    expect(defaultConfig.workingDays).toHaveLength(7);
    expect(defaultConfig.dataDirectory).toBeDefined();
    expect(defaultConfig.setupCompleted).toBe(false);
  });

  it('should save and load config', async () => {
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
      dataDirectory: '/tmp/test-clockin',
      setupCompleted: true,
    };

    await configManager.saveConfig(testConfig);
    const loadedConfig = await configManager.loadConfig();

    expect(loadedConfig).toEqual(testConfig);
  });

  it('should return null for non-existent config', async () => {
    const config = await configManager.loadConfig();
    expect(config).toBeNull();
  });
});
