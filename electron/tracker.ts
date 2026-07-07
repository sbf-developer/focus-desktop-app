import { execFile } from "child_process";
import { promisify } from "util";
import { DailyStats, loadStats, saveStats } from "./storage";

const exec = promisify(execFile);

const TRACK_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class FocusTrack {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static string GetActive() {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return "";
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (pid == 0) return "";
    string proc = "";
    try { proc = Process.GetProcessById((int)pid).ProcessName; } catch {}
    var sb = new StringBuilder(512);
    GetWindowText(hwnd, sb, 512);
    return proc + "|" + sb.ToString();
  }
  public static bool IsIdle(int seconds) {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return false;
    return ((uint)Environment.TickCount - info.dwTime) / 1000 >= (uint)seconds;
  }
}
"@
$active = [FocusTrack]::GetActive()
$idle = [FocusTrack]::IsIdle(120)
Write-Output "$active|$idle"
`.trim();

const FRIENDLY: Record<string, string> = {
  Cursor: "Cursor",
  cursor: "Cursor",
  Code: "VS Code",
  WINWORD: "Word",
  EXCEL: "Excel",
  POWERPNT: "PowerPoint",
  OUTLOOK: "Outlook",
  chrome: "Chrome",
  firefox: "Firefox",
  msedge: "Edge",
  brave: "Brave",
  Slack: "Slack",
  Discord: "Discord",
  Spotify: "Spotify",
  Notion: "Notion",
  Figma: "Figma",
};

const SITE_MAP: [string, string][] = [
  ["youtube", "youtube.com"],
  ["reddit", "reddit.com"],
  ["twitter", "twitter.com"],
  ["github", "github.com"],
  ["facebook", "facebook.com"],
  ["instagram", "instagram.com"],
  ["tiktok", "tiktok.com"],
  ["linkedin", "linkedin.com"],
  ["netflix", "netflix.com"],
];

export class ActivityTracker {
  private stats: DailyStats;
  private currentApp: string | null = null;
  private currentDomain: string | null = null;
  private isIdle = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onUpdate: ((stats: DailyStats) => void) | null = null;

  constructor() {
    this.stats = loadStats();
  }

  setOnUpdate(cb: (stats: DailyStats) => void): void {
    this.onUpdate = cb;
  }

  start(getDnsDomain: () => string | null): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        const { stdout } = await exec("powershell.exe", [
          "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", TRACK_PS,
        ]);
        const parts = stdout.trim().split("|");
        const idle = parts[parts.length - 1] === "True";
        const raw = parts.slice(0, -1).join("|");
        const [proc, ...titleParts] = raw.split("|");
        const title = titleParts.join("|");

        this.isIdle = idle;
        const app = friendlyName(proc);
        const domainFromTitle = domainFromWindowTitle(title);
        const dnsDomain = getDnsDomain();
        const domain = dnsDomain ?? domainFromTitle;

        this.tick(app, domain, idle);
      } catch {
        /* ignore transient PS errors */
      }
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    saveStats(this.stats);
  }

  getStats(): DailyStats {
    return this.stats;
  }

  getCurrentApp(): string | null {
    return this.currentApp;
  }

  getCurrentDomain(): string | null {
    return this.currentDomain;
  }

  getIsIdle(): boolean {
    return this.isIdle;
  }

  resetStats(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.stats = { apps: {}, domains: {}, date: today };
    saveStats(this.stats);
    this.onUpdate?.(this.stats);
  }

  private tick(app: string | null, domain: string | null, idle: boolean): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.stats.date !== today) {
      saveStats(this.stats);
      this.stats = { apps: {}, domains: {}, date: today };
    }

    this.currentApp = app;
    this.currentDomain = idle ? null : domain;

    if (idle) {
      this.onUpdate?.(this.stats);
      return;
    }

    if (app) {
      this.stats.apps[app] = (this.stats.apps[app] ?? 0) + 1;
    }

    if (domain && domain.includes(".") && !domain.endsWith(".local")) {
      const norm = domain.replace(/^www\./, "").toLowerCase();
      this.stats.domains[norm] = (this.stats.domains[norm] ?? 0) + 1;
    }

    const total = Object.values(this.stats.apps).reduce((a, b) => a + b, 0);
    if (total % 30 === 0) saveStats(this.stats);

    this.onUpdate?.(this.stats);
  }
}

function friendlyName(proc: string): string | null {
  if (!proc) return null;
  return FRIENDLY[proc] ?? proc;
}

function domainFromWindowTitle(title: string): string | null {
  if (!title) return null;
  const parts = title.split(" - ");
  if (parts.length < 2) return null;
  const browser = parts[parts.length - 1].toLowerCase();
  if (!browser.match(/chrome|firefox|edge|brave/)) return null;
  const site = parts[parts.length - 2].trim().toLowerCase();
  for (const [key, domain] of SITE_MAP) {
    if (site.includes(key)) return domain;
  }
  if (site.includes(".")) return site;
  return null;
}
