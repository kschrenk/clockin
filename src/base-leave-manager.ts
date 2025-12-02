import dayjs, { Dayjs } from 'dayjs';
import { addDays } from './date-utils.js';
import { Config } from './types.js';
import { DataManager } from './data-manager.js';

export abstract class BaseLeaveManager {
  protected config: Config;
  protected dataManager: DataManager;

  constructor(config: Config) {
    this.config = config;
    this.dataManager = new DataManager(config);
  }

  protected findNextWorkingDay(date: Dayjs): Dayjs | null {
    let cursor = date;
    for (let i = 0; i < 14; i++) {
      if (this.isWorkingDay(cursor)) return cursor;
      cursor = cursor.add(1, 'day');
    }
    return null;
  }

  protected isWorkingDay(date: Dayjs): boolean {
    const dayName = date.format('dddd').toLowerCase();
    const workingDay = this.config.workingDays.find((day) => day.day === dayName);
    return workingDay?.isWorkingDay ?? false;
  }

  protected calculateWorkingDaysInRange(startDate: Date, endDate: Date): Date[] {
    const workingDays: Date[] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      if (this.isWorkingDay(dayjs(currentDate))) {
        workingDays.push(new Date(currentDate));
      }
      currentDate = addDays(currentDate, 1);
    }

    return workingDays;
  }

  protected generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}
