import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { Config, WorkingDay } from './types.js';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only load .env when not under Vitest to avoid overriding .env.test variables
if (!process.env.VITEST) {
  // Determine if we're in development or production
  const isDevelopment = process.env.NODE_ENV === 'development' ||
                       __filename.includes('/src/') ||
                       process.argv[0].includes('tsx');

  if (isDevelopment) {
    // Development: Look for .env.local in project root
    const projectRoot = path.resolve(__dirname, '../..');
    const envLocalPath = path.join(projectRoot, '.env.local');
    dotenv.config({ path: envLocalPath });
  } else {
    // Production: Look for .env in the same directory as the compiled JS
    const envPath = path.join(__dirname, '.env');
    dotenv.config({ path: envPath });
  }
}

export class ConfigManager {
  private configPath: string;
  private globalConfigPath: string;

  constructor(dataDirectory?: string) {

    // Use environment variable or default path
    const configBasePath = process.env.CLOCKIN_CONFIG_PATH || path.join(os.homedir(), '.clockin');
    this.globalConfigPath = path.join(configBasePath, 'currentConfig.json');

    if (dataDirectory) {
      this.configPath = path.join(dataDirectory, '.clockin', 'config.json');
    } else {
      // Will be set after loading global config
      this.configPath = '';
    }
  }

  async ensureConfigDirectory(): Promise<void> {
    const configDir = path.dirname(this.configPath);
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }
  }

  async loadConfig(): Promise<Config | null> {
    // First, try to load from global config pointer
    const currentDataDirectory = await this.getCurrentDataDirectory();
    if (currentDataDirectory) {
      this.configPath = path.join(currentDataDirectory, '.clockin', 'config.json');
    }

    if (!this.configPath) {
      return null;
    }

    try {
      await this.ensureConfigDirectory();
      const data = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(data) as Config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // Config file doesn't exist
      }
      throw error;
    }
  }

  async getCurrentDataDirectory(): Promise<string | null> {
    try {
      const globalConfigDir = path.dirname(this.globalConfigPath);
      await fs.access(globalConfigDir);
    } catch {
      await fs.mkdir(path.dirname(this.globalConfigPath), { recursive: true });
    }

    try {
      const data = await fs.readFile(this.globalConfigPath, 'utf-8');
      const globalConfig = JSON.parse(data);
      return globalConfig.currentDataDirectory;
    } catch {
      // No global config yet, return null instead of default to avoid test pollution
      return null;
    }
  }

  async setCurrentDataDirectory(dataDirectory: string): Promise<void> {
    const globalConfigDir = path.dirname(this.globalConfigPath);
    try {
      await fs.access(globalConfigDir);
    } catch {
      await fs.mkdir(globalConfigDir, { recursive: true });
    }

    const globalConfig = {
      currentDataDirectory: dataDirectory,
    };

    await fs.writeFile(this.globalConfigPath, JSON.stringify(globalConfig, null, 2), 'utf-8');
  }

  async saveConfig(config: Config): Promise<void> {
    // Set the global pointer to this data directory
    await this.setCurrentDataDirectory(config.dataDirectory);

    // Use the data directory from the config for storage in .clockin subdirectory
    this.configPath = path.join(config.dataDirectory, '.clockin', 'config.json');
    await this.ensureConfigDirectory();
    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configPath, data, 'utf-8');
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
      dataDirectory: path.join(os.homedir(), 'clockin-data'),
      setupCompleted: false,
    };
  }
}
