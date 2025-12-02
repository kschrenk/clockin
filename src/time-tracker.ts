import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import {
  dayjs,
  formatInTz,
  calculateWorkingTime,
  isValidDateString,
  FORMAT_TIME,
  getPauseDurationMs,
  calculateElapsedMs,
  calculateCurrentPausedTimeMs,
} from './date-utils.js';
import { Config, TimeEntry, WorkSession } from './types.js';
import { DataManager } from './data-manager.js';

export class TimeTracker {
  private config: Config;
  private dataManager: DataManager;
  private sessionPath: string;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
    this.sessionPath = path.join(config.dataDirectory, 'current-session.json');
  }

  async startTracking(): Promise<void> {
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

  async stopTracking(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('\u274c No active tracking session found.'));
      return;
    }

    const endTime = dayjs();
    const totalPausedTimeMs = calculateCurrentPausedTimeMs(session, endTime);
    const pauseTime = dayjs.duration(totalPausedTimeMs).asMinutes();
    const timeEntry: TimeEntry = {
      id: this.generateId(),
      date: formatInTz(session.startTime, this.config.timezone, 'YYYY-MM-DD'),
      startTime: dayjs(session.startTime).toISOString(),
      endTime: endTime.toISOString(),
      pauseTime,
      type: 'work',
    };

    await this.dataManager.saveTimeEntry(timeEntry);
    await this.clearCurrentSession();

    const workingHours = calculateWorkingTime(session.startTime, endTime.toISOString(), pauseTime);

    console.log(chalk.green('\ud83d\uded1 Stopped tracking time!'));
    console.log(
      chalk.cyan(`Total working time: ${dayjs.duration(workingHours).format(FORMAT_TIME)}`)
    );
  }

  async displayTimer(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('\u274c No active tracking session found.'));
      return;
    }

    const today = dayjs(session.startTime);
    const dailyHours = this.config.hoursPerWeek / this.getWorkingDaysCount();
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

      console.log(chalk.blue.bold(`\ud83d\udcc5 ${now.format('dddd, MMMM Do, YYYY')}`));
      console.log(
        chalk.green(
          `\ud83d\udd50 Started: ${startTimeFormatted} | \u23f1\ufe0f  Session: ${elapsedTime.format(FORMAT_TIME)} | \ud83d\udcca Today's Total: ${dayjs.duration(todaysTotalMs).format(FORMAT_TIME)}`
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

      if (session.isPaused) {
        console.log(
          chalk.yellow('\u23f8\ufe0f  PAUSED - Use "clockin resume" to continue tracking')
        );
      } else {
        console.log(
          chalk.gray('Use Ctrl+C to exit timer view, then "clockin stop" to finish tracking')
        );
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.yellow('\n\u23f0 Timer view exited. Session is still active.'));
      process.exit(0);
    });
  }

  private async getCurrentSession(): Promise<WorkSession | null> {
    try {
      const data = await fs.readFile(this.sessionPath, 'utf-8');
      const session = JSON.parse(data);
      return {
        ...session,
        startTime: dayjs(session.startTime).toISOString(),
        pauseStartTime: session.pauseStartTime
          ? dayjs(session.pauseStartTime).toISOString()
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private async saveCurrentSession(session: WorkSession): Promise<void> {
    const sessionDir = path.dirname(this.sessionPath);
    try {
      await fs.access(sessionDir);
    } catch {
      await fs.mkdir(sessionDir, { recursive: true });
    }
    await fs.writeFile(this.sessionPath, JSON.stringify(session, null, 2));
  }

  private async clearCurrentSession(): Promise<void> {
    try {
      await fs.unlink(this.sessionPath);
    } catch {
      // ignore
    }
  }

  private getWorkingDaysCount(): number {
    return this.config.workingDays.filter((day) => day.isWorkingDay).length;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
