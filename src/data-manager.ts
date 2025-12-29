import fs from 'fs/promises';
import path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { createReadStream } from 'fs';
import { TimeEntry, VacationEntry, SickEntry, HolidayEntry, Config } from './types.js';

export class DataManager {
  private config: Config;
  private readonly timeEntriesPath: string;
  private readonly vacationEntriesPath: string;
  private readonly sickEntriesPath: string;
  private readonly holidayEntriesPath: string;

  constructor(config: Config) {
    this.config = config;
    this.timeEntriesPath = path.join(config.dataDirectory, 'time-entries.csv');
    this.vacationEntriesPath = path.join(config.dataDirectory, 'vacation-entries.csv');
    this.sickEntriesPath = path.join(config.dataDirectory, 'sick-entries.csv');
    this.holidayEntriesPath = path.join(config.dataDirectory, 'holiday-entries.csv');
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

  async loadSickEntries(): Promise<SickEntry[]> {
    await this.ensureDataDirectory();

    try {
      await fs.access(this.sickEntriesPath);
    } catch {
      return [];
    }

    return new Promise((resolve, reject) => {
      const entries: SickEntry[] = [];
      createReadStream(this.sickEntriesPath)
        .pipe(csv())
        .on('data', (data) => {
          try {
            const daysRaw = data.days || data.Days;
            const entry: SickEntry = {
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

  async saveSickEntry(entry: SickEntry): Promise<void> {
    await this.ensureDataDirectory();

    const fileExists = await this.fileExists(this.sickEntriesPath);
    const csvWriter = createObjectCsvWriter({
      path: this.sickEntriesPath,
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

  async loadHolidayEntries(): Promise<HolidayEntry[]> {
    await this.ensureDataDirectory();

    try {
      await fs.access(this.holidayEntriesPath);
    } catch {
      return [];
    }

    return new Promise((resolve, reject) => {
      const entries: HolidayEntry[] = [];
      createReadStream(this.holidayEntriesPath)
        .pipe(csv())
        .on('data', (data) => {
          try {
            const entry: HolidayEntry = {
              id: data.id || data.ID,
              date: data.date || data.Date,
              name: data.name || data.Name,
              country: data.country || data.Country,
              region: data.region || data.Region,
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

  async saveHolidayEntry(entry: HolidayEntry): Promise<void> {
    await this.ensureDataDirectory();

    const fileExists = await this.fileExists(this.holidayEntriesPath);
    const csvWriter = createObjectCsvWriter({
      path: this.holidayEntriesPath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'date', title: 'Date' },
        { id: 'name', title: 'Name' },
        { id: 'country', title: 'Country' },
        { id: 'region', title: 'Region' },
      ],
      append: fileExists,
    });

    await csvWriter.writeRecords([entry]);
  }

  async rewriteHolidayEntries(entries: HolidayEntry[]): Promise<void> {
    await this.ensureDataDirectory();

    // Delete existing file
    try {
      await fs.unlink(this.holidayEntriesPath);
    } catch (error) {
      // File doesn't exist, that's fine
    }

    // Write all entries at once (not appending)
    if (entries.length > 0) {
      const csvWriter = createObjectCsvWriter({
        path: this.holidayEntriesPath,
        header: [
          { id: 'id', title: 'ID' },
          { id: 'date', title: 'Date' },
          { id: 'name', title: 'Name' },
          { id: 'country', title: 'Country' },
          { id: 'region', title: 'Region' },
        ],
        append: false,
      });

      await csvWriter.writeRecords(entries);
    }
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
}
