# clockin

## outline
clockin is cli app that can be controled via a terminal.
The main purpose of clockin is to track working hours and align them with the hours you get paid for.

## how it works
First there is a setup phase where you have to answer certain questions in the terminal. It is the same as when you 
create a nextjs app with `npx create-next-app@latest`. Clockin asks for you name and how many hours you work per week.
It also asks how many vacations you get per year. It than asks you whether saturday and sunday are considered working days or not.
As a last question it asks for the directory where to store the main csv file with all the tracked data.

The output in the cli is nicely formatted with colors and tables to make it easy to read. When you answered all the questions 
a summary is shown and the user has to confirm the setup. If it is not confirmed the setup starts from the beginning again.

After the setup phase clockin is ready to track your working hours. All the data is stored locally in a csv file.  

## commands

* Start tracking
```zsh
clockin start
```
The cli shows a stopwatch like timer that counts the working hours. It should not extend more than three lines in the terminal.
It shows the current date, the start time, the elapsed time and the expected end time.

* Pause tracking
```zsh
clockin pause
```

* Stop tracking
```zsh
clockin stop
```

* Show summary
```zsh
clockin summary
```
Shows a summary of the tracked working hours in a table format.

* Show summary
```zsh
clockin summary --week
```
Shows a summary of the tracked working hours for the current week in a table format.

* Show summary
```zsh
clockin summary --csv
```
Opens the csv file with all the tracked data in the default csv viewer.

* Add vacation day
```zsh
clockin vacation add <days> <start_date>
```
The start_date is optional and defaults to today. The days can be a float value like 0.5 for half a day.
If you enter three days of vacation on friday the 1st of july 2024 it just adds vacation days on friday because saturday and sunday are not working days.

* Add vacation day
```zsh
clockin vacation add --range <start_date> <end_date>
```
Adds vacation days for the given date range. It automatically skips non working days.