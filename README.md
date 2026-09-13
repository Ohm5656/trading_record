# Trade Rise Journal

A mobile-first PWA for analyzing, planning, recording, and reviewing trades. Data is stored in IndexedDB on the current device and remains available offline.

## Features

- Day, month, year, and all-time trading views
- Local accounts with remembered sign-in sessions
- PBKDF2 password hashing and per-user trade isolation
- Interactive BTCUSD and gold-futures candlestick charts powered by TradingView Lightweight Charts
- Long/Short planning tools with Entry, TP, SL, ATR-based defaults, and live risk/reward zones
- Confirmed chart plans prefill the trade ticket and attach a chart snapshot automatically
- Live and mark-to-market P&L for open trades
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

Run the browser checks:

```bash
npm run test:smoke
npm run test:pwa
```

## Market data

- `BTCUSD` uses Binance `BTCUSDT` spot prices and candles.
- `XAUUSD` uses Yahoo Finance `GC=F` gold futures as a chart and price proxy. It is not the exact spot or execution price from a broker.
- Market data is for planning and journaling only. This app does not place broker or exchange orders.
- Lightweight Charts requires visible TradingView attribution, which is included below the chart.

> Accounts and data are stored only in this browser. They do not sync between devices, so export a backup before clearing site data or moving devices.
