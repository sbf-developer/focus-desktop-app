import path from "path";
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { DnsBlocker } from "./dns";
import { ActivityTracker } from "./tracker";
import { loadBlocklist, saveBlocklist } from "./storage";
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

const isDev = !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 520,
    title: "Focus",
    show: true,
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

  ipcMain.handle("get_status", () => ({
    blocking_enabled: blockingEnabled,
    blocking_active: dns.running,
    dns_redirect_ok: dns.dnsRedirectOk,
    blocklist_count: blocklist.length,
    current_app: tracker.getCurrentApp(),
    current_domain: tracker.getCurrentDomain(),
    is_idle: tracker.getIsIdle(),
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
      const admin = await isRunningAsAdmin();
      if (!admin) {
        setPendingBlocking(true);
        await relaunchAsAdmin();
        return {
          blocking_enabled: false,
          blocking_active: false,
          dns_redirect_ok: false,
          blocklist_count: blocklist.length,
          current_app: tracker.getCurrentApp(),
          current_domain: tracker.getCurrentDomain(),
          is_idle: tracker.getIsIdle(),
        };
      }
      dns.updateBlocklist(blocklist);
      await dns.start();
      blockingEnabled = true;
    } else {
      setPendingBlocking(false);
      dns.stop();
      blockingEnabled = false;
    }
    return {
      blocking_enabled: blockingEnabled,
      blocking_active: dns.running,
      dns_redirect_ok: dns.dnsRedirectOk,
      blocklist_count: blocklist.length,
      current_app: tracker.getCurrentApp(),
      current_domain: tracker.getCurrentDomain(),
      is_idle: tracker.getIsIdle(),
    };
  });

  ipcMain.handle("reset_today_stats", () => {
    tracker.resetStats();
  });
}

app.whenReady().then(async () => {
  dns.updateBlocklist(blocklist);
  createWindow();
  createTray();
  registerIpc();

  tracker.setOnUpdate((stats) => {
    mainWindow?.webContents.send("stats-updated", stats);
  });
  tracker.start(() => dns.lastDomain);

  if (consumePendingBlocking() && (await isRunningAsAdmin())) {
    try {
      dns.updateBlocklist(blocklist);
      await dns.start();
      blockingEnabled = true;
      mainWindow?.webContents.send("blocking-changed");
    } catch {
      /* UI will show error on next status poll */
    }
  }

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
