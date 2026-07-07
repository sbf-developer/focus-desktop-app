import type { AppStatus, DailyStats } from "./types";

declare global {
  interface Window {
    focusApp: {
      getStats: () => Promise<DailyStats>;
      getStatus: () => Promise<AppStatus>;
      getBlocklist: () => Promise<string[]>;
      addDomain: (domain: string) => Promise<string[]>;
      removeDomain: (domain: string) => Promise<string[]>;
      setBlocking: (enabled: boolean) => Promise<AppStatus>;
      resetTodayStats: () => Promise<void>;
      onStatsUpdated: (cb: (stats: DailyStats) => void) => () => void;
      onBlockingChanged: (cb: () => void) => () => void;
    };
  }
}

export const api = {
  getStats: () => window.focusApp.getStats(),
  getStatus: () => window.focusApp.getStatus(),
  getBlocklist: () => window.focusApp.getBlocklist(),
  addDomain: (domain: string) => window.focusApp.addDomain(domain),
  removeDomain: (domain: string) => window.focusApp.removeDomain(domain),
  setBlocking: (enabled: boolean) => window.focusApp.setBlocking(enabled),
  resetTodayStats: () => window.focusApp.resetTodayStats(),
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function displayDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/^www\./, "");
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return withoutProtocol.split(/[/?#:]/)[0] || raw;
}

export function sortedEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
