import chalk from 'chalk';
import readline from 'readline';
import {
  dayjs,
  formatInTz,
  calculateWorkingTime,
  isValidDateString,
  isValidTimeString,
  combineDateAndTime,
  FORMAT_TIME,
  getPauseDurationMs,
  calculateElapsedMs,
  calculateCurrentPausedTimeMs,
} from './date-utils.js';
import { Config, TimeEntry, WorkSession } from './types.js';
import { DataManager } from './data-manager.js';
import { clearStoredSession, readCurrentSession, writeCurrentSession } from './session-store.js';

export class TimeTracker {
  private config: Config;
  private dataManager: DataManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
  }

  async startTracking(location: 'office' | 'home' = 'office'): Promise<void> {
    const existingSession = await this.getCurrentSession();
    if (existingSession) {
      console.log(chalk.yellow('\u26a0\ufe0f  A tracking session is already active!'));
      console.log(
        chalk.gray('Use "clockin stop" to end the current session or "clockin pause" to pause it.')
      );
      return;
    }

    // Check for conflicting leave entries on today's date
    const today = dayjs();

    // Check for vacation days
    const vacationEntries = await this.dataManager.loadVacationEntries();
    const hasVacationToday = vacationEntries.some((entry) => {
      const entryStart = dayjs(entry.startDate);
      const entryEnd = dayjs(entry.endDate);
      return (
        today.isSame(entryStart, 'day') ||
        today.isSame(entryEnd, 'day') ||
        (today.isAfter(entryStart, 'day') && today.isBefore(entryEnd, 'day'))
      );
    });

    if (hasVacationToday) {
      console.log(
        chalk.red('\u274c Cannot start time tracking: vacation day scheduled for today.')
      );
      console.log(
        chalk.gray('Remove the vacation entry or choose a different date to track time.')
      );
      return;
    }

    // Check for sick days
    const sickEntries = await this.dataManager.loadSickEntries();
    const hasSickDayToday = sickEntries.some((entry) => {
      const entryStart = dayjs(entry.startDate);
      const entryEnd = dayjs(entry.endDate);
      return (
        today.isSame(entryStart, 'day') ||
        today.isSame(entryEnd, 'day') ||
        (today.isAfter(entryStart, 'day') && today.isBefore(entryEnd, 'day'))
      );
    });

    if (hasSickDayToday) {
      console.log(chalk.red('\u274c Cannot start time tracking: sick day scheduled for today.'));
      console.log(
        chalk.gray('Remove the sick day entry or choose a different date to track time.')
      );
      return;
    }

    const session: WorkSession = {
      startTime: dayjs().toISOString(),
      pausedTime: 0,
      isPaused: false,
      location,
    };

    await this.saveCurrentSession(session);

    console.log(chalk.green('\ud83d\ude80 Started tracking time!'));
    await this.displayTimer();
  }

  async pauseTracking(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('\u274c No active tracking session found.'));
      return;
    }

    if (session.isPaused) {
      console.log(chalk.yellow('\u26a0\ufe0f  Session is already paused.'));
      return;
    }

    session.isPaused = true;
    session.pauseStartTime = dayjs().toISOString();
    await this.saveCurrentSession(session);

    console.log(chalk.yellow('\u23f8\ufe0f  Tracking paused.'));
  }

  async resumeTracking(): Promise<void> {
    const now = dayjs();
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('\u274c No active tracking session found.'));
      return;
    }

    if (!session.isPaused) {
      console.log(chalk.yellow('\u26a0\ufe0f  Session is not paused.'));
      return;
    }

    if (session.pauseStartTime) {
      const pauseDuration = getPauseDurationMs(now, session.pauseStartTime);
      session.pausedTime += pauseDuration;
    }

    session.isPaused = false;
    session.pauseStartTime = undefined;
    await this.saveCurrentSession(session);

    console.log(chalk.green('\u25b6\ufe0f  Tracking resumed.'));
    await this.displayTimer();
  }

  async displayTimer(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    const today = dayjs(session.startTime);
    const dailyHours =
      this.getWorkingDaysCount() > 0 ? this.config.hoursPerWeek / this.getWorkingDaysCount() : 0;
    const dailyHoursMs = dailyHours * 60 * 60 * 1000;
    const todaysEntries = await this.dataManager.loadTimeEntries();
    const todaysCompletedWork = todaysEntries
      .filter((entry) => dayjs(entry.date).isSame(today, 'day') && isValidDateString(entry.endTime))
      .reduce((total, entry) => {
        const workingTime = calculateWorkingTime(entry.startTime, entry.endTime!, entry.pauseTime);
        return total + workingTime;
      }, 0);

    console.clear();

    const updateTimer = () => {
      console.clear();
      const now = dayjs();
      const elapsedMs = calculateElapsedMs(session, now);
      const startTimeFormatted = dayjs(session.startTime)
        .tz(this.config.timezone)
        .format(FORMAT_TIME);
      const elapsedTime = dayjs.duration(elapsedMs);
      const todaysTotalMs = todaysCompletedWork + elapsedMs;
      const remainingWorkMs = Math.max(0, dailyHoursMs - todaysCompletedWork);
      const expectedEndTimeDate = dayjs(session.startTime).add(
        remainingWorkMs + session.pausedTime,
        'ms'
      );
      const endTime = dayjs(expectedEndTimeDate).tz(this.config.timezone).format(FORMAT_TIME);

      const locationLabel = session.location === 'home' ? '🏠 Home' : '🏢 Office';

      console.log(chalk.blue.bold(`📅 ${now.format('dddd, MMMM Do, YYYY')} | ${locationLabel}`));
      console.log(
        chalk.green(
          `🕐 Started: ${startTimeFormatted} | ⏱️  Session: ${elapsedTime.format(FORMAT_TIME)} | 📊 Today's Total: ${dayjs.duration(todaysTotalMs).format(FORMAT_TIME)}`
        )
      );
      console.log(
        chalk.cyan(
          `🎯 Expected End: ${endTime} | 🎯 Daily Target: ${dayjs.duration(dailyHoursMs).format(FORMAT_TIME)}`
        )
      );

      const currentPausedTime = calculateCurrentPausedTimeMs(session, now);
      const pausedTimeFormatted = dayjs.duration(currentPausedTime).format(FORMAT_TIME);

      console.log(chalk.magenta(`⏸️  Total Paused: ${pausedTimeFormatted}`));

      if (confirmingStop) {
        console.log(chalk.red('🛑 Stop session? Press "y" to confirm, any other key to cancel'));
      } else if (session.isPaused) {
        console.log(chalk.yellow('⏸️  PAUSED - Press "p" to resume | "s" to stop'));
      } else {
        console.log(chalk.gray('Press "p" to pause | "s" to stop | Ctrl+C to exit timer view'));
      }
    };

    let confirmingStop = false;

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    const restoreStdin = () => {
      clearInterval(interval);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };

    const cleanupAndExit = () => {
      restoreStdin();
      process.stdin.pause();
      console.log(chalk.yellow('\n⏰ Timer view exited. Session is still active.'));
      process.exit(0);
    };

    process.on('SIGINT', cleanupAndExit);

    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let togglingPause = false;

      const stopFromTimer = async () => {
        // Hand stdin back in cooked mode so the overtime pause prompt in stopTracking() works.
        process.stdin.off('keypress', onKeypress);
        process.removeListener('SIGINT', cleanupAndExit);
        restoreStdin();
        console.clear();
        try {
          await this.stopTracking();
          process.stdin.pause();
          process.exit(0);
        } catch (error) {
          console.log(chalk.red('❌ Error stopping time tracking:'), error);
          process.stdin.pause();
          process.exit(1);
        }
      };

      const onKeypress = (str: string, key: readline.Key) => {
        if (key?.ctrl && key.name === 'c') {
          cleanupAndExit();
          return;
        }

        if (confirmingStop) {
          confirmingStop = false;
          if (str === 'y' || str === 'Y') {
            void stopFromTimer();
          } else {
            updateTimer();
          }
          return;
        }

        if ((str === 's' || str === 'S') && !togglingPause) {
          confirmingStop = true;
          updateTimer();
          return;
        }

        if ((str === 'p' || str === 'P') && !togglingPause) {
          togglingPause = true;
          const now = dayjs();
          if (session.isPaused) {
            if (session.pauseStartTime) {
              session.pausedTime += getPauseDurationMs(now, session.pauseStartTime);
            }
            session.isPaused = false;
            session.pauseStartTime = undefined;
          } else {
            session.isPaused = true;
            session.pauseStartTime = now.toISOString();
          }
          void this.saveCurrentSession(session).then(() => {
            togglingPause = false;
            updateTimer();
          });
        }
      };

      process.stdin.on('keypress', onKeypress);
    }
  }

  private getRegularDailyMinutes(): number {
    const workingDays = this.getWorkingDaysCount();
    if (workingDays <= 0) return 0;
    const dailyHours = this.config.hoursPerWeek / workingDays;
    // Ensure we're working with an integer minute target to avoid floating-point drift.
    return Math.round(dailyHours * 60);
  }

  private getSuggestedPauseMinutesForSession(totalWorkMinutes: number): number {
    const regularDailyMinutes = this.getRegularDailyMinutes();
    const overtimeMinutes = totalWorkMinutes - regularDailyMinutes;
    // Use floor so we don't accidentally overshoot the target due to floating point artifacts.
    return Math.max(0, Math.floor(overtimeMinutes));
  }

  async stopTracking(options?: {
    inquirer?: { prompt: (questions: any) => Promise<any> };
  }): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    const endTime = dayjs();
    const totalPausedTimeMs = calculateCurrentPausedTimeMs(session, endTime);
    let pauseTime = dayjs.duration(totalPausedTimeMs).asMinutes();

    // compute gross duration (without any pause deducted)
    const grossMs = calculateWorkingTime(session.startTime, endTime.toISOString(), 0);
    const grossMinutes = dayjs.duration(grossMs).asMinutes();

    const suggestedPauseMinutes = this.getSuggestedPauseMinutesForSession(grossMinutes);

    // Only prompt if the user worked longer than their regular daily time and no real pause was
    // tracked this session (a tracked pause means the user already accounted for their break via
    // "clockin pause"/"p" in the timer view).
    if (suggestedPauseMinutes > 0 && (pauseTime ?? 0) === 0) {
      const inquirer = options?.inquirer ?? (await import('inquirer')).default;

      const { applyPause } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'applyPause',
          message: `You worked ${Math.round(grossMinutes)} minutes today (target: ${Math.round(
            this.getRegularDailyMinutes()
          )} minutes). Add default pause of ${suggestedPauseMinutes} minutes?`,
          default: true,
        },
      ]);

      if (applyPause) {
        pauseTime = suggestedPauseMinutes;
      } else {
        const { addCustomPause } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'addCustomPause',
            message: 'Add a custom pause instead?',
            default: false,
          },
        ]);

        if (addCustomPause) {
          const { customPauseMinutes } = await inquirer.prompt([
            {
              type: 'number',
              name: 'customPauseMinutes',
              message: 'Enter pause time in minutes:',
              default: 0,
              validate: (input: number) =>
                (Number.isFinite(input) && input >= 0 && input <= grossMinutes) ||
                `Please enter a number between 0 and ${Math.floor(grossMinutes)}.`,
            },
          ]);

          pauseTime = customPauseMinutes;
        }
      }
    }

    const timeEntry: TimeEntry = {
      id: this.generateId(),
      date: formatInTz(session.startTime, this.config.timezone, 'YYYY-MM-DD'),
      startTime: dayjs(session.startTime).toISOString(),
      endTime: endTime.toISOString(),
      pauseTime,
      type: 'work',
      location: session.location ?? 'office',
    };

    await this.dataManager.saveTimeEntry(timeEntry);
    await this.clearCurrentSession();

    const workingHours = calculateWorkingTime(session.startTime, endTime.toISOString(), pauseTime);

    console.log(chalk.green('🛑 Stopped tracking time!'));
    console.log(
      chalk.cyan(`Total working time: ${dayjs.duration(workingHours).format(FORMAT_TIME)}`)
    );
  }

  /**
   * Add a time entry manually with validation
   */
  async addTimeEntry(
    dateString: string,
    startTimeString: string,
    endTimeString: string,
    description?: string,
    pauseTimeMinutes: number = 0,
    location: 'office' | 'home' = 'office'
  ): Promise<void> {
    // Validate date format
    if (!isValidDateString(dateString)) {
      console.log(chalk.red('❌ Invalid date format. Please use YYYY-MM-DD format.'));
      return;
    }

    // Validate time formats
    if (!isValidTimeString(startTimeString)) {
      console.log(chalk.red('❌ Invalid start time format. Please use HH:MM format (24-hour).'));
      return;
    }

    if (!isValidTimeString(endTimeString)) {
      console.log(chalk.red('❌ Invalid end time format. Please use HH:MM format (24-hour).'));
      return;
    }

    // Validate pause time
    if (pauseTimeMinutes < 0) {
      console.log(chalk.red('❌ Pause time cannot be negative.'));
      return;
    }

    const targetDate = dayjs(dateString);
    const now = dayjs();

    // Don't allow future dates
    if (targetDate.isAfter(now, 'day')) {
      console.log(chalk.red('❌ Cannot add time entries for future dates.'));
      return;
    }

    // Create full datetime strings
    const startTimeISO = combineDateAndTime(dateString, startTimeString, this.config.timezone);
    const endTimeISO = combineDateAndTime(dateString, endTimeString, this.config.timezone);

    // Validate that end time is after start time
    const startDateTime = dayjs(startTimeISO);
    const endDateTime = dayjs(endTimeISO);

    if (!endDateTime.isAfter(startDateTime)) {
      console.log(chalk.red('❌ End time must be after start time.'));
      return;
    }

    // Calculate total duration and validate it's reasonable
    const totalDurationMs = calculateWorkingTime(startTimeISO, endTimeISO, pauseTimeMinutes);
    const totalHours = dayjs.duration(totalDurationMs).asHours();

    if (totalHours >= 24) {
      console.log(chalk.red('❌ Work session cannot exceed 24 hours.'));
      return;
    }

    if (totalHours <= 0) {
      console.log(chalk.red('❌ Work session must be longer than the pause time.'));
      return;
    }

    // Check for conflicts with existing time entries
    const existingTimeEntries = await this.dataManager.loadTimeEntries();
    const hasTimeEntryConflict = existingTimeEntries.some((entry) =>
      dayjs(entry.date).isSame(targetDate, 'day')
    );

    if (hasTimeEntryConflict) {
      console.log(
        chalk.red(
          `❌ A time entry already exists for ${targetDate.format('MMM Do, YYYY')}. Please remove it first or choose a different date.`
        )
      );
      return;
    }

    // Check for conflicts with vacation entries
    const vacationEntries = await this.dataManager.loadVacationEntries();
    const hasVacationConflict = vacationEntries.some((entry) => {
      const entryStart = dayjs(entry.startDate);
      const entryEnd = dayjs(entry.endDate);
      return (
        targetDate.isSame(entryStart, 'day') ||
        targetDate.isSame(entryEnd, 'day') ||
        (targetDate.isAfter(entryStart, 'day') && targetDate.isBefore(entryEnd, 'day'))
      );
    });

    if (hasVacationConflict) {
      console.log(
        chalk.red(
          `❌ Cannot add time entry: vacation day scheduled for ${targetDate.format('MMM Do, YYYY')}. Please remove the vacation entry first.`
        )
      );
      return;
    }

    // Check for conflicts with sick entries
    const sickEntries = await this.dataManager.loadSickEntries();
    const hasSickConflict = sickEntries.some((entry) => {
      const entryStart = dayjs(entry.startDate);
      const entryEnd = dayjs(entry.endDate);
      return (
        targetDate.isSame(entryStart, 'day') ||
        targetDate.isSame(entryEnd, 'day') ||
        (targetDate.isAfter(entryStart, 'day') && targetDate.isBefore(entryEnd, 'day'))
      );
    });

    if (hasSickConflict) {
      console.log(
        chalk.red(
          `❌ Cannot add time entry: sick day scheduled for ${targetDate.format('MMM Do, YYYY')}. Please remove the sick day entry first.`
        )
      );
      return;
    }

    // Create the time entry
    const timeEntry: TimeEntry = {
      id: this.generateId(),
      date: targetDate.format('YYYY-MM-DD'),
      startTime: startTimeISO,
      endTime: endTimeISO,
      pauseTime: pauseTimeMinutes,
      type: 'work',
      description,
      location,
    };

    // Save the entry
    await this.dataManager.saveTimeEntry(timeEntry);

    console.log(chalk.green(`✅ Time entry added successfully!`));
    console.log(
      chalk.cyan(
        `📅 Date: ${targetDate.format('MMM Do, YYYY')} | ⏰ ${startTimeString} - ${endTimeString}`
      )
    );
    console.log(
      chalk.cyan(`🕐 Working time: ${dayjs.duration(totalDurationMs).format(FORMAT_TIME)}`)
    );
    if (pauseTimeMinutes > 0) {
      console.log(chalk.cyan(`⏸️  Pause time: ${pauseTimeMinutes} minutes`));
    }
    if (description) {
      console.log(chalk.cyan(`📝 Description: ${description}`));
    }
  }

  /**
   * Apply a pause (in minutes) to an *existing* time entry for a given date.
   *
   * By default, callers should pass a date string (YYYY-MM-DD). The CLI can default that to "today".
   */
  async addPauseToExistingEntry(
    pauseMinutes: number,
    dateString: string,
    options?: { index?: number; inquirer?: { prompt: (questions: any) => Promise<any> } }
  ): Promise<void> {
    if (!Number.isFinite(pauseMinutes) || pauseMinutes < 0) {
      console.log(chalk.red('❌ Pause time must be a non-negative number of minutes.'));
      return;
    }

    if (!isValidDateString(dateString)) {
      console.log(chalk.red('❌ Invalid date format. Please use YYYY-MM-DD format.'));
      return;
    }

    const day = dayjs(dateString);
    const allEntries = await this.dataManager.loadTimeEntries();
    const entriesForDay = allEntries
      .filter((e) => dayjs(e.date).isSame(day, 'day'))
      .sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf());

    if (entriesForDay.length === 0) {
      console.log(chalk.yellow(`⚠️  No time entries found for ${day.format('MMM Do, YYYY')}.`));
      return;
    }

    let selectedIndex: number | undefined = options?.index;

    if (selectedIndex === undefined) {
      const inquirer = options?.inquirer ?? (await import('inquirer')).default;

      const choices = entriesForDay.map((e, idx) => {
        const start = dayjs(e.startTime).tz(this.config.timezone).format('HH:mm');
        const end = e.endTime ? dayjs(e.endTime).tz(this.config.timezone).format('HH:mm') : '—';
        const currentPause = e.pauseTime ?? 0;
        const label = `${start} - ${end} (pause: ${currentPause}m)${e.description ? ` — ${e.description}` : ''}`;
        return { name: label, value: idx };
      });

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'index',
          message: `Select the entry to set pause for (${day.format('YYYY-MM-DD')}):`,
          choices,
        },
      ]);

      selectedIndex = answers.index;
    }

    if (selectedIndex === undefined) {
      console.log(chalk.red('❌ Invalid selection.'));
      return;
    }

    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= entriesForDay.length
    ) {
      console.log(chalk.red('❌ Invalid selection.'));
      return;
    }

    const entryToUpdate = entriesForDay[selectedIndex];

    if (!entryToUpdate.endTime) {
      console.log(chalk.red('❌ Cannot set pause on an entry without an end time.'));
      return;
    }

    const totalMs = calculateWorkingTime(entryToUpdate.startTime, entryToUpdate.endTime, 0);
    const totalMinutes = dayjs.duration(totalMs).asMinutes();

    if (pauseMinutes > totalMinutes) {
      console.log(chalk.red('❌ Pause time cannot exceed the total session duration.'));
      return;
    }

    const updatedEntry: TimeEntry = {
      ...entryToUpdate,
      pauseTime: pauseMinutes,
    };

    const updatedAll = allEntries.map((e) => (e.id === entryToUpdate.id ? updatedEntry : e));
    await this.dataManager.rewriteTimeEntries(updatedAll);

    console.log(chalk.green('✅ Pause time updated successfully!'));
    console.log(
      chalk.cyan(`📅 Date: ${day.format('MMM Do, YYYY')} | ⏸️  Pause: ${pauseMinutes} minutes`)
    );
  }

  async addSuggestedPauseToExistingEntry(
    dateString: string,
    options?: { index?: number; inquirer?: { prompt: (questions: any) => Promise<any> } }
  ): Promise<void> {
    if (!isValidDateString(dateString)) {
      console.log(chalk.red('❌ Invalid date format. Please use YYYY-MM-DD format.'));
      return;
    }

    const day = dayjs(dateString);
    const allEntries = await this.dataManager.loadTimeEntries();
    const entriesForDay = allEntries
      .filter((e) => dayjs(e.date).isSame(day, 'day'))
      .sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf());

    if (entriesForDay.length === 0) {
      console.log(chalk.yellow(`⚠️  No time entries found for ${day.format('MMM Do, YYYY')}.`));
      return;
    }

    // reuse selection logic from addPauseToExistingEntry by delegating
    let selectedIndex: number | undefined = options?.index;
    if (selectedIndex === undefined) {
      const inquirer = options?.inquirer ?? (await import('inquirer')).default;
      const choices = entriesForDay.map((e, idx) => {
        const start = dayjs(e.startTime).tz(this.config.timezone).format('HH:mm');
        const end = e.endTime ? dayjs(e.endTime).tz(this.config.timezone).format('HH:mm') : '—';
        const currentPause = e.pauseTime ?? 0;
        const label = `${start} - ${end} (pause: ${currentPause}m)${e.description ? ` — ${e.description}` : ''}`;
        return { name: label, value: idx };
      });

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'index',
          message: `Select the entry to auto-set pause for (${day.format('YYYY-MM-DD')}):`,
          choices,
        },
      ]);
      selectedIndex = answers.index;
    }

    if (selectedIndex === undefined) {
      console.log(chalk.red('❌ Invalid selection.'));
      return;
    }

    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= entriesForDay.length
    ) {
      console.log(chalk.red('❌ Invalid selection.'));
      return;
    }

    const entryToUpdate = entriesForDay[selectedIndex];

    if (!entryToUpdate.endTime) {
      console.log(chalk.red('❌ Cannot set pause on an entry without an end time.'));
      return;
    }

    const totalMs = calculateWorkingTime(entryToUpdate.startTime, entryToUpdate.endTime, 0);
    const totalMinutes = dayjs.duration(totalMs).asMinutes();
    const suggestedPauseMinutes = this.getSuggestedPauseMinutesForSession(totalMinutes);

    if (suggestedPauseMinutes <= 0) {
      console.log(
        chalk.yellow(
          `⚠️  No default pause suggested (worked ${Math.round(totalMinutes)}m, target ${Math.round(
            this.getRegularDailyMinutes()
          )}m).`
        )
      );
      return;
    }

    await this.addPauseToExistingEntry(suggestedPauseMinutes, dateString, { index: selectedIndex });
  }

  private async getCurrentSession(): Promise<WorkSession | null> {
    return readCurrentSession(this.config);
  }

  private async saveCurrentSession(session: WorkSession): Promise<void> {
    await writeCurrentSession(this.config, session);
  }

  private async clearCurrentSession(): Promise<void> {
    await clearStoredSession(this.config);
  }

  private getWorkingDaysCount(): number {
    return this.config.workingDays.filter((day) => day.isWorkingDay).length;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
