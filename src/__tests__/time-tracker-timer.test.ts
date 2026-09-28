import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { TimeTracker } from '../time-tracker.js';
import { DataManager } from '../data-manager.js';
import { writeCurrentSession } from '../session-store.js';
import { Config } from '../types.js';

function buildConfig(dataDir: string): Config {
  return {
    name: 'Test User',
    hoursPerWeek: 37.5,
    vacationDaysPerYear: 25,
    workingDays: [
      { day: 'monday', isWorkingDay: true },
      { day: 'tuesday', isWorkingDay: true },
      { day: 'wednesday', isWorkingDay: true },
      { day: 'thursday', isWorkingDay: true },
      { day: 'friday', isWorkingDay: true },
      { day: 'saturday', isWorkingDay: false },
      { day: 'sunday', isWorkingDay: false },
    ],
    dataDirectory: dataDir,
    setupCompleted: true,
    timezone: 'Europe/Berlin',
  };
}

async function readSession(dataDir: string) {
  const raw = await fs.readFile(path.join(dataDir, 'current-session.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('TimeTracker - displayTimer keyboard shortcuts', () => {
  let tempDir: string;
  let config: Config;
  let timeTracker: TimeTracker;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-timer-'));
    config = buildConfig(tempDir);
    timeTracker = new TimeTracker(config);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'clear').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => {});

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: vi.fn().mockReturnValue(process.stdin),
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'resume', {
      value: vi.fn().mockReturnValue(process.stdin),
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'pause', {
      value: vi.fn().mockReturnValue(process.stdin),
      configurable: true,
    });
  });

  afterEach(async () => {
    process.stdin.removeAllListeners('keypress');
    process.removeAllListeners('SIGINT');
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    delete (process.stdin as unknown as Record<string, unknown>).setRawMode;
    delete (process.stdin as unknown as Record<string, unknown>).resume;
    delete (process.stdin as unknown as Record<string, unknown>).pause;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('pauses the session in place when "p" is pressed while running', async () => {
    await timeTracker.startTracking('office');

    process.stdin.emit('keypress', 'p', { name: 'p' });
    let session: { isPaused: boolean; pauseStartTime?: string } | undefined;
    await vi.waitFor(async () => {
      session = await readSession(tempDir);
      expect(session.isPaused).toBe(true);
    });

    expect(session?.isPaused).toBe(true);
    expect(session?.pauseStartTime).toBeTruthy();
  });

  it('resumes the session in place when "p" is pressed while paused', async () => {
    await writeCurrentSession(config, {
      startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      isPaused: true,
      pausedTime: 0,
      pauseStartTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      location: 'office',
    });
    await timeTracker.displayTimer();

    process.stdin.emit('keypress', 'p', { name: 'p' });
    let session: { isPaused: boolean; pauseStartTime?: string } | undefined;
    await vi.waitFor(async () => {
      session = await readSession(tempDir);
      expect(session.isPaused).toBe(false);
    });

    expect(session?.isPaused).toBe(false);
    expect(session?.pauseStartTime).toBeUndefined();
  });

  it('stops the session when "s" is confirmed with "y"', async () => {
    await timeTracker.startTracking('office');

    process.stdin.emit('keypress', 's', { name: 's' });
    process.stdin.emit('keypress', 'y', { name: 'y' });

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    await expect(fs.access(path.join(tempDir, 'current-session.json'))).rejects.toThrow();
    const entries = await new DataManager(config).loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].endTime).toBeTruthy();
    expect(process.stdin.listenerCount('keypress')).toBe(0);
  });

  it('cancels the stop when "s" is followed by any other key', async () => {
    await timeTracker.startTracking('office');

    process.stdin.emit('keypress', 's', { name: 's' });
    process.stdin.emit('keypress', 'n', { name: 'n' });

    const session = await readSession(tempDir);
    expect(session.isPaused).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.stdin.listenerCount('keypress')).toBe(1);
  });

  it('does not toggle pause when "p" cancels a pending stop', async () => {
    await timeTracker.startTracking('office');

    process.stdin.emit('keypress', 's', { name: 's' });
    process.stdin.emit('keypress', 'p', { name: 'p' });
    // Give any (unexpected) async save a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = await readSession(tempDir);
    expect(session.isPaused).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('does not attach a keypress listener when stdin is not a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    await timeTracker.startTracking('office');

    expect(process.stdin.listenerCount('keypress')).toBe(0);
  });
});
