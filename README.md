# Focus

Block distracting websites system-wide and track how you spend time on your computer.
<img width="914" height="592" alt="image" src="https://github.com/user-attachments/assets/484282a8-fd68-4206-8c20-35d428261637" />


## Features

- **System-wide blocking** — blocks domains across all browsers and apps via local DNS
- **App tracking** — see time spent in Cursor, Word, Chrome, and more
- **Website tracking** — DNS logging + browser title detection for site-level stats
- **Minimal UI** — clean dashboard, blocklist manager, activity breakdown
- **System tray** — runs quietly in the background

## Requirements

- Windows 10/11
- **Run as Administrator** (required for DNS blocking on port 53)

## Development

```bash
npm install
npm run electron:dev
```

## Build installer

```bash
npm run electron:build
```

The installer will be in `release/`. It creates a desktop shortcut and Start Menu entry.

## Usage

1. Install and launch **Focus** (accept admin prompt)
2. Go to **Block** → toggle blocking on
3. Add domains to block (YouTube, Reddit, etc.)
4. Check **Dashboard** for live activity and daily totals

Data is stored locally in `%APPDATA%/focus/data/`.
