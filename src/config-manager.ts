import fs from 'fs/promises';
import path from 'path';
import { Config, WorkingDay } from './types.js';
import { loadConfig } from './loadConfig.js';
import { getDataDirectory } from './helper/getDataDirectory.js';

/*
 * Module-level invocation to load environment variables immediately.
 */
loadConfig();

export class ConfigManager {
  private dataDirectory: string;
  private configFilePath: string;

  constructor() {
    const globalConfigPath = process.env.CLOCKIN_CONFIG_PATH;
    const dataPath = getDataDirectory(globalConfigPath);

    this.dataDirectory = dataPath;
    this.configFilePath = path.join(this.dataDirectory, 'config.json');
  }

  async ensureConfigDirectory(): Promise<void> {
    try {
      await fs.access(this.dataDirectory);
    } catch {
      await fs.mkdir(this.dataDirectory, { recursive: true });
    }
  }

  async loadConfig(): Promise<Config | null> {
    try {
      await this.ensureConfigDirectory();
      const data = await fs.readFile(this.configFilePath, 'utf-8');
      return JSON.parse(data) as Config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // Config file doesn't exist
      }
      throw error;
    }
  }

  async saveConfig(config: Config): Promise<void> {
    await this.ensureConfigDirectory();
    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configFilePath, data, 'utf-8');
  }

  getDefaultConfig(): Partial<Config> {
    const defaultWorkingDays: WorkingDay[] = [
      { day: 'monday', isWorkingDay: true },
      { day: 'tuesday', isWorkingDay: true },
      { day: 'wednesday', isWorkingDay: true },
      { day: 'thursday', isWorkingDay: true },
      { day: 'friday', isWorkingDay: true },
      { day: 'saturday', isWorkingDay: false },
      { day: 'sunday', isWorkingDay: false },
    ];

    return {
      workingDays: defaultWorkingDays,
      dataDirectory: this.dataDirectory,
      timezone: 'Europe/Berlin',
      setupCompleted: false,
    };
  }

  getDataDirectory(): string {
    return this.dataDirectory;
  }

  getDataDirectoryConfigFilePath(): string {
    return this.configFilePath;
  }
}
