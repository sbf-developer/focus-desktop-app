import { app } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const exec = promisify(execFile);

const PENDING_BLOCKING_FILE = "pending-blocking";
const SHOW_WINDOW_FILE = "focus-show";

function pendingPath(): string {
  return path.join(app.getPath("userData"), PENDING_BLOCKING_FILE);
}

function showWindowPath(): string {
  return path.join(app.getPath("userData"), SHOW_WINDOW_FILE);
}

export async function isRunningAsAdmin(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  try {
    await exec("net", ["session"]);
    return true;
  } catch {
    return false;
  }
}

export function signalShowExisting(): void {
  fs.mkdirSync(path.dirname(showWindowPath()), { recursive: true });
  fs.writeFileSync(showWindowPath(), String(Date.now()), "utf8");
}

export function startShowWindowWatcher(show: () => void): void {
  const file = showWindowPath();
  setInterval(() => {
    if (!fs.existsSync(file)) return;
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    show();
  }, 400);
}

export function quitForInstallPath(): string {
  return path.join(app.getPath("userData"), "focus-quit-install");
}

export function startQuitForInstallWatcher(quit: () => void): void {
  const file = quitForInstallPath();
  setInterval(() => {
    if (!fs.existsSync(file)) return;
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    quit();
  }, 400);
}

export function setPendingBlocking(enabled: boolean): void {
  const file = pendingPath();
  if (enabled) {
    fs.writeFileSync(file, "1", "utf8");
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

const PENDING_CLEANUP_FILE = "pending-cleanup";

function cleanupPath(): string {
  return path.join(app.getPath("userData"), PENDING_CLEANUP_FILE);
}

export function setPendingCleanup(enabled: boolean): void {
  const file = cleanupPath();
  if (enabled) {
    fs.writeFileSync(file, "1", "utf8");
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function consumePendingCleanup(): boolean {
  const file = cleanupPath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function consumePendingBlocking(): boolean {
  const file = pendingPath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export async function relaunchAsAdmin(args: string[] = []): Promise<void> {
  const bat = path.join(path.dirname(process.execPath), "Focus-Admin.bat");
  const launchArgs = args.length > 0 ? args.join(" ") : "--show";
  const target = fs.existsSync(bat) ? bat : process.execPath;

  if (target.endsWith(".bat")) {
    await exec("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${target.replace(/'/g, "''")}' -ArgumentList '${launchArgs.replace(/'/g, "''")}' -Verb RunAs`,
    ]);
  } else {
    const quoted = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(", ");
    const argList = quoted ? `-ArgumentList ${quoted}` : "";
    await exec("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -Verb RunAs ${argList}`,
    ]);
  }
  app.quit();
}
