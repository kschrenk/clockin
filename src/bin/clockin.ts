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
import { SummaryManager } from '../summary-manager.js';

const program = new Command();

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
  .action(async (options) => {
    try {
      const config = await ensureSetup();
      const summaryManager = new SummaryManager(config);

      if (options.csv) {
        await summaryManager.openCsvFile();
      } else if (options.week) {
        await summaryManager.showWeeklySummary();
      } else {
        await summaryManager.showSummary();
      }
    } catch (error) {
      console.log(chalk.red('❌ Error showing summary:'), error);
    }
  });

const vacationCommand = program.command('vacation').description('Manage vacation days');

vacationCommand
  .command('add <days> [start_date]')
  .description('Add vacation days (start_date optional, defaults to today)')
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

      // Clear global config
      const globalConfigDir = path.join(os.homedir(), '.clockin');
      try {
        await fs.rm(globalConfigDir, { recursive: true, force: true });
        console.log(chalk.green('✅ Cleared global configuration'));
      } catch (error) {
        // Ignore if directory doesn't exist
      }

      // Try to clear current target directory config
      try {
        const configManager = new ConfigManager();
        const currentDataDir = await configManager.getCurrentDataDirectory();
        if (currentDataDir) {
          const targetConfigDir = path.join(currentDataDir, '.clockin');
          await fs.rm(targetConfigDir, { recursive: true, force: true });
          console.log(chalk.green(`✅ Cleared data directory: ${currentDataDir}`));
        }
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
  .command('debug')
  .description('Show debug information including environment variables and system info')
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
        'TZ',
        'CLOCKIN_CONFIG_DIR',
        'CLOCKIN_DATA_DIR',
        'XDG_CONFIG_HOME',
        'XDG_DATA_HOME',
      ];

      relevantEnvVars.forEach(varName => {
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
      const globalConfigDir = path.join(os.homedir(), '.clockin');

      try {
        const currentDataDir = await configManager.getCurrentDataDirectory();
        const currentConfigDir = currentDataDir ? path.join(currentDataDir, '.clockin') : 'N/A';

        // Check if paths exist
        let globalExists = 'No';
        let currentExists = 'No';

        try {
          await fs.access(globalConfigDir);
          globalExists = 'Yes';
        } catch (error) {
          // Directory doesn't exist
        }

        if (currentDataDir) {
          try {
            await fs.access(currentConfigDir);
            currentExists = 'Yes';
          } catch (error) {
            // Directory doesn't exist
          }
        }

        pathTable.push(
          ['Global Config Dir', globalConfigDir, globalExists],
          ['Current Data Dir', currentDataDir || 'N/A', currentDataDir ? 'Yes' : 'No'],
          ['Current Config Dir', currentConfigDir, currentExists]
        );
      } catch (error) {
        pathTable.push(
          ['Global Config Dir', globalConfigDir, 'Unknown'],
          ['Current Data Dir', 'Error loading', 'No'],
          ['Current Config Dir', 'Error loading', 'No']
        );
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
            ['Setup Completed', config.setupCompleted ? 'Yes' : 'No', config.setupCompleted ? 'Ready to use' : 'Setup required'],
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
          ['Config Loaded', 'Error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
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
