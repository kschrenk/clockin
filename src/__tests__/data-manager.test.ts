import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DataManager } from '../data-manager.js';
import { Config, TimeEntry } from '../types.js';

const LEGACY_HEADER = 'ID,Date,Start Time,End Time,Pause Time (minutes),Type,Description';
const CURRENT_HEADER = 'ID,Date,Start Time,End Time,Pause Time (minutes),Type,Location,Description';

function buildConfig(dataDir: string): Config {
  return {
    name: 'Test User',
    hoursPerWeek: 40,
    vacationDaysPerYear: 25,
    workingDays: [],
    dataDirectory: dataDir,
    setupCompleted: true,
    timezone: 'Europe/Berlin',
  };
}

describe('DataManager - time-entries.csv schema migration', () => {
  let tempDir: string;
  let dataManager: DataManager;
  let csvPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-data-'));
    dataManager = new DataManager(buildConfig(tempDir));
    csvPath = dataManager.getTimeEntriesPath();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const newEntry: TimeEntry = {
    id: 'new',
    date: '2025-01-15',
    startTime: '2025-01-15T08:00:00.000Z',
    endTime: '2025-01-15T16:00:00.000Z',
    pauseTime: 30,
    type: 'work',
    location: 'home',
    description: 'New entry',
  };

  it('migrates a legacy header before appending so columns stay aligned', async () => {
    await fs.writeFile(
      csvPath,
      `${LEGACY_HEADER}\nold,2025-01-14,2025-01-14T08:00:00.000Z,2025-01-14T16:00:00.000Z,60,work,Old entry\n`
    );

    await dataManager.saveTimeEntry(newEntry);

    const content = await fs.readFile(csvPath, 'utf-8');
    expect(content.split('\n')[0]).toBe(CURRENT_HEADER);

    const entries = await dataManager.loadTimeEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'old', description: 'Old entry', location: undefined });
    expect(entries[1]).toMatchObject({ id: 'new', description: 'New entry', location: 'home' });
  });

  it('repairs rows that were already appended misaligned to a legacy file', async () => {
    await fs.writeFile(
      csvPath,
      [
        LEGACY_HEADER,
        'old,2025-01-14,2025-01-14T08:00:00.000Z,2025-01-14T16:00:00.000Z,60,work,Old entry',
        'bad,2025-01-15,2025-01-15T08:00:00.000Z,2025-01-15T16:00:00.000Z,30,work,office,Meeting day',
        'bad2,2025-01-16,2025-01-16T08:00:00.000Z,2025-01-16T16:00:00.000Z,30,work,home,',
        '',
      ].join('\n')
    );

    const loaded = await dataManager.loadTimeEntries();
    expect(loaded[1]).toMatchObject({ id: 'bad', location: 'office', description: 'Meeting day' });
    expect(loaded[2]).toMatchObject({ id: 'bad2', location: 'home', description: undefined });

    // Appending triggers the migration and persists the repaired rows.
    await dataManager.saveTimeEntry(newEntry);
    const content = await fs.readFile(csvPath, 'utf-8');
    expect(content.split('\n')[0]).toBe(CURRENT_HEADER);

    const entries = await dataManager.loadTimeEntries();
    expect(entries.map((e) => [e.id, e.location, e.description])).toEqual([
      ['old', undefined, 'Old entry'],
      ['bad', 'office', 'Meeting day'],
      ['bad2', 'home', undefined],
      ['new', 'home', 'New entry'],
    ]);
  });

  it('leaves a file with the current header untouched when appending', async () => {
    await dataManager.saveTimeEntry({ ...newEntry, id: 'first' });
    await dataManager.saveTimeEntry(newEntry);

    const content = await fs.readFile(csvPath, 'utf-8');
    expect(content.split('\n').filter((l) => l === CURRENT_HEADER)).toHaveLength(1);
    expect((await dataManager.loadTimeEntries()).map((e) => e.id)).toEqual(['first', 'new']);
  });
});

describe('DataManager - atomic rewrites', () => {
  let tempDir: string;
  let dataManager: DataManager;
  let csvPath: string;

  const entry = (id: string): TimeEntry => ({
    id,
    date: '2025-01-15',
    startTime: '2025-01-15T08:00:00.000Z',
    endTime: '2025-01-15T16:00:00.000Z',
    pauseTime: 30,
    type: 'work',
    location: 'office',
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clockin-data-'));
    dataManager = new DataManager(buildConfig(tempDir));
    csvPath = dataManager.getTimeEntriesPath();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps the original file intact and cleans up when the rewrite fails', async () => {
    await dataManager.saveTimeEntry(entry('a'));
    await dataManager.saveTimeEntry(entry('b'));
    const before = await fs.readFile(csvPath, 'utf-8');

    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));

    await expect(dataManager.rewriteTimeEntries([entry('a')])).rejects.toThrow('disk full');

    expect(await fs.readFile(csvPath, 'utf-8')).toBe(before);
    expect(await fs.readdir(tempDir)).toEqual(['time-entries.csv']);
  });

  it('replaces the file content on success without leaving temp files', async () => {
    await dataManager.saveTimeEntry(entry('a'));
    await dataManager.saveTimeEntry(entry('b'));

    await dataManager.rewriteTimeEntries([{ ...entry('b'), pauseTime: 45 }]);

    const entries = await dataManager.loadTimeEntries();
    expect(entries.map((e) => [e.id, e.pauseTime])).toEqual([['b', 45]]);
    expect(await fs.readdir(tempDir)).toEqual(['time-entries.csv']);
  });

  it('removes the file when rewriting with no entries', async () => {
    await dataManager.saveTimeEntry(entry('a'));

    await dataManager.rewriteTimeEntries([]);

    expect(await dataManager.loadTimeEntries()).toEqual([]);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });
});
