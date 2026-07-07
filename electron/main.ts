import path from "path";
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { cleanupOrphanedBlocking, DnsBlocker } from "./dns";
import { ActivityTracker } from "./tracker";
import { loadBlocklist, loadSettings, saveBlocklist, saveSettings } from "./storage";
import {
  consumePendingBlocking,
  isRunningAsAdmin,
  relaunchAsAdmin,
  setPendingBlocking,
  signalShowExisting,
  startShowWindowWatcher,
  startQuitForInstallWatcher,
} from "./admin";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const dns = new DnsBlocker();
const tracker = new ActivityTracker();
let blockingEnabled = false;
let blocklist = loadBlocklist();
let settings = loadSettings();

const isDev = !app.isPackaged;
const startHidden = process.argv.includes("--hidden");
const forceShow = process.argv.includes("--show");

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  signalShowExisting();
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}

function launcherPath(): string {
  return path.join(path.dirname(process.execPath), "Focus-Admin.bat");
}

function applyLaunchAtStartup(enabled: boolean): void {
  if (!app.isPackaged) return;
  const bat = launcherPath();
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: bat,
    args: enabled ? ["--hidden"] : [],
  });
}

function statusPayload() {
  const enabled = blockingEnabled || settings.blockingEnabled;
  return {
    blocking_enabled: enabled,
    blocking_active: dns.running,
    dns_redirect_ok: dns.dnsRedirectOk,
    blocklist_count: blocklist.length,
    launch_at_startup: settings.launchAtStartup,
    is_admin: false as boolean,
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
  if (!shouldBlock) {
    await cleanupOrphanedBlocking();
    return;
  }
  if (!(await isRunningAsAdmin())) {
    await cleanupOrphanedBlocking();
    return;
  }
  try {
    await startBlocking();
  } catch {
    await cleanupOrphanedBlocking();
    settings.blockingEnabled = false;
    blockingEnabled = false;
    saveSettings(settings);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 520,
    title: "Focus",
    show: false,
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

  mainWindow.once("ready-to-show", () => {
    if (!startHidden || forceShow) showMainWindow();
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting && tray) {
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
    icon = nativeImage.createFromPath(
      path.join(__dirname, "../src-tauri/icons/32x32.png")
    );
  }

  tray = new Tray(icon);
  tray.setToolTip("Focus");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Focus", click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("double-click", () => showMainWindow());
}

function registerIpc(): void {
  ipcMain.handle("get_stats", () => tracker.getStats());

  ipcMain.handle("get_status", async () => ({
    ...statusPayload(),
    is_admin: await isRunningAsAdmin(),
  }));

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
      settings.blockingEnabled = true;
      saveSettings(settings);
      if (!(await isRunningAsAdmin())) {
        setPendingBlocking(true);
        await relaunchAsAdmin(["--show"]);
        return { ...statusPayload(), blocking_enabled: true, is_admin: false };
      }
      await startBlocking();
    } else {
      await stopBlocking();
    }
    return { ...statusPayload(), is_admin: await isRunningAsAdmin() };
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
  blockingEnabled = settings.blockingEnabled;

  createWindow();
  createTray();
  registerIpc();
  startShowWindowWatcher(showMainWindow);
  startQuitForInstallWatcher(() => {
    isQuitting = true;
    app.quit();
  });

  dns.updateBlocklist(blocklist);
  applyLaunchAtStartup(settings.launchAtStartup);

  tracker.setOnUpdate((stats) => {
    mainWindow?.webContents.send("stats-updated", stats);
  });
  tracker.start(() => dns.lastDomain);

  await restoreBlockingOnLaunch();
  mainWindow?.webContents.send("blocking-changed");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  tray?.destroy();
  tray = null;
  dns.stop();
  tracker.stop();
});

app.on("window-all-closed", () => {
  /* keep running in tray on Windows */
});
