import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../config-manager.js';
import { Config } from '../types.js';
import fs from 'fs/promises';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let testGlobalConfigDir: string;

  beforeEach(async () => {
    // Read test directories from environment (set via .env.test loaded by Vitest)
    testGlobalConfigDir = process.env.CLOCKIN_CONFIG_PATH!;

    console.log('🚀', { testGlobalConfigDir });

    // Clean up before each test to ensure isolation
    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
    } catch {}

    // Instantiate ConfigManager (will use env-based global config path implicitly)
    configManager = new ConfigManager();
  });

  afterEach(async () => {
    // Clean up created test directories
    try {
      await fs.rm(testGlobalConfigDir, { recursive: true, force: true });
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
      dataDirectory: testGlobalConfigDir,
      setupCompleted: true,
      timezone: 'Europe/Berlin',
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
