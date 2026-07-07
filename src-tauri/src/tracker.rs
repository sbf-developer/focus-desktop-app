use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::Local;
use parking_lot::RwLock;

use crate::state::{storage, DailyStats};

pub struct ActivityTracker {
    data_dir: PathBuf,
    stats: RwLock<DailyStats>,
    current_app: RwLock<Option<String>>,
    current_domain: RwLock<Option<String>>,
    is_idle: AtomicBool,
    running: AtomicBool,
}

impl ActivityTracker {
    pub fn new(data_dir: PathBuf) -> Self {
        let stats = storage::load_stats(&data_dir);
        Self {
            data_dir,
            stats: RwLock::new(stats),
            current_app: RwLock::new(None),
            current_domain: RwLock::new(None),
            is_idle: AtomicBool::new(false),
            running: AtomicBool::new(false),
        }
    }

    pub fn tick(&self, app: Option<String>, domain: Option<String>, idle: bool) {
        self.is_idle.store(idle, Ordering::SeqCst);

        let today = Local::now().format("%Y-%m-%d").to_string();
        let mut stats = self.stats.write();

        if stats.date != today {
            let _ = storage::save_stats(&self.data_dir, &stats);
            *stats = DailyStats {
                date: today,
                ..Default::default()
            };
        }

        if idle {
            *self.current_app.write() = app.clone();
            *self.current_domain.write() = None;
            return;
        }

        if let Some(ref app_name) = app {
            *stats.apps.entry(app_name.clone()).or_insert(0) += 1;
            *self.current_app.write() = Some(app_name.clone());
        }

        if let Some(ref dom) = domain {
            let normalized = dom.trim_start_matches("www.").to_lowercase();
            if !normalized.is_empty() && is_trackable_domain(&normalized) {
                *stats.domains.entry(normalized).or_insert(0) += 1;
                *self.current_domain.write() = Some(dom.clone());
            }
        } else if is_browser(app.as_deref()) {
            if let Some(title_domain) = extract_domain_from_title(app.as_deref()) {
                *stats.domains.entry(title_domain.clone()).or_insert(0) += 1;
                *self.current_domain.write() = Some(title_domain);
            }
        }

        if stats.apps.values().sum::<u64>() % 30 == 0 {
            let snapshot = stats.clone();
            drop(stats);
            let _ = storage::save_stats(&self.data_dir, &snapshot);
        }
    }

    pub fn stats(&self) -> DailyStats {
        self.stats.read().clone()
    }

    pub fn current_app(&self) -> Option<String> {
        self.current_app.read().clone()
    }

    pub fn current_domain(&self) -> Option<String> {
        self.current_domain.read().clone()
    }

    pub fn is_idle(&self) -> bool {
        self.is_idle.load(Ordering::SeqCst)
    }

    pub fn reset_stats(&self) -> Result<(), String> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let stats = DailyStats {
            date: today,
            ..Default::default()
        };
        *self.stats.write() = stats.clone();
        storage::save_stats(&self.data_dir, &stats)
    }
}

fn is_trackable_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.contains('.')
        && !domain.ends_with(".local")
        && !domain.ends_with(".arpa")
        && domain != "localhost"
}

fn is_browser(app: Option<&str>) -> bool {
    matches!(
        app.map(|s| s.to_lowercase()),
        Some(ref n) if n.contains("chrome") || n.contains("firefox") || n.contains("msedge") || n.contains("brave")
    )
}

fn extract_domain_from_title(_app: Option<&str>) -> Option<String> {
    None
}

#[cfg(windows)]
pub fn get_foreground_app() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).ok()?;
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let exe = path.rsplit('\\').next()?.to_string();
        let name = friendly_app_name(&exe);

        // Window title for browser domain hints
        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title_buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&title_buf[..len as usize]);
            if let Some(domain) = domain_from_title(&title) {
                return Some(format!("{name}|{domain}"));
            }
        }

        Some(name)
    }
}

#[cfg(windows)]
pub fn is_user_idle(idle_seconds: u32) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let tick = windows::Win32::System::SystemInformation::GetTickCount();
            let elapsed = tick.wrapping_sub(info.dwTime) / 1000;
            return elapsed >= idle_seconds;
        }
        false
    }
}

#[cfg(not(windows))]
pub fn get_foreground_app() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn is_user_idle(_idle_seconds: u32) -> bool {
    false
}

#[cfg(windows)]
fn friendly_app_name(exe: &str) -> String {
    let lower = exe.to_lowercase();
    match lower.as_str() {
        "cursor.exe" => "Cursor".into(),
        "code.exe" => "VS Code".into(),
        "winword.exe" => "Word".into(),
        "excel.exe" => "Excel".into(),
        "powerpnt.exe" => "PowerPoint".into(),
        "outlook.exe" => "Outlook".into(),
        "chrome.exe" => "Chrome".into(),
        "firefox.exe" => "Firefox".into(),
        "msedge.exe" => "Edge".into(),
        "brave.exe" => "Brave".into(),
        "slack.exe" => "Slack".into(),
        "discord.exe" => "Discord".into(),
        "spotify.exe" => "Spotify".into(),
        "notion.exe" => "Notion".into(),
        "figma.exe" => "Figma".into(),
        _ => exe.trim_end_matches(".exe").to_string(),
    }
}

fn domain_from_title(title: &str) -> Option<String> {
    // "Video title - YouTube - Google Chrome" or "GitHub - Google Chrome"
    let parts: Vec<&str> = title.split(" - ").collect();
    if parts.len() >= 2 {
        let last = parts.last()?.to_lowercase();
        if last.contains("chrome") || last.contains("firefox") || last.contains("edge") || last.contains("brave") {
            let site = parts[parts.len() - 2].trim().to_lowercase();
            return map_site_name_to_domain(&site);
        }
    }
    None
}

fn map_site_name_to_domain(site: &str) -> Option<String> {
    let known = [
        ("youtube", "youtube.com"),
        ("reddit", "reddit.com"),
        ("twitter", "twitter.com"),
        ("x", "x.com"),
        ("github", "github.com"),
        ("facebook", "facebook.com"),
        ("instagram", "instagram.com"),
        ("tiktok", "tiktok.com"),
        ("linkedin", "linkedin.com"),
        ("netflix", "netflix.com"),
    ];
    for (name, domain) in known {
        if site.contains(name) {
            return Some(domain.into());
        }
    }
    if site.contains('.') {
        return Some(site.to_string());
    }
    None
}
