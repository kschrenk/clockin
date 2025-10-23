import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { format, addMinutes } from 'date-fns';
import { Config, TimeEntry, WorkSession } from './types.js';
import { DataManager } from './data-manager.js';

export class TimeTracker {
  private config: Config;
  private dataManager: DataManager;
  private sessionPath: string;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
    this.sessionPath = path.join(config.dataDirectory, '.clockin', 'current-session.json');
  }

  async startTracking(): Promise<void> {
    const existingSession = await this.getCurrentSession();
    if (existingSession) {
      console.log(chalk.yellow('⚠️  A tracking session is already active!'));
      console.log(
        chalk.gray('Use "clockin stop" to end the current session or "clockin pause" to pause it.')
      );
      return;
    }

    const session: WorkSession = {
      startTime: new Date(),
      pausedTime: 0,
      isPaused: false,
    };

    await this.saveCurrentSession(session);

    console.log(chalk.green('🚀 Started tracking time!'));
    await this.displayTimer();
  }

  async pauseTracking(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    if (session.isPaused) {
      console.log(chalk.yellow('⚠️  Session is already paused.'));
      return;
    }

    session.isPaused = true;
    session.pauseStartTime = new Date();
    await this.saveCurrentSession(session);

    console.log(chalk.yellow('⏸️  Tracking paused.'));
  }

  async resumeTracking(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    if (!session.isPaused) {
      console.log(chalk.yellow('⚠️  Session is not paused.'));
      return;
    }

    if (session.pauseStartTime) {
      const pauseDuration = Date.now() - session.pauseStartTime.getTime();
      session.pausedTime += pauseDuration;
    }

    session.isPaused = false;
    session.pauseStartTime = undefined;
    await this.saveCurrentSession(session);

    console.log(chalk.green('▶️  Tracking resumed.'));
    await this.displayTimer();
  }

  async stopTracking(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    const endTime = new Date();
    let totalPausedTime = session.pausedTime;

    // If currently paused, add the current pause duration
    if (session.isPaused && session.pauseStartTime) {
      totalPausedTime += Date.now() - session.pauseStartTime.getTime();
    }

    const timeEntry: TimeEntry = {
      id: this.generateId(),
      date: format(session.startTime, 'yyyy-MM-dd'),
      startTime: session.startTime.toISOString(),
      endTime: endTime.toISOString(),
      pauseTime: Math.round(totalPausedTime / 60000), // Convert to minutes
      type: 'work',
    };

    await this.dataManager.saveTimeEntry(timeEntry);
    await this.clearCurrentSession();

    const workingHours = this.calculateWorkingHours(session.startTime, endTime, totalPausedTime);
    console.log(chalk.green('🛑 Stopped tracking time!'));
    console.log(chalk.cyan(`Total working time: ${this.formatDuration(workingHours)}`));
  }

  async displayTimer(): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) {
      console.log(chalk.red('❌ No active tracking session found.'));
      return;
    }

    // Pre-calculate today's completed work once
    const today = format(session.startTime, 'yyyy-MM-dd');
    const dailyHours = this.config.hoursPerWeek / this.getWorkingDaysCount();
    const dailyHoursMs = dailyHours * 60 * 60 * 1000;

    const todaysEntries = await this.dataManager.loadTimeEntries();
    const todaysCompletedWork = todaysEntries
      .filter((entry) => entry.date === today && entry.endTime)
      .reduce((total, entry) => {
        const start = new Date(entry.startTime);
        const end = new Date(entry.endTime!);
        const pause = (entry.pauseTime || 0) * 60 * 1000;
        return total + (end.getTime() - start.getTime() - pause);
      }, 0);

    // Clear the console and show timer
    console.clear();

    const updateTimer = () => {
      console.clear();
      const now = new Date();
      let elapsedMs = now.getTime() - session.startTime.getTime() - session.pausedTime;

      if (session.isPaused && session.pauseStartTime) {
        elapsedMs -= now.getTime() - session.pauseStartTime.getTime();
      }

      const currentDate = format(now, 'EEEE, MMMM do, yyyy');
      const startTime = format(session.startTime, 'HH:mm:ss');
      const elapsedTime = this.formatDuration(elapsedMs);

      // Calculate today's total work time (completed + current session)
      const todaysTotalMs = todaysCompletedWork + elapsedMs;
      const todaysTotal = this.formatDuration(todaysTotalMs);

      // Calculate expected end time based on daily hours and work already done today
      // Remaining work needed = daily target - work already done today
      const remainingWorkMs = Math.max(0, dailyHoursMs - todaysCompletedWork);

      // Expected end time = current session start + remaining work + current session pauses
      const expectedEndTime = addMinutes(
        session.startTime,
        (remainingWorkMs + session.pausedTime) / 60000
      );
      const endTime = format(expectedEndTime, 'HH:mm:ss');

      console.log(chalk.blue.bold(`📅 ${currentDate}`));
      console.log(
        chalk.green(
          `🕐 Started: ${startTime} | ⏱️  Session: ${elapsedTime} | 📊 Today's Total: ${todaysTotal}`
        )
      );
      console.log(
        chalk.cyan(
          `🎯 Expected End: ${endTime} | 🎯 Daily Target: ${this.formatDuration(dailyHoursMs)}`
        )
      );

      if (session.isPaused) {
        console.log(chalk.yellow('⏸️  PAUSED - Use "clockin resume" to continue tracking'));
      } else {
        console.log(
          chalk.gray('Use Ctrl+C to exit timer view, then "clockin stop" to finish tracking')
        );
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    // Handle Ctrl+C to exit timer view
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.yellow('\n⏰ Timer view exited. Session is still active.'));
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
      // File doesn't exist, which is fine
    }
  }

  private calculateWorkingHours(startTime: Date, endTime: Date, pausedTime: number): number {
    return endTime.getTime() - startTime.getTime() - pausedTime;
  }

  private formatDuration(milliseconds: number): string {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private getWorkingDaysCount(): number {
    return this.config.workingDays.filter((day) => day.isWorkingDay).length;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
