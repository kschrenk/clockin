import fs from 'fs/promises';
import path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { createReadStream } from 'fs';
import { TimeEntry, VacationEntry, Config } from './types.js';

export class DataManager {
  private config: Config;
  private timeEntriesPath: string;
  private vacationEntriesPath: string;

  constructor(config: Config) {
    this.config = config;
    this.timeEntriesPath = path.join(config.dataDirectory, 'time-entries.csv');
    this.vacationEntriesPath = path.join(config.dataDirectory, 'vacation-entries.csv');
  }

  async ensureDataDirectory(): Promise<void> {
    try {
      await fs.access(this.config.dataDirectory);
    } catch {
      await fs.mkdir(this.config.dataDirectory, { recursive: true });
    }
  }

  async loadTimeEntries(): Promise<TimeEntry[]> {
    await this.ensureDataDirectory();

    try {
      await fs.access(this.timeEntriesPath);
    } catch {
      return [];
    }

    return new Promise((resolve, reject) => {
      const entries: TimeEntry[] = [];
      createReadStream(this.timeEntriesPath)
        .pipe(csv())
        .on('data', (data) => {
          try {
            // Support both original field ids and header titles
            const entry: TimeEntry = {
              id: data.id || data.ID,
              date: data.date || data.Date,
              startTime: data.startTime || data['Start Time'],
              endTime: data.endTime || data['End Time'] || undefined,
              pauseTime:
                data.pauseTime || data['Pause Time (minutes)']
                  ? parseInt(data.pauseTime || data['Pause Time (minutes)'] || '0', 10)
                  : undefined,
              type: (data.type || data.Type) as TimeEntry['type'],
            };
            entries.push(entry);
          } catch (e) {
            reject(e);
          }
        })
        .on('end', () => resolve(entries))
        .on('error', reject);
    });
  }

  async saveTimeEntry(entry: TimeEntry): Promise<void> {
    await this.ensureDataDirectory();

    const fileExists = await this.fileExists(this.timeEntriesPath);
    const csvWriter = createObjectCsvWriter({
      path: this.timeEntriesPath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'date', title: 'Date' },
        { id: 'startTime', title: 'Start Time' },
        { id: 'endTime', title: 'End Time' },
        { id: 'pauseTime', title: 'Pause Time (minutes)' },
        { id: 'type', title: 'Type' },
        { id: 'description', title: 'Description' },
      ],
      append: fileExists,
    });

    await csvWriter.writeRecords([entry]);
  }

  async loadVacationEntries(): Promise<VacationEntry[]> {
    await this.ensureDataDirectory();

    try {
      await fs.access(this.vacationEntriesPath);
    } catch {
      return [];
    }

    return new Promise((resolve, reject) => {
      const entries: VacationEntry[] = [];
      createReadStream(this.vacationEntriesPath)
        .pipe(csv())
        .on('data', (data) => {
          try {
            const daysRaw = data.days || data.Days;
            const entry: VacationEntry = {
              id: data.id || data.ID,
              startDate: data.startDate || data['Start Date'],
              endDate: data.endDate || data['End Date'],
              days: typeof daysRaw === 'number' ? daysRaw : parseFloat(daysRaw),
              description: data.description || data.Description || undefined,
            };
            entries.push(entry);
          } catch (e) {
            reject(e);
          }
        })
        .on('end', () => resolve(entries))
        .on('error', reject);
    });
  }

  async saveVacationEntry(entry: VacationEntry): Promise<void> {
    await this.ensureDataDirectory();

    const fileExists = await this.fileExists(this.vacationEntriesPath);
    const csvWriter = createObjectCsvWriter({
      path: this.vacationEntriesPath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'startDate', title: 'Start Date' },
        { id: 'endDate', title: 'End Date' },
        { id: 'days', title: 'Days' },
        { id: 'description', title: 'Description' },
      ],
      append: fileExists,
    });

    await csvWriter.writeRecords([entry]);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getTimeEntriesPath(): string {
    return this.timeEntriesPath;
  }

  getVacationEntriesPath(): string {
    return this.vacationEntriesPath;
  }
}
