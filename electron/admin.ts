import { app } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const exec = promisify(execFile);

const PENDING_BLOCKING_FILE = "pending-blocking";

function pendingPath(): string {
  return path.join(app.getPath("userData"), PENDING_BLOCKING_FILE);
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

export async function relaunchAsAdmin(): Promise<void> {
  const exe = process.execPath.replace(/'/g, "''");
  const args = process.argv
    .slice(1)
    .map((a) => `'${a.replace(/'/g, "''")}'`)
    .join(", ");

  const argList = args ? `-ArgumentList ${args}` : "";
  await exec("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${exe}' -Verb RunAs ${argList}`,
  ]);
  app.quit();
}
