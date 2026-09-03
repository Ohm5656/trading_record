# Trade Rise Journal

A mobile-first PWA for recording and reviewing trades. Data is stored in IndexedDB on the current device and remains available offline.

## Features

- Day, month, year, and all-time trading views
- Local accounts with remembered sign-in sessions
- PBKDF2 password hashing and per-user trade isolation
- Profit/loss, date, time, symbol, setup, notes, and lessons
- Trade-chart screenshots up to 5 MB
- Edit and delete history
- Win rate, profit factor, expectancy, averages, and an equity curve
- Monthly and yearly goals with multiple currencies
- JSON backup and restore
- Installable PWA with offline support

## Getting started

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
npm run preview
```

> Accounts and data are stored only in this browser. They do not sync between devices, so export a backup before clearing site data or moving devices.
