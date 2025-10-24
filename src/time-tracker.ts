import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { dayjs, formatInTz, calculateWorkingTime } from './date-utils.js';
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

  private getCurrentTimeInTimezone(): Date {
    return dayjs.tz(new Date(), this.config.timezone).toDate();
  }

  private formatTimestampForStorage(date: Date): string {
    return formatInTz(date, this.config.timezone, 'YYYY-MM-DDTHH:mm:ss.SSSZ');
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

    const session: WorkSession = {
      startTime: this.getCurrentTimeInTimezone(),
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
    session.pauseStartTime = this.getCurrentTimeInTimezone();
    await this.saveCurrentSession(session);

    console.log(chalk.yellow('\u23f8\ufe0f  Tracking paused.'));
  }

  async resumeTracking(): Promise<void> {
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
      const pauseDuration = Date.now() - session.pauseStartTime.getTime();
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

    const endTime = this.getCurrentTimeInTimezone();
    let totalPausedTime = session.pausedTime;

    if (session.isPaused && session.pauseStartTime) {
      totalPausedTime += Date.now() - session.pauseStartTime.getTime();
    }

    const timeEntry: TimeEntry = {
      id: this.generateId(),
      date: formatInTz(session.startTime, this.config.timezone, 'YYYY-MM-DD'),
      startTime: this.formatTimestampForStorage(session.startTime),
      endTime: this.formatTimestampForStorage(endTime),
      pauseTime: Math.round(totalPausedTime / 60000),
      type: 'work',
    };

    await this.dataManager.saveTimeEntry(timeEntry);
    await this.clearCurrentSession();

    const workingHours = this.calculateWorkingHours(session.startTime, endTime, totalPausedTime);
    console.log(chalk.green('\ud83d\uded1 Stopped tracking time!'));
    console.log(chalk.cyan(`Total working time: ${this.formatDuration(workingHours)}`));
  }

  async displayTimer(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('\u274c No active tracking session found.'));
      return;
    }

    const today = formatInTz(session.startTime, this.config.timezone, 'YYYY-MM-DD');
    const dailyHours = this.config.hoursPerWeek / this.getWorkingDaysCount();
    const dailyHoursMs = dailyHours * 60 * 60 * 1000;

    const todaysEntries = await this.dataManager.loadTimeEntries();
    const todaysCompletedWork = todaysEntries
      .filter((entry) => entry.date === today && entry.endTime)
      .reduce((total, entry) => {
        const workingTime = calculateWorkingTime(entry.startTime, entry.endTime!, entry.pauseTime);
        return total + workingTime;
      }, 0);

    console.clear();

    const updateTimer = () => {
      console.clear();
      const now = new Date();
      let elapsedMs = now.getTime() - session.startTime.getTime() - session.pausedTime;

      if (session.isPaused && session.pauseStartTime) {
        elapsedMs -= now.getTime() - session.pauseStartTime.getTime();
      }

      const currentDate = dayjs(now).tz(this.config.timezone).format('dddd, MMMM Do, YYYY');
      const startTime = dayjs(session.startTime).tz(this.config.timezone).format('HH:mm:ss');
      const elapsedTime = this.formatDuration(elapsedMs);

      const todaysTotalMs = todaysCompletedWork + elapsedMs;
      const todaysTotal = this.formatDuration(todaysTotalMs);

      const remainingWorkMs = Math.max(0, dailyHoursMs - todaysCompletedWork);

      const expectedEndTimeDate = dayjs(session.startTime)
        .add((remainingWorkMs + session.pausedTime) / 60000, 'minute')
        .toDate();
      const endTime = dayjs(expectedEndTimeDate).tz(this.config.timezone).format('HH:mm:ss');

      console.log(chalk.blue.bold(`\ud83d\udcc5 ${currentDate}`));
      console.log(
        chalk.green(
          `\ud83d\udd50 Started: ${startTime} | \u23f1\ufe0f  Session: ${elapsedTime} | \ud83d\udcca Today's Total: ${todaysTotal}`
        )
      );
      console.log(
        chalk.cyan(
          `\ud83c\udfaf Expected End: ${endTime} | \ud83c\udfaf Daily Target: ${this.formatDuration(dailyHoursMs)}`
        )
      );

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
        startTime: new Date(session.startTime),
        pauseStartTime: session.pauseStartTime ? new Date(session.pauseStartTime) : undefined,
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

  private calculateWorkingHours(startTime: Date, endTime: Date, pausedTime: number): number {
    return endTime.getTime() - startTime.getTime() - pausedTime;
  }

  private formatDuration(milliseconds: number): string {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private getWorkingDaysCount(): number {
    return this.config.workingDays.filter((day) => day.isWorkingDay).length;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
