import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TimeTracker } from '../time-tracker.js';
import { DataManager } from '../data-manager.js';
import { Config } from '../types.js';
import { createInquirerStub } from '../helper/test-inquirer-stub.js';

function buildConfig(dataDir: string): Config {
  return {
    name: 'Test User',
    hoursPerWeek: 37.5, // 7.5h/day for 5 days
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

describe('TimeTracker - startTracking location', () => {
  let tempDir: string;
  let config: Config;
  let timeTracker: TimeTracker;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-start-'));
    config = buildConfig(tempDir);
    timeTracker = new TimeTracker(config);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(TimeTracker.prototype, 'displayTimer').mockResolvedValue();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('persists the given location on the session file', async () => {
    await timeTracker.startTracking('home');

    const raw = await fs.readFile(path.join(tempDir, 'current-session.json'), 'utf-8');
    expect(JSON.parse(raw).location).toBe('home');
  });

  it('defaults to office when no location is given', async () => {
    await timeTracker.startTracking();

    const raw = await fs.readFile(path.join(tempDir, 'current-session.json'), 'utf-8');
    expect(JSON.parse(raw).location).toBe('office');
  });
});

describe('TimeTracker - stopTracking suggested pause prompt', () => {
  let tempDir: string;
  let config: Config;
  let timeTracker: TimeTracker;
  let dataManager: DataManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-stop-'));
    config = buildConfig(tempDir);
    timeTracker = new TimeTracker(config);
    dataManager = new DataManager(config);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('prompts and applies suggested pause when user confirms', async () => {
    // freeze time
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T16:20:00.000Z'));

    // create current session started at 08:00Z
    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    // 7.5h target = 450 minutes. Worked 500 minutes -> suggestion 50.
    const inquirerStub = createInquirerStub({ applyPause: true });

    await timeTracker.stopTracking({ inquirer: inquirerStub });

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].pauseTime).toBe(50);
  });

  it('prompts but keeps tracked pause when user declines', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T16:20:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    const inquirerStub = createInquirerStub({ applyPause: false });

    await timeTracker.stopTracking({ inquirer: inquirerStub });

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].pauseTime).toBe(0);
  });

  it('offers and applies a custom pause when user declines the default then confirms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T16:20:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    const responses = [{ applyPause: false }, { addCustomPause: true }, { customPauseMinutes: 30 }];
    let call = 0;
    const promptSpy = vi.fn(async () => responses[call++]);

    await timeTracker.stopTracking({ inquirer: { prompt: promptSpy } });

    expect(promptSpy).toHaveBeenCalledTimes(3);

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].pauseTime).toBe(30);
  });

  it('keeps tracked pause when user declines both the default and a custom pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T16:20:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    const responses = [{ applyPause: false }, { addCustomPause: false }];
    let call = 0;
    const promptSpy = vi.fn(async () => responses[call++]);

    await timeTracker.stopTracking({ inquirer: { prompt: promptSpy } });

    expect(promptSpy).toHaveBeenCalledTimes(2);

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].pauseTime).toBe(0);
  });

  it('carries the location from the session through to the saved entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T15:30:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
        location: 'home',
      })
    );

    await timeTracker.stopTracking({ inquirer: createInquirerStub({ applyPause: true }) });

    const entries = await dataManager.loadTimeEntries();
    expect(entries[0].location).toBe('home');
  });

  it('falls back to office when the session predates the location field', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-14T15:30:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    await timeTracker.stopTracking({ inquirer: createInquirerStub({ applyPause: true }) });

    const entries = await dataManager.loadTimeEntries();
    expect(entries[0].location).toBe('office');
  });

  it('does not prompt when there is no overtime', async () => {
    vi.useFakeTimers();
    // exactly 7.5h from 08:00 to 15:30
    vi.setSystemTime(new Date('2025-01-14T15:30:00.000Z'));

    await fs.writeFile(
      path.join(tempDir, 'current-session.json'),
      JSON.stringify({
        startTime: '2025-01-14T08:00:00.000Z',
        pausedTime: 0,
        isPaused: false,
      })
    );

    const promptSpy = vi.fn(async () => ({ applyPause: true }));

    await timeTracker.stopTracking({ inquirer: { prompt: promptSpy } });

    expect(promptSpy).not.toHaveBeenCalled();

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].pauseTime).toBe(0);
  });
});
