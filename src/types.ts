export interface DailyStats {
  apps: Record<string, number>;
  domains: Record<string, number>;
  date: string;
}

export interface AppStatus {
  blocking_enabled: boolean;
  blocking_active: boolean;
  dns_redirect_ok: boolean;
  blocklist_count: number;
  launch_at_startup: boolean;
  networking_ok: boolean;
  networking_issues: string[];
  current_app: string | null;
  current_domain: string | null;
  is_idle: boolean;
}

export type Tab = "dashboard" | "block" | "activity";
