import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("focusApp", {
  getStats: () => ipcRenderer.invoke("get_stats"),
  getStatus: () => ipcRenderer.invoke("get_status"),
  getBlocklist: () => ipcRenderer.invoke("get_blocklist"),
  addDomain: (domain: string) => ipcRenderer.invoke("add_domain", domain),
  removeDomain: (domain: string) => ipcRenderer.invoke("remove_domain", domain),
  setBlocking: (enabled: boolean) => ipcRenderer.invoke("set_blocking", enabled),
  setLaunchAtStartup: (enabled: boolean) =>
    ipcRenderer.invoke("set_launch_at_startup", enabled),
  resetTodayStats: () => ipcRenderer.invoke("reset_today_stats"),
  onStatsUpdated: (cb: (stats: unknown) => void) => {
    const handler = (_: unknown, stats: unknown) => cb(stats);
    ipcRenderer.on("stats-updated", handler);
    return () => ipcRenderer.removeListener("stats-updated", handler);
  },
  onBlockingChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("blocking-changed", handler);
    return () => ipcRenderer.removeListener("blocking-changed", handler);
  },
});
