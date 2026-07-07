import path from "path";
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { DnsBlocker } from "./dns";
import { ActivityTracker } from "./tracker";
import { loadBlocklist, loadSettings, saveBlocklist, saveSettings } from "./storage";
import {
  consumePendingBlocking,
  isRunningAsAdmin,
  relaunchAsAdmin,
  setPendingBlocking,
} from "./admin";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const dns = new DnsBlocker();
const tracker = new ActivityTracker();
let blockingEnabled = false;
let blocklist = loadBlocklist();
let settings = loadSettings();

const isDev = !app.isPackaged;
const startHidden = process.argv.includes("--hidden");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function applyLaunchAtStartup(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ["--hidden"],
  });
}

function statusPayload() {
  return {
    blocking_enabled: blockingEnabled,
    blocking_active: dns.running,
    dns_redirect_ok: dns.dnsRedirectOk,
    blocklist_count: blocklist.length,
    launch_at_startup: settings.launchAtStartup,
    current_app: tracker.getCurrentApp(),
    current_domain: tracker.getCurrentDomain(),
    is_idle: tracker.getIsIdle(),
  };
}

async function startBlocking(): Promise<void> {
  dns.updateBlocklist(blocklist);
  await dns.start();
  blockingEnabled = true;
  settings.blockingEnabled = true;
  saveSettings(settings);
  setPendingBlocking(false);
}

async function stopBlocking(): Promise<void> {
  dns.stop();
  blockingEnabled = false;
  settings.blockingEnabled = false;
  saveSettings(settings);
  setPendingBlocking(false);
}

async function restoreBlockingOnLaunch(): Promise<void> {
  const pending = consumePendingBlocking();
  const shouldBlock = pending || settings.blockingEnabled;
  if (!shouldBlock) return;

  const admin = await isRunningAsAdmin();
  if (!admin) {
    setPendingBlocking(true);
    await relaunchAsAdmin();
    return;
  }

  try {
    await startBlocking();
    mainWindow?.webContents.send("blocking-changed");
  } catch {
    /* UI shows error on next status poll */
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 520,
    title: "Focus",
    show: !startHidden,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:1420");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, "../src-tauri/icons/32x32.png")
    : path.join(process.resourcesPath, "icon.png");

  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("Focus");
  const menu = Menu.buildFromTemplate([
    {
      label: "Open Focus",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerIpc(): void {
  ipcMain.handle("get_stats", () => tracker.getStats());
  ipcMain.handle("get_status", () => statusPayload());
  ipcMain.handle("get_blocklist", () => blocklist);

  ipcMain.handle("add_domain", (_e, domain: string) => {
    const normalized = domain.trim().toLowerCase();
    if (!normalized.includes(".")) throw new Error("Enter a valid domain (e.g. youtube.com)");
    if (!blocklist.includes(normalized)) blocklist.push(normalized);
    saveBlocklist(blocklist);
    dns.updateBlocklist(blocklist);
    return blocklist;
  });

  ipcMain.handle("remove_domain", (_e, domain: string) => {
    blocklist = blocklist.filter((d) => d !== domain);
    saveBlocklist(blocklist);
    dns.updateBlocklist(blocklist);
    return blocklist;
  });

  ipcMain.handle("set_blocking", async (_e, enabled: boolean) => {
    if (enabled) {
      const admin = await isRunningAsAdmin();
      if (!admin) {
        settings.blockingEnabled = true;
        saveSettings(settings);
        setPendingBlocking(true);
        await relaunchAsAdmin();
        return { ...statusPayload(), blocking_enabled: true };
      }
      await startBlocking();
    } else {
      await stopBlocking();
    }
    return statusPayload();
  });

  ipcMain.handle("set_launch_at_startup", (_e, enabled: boolean) => {
    settings.launchAtStartup = enabled;
    saveSettings(settings);
    applyLaunchAtStartup(enabled);
    return statusPayload();
  });

  ipcMain.handle("reset_today_stats", () => {
    tracker.resetStats();
  });
}

app.whenReady().then(async () => {
  dns.updateBlocklist(blocklist);
  applyLaunchAtStartup(settings.launchAtStartup);
  createWindow();
  createTray();
  registerIpc();

  tracker.setOnUpdate((stats) => {
    mainWindow?.webContents.send("stats-updated", stats);
  });
  tracker.start(() => dns.lastDomain);

  await restoreBlockingOnLaunch();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  tray = null;
  dns.stop();
  tracker.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    /* keep running in tray on Windows */
  }
});
