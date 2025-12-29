import inquirer from 'inquirer';
import chalk from 'chalk';

import { Config, WorkingDay } from './types.js';
import { ConfigManager } from './config-manager.js';
import { HolidayManager } from './holiday-manager.js';
import { dayjs } from './date-utils.js';

export class SetupWizard {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  async runSetup(): Promise<Config> {
    console.log(chalk.blue.bold('\n🕐 Welcome to Clockin Setup!\n'));
    console.log(chalk.gray("Let's configure your time tracking preferences.\n"));

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

        await this.maybeInitializeHolidays(config);
      } else {
        console.log(chalk.yellow("\n🔄 Let's start over...\n"));
      }
    }

    return config!;
  }

  private async maybeInitializeHolidays(config: Config): Promise<void> {
    const { initHolidays } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'initHolidays',
        message: 'Initialize your holiday calendar now? (recommended)',
        default: true,
      },
    ]);

    if (!initHolidays) return;

    const { country, region } = await inquirer.prompt([
      {
        type: 'input',
        name: 'country',
        message: 'Holiday country code (e.g., DE, US):',
        default: 'DE',
        validate: (input: string) =>
          /^[A-Za-z]{2}$/.test(input.trim()) || 'Please enter a valid 2-letter country code',
        filter: (input: string) => input.trim().toUpperCase(),
      },
      {
        type: 'input',
        name: 'region',
        message: 'Holiday region/state code (e.g., BY for Bavaria, CA for California):',
        default: 'BY',
        validate: (input: string) => input.trim().length > 0 || 'Region cannot be empty',
        filter: (input: string) => input.trim().toUpperCase(),
      },
    ]);

    const holidayManager = new HolidayManager(config);
    const now = dayjs();
    const yearsToInit = [now.year(), now.year() + 1];

    try {
      for (const year of yearsToInit) {
        await holidayManager.initHolidays(year, country, region);
      }
      console.log(
        chalk.green(
          `✅ Holidays initialized for ${country}-${region} (${yearsToInit[0]} and ${yearsToInit[1]}).\n`
        )
      );
    } catch (err) {
      // Non-fatal: setup should succeed even if holiday initialization fails.
      console.log(
        chalk.yellow(
          '⚠️  Setup completed, but holiday initialization failed. You can run `clockin holidays` later to try again.'
        )
      );
      console.log(chalk.gray(String(err)));
    }
  }

  private async collectUserInput(): Promise<Config> {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: "What's your name?",
        validate: (input: string) => input.trim().length > 0 || 'Name cannot be empty',
      },
      {
        type: 'number',
        name: 'hoursPerWeek',
        message: 'How many hours do you work per week?',
        default: 40,
        validate: (input: number) =>
          (input > 0 && input <= 168) || 'Please enter a valid number of hours (1-168)',
      },
      {
        type: 'number',
        name: 'vacationDaysPerYear',
        message: 'How many vacation days do you get per year?',
        default: 25,
        validate: (input: number) =>
          (input >= 0 && input <= 365) || 'Please enter a valid number of days (0-365)',
      },
      {
        type: 'input',
        name: 'startDate',
        message: 'What is your first day of work? (YYYY-MM-DD, press Enter to use today)',
        default: new Date().toISOString().split('T')[0],
        validate: (input: string) => {
          if (!input.trim()) return true;
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(input)) return 'Please enter a valid date in YYYY-MM-DD format';
          const date = new Date(input);
          if (isNaN(date.getTime())) return 'Please enter a valid date';
          return true;
        },
      },
    ]);

    const timezone = await this.collectTimezone();
    const workingDays = await this.collectWorkingDays();
    const dataDirectory = await this.collectDataDirectory();

    return {
      name: answers.name,
      hoursPerWeek: answers.hoursPerWeek,
      vacationDaysPerYear: answers.vacationDaysPerYear,
      startDate: answers.startDate,
      timezone,
      workingDays,
      setupCompleted: false,
      dataDirectory,
    };
  }

  private async collectTimezone(): Promise<string> {
    console.log(chalk.blue('\n🌍 Configure your timezone:'));

    const commonTimezones = [
      { name: 'Europe/Berlin (GMT+1/+2)', value: 'Europe/Berlin' },
      { name: 'Europe/London (GMT+0/+1)', value: 'Europe/London' },
      { name: 'Europe/Paris (GMT+1/+2)', value: 'Europe/Paris' },
      { name: 'America/New_York (EST/EDT)', value: 'America/New_York' },
      { name: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
      { name: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
      { name: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
      { name: 'Asia/Shanghai (CST)', value: 'Asia/Shanghai' },
      { name: 'Australia/Sydney (AEST/AEDT)', value: 'Australia/Sydney' },
      { name: 'UTC (Coordinated Universal Time)', value: 'UTC' },
      { name: 'Custom timezone...', value: 'custom' },
    ];

    const { timezone } = await inquirer.prompt([
      {
        type: 'list',
        name: 'timezone',
        message: 'Select your timezone:',
        choices: commonTimezones,
        default: 'Europe/Berlin',
      },
    ]);

    if (timezone === 'custom') {
      const { customTimezone } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customTimezone',
          message: 'Enter your timezone (e.g., Europe/Berlin, America/New_York):',
          default: 'Europe/Berlin',
          validate: (input: string) => {
            // Basic validation for timezone format
            const timezoneRegex = /^[A-Za-z_]+\/[A-Za-z_]+$/;
            return (
              timezoneRegex.test(input) || input === 'UTC' || 'Please enter a valid timezone format'
            );
          },
        },
      ]);
      return customTimezone;
    }

    return timezone;
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
    return configManager.getDataDirectory();
  }

  private displaySummary(config: Config): void {
    console.log(`${chalk.cyan('Name:')} ${config.name}`);
    console.log(`${chalk.cyan('Hours per week:')} ${config.hoursPerWeek}`);
    console.log(`${chalk.cyan('Vacation days per year:')} ${config.vacationDaysPerYear}`);
    console.log(`${chalk.cyan('Start date:')} ${config.startDate || 'Not set'}`);
    console.log(`${chalk.cyan('Timezone:')} ${config.timezone}`);

    const workingDayNames = config.workingDays
      .filter((day) => day.isWorkingDay)
      .map((day) => day.day.charAt(0).toUpperCase() + day.day.slice(1))
      .join(', ');
    console.log(`${chalk.cyan('Working days:')} ${workingDayNames}`);
    console.log(`${chalk.cyan('Data directory:')} ${config.dataDirectory}`);
  }
}
