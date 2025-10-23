import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import { Config, WorkingDay } from './types.js';
import { ConfigManager } from './config-manager.js';

export class SetupWizard {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  async runSetup(): Promise<Config> {
    console.log(chalk.blue.bold('\n🕐 Welcome to Clockin Setup!\n'));
    console.log(chalk.gray('Let\'s configure your time tracking preferences.\n'));

    let setupComplete = false;
    let config: Config;

    while (!setupComplete) {
      config = await this.collectUserInput();

      console.log(chalk.yellow('\n📋 Setup Summary:'));
      this.displaySummary(config);

      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Is this configuration correct?',
          default: true,
        },
      ]);

      if (confirmed) {
        setupComplete = true;
        config.setupCompleted = true;
        await this.configManager.saveConfig(config);
        console.log(chalk.green.bold('\n✅ Setup completed successfully!\n'));
      } else {
        console.log(chalk.yellow('\n🔄 Let\'s start over...\n'));
      }
    }

    return config!;
  }

  private async collectUserInput(): Promise<Config> {
    const defaultConfig = this.configManager.getDefaultConfig();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'What\'s your name?',
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
      {
        type: 'number',
        name: 'hoursPerWeek',
        message: 'How many hours do you work per week?',
        default: 40,
        validate: (input: number) => input > 0 && input <= 168 || 'Please enter a valid number of hours (1-168)',
      },
      {
        type: 'number',
        name: 'vacationDaysPerYear',
        message: 'How many vacation days do you get per year?',
        default: 25,
        validate: (input: number) => input >= 0 && input <= 365 || 'Please enter a valid number of days (0-365)',
      },
    ]);

    const workingDays = await this.collectWorkingDays();
    const dataDirectory = await this.collectDataDirectory();

    return {
      name: answers.name,
      hoursPerWeek: answers.hoursPerWeek,
      vacationDaysPerYear: answers.vacationDaysPerYear,
      workingDays,
      dataDirectory,
      setupCompleted: false,
    };
  }

  private async collectWorkingDays(): Promise<WorkingDay[]> {
    console.log(chalk.blue('\n📅 Configure your working days:'));

    const { useDefault } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useDefault',
        message: 'Use default working days (Monday-Friday)?',
        default: true,
      },
    ]);

    if (useDefault) {
      return this.configManager.getDefaultConfig().workingDays!;
    }

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const workingDays: WorkingDay[] = [];

    for (const day of days) {
      const { isWorkingDay } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'isWorkingDay',
          message: `Is ${day.charAt(0).toUpperCase() + day.slice(1)} a working day?`,
          default: day !== 'saturday' && day !== 'sunday',
        },
      ]);

      workingDays.push({
        day: day as WorkingDay['day'],
        isWorkingDay,
      });
    }

    return workingDays;
  }

  private async collectDataDirectory(): Promise<string> {
    const configManager = new ConfigManager();
    const defaultPath = (await configManager.getCurrentDataDirectory()) || path.join(os.homedir(), 'clockin-data');

    const { useDefault } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useDefault',
        message: `Store data in default directory (${defaultPath})?`,
        default: true,
      },
    ]);

    if (useDefault) {
      return defaultPath;
    }

    const { customPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'customPath',
        message: 'Enter custom data directory path:',
        default: defaultPath,
        validate: (input: string) => {
          const resolvedPath = path.resolve(input);
          return resolvedPath.length > 0 || 'Please enter a valid path';
        },
      },
    ]);

    return path.resolve(customPath);
  }

  private displaySummary(config: Config): void {
    console.log(`${chalk.cyan('Name:')} ${config.name}`);
    console.log(`${chalk.cyan('Hours per week:')} ${config.hoursPerWeek}`);
    console.log(`${chalk.cyan('Vacation days per year:')} ${config.vacationDaysPerYear}`);

    const workingDayNames = config.workingDays
      .filter(day => day.isWorkingDay)
      .map(day => day.day.charAt(0).toUpperCase() + day.day.slice(1))
      .join(', ');
    console.log(`${chalk.cyan('Working days:')} ${workingDayNames}`);
    console.log(`${chalk.cyan('Data directory:')} ${config.dataDirectory}`);
  }
}
