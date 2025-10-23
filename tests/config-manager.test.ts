import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../src/config-manager.js';
import { Config } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let testGlobalConfigDir: string;
  let testDataDir: string;

  beforeEach(async () => {
    // Use completely isolated test directories
    testGlobalConfigDir = '/tmp/test-clockin-global';
    testDataDir = '/tmp/test-clockin-data';

    // Clean up before each test
    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {}

    // Create a ConfigManager instance with test directories
    const testGlobalConfigPath = path.join(testGlobalConfigDir, 'currentConfig.json');
    configManager = new ConfigManager(undefined, testGlobalConfigPath);
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {}
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
      dataDirectory: testDataDir,
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
