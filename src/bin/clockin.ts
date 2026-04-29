#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import Table from 'cli-table3';
import { ConfigManager } from '../config-manager.js';
import { SetupWizard } from '../setup-wizard.js';
import { TimeTracker } from '../time-tracker.js';
import { VacationManager } from '../vacation-manager.js';
import { SickManager } from '../sick-manager.js';
import { ParentalLeaveManager } from '../parental-leave-manager.js';
import { SummaryManager } from '../summary-manager.js';
import { HolidayManager } from '../holiday-manager.js';
import { dayjs } from '../date-utils.js';

const program = new Command();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** When the user omits description and passes a date as the second arg, remap it. */
function resolveDescriptionAndDate(
  description?: string,
  startDate?: string
): { description: string | undefined; startDate: string | undefined } {
  if (startDate === undefined && description !== undefined && ISO_DATE_RE.test(description)) {
    return { description: undefined, startDate: description };
  }
  return { description, startDate };
}

async function ensureSetup() {
  const configManager = new ConfigManager();
  let config = await configManager.loadConfig();

  if (!config || !config.setupCompleted) {
    console.log(chalk.yellow("⚠️  Clockin is not set up yet. Let's get started!"));
    const setupWizard = new SetupWizard();
    config = await setupWizard.runSetup();
  }

  return config;
}

program
  .name('clockin')
  .description('A CLI app to track working hours and manage vacation time')
  .version('1.0.0');

program
  .command('start')
  .description('Start tracking time')
  .action(async () => {
    try {
      const config = await ensureSetup();
      const timeTracker = new TimeTracker(config);
      await timeTracker.startTracking();
    } catch (error) {
      console.log(chalk.red('❌ Error starting time tracking:'), error);
    }
  });

program
  .command('pause')
  .description('Pause the current tracking session')
  .action(async () => {
    try {
      const config = await ensureSetup();
      const timeTracker = new TimeTracker(config);
      await timeTracker.pauseTracking();
    } catch (error) {
      console.log(chalk.red('❌ Error pausing time tracking:'), error);
    }
  });

program
  .command('resume')
  .description('Resume the paused tracking session')
  .action(async () => {
    try {
      const config = await ensureSetup();
      const timeTracker = new TimeTracker(config);
      await timeTracker.resumeTracking();
    } catch (error) {
      console.log(chalk.red('❌ Error resuming time tracking:'), error);
    }
  });

program
  .command('stop')
  .description('Stop the current tracking session')
  .action(async () => {
    try {
      const config = await ensureSetup();
      const timeTracker = new TimeTracker(config);
      await timeTracker.stopTracking();
    } catch (error) {
      console.log(chalk.red('❌ Error stopping time tracking:'), error);
    }
  });

program
  .command('summary')
  .description('Show work summary')
  .option('-w, --week', 'Show weekly summary')
  .option('-c, --csv', 'Open CSV file with time data')
  .option('-j, --json', 'Output weekly summary as JSON (use with --week)')
  .option('-l, --leaves', 'Show unified leave summary (vacation, sick, parental)')
  .option('-y, --year <year>', 'Show summary for a specific year (defaults to current year)')
  .action(async (options) => {
    try {
      const config = await ensureSetup();
      const summaryManager = new SummaryManager(config);

      if (options.csv) {
        await summaryManager.openCsvFile();
      } else if (options.week) {
        if (options.json) {
          const result = await summaryManager.showWeeklySummary({ format: 'json' });
          console.log(JSON.stringify(result, null, 2));
        } else {
          await summaryManager.showWeeklySummary();
        }
      } else if (options.leaves) {
        const year = options.year ? parseInt(options.year, 10) : undefined;
        if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
          console.log(chalk.red('❌ Invalid year. Please provide a year between 2000 and 2100.'));
          return;
        }
        await summaryManager.showLeaveSummary({ year });
      } else {
        const year = options.year ? parseInt(options.year, 10) : undefined;
        if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
          console.log(chalk.red('❌ Invalid year. Please provide a year between 2000 and 2100.'));
          return;
        }
        await summaryManager.showSummary({ year });
      }
    } catch (error) {
      console.log(chalk.red('❌ Error showing summary:'), error);
    }
  });

const vacationCommand = program.command('vacation').description('Manage vacation days');

vacationCommand
  .command('add <days> [start_date]')
  .description('Add vacation days (start_date optional, defaults to today)')
  .addHelpText(
    'after',
    `
Examples:
  clockin vacation add 5                      # Add 5 vacation days starting today
  clockin vacation add 3 2025-01-15          # Add 3 vacation days starting Jan 15th`
  )
  .action(async (days: string, startDate?: string) => {
    try {
      const config = await ensureSetup();
      const vacationManager = new VacationManager(config);
      const numDays = parseFloat(days);

      if (isNaN(numDays) || numDays <= 0) {
        console.log(chalk.red('❌ Invalid number of days. Please enter a positive number.'));
        return;
      }

      await vacationManager.addVacation(numDays, startDate);
    } catch (error) {
      console.log(chalk.red('❌ Error adding vacation:'), error);
    }
  });

vacationCommand
  .command('list')
  .description('List vacation entries for a given year (defaults to current year)')
  .option('-y, --year <year>', 'Year to list vacations for')
  .action(async (options: { year?: string }) => {
    try {
      const config = await ensureSetup();
      const vacationManager = new VacationManager(config);

      const year = options.year ? parseInt(options.year, 10) : undefined;
      if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
        console.log(chalk.red('❌ Invalid year. Please provide a year between 2000 and 2100.'));
        return;
      }

      await vacationManager.listVacations(year);
    } catch (error) {
      console.log(chalk.red('❌ Error listing vacations:'), error);
    }
  });

vacationCommand
  .command('range <start_date> <end_date>')
  .description('Add vacation days for a date range (YYYY-MM-DD format)')
  .action(async (startDate: string, endDate: string) => {
    try {
      const config = await ensureSetup();
      const vacationManager = new VacationManager(config);
      await vacationManager.addVacationRange(startDate, endDate);
    } catch (error) {
      console.log(chalk.red('❌ Error adding vacation range:'), error);
    }
  });

const sickCommand = program.command('sick').description('Manage sick days');

sickCommand
  .command('add <days> [description] [start_date]')
  .description('Add sick days (description and start_date optional, start_date defaults to today)')
  .addHelpText(
    'after',
    `
Examples:
  clockin sick add 1                          # Add 1 sick day starting today
  clockin sick add 2 "Flu"                    # Add 2 sick days with description
  clockin sick add 3 "Food poisoning" 2025-01-15  # Add 3 sick days starting Jan 15th
  clockin sick add 1 "" 2025-12-10            # Add 1 sick day on specific date (no description)`
  )
  .action(async (days: string, rawDescription?: string, rawStartDate?: string) => {
    try {
      const config = await ensureSetup();
      const sickManager = new SickManager(config);
      const numDays = parseFloat(days);

      if (isNaN(numDays) || numDays <= 0) {
        console.log(chalk.red('❌ Invalid number of days. Please enter a positive number.'));
        return;
      }

      const { description, startDate } = resolveDescriptionAndDate(rawDescription, rawStartDate);
      await sickManager.addSickDays(numDays, description, startDate);
    } catch (error) {
      console.log(chalk.red('❌ Error adding sick days:'), error);
    }
  });

sickCommand
  .command('list')
  .description('List sick day entries for a given year (defaults to current year)')
  .option('-y, --year <year>', 'Year to list sick days for')
  .action(async (options: { year?: string }) => {
    try {
      const config = await ensureSetup();
      const sickManager = new SickManager(config);
      const year = options.year ? parseInt(options.year, 10) : undefined;

      if (year !== undefined && isNaN(year)) {
        console.log(chalk.red('❌ Invalid year. Please enter a valid year (e.g. 2025).'));
        return;
      }

      await sickManager.listSickDays(year);
    } catch (error) {
      console.log(chalk.red('❌ Error listing sick days:'), error);
    }
  });

const parentalCommand = program.command('parental').description('Manage parental leave days');

parentalCommand
  .command('add <days> [description] [start_date]')
  .description('Add parental leave days (consecutive calendar days, defaults to today)')
  .addHelpText(
    'after',
    `
Examples:
  clockin parental add 30                          # Add 30 parental leave days starting today
  clockin parental add 60 "Maternity leave"        # Add 60 days with note
  clockin parental add 14 "Paternity" 2025-06-01  # Add 14 days starting June 1st`
  )
  .action(async (days: string, rawDescription?: string, rawStartDate?: string) => {
    try {
      const config = await ensureSetup();
      const manager = new ParentalLeaveManager(config);
      const numDays = parseFloat(days);

      if (isNaN(numDays) || numDays <= 0) {
        console.log(chalk.red('❌ Invalid number of days. Please enter a positive number.'));
        return;
      }

      const { description, startDate } = resolveDescriptionAndDate(rawDescription, rawStartDate);
      await manager.addParentalLeave(numDays, description, startDate);
    } catch (error) {
      console.log(chalk.red('❌ Error adding parental leave:'), error);
    }
  });

parentalCommand
  .command('list')
  .description('List parental leave entries for a given year (defaults to current year)')
  .option('-y, --year <year>', 'Year to list parental leave for')
  .action(async (options: { year?: string }) => {
    try {
      const config = await ensureSetup();
      const manager = new ParentalLeaveManager(config);
      const year = options.year ? parseInt(options.year, 10) : undefined;

      if (year !== undefined && isNaN(year)) {
        console.log(chalk.red('❌ Invalid year. Please enter a valid year (e.g. 2025).'));
        return;
      }

      await manager.listParentalLeave(year);
    } catch (error) {
      console.log(chalk.red('❌ Error listing parental leave:'), error);
    }
  });

program
  .command('setup')
  .description('Run the setup wizard again')
  .action(async () => {
    try {
      const setupWizard = new SetupWizard();
      await setupWizard.runSetup();
    } catch (error) {
      console.log(chalk.red('❌ Error running setup:'), error);
    }
  });

program
  .command('reset')
  .description('Reset all configuration and start fresh')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      if (!options.force) {
        const inquirer = (await import('inquirer')).default;
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'This will delete all configuration and data. Are you sure?',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.yellow('Reset cancelled.'));
          return;
        }
      }

      // Try to clear current target directory config
      try {
        const configManager = new ConfigManager();
        const currentDataDir = configManager.getDataDirectory();
        await fs.rm(currentDataDir, { recursive: true, force: true });
        console.log(chalk.green(`✅ Cleared data directory: ${currentDataDir}`));
      } catch (error) {
        // Ignore if can't determine or clean current config
      }

      console.log(chalk.green('✅ Configuration reset successfully!'));
      console.log(chalk.yellow('Starting fresh setup...\n'));

      const setupWizard = new SetupWizard();
      await setupWizard.runSetup();
    } catch (error) {
      console.log(chalk.red('❌ Error resetting configuration:'), error);
    }
  });

program
  .command('timer')
  .description('Show the live timer for the current session')
  .action(async () => {
    try {
      const config = await ensureSetup();
      const timeTracker = new TimeTracker(config);
      await timeTracker.displayTimer();
    } catch (error) {
      console.log(chalk.red('❌ Error displaying timer:'), error);
    }
  });

program
  .command('add <date> <start_time> <end_time> [description]')
  .description('Add a time entry manually (YYYY-MM-DD HH:MM HH:MM format)')
  .option('-p, --pause <minutes>', 'Pause time in minutes', '0')
  .addHelpText(
    'after',
    `
Examples:
  clockin add 2025-01-14 09:00 17:30                    # Add 8.5 hour work day
  clockin add 2025-01-14 09:00 17:30 "Project work"     # Add with description
  clockin add 2025-01-14 09:00 17:30 -p 30              # Add with 30 minutes pause
  clockin add 2025-01-14 09:00 17:30 "Meeting day" -p 45 # Add with description and pause
`
  )
  .action(
    async (
      date: string,
      startTime: string,
      endTime: string,
      description?: string,
      options?: { pause?: string }
    ) => {
      try {
        const config = await ensureSetup();
        const timeTracker = new TimeTracker(config);

        const pauseMinutes = options?.pause ? parseInt(options.pause, 10) : 0;

        if (isNaN(pauseMinutes)) {
          console.log(chalk.red('❌ Invalid pause time. Please enter a valid number of minutes.'));
          return;
        }

        await timeTracker.addTimeEntry(date, startTime, endTime, description, pauseMinutes);
      } catch (error) {
        console.log(chalk.red('❌ Error adding time entry:'), error);
      }
    }
  );

program
  .command('pause-entry [date]')
  .description('Set or auto-suggest pause time for an existing time entry')
  .option('--minutes <minutes>', 'Set pause time in minutes for the selected entry')
  .option(
    '--suggest',
    'Auto-calculate pause as (worked minutes - daily target) for the selected entry'
  )
  .option('--index <index>', 'Non-interactive selection index (sorted by start time)')
  .addHelpText(
    'after',
    `
Notes:
  - You must provide either --minutes <minutes> (set an explicit pause) OR --suggest (auto-calculate).
  - If [date] is omitted, it defaults to today.

Examples:
  clockin pause-entry --minutes 30                 # Select from today's entries and set pause to 30 minutes
  clockin pause-entry 2025-01-14 --minutes 30      # Select from entries on a specific date and set pause
  clockin pause-entry --suggest                    # Select from today's entries and set pause to overtime minutes
  clockin pause-entry 2025-01-14 --suggest         # Same, but for a specific date
  clockin pause-entry 2025-01-14 --suggest --index 0 # Non-interactive selection
`
  )
  .action(
    async (date?: string, options?: { minutes?: string; suggest?: boolean; index?: string }) => {
      try {
        const config = await ensureSetup();
        const timeTracker = new TimeTracker(config);

        const targetDate = date || dayjs().format('YYYY-MM-DD');
        const index = options?.index !== undefined ? parseInt(options.index, 10) : undefined;

        if (options?.suggest) {
          await timeTracker.addSuggestedPauseToExistingEntry(targetDate, {
            index: Number.isFinite(index) ? index : undefined,
          });
          return;
        }

        if (options?.minutes !== undefined) {
          const pauseMinutes = parseInt(options.minutes, 10);
          if (isNaN(pauseMinutes) || pauseMinutes < 0) {
            console.log(
              chalk.red('❌ Invalid pause minutes. Please provide a non-negative number.')
            );
            return;
          }

          await timeTracker.addPauseToExistingEntry(pauseMinutes, targetDate, {
            index: Number.isFinite(index) ? index : undefined,
          });
          return;
        }

        console.log(
          chalk.yellow('⚠️  Please provide either --minutes <minutes> or --suggest to set a pause.')
        );
      } catch (error) {
        console.log(chalk.red('❌ Error updating pause time:'), error);
      }
    }
  );

program
  .command('whoami')
  .description('Show current user settings and configuration')
  .action(async () => {
    try {
      const config = await ensureSetup();

      console.log(chalk.blue.bold('\n👤 Current User Configuration\n'));

      const table = new Table({
        head: [chalk.cyan('Setting'), chalk.cyan('Value')],
        colWidths: [25, 50],
      });

      const workingDayNames = config.workingDays
        .filter((day) => day.isWorkingDay)
        .map((day) => day.day.charAt(0).toUpperCase() + day.day.slice(1))
        .join(', ');

      table.push(
        ['Name', config.name],
        ['Hours per week', `${config.hoursPerWeek}`],
        ['Vacation days per year', `${config.vacationDaysPerYear}`],
        ['Working days', workingDayNames],
        ['Data directory', config.dataDirectory],
        ['Config file', path.join(config.dataDirectory, '.clockin', 'config.json')],
        ['Time entries', path.join(config.dataDirectory, '.clockin', 'time-entries.csv')],
        ['Setup completed', config.setupCompleted ? 'Yes' : 'No']
      );

      console.log(table.toString());
      console.log();
    } catch (error) {
      console.log(chalk.red('❌ Error showing user info:'), error);
    }
  });

program
  .command('holidays')
  .description('Initialize public holidays for a given year and region')
  .option('-y, --year <year>', 'Year to initialize holidays for (defaults to current year)')
  .option('-c, --country <country>', 'Country code (e.g., DE, US)', 'DE')
  .option(
    '-r, --region <region>',
    'Region/state code (e.g., BY for Bavaria, CA for California)',
    'BY'
  )
  .option('-f, --force', 'Force re-initialization even if holidays already exist')
  .addHelpText(
    'after',
    `
Examples:
  clockin holidays                           # Initialize holidays for current year (Germany/Bavaria)
  clockin holidays -y 2025                   # Initialize holidays for 2025 (Germany/Bavaria)
  clockin holidays -c US -r CA               # Initialize holidays for current year (US/California)
  clockin holidays -y 2026 -c US -r CA       # Initialize holidays for 2026 (US/California)
  clockin holidays -y 2025 --force           # Re-initialize 2025 holidays (replaces existing)

Supported Countries and Regions:
  DE (Germany):
    - BY: Bavaria
  US (United States):
    - CA: California`
  )
  .action(
    async (options: { year?: string; country?: string; region?: string; force?: boolean }) => {
      try {
        const config = await ensureSetup();
        const holidayManager = new HolidayManager(config);

        const year = options.year ? parseInt(options.year, 10) : undefined;
        const country = options.country || 'DE';
        const region = options.region || 'BY';
        const force = options.force || false;

        if (year && (isNaN(year) || year < 2000 || year > 2100)) {
          console.log(chalk.red('❌ Invalid year. Please provide a year between 2000 and 2100.'));
          return;
        }

        await holidayManager.initHolidays(year, country, region, force);
      } catch (error) {
        console.log(chalk.red('❌ Error initializing holidays:'), error);
      }
    }
  );

program
  .command('debug')
  .description('Show debug information about the current environment and configuration')
  .action(async () => {
    try {
      console.log(chalk.blue.bold('\n🐛 Debug Information\n'));

      // Environment Variables Section
      console.log(chalk.yellow.bold('Environment Variables:'));
      const envTable = new Table({
        head: [chalk.cyan('Variable'), chalk.cyan('Value')],
        colWidths: [30, 60],
      });

      const relevantEnvVars = [
        'NODE_ENV',
        'HOME',
        'USER',
        'PWD',
        'SHELL',
        'PATH',
        'TERM',
        'LANG',
        'CLOCKIN_CONFIG_PATH',
      ];

      relevantEnvVars.forEach((varName) => {
        const value = process.env[varName] || 'undefined';
        envTable.push([varName, value]);
      });

      console.log(envTable.toString());

      // System Information Section
      console.log(chalk.yellow.bold('\nSystem Information:'));
      const systemTable = new Table({
        head: [chalk.cyan('Property'), chalk.cyan('Value')],
        colWidths: [30, 60],
      });

      systemTable.push(
        ['Platform', os.platform()],
        ['Architecture', os.arch()],
        ['OS Release', os.release()],
        ['Node.js Version', process.version],
        ['Current Working Directory', process.cwd()],
        ['User Home Directory', os.homedir()],
        ['Temporary Directory', os.tmpdir()],
        ['Process ID', process.pid.toString()],
        ['Process Title', process.title],
        ['Execution Path', process.execPath]
      );

      console.log(systemTable.toString());

      // Configuration Paths Section
      console.log(chalk.yellow.bold('\nConfiguration Paths:'));
      const pathTable = new Table({
        head: [chalk.cyan('Type'), chalk.cyan('Path'), chalk.cyan('Exists')],
        colWidths: [25, 50, 10],
      });

      const configManager = new ConfigManager();

      try {
        const currentDataDir = configManager.getDataDirectory();
        const configFilePath = configManager.getDataDirectoryConfigFilePath();

        // Check if paths exist
        let currentExists = 'No';

        try {
          await fs.access(currentDataDir);
        } catch (error) {
          // Directory doesn't exist
        }

        if (currentDataDir) {
          try {
            await fs.access(configFilePath);
            currentExists = 'Yes';
          } catch (error) {
            // Directory doesn't exist
          }
        }

        pathTable.push(
          ['Current Data Dir', currentDataDir || 'N/A', currentDataDir ? 'Yes' : 'No'],
          ['Current Config File', configFilePath, currentExists]
        );
      } catch (error) {
        pathTable.push([
          'Error retrieving paths',
          '',
          `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ]);
      }

      console.log(pathTable.toString());

      // Try to load and show configuration status
      console.log(chalk.yellow.bold('\nConfiguration Status:'));
      const statusTable = new Table({
        head: [chalk.cyan('Check'), chalk.cyan('Status'), chalk.cyan('Details')],
        colWidths: [25, 15, 50],
      });

      try {
        const config = await configManager.loadConfig();
        if (config) {
          statusTable.push(
            ['Config Loaded', 'Success', 'Configuration loaded successfully'],
            [
              'Setup Completed',
              config.setupCompleted ? 'Yes' : 'No',
              config.setupCompleted ? 'Ready to use' : 'Setup required',
            ],
            ['Data Directory', 'Set', config.dataDirectory]
          );
        } else {
          statusTable.push(
            ['Config Loaded', 'Failed', 'No configuration found'],
            ['Setup Completed', 'No', 'Setup required'],
            ['Data Directory', 'Not Set', 'Configuration needed']
          );
        }
      } catch (error) {
        statusTable.push(
          [
            'Config Loaded',
            'Error',
            `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
          ['Setup Completed', 'Unknown', 'Cannot determine'],
          ['Data Directory', 'Unknown', 'Cannot determine']
        );
      }

      console.log(statusTable.toString());

      console.log(chalk.green('\n✅ Debug information displayed successfully!'));
      console.log(chalk.gray('Use this information to troubleshoot configuration issues.\n'));
    } catch (error) {
      console.log(chalk.red('❌ Error displaying debug information:'), error);
    }
  });

// Handle unknown commands
program.on('command:*', () => {
  console.log(chalk.red('❌ Unknown command. Use "clockin --help" to see available commands.'));
  process.exit(1);
});

// Show help if no command is provided
if (process.argv.length <= 2) {
  program.help();
}

program.parse(process.argv);
