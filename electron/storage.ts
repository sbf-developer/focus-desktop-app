import fs from "fs";
import path from "path";
import { app } from "electron";

export interface DailyStats {
  apps: Record<string, number>;
  domains: Record<string, number>;
  date: string;
}

function dataDir(): string {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadBlocklist(): string[] {
  const file = path.join(dataDir(), "blocklist.json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* fall through */
    }
  }
  return [
    "youtube.com",
    "twitter.com",
    "x.com",
    "reddit.com",
    "facebook.com",
    "instagram.com",
    "tiktok.com",
  ];
}

export function saveBlocklist(list: string[]): void {
  fs.writeFileSync(
    path.join(dataDir(), "blocklist.json"),
    JSON.stringify(list, null, 2)
  );
}

export function loadStats(): DailyStats {
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(dataDir(), `stats-${today}.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* fall through */
    }
  }
  return { apps: {}, domains: {}, date: today };
}

export function saveStats(stats: DailyStats): void {
  fs.writeFileSync(
    path.join(dataDir(), `stats-${stats.date}.json`),
    JSON.stringify(stats, null, 2)
  );
}

export function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

export interface AppSettings {
  launchAtStartup: boolean;
  blockingEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  launchAtStartup: true,
  blockingEnabled: false,
};

export function loadSettings(): AppSettings {
  const file = path.join(dataDir(), "settings.json");
  if (fs.existsSync(file)) {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      /* fall through */
    }
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(
    path.join(dataDir(), "settings.json"),
    JSON.stringify(settings, null, 2)
  );
}
