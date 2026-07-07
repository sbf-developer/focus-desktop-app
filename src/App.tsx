import { useCallback, useEffect, useState } from "react";
import { api, formatDuration, sortedEntries, displayDomain } from "./api";
import type { AppStatus, DailyStats, Tab } from "./types";

function ActivityList({
  items,
  empty,
}: {
  items: [string, number][];
  empty: string;
}) {
  const max = items[0]?.[1] ?? 1;
  if (items.length === 0) {
    return <div className="empty-state">{empty}</div>;
  }
  return (
    <div className="activity-list">
      {items.map(([name, secs]) => {
        const label = displayDomain(name);
        return (
        <div className="activity-row" key={name}>
          <span className="activity-name" title={name}>
            {label}
          </span>
          <div className="activity-bar-wrap">
            <div
              className="activity-bar"
              style={{ width: `${Math.round((secs / max) * 100)}%` }}
            />
          </div>
          <span className="activity-time">{formatDuration(secs)}</span>
        </div>
        );
      })}
    </div>
  );
}

function Dashboard({
  stats,
  status,
}: {
  stats: DailyStats;
  status: AppStatus;
}) {
  const appTotal = Object.values(stats.apps).reduce((a, b) => a + b, 0);
  const domainTotal = Object.values(stats.domains).reduce((a, b) => a + b, 0);
  const topApp = sortedEntries(stats.apps)[0];

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div className="now-card">
        <div
          className={`now-indicator${status.is_idle ? " idle" : ""}`}
        />
        <div>
          <div className="now-label">
            {status.is_idle ? "Idle" : "Active now"}
          </div>
          <div className="now-value">
            {status.is_idle
              ? "Away from keyboard"
              : status.current_app ?? "—"}
            {!status.is_idle && status.current_domain && (
              <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                {" "}
                · {status.current_domain}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">App time</div>
          <div className="stat-value">{formatDuration(appTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Web time</div>
          <div className="stat-value">{formatDuration(domainTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Top app</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {topApp ? topApp[0] : "—"}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Apps</div>
          <ActivityList
            items={sortedEntries(stats.apps).slice(0, 8)}
            empty="Start using apps — time will appear here."
          />
        </div>
        <div className="card">
          <div className="card-title">Websites</div>
          <ActivityList
            items={sortedEntries(stats.domains).slice(0, 8)}
            empty="Browse the web — domains will appear here."
          />
        </div>
      </div>
    </>
  );
}

function BlockPage({
  blocklist,
  status,
  onToggle,
  onToggleStartup,
  onAdd,
  onRemove,
  error,
}: {
  blocklist: string[];
  status: AppStatus;
  onToggle: (v: boolean) => void;
  onToggleStartup: (v: boolean) => void;
  onAdd: (d: string) => void;
  onRemove: (d: string) => void;
  error: string | null;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const d = input.trim();
    if (d) {
      onAdd(d);
      setInput("");
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Block</h1>
        <p className="page-subtitle">
          Block distracting sites across your entire computer.
        </p>
      </div>

      <div className="banner banner-info">
        Turning blocking on will request Administrator access (needed for DNS).
        Restart Chrome or Edge after enabling if a blocked site still loads.
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <div className="block-hero">
          <div className="block-hero-text">
            <h2>
              {status.blocking_active ? "Blocking active" : "Blocking off"}
            </h2>
            <p>
              {status.blocking_active
                ? `${status.blocklist_count} domains blocked system-wide`
                : "Enable to block your blocklist on all browsers and apps"}
            </p>
            {status.blocking_active && (
              <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                Restart Chrome or Edge if a blocked site still loads after enabling.
              </p>
            )}
          </div>
          <button
            className={`toggle-btn${status.blocking_enabled || status.blocking_active ? " on" : ""}`}
            onClick={() => onToggle(!(status.blocking_enabled || status.blocking_active))}
            aria-label="Toggle blocking"
          />
        </div>

        <div className="domain-input-row">
          <input
            className="input"
            placeholder="Add domain — e.g. youtube.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd}>
            Add
          </button>
        </div>

        <div className="domain-list">
          {blocklist.length === 0 ? (
            <div className="empty-state">No domains in your blocklist.</div>
          ) : (
            blocklist.map((d) => (
              <div className="domain-row" key={d}>
                <span className="domain-name">{d}</span>
                <button
                  className="domain-remove"
                  onClick={() => onRemove(d)}
                  aria-label={`Remove ${d}`}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="block-hero">
          <div className="block-hero-text">
            <h2>Run in background</h2>
            <p>
              Start Focus automatically when you log in. It stays in the system
              tray, keeps tracking activity, and restores blocking if you left
              it on.
            </p>
          </div>
          <button
            className={`toggle-btn${status.launch_at_startup ? " on" : ""}`}
            onClick={() => onToggleStartup(!status.launch_at_startup)}
            aria-label="Start with Windows"
          />
        </div>
      </div>
    </>
  );
}

function ActivityPage({ stats }: { stats: DailyStats }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Full breakdown of today's usage.</p>
      </div>

      <div className="card">
        <div className="card-title">Applications</div>
        <ActivityList
          items={sortedEntries(stats.apps)}
          empty="No app activity recorded yet today."
        />
      </div>

      <div className="card">
        <div className="card-title">Websites</div>
        <ActivityList
          items={sortedEntries(stats.domains)}
          empty="No website activity recorded yet today."
        />
      </div>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<DailyStats>({
    apps: {},
    domains: {},
    date: "",
  });
  const [status, setStatus] = useState<AppStatus>({
    blocking_enabled: false,
    blocking_active: false,
    dns_redirect_ok: false,
    blocklist_count: 0,
    launch_at_startup: true,
    current_app: null,
    current_domain: null,
    is_idle: false,
  });
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("focus-sidebar") === "collapsed"
  );
  const [narrowWindow, setNarrowWindow] = useState(
    () => window.innerWidth < 900
  );

  useEffect(() => {
    const onResize = () => setNarrowWindow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const sidebarMinimized = sidebarCollapsed || narrowWindow;

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("focus-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  };

  const refresh = useCallback(async () => {
    const [s, st, bl] = await Promise.all([
      api.getStats(),
      api.getStatus(),
      api.getBlocklist(),
    ]);
    setStats(s);
    setStatus(st);
    setBlocklist(bl);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    const unsubStats = window.focusApp?.onStatsUpdated((s: DailyStats) =>
      setStats(s)
    );
    const unsubBlocking = window.focusApp?.onBlockingChanged(() => refresh());
    return () => {
      clearInterval(interval);
      unsubStats?.();
      unsubBlocking?.();
    };
  }, [refresh]);

  const handleToggle = async (enabled: boolean) => {
    setError(null);
    try {
      const st = await api.setBlocking(enabled);
      setStatus(st);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleStartup = async (enabled: boolean) => {
    setError(null);
    try {
      const st = await api.setLaunchAtStartup(enabled);
      setStatus(st);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAdd = async (domain: string) => {
    setError(null);
    try {
      const bl = await api.addDomain(domain);
      setBlocklist(bl);
      setStatus(await api.getStatus());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRemove = async (domain: string) => {
    const bl = await api.removeDomain(domain);
    setBlocklist(bl);
    setStatus(await api.getStatus());
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "block", label: "Block", icon: "⊘" },
    { id: "activity", label: "Activity", icon: "≡" },
  ];

  return (
    <div className={`app${sidebarMinimized ? " sidebar-minimized" : ""}`}>
      <aside className={`sidebar${sidebarMinimized ? " collapsed" : ""}`}>
        <div className="sidebar-top">
          <div className="logo">{sidebarMinimized ? "F" : "Focus"}</div>
          {!narrowWindow && (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "›" : "‹"}
            </button>
          )}
        </div>
        <nav className="nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`nav-item${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
              title={sidebarMinimized ? t.label : undefined}
            >
              <span className="nav-icon">{t.icon}</span>
              <span className="nav-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-pill" title={status.blocking_active ? "Blocking on" : "Blocking off"}>
            <span
              className={`status-dot${status.blocking_active ? " active" : ""}`}
            />
            <span className="status-label">
              {status.blocking_active ? "Blocking on" : "Blocking off"}
            </span>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === "dashboard" && (
          <Dashboard stats={stats} status={status} />
        )}
        {tab === "block" && (
          <BlockPage
            blocklist={blocklist}
            status={status}
            onToggle={handleToggle}
            onToggleStartup={handleToggleStartup}
            onAdd={handleAdd}
            onRemove={handleRemove}
            error={error}
          />
        )}
        {tab === "activity" && <ActivityPage stats={stats} />}
      </main>
    </div>
  );
}
