export interface Config {
  name: string;
  hoursPerWeek: number;
  vacationDaysPerYear: number;
  workingDays: WorkingDay[];
  dataDirectory: string;
  timezone: string;
  setupCompleted: boolean;
  startDate?: string; // ISO date string - first day of work for accurate overtime calculations
}

export interface WorkingDay {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  isWorkingDay: boolean;
}

export interface TimeEntry {
  id: string;
  date: string; // ISO date string
  startTime: string; // ISO datetime string
  endTime?: string; // ISO datetime string
  pauseTime?: number; // minutes paused
  type: 'work' | 'vacation';
  description?: string;
}

export interface VacationEntry {
  id: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  days: number; // number of vacation days
  description?: string;
}

export interface SickEntry {
  id: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  days: number; // number of sick days
  description?: string;
}

export interface HolidayEntry {
  id: string;
  date: string; // ISO date string
  name: string; // Holiday name
  country: string; // Country code (e.g., 'DE', 'US')
  region: string; // Region/state code (e.g., 'BY' for Bavaria, 'CA' for California)
}

export interface WorkSession {
  startTime: string; // ISO datetime string
  pausedTime: number; // total paused time in milliseconds
  isPaused: boolean;
  pauseStartTime?: string; // ISO datetime string
}

export interface SummaryData {
  totalHoursWorked: number;
  totalVacationDays: number;
  totalSickDays: number;
  remainingVacationDays: number;
  expectedHoursPerWeek: number;
  currentWeekHours: number;
  overtimeHours: number; // in milliseconds
  startDate: string; // Employment start date (YYYY-MM-DD)
  endDate: string; // Calculation end date (YYYY-MM-DD)
}
