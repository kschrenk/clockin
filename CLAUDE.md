# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**clockin** is a local CLI tool for tracking working hours and managing vacation/sick days, storing all data as CSV files. Built with TypeScript, Commander.js, and Dayjs.

## Commands

```bash
pnpm build          # Compile TypeScript → dist/
pnpm dev -- <cmd>   # Run a command in dev mode (e.g. pnpm dev -- start)
pnpm test           # Run tests once
pnpm test:watch     # Run tests in watch mode
pnpm lint           # ESLint check
pnpm lint:fix       # Auto-fix lint issues
pnpm format         # Prettier (write)
```

To run a single test file: `pnpm vitest run src/__tests__/<file>.test.ts`

## Architecture

### Entry Point

`src/bin/clockin.ts` — defines all CLI commands via Commander.js. Each command instantiates the relevant manager and calls async methods. This is the only file that should print to the user or handle process exits.

### Manager Layer

Each domain has a dedicated manager:

| Manager | File | Responsibility |
|---|---|---|
| `TimeTracker` | `time-tracker.ts` | start/pause/resume/stop sessions, manual entry, live timer display |
| `SummaryManager` | `summary-manager.ts` | overall and weekly summaries, overtime calculations |
| `DataManager` | `data-manager.ts` | CSV read/write for all entry types |
| `VacationManager` | `vacation-manager.ts` | vacation tracking (working days) |
| `SickManager` | `sick-manager.ts` | sick leave (calendar days) |
| `HolidayManager` | `holiday-manager.ts` | public holidays via `date-holidays` npm |
| `ConfigManager` | `config-manager.ts` | config at `~/.clockin/config.json` |
| `SetupWizard` | `setup-wizard.ts` | interactive first-run setup |
| `BaseLeaveManager` | `base-leave-manager.ts` | shared overlap detection for Vacation/Sick |

### Data Storage

CSV files in a configurable directory (default `~/clockin-data/`):

- `time-entries.csv` — work sessions (ID, Date, Start/End Time, Pause Time, Type, Description)
- `vacation-entries.csv` — vacation blocks
- `sick-entries.csv` — sick leave blocks
- `holiday-entries.csv` — public holidays

All types are defined in `src/types.ts`.

### Date Handling

All date/time operations go through `src/date-utils.ts`, which wraps Dayjs with plugins (utc, timezone, advancedFormat, isoWeek, duration). Always use these helpers rather than calling Dayjs directly.

### Environment & Config

- **Dev**: loads `.env.local` (override data path etc.)
- **Test**: loads `.env.test` (sets `CLOCKIN_CONFIG_PATH=/tmp/test-clockin-global`)
- **Prod**: loads `~/.config/clockin/.env`

Loading logic is in `src/loadConfig.ts`.

## Key Conventions

- **Vacation** counts only working days; **sick leave** counts consecutive calendar days. This distinction is central to the domain model.
- Overlap detection (leave vs. leave, leave vs. work sessions) is handled in `BaseLeaveManager` — extend it when adding new leave types.
- Tests use real file I/O to a temp directory (via `.env.test`), not mocks of the data layer.
- The `_` prefix on variables suppresses the `no-unused-vars` ESLint rule.
