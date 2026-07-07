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

export async function isAnotherFocusRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await exec("powershell.exe", [
      "-NoProfile",
      "-Command",
      `$others = Get-Process Focus -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${process.pid} }; if ($others) { 'yes' } else { 'no' }`,
    ]);
    return stdout.trim() === "yes";
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

export function setPendingBlocking(enabled: boolean): void {
  const file = pendingPath();
  if (enabled) {
    fs.writeFileSync(file, "1", "utf8");
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function consumePendingBlocking(): boolean {
  const file = pendingPath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export async function relaunchAsAdmin(args: string[] = []): Promise<void> {
  const exe = process.execPath.replace(/'/g, "''");
  const quoted = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(", ");
  const argList = quoted ? `-ArgumentList ${quoted}` : "";

  await exec("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${exe}' -Verb RunAs ${argList}`,
  ]);
  app.quit();
}
