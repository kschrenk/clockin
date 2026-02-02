# clockin

A colorful, user-friendly CLI to track working hours and vacation days locally using simple CSV files.

## Features

- Interactive setup wizard
- Start, pause, resume, and stop live tracking sessions
- Dynamic timer view with expected end time
- Data stored locally as CSV (easy to inspect & back up)
- Summaries (overall and weekly) with tables and color formatting
- Open raw time CSV in your default viewer
- Add vacation by number of days or by date range (skips non-working days)
- Track sick days with optional descriptions
- **Track public holidays** - Initialize holidays for your region (Germany/Bavaria, US/California)
- Track remaining vacation vs yearly allowance
- Comprehensive leave management with separate vacation and sick day tracking
- **Accurate overtime calculation** - Based on start date, includes vacation/sick/holidays

## Installation

Clone and build locally:

```zsh
# Clone the repository
git clone <repo-url> clockin
cd clockin

# Install dependencies (uses pnpm)
pnpm install

# Build TypeScript to dist/
pnpm build

# Link globally so the `clockin` command is available
pnpm link --global
# (Or use: npm link)
```

Verify installation:

```zsh
clockin --help
```

If you see `zsh: command not found: clockin`, make sure your global pnpm bin directory is in your `$PATH`:

```zsh
export PATH="$PATH:$(pnpm bin -g)"
source ~/.zshrc
```

During development, you can run the entrypoint with tsx:

```zsh
pnpm dev -- <command> [options]
# Example
pnpm dev -- start
```

## Setup (First Run)

On first run (any command), if no config exists you will be guided through:

1. Name
2. Hours per week (**use a dot for decimals, e.g. `37.5` not `37,5`**)
3. Vacation days per year
4. Working days (default Mon–Fri or customize)
5. Data directory (default: `~/clockin-data`)

A summary is shown for confirmation. If you reject it, the wizard restarts.

Config file location: `~/.clockin/config.json`
Data CSV directory (default): `~/clockin-data`
Environment file location (if used): `~/.clockin/.env`

To re-run setup later:

```zsh
clockin setup
```

## Environment Configuration (.env)

You can override paths and other settings via an environment file located in your global config directory (`~/.clockin`). The CLI looks for a `.env` file **inside `~/.clockin`**.

1. Copy the example file provided in the repository:
   ```zsh
   cp .env.example ~/.clockin/.env
   ```
2. Edit `~/.clockin/.env` and set absolute paths:

   ```dotenv
   # Path to the global config directory (defaults to $HOME/.clockin if unset)
   CLOCKIN_CONFIG_PATH=/Users/yourname/.clockin

   # Path to the data directory (defaults to $HOME/clockin-data if unset)
   CLOCKIN_DATA_PATH=/Users/yourname/clockin-data
   ```

3. (Optional) Restart your terminal session if you rely on shell expansion, or just run the commands again.

Notes:

- Use full absolute paths (the app does not expand `~`).
- If variables are omitted, built-in defaults are used.
- The setup wizard can still create initial directories; environment values override defaults.

## Usage & Commands

Run `clockin --help` or `clockin <command> --help` for details.

### Start Tracking

```zsh
clockin start [--description "Feature ABC"]
```

Starts a new session and launches a live timer. Shows current date, start time, elapsed time, expected end time. Warns if a session is already active.

### Pause / Resume

```zsh
clockin pause
clockin resume
```

Pauses or resumes the active session. Paused time is excluded from worked hours and shifts the expected end time.

### Stop

```zsh
clockin stop
```

Ends the current session, writes a row in `time-entries.csv`, and prints total worked time (minus pauses).

### Show Summary

```zsh
clockin summary           # Overall summary
clockin summary --week    # Current week summary
clockin summary --csv     # Open raw CSV in default viewer
```

### Vacation Management

Add vacation by number of working days (whole days only):

```zsh
clockin vacation add <days> [start_date]
# Examples
clockin vacation add 1            # Add 1 vacation day starting today
clockin vacation add 3 2025-01-15 # Add 3 vacation days starting Jan 15th
```

If the start date is a non-working day, the next working day is used automatically.

Add vacation by date range (counts only configured working days):

```zsh
clockin vacation range <start_date> <end_date>
# Example
clockin vacation range 2025-07-01 2025-07-10
```

### Sick Days Management

Add sick days with optional description and start date:

```zsh
clockin sick add <days> [description] [start_date]
# Examples
clockin sick add 1                          # Add 1 sick day starting today
clockin sick add 2 "Flu"                    # Add 2 sick days with description
clockin sick add 3 "Food poisoning" 2025-01-15  # Add 3 sick days starting Jan 15th
clockin sick add 1 "" 2025-12-10            # Add 1 sick day on specific date (no description)
```

Sick days are tracked separately from vacation days and appear in both overall and weekly summaries. Unlike vacation days, **sick days use consecutive calendar days** (including weekends) since illness doesn't follow working day schedules. For example, if you're sick for 3 days starting Monday, it covers Monday, Tuesday, and Wednesday - regardless of whether any of those days are configured as working days.

### Holiday Management

Initialize public holidays for your region to get accurate overtime calculations:

```zsh
clockin holidays                           # Initialize for current year (Germany/Bavaria default)
clockin holidays -y 2025                   # Initialize for specific year
clockin holidays -c US -r CA               # Initialize for US/California
clockin holidays -y 2026 -c US -r CA       # Initialize for 2026, US/California
clockin holidays -y 2025 --force           # Re-initialize 2025 (replaces existing)
```

**Duplicate Prevention:** If you try to initialize holidays for a year that already exists, the command will warn you and skip initialization. Use the `--force` flag to replace existing holidays.

**Supported regions:**

- **Germany (DE):** Bavaria (BY) - 13 holidays including Epiphany, Easter-based holidays, Corpus Christi, Assumption of Mary, All Saints' Day
- **United States (US):** California (CA) - 9 federal holidays including MLK Day, Presidents' Day, Memorial Day, Labor Day, Thanksgiving

Holidays are automatically counted toward your expected working hours and appear in weekly summaries. See `HOLIDAY_GUIDE.md` for detailed information.

### Live Timer (Detached)

If you exited the live view with Ctrl+C, **your session continues running in the background**. Ctrl+C only exits the timer display, it does NOT pause tracking. To pause tracking, use:

```zsh
clockin pause
```

To resume:

```zsh
clockin resume
```

To stop and save the session:

```zsh
clockin stop
```

To reopen the timer view:

```zsh
clockin timer
```

## Data Files

| File                   | Purpose                              |
| ---------------------- | ------------------------------------ |
| `time-entries.csv`     | Work sessions (start/end, pauses)    |
| `vacation-entries.csv` | Vacation periods                     |
| `sick-entries.csv`     | Sick leave periods with descriptions |
| `holiday-entries.csv`  | Public holidays by region and year   |

Files are stored in your chosen data directory. Safe to back up with any sync tool.

## Development

```zsh
# Lint
pnpm run lint
# Test
pnpm test
# Watch tests
pnpm run test:watch
# Build before publishing
pnpm build
```

## Troubleshooting

| Issue                        | Fix                                                            |
| ---------------------------- | -------------------------------------------------------------- |
| Command not found after link | Ensure global bin path is in `$PATH`; try reopening terminal   |
| Cannot start session         | Run `clockin stop` or remove `~/.clockin/current-session.json` |
| CSV opens in wrong app       | Change your OS default for `.csv` files                        |
| Wrong expected end time      | Check config via `clockin setup`                               |
| Decimal input error          | Use a dot (`.`) for decimals, e.g. `37.5` not `37,5`           |
| Ctrl+C exits timer           | Use `clockin pause` to actually pause tracking                 |

## License

ISC (see package.json)

## Quick Start

```zsh
pnpm install
pnpm build
pnpm link --global
clockin start
clockin pause
clockin resume
clockin stop
clockin summary --week
clockin vacation add 3 2025-01-15
clockin sick add 1 "Flu"
```

Enjoy productive, transparent time tracking!
