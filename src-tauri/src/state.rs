use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::dns::DnsServer;
use crate::tracker::ActivityTracker;

pub struct AppState {
    pub blocking_enabled: RwLock<bool>,
    pub blocklist: RwLock<Vec<String>>,
    pub tracker: ActivityTracker,
    pub dns: Arc<DnsServer>,
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DailyStats {
    pub apps: HashMap<String, u64>,
    pub domains: HashMap<String, u64>,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatus {
    pub blocking_enabled: bool,
    pub blocking_active: bool,
    pub blocklist_count: usize,
    pub current_app: Option<String>,
    pub current_domain: Option<String>,
    pub is_idle: bool,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        let blocklist = storage::load_blocklist(&data_dir);
        let dns = Arc::new(DnsServer::new(blocklist.clone()));
        Self {
            blocking_enabled: RwLock::new(false),
            blocklist: RwLock::new(blocklist),
            tracker: ActivityTracker::new(data_dir.clone()),
            dns,
            data_dir,
        }
    }
}

pub mod storage {
    use super::*;
    use chrono::Local;
    use std::fs;

    pub fn data_dir() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Focus")
    }

    pub fn load_blocklist(dir: &PathBuf) -> Vec<String> {
        let path = dir.join("blocklist.json");
        if path.exists() {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(list) = serde_json::from_str::<Vec<String>>(&data) {
                    return list;
                }
            }
        }
        default_blocklist()
    }

    pub fn save_blocklist(dir: &PathBuf, list: &[String]) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join("blocklist.json");
        let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn load_stats(dir: &PathBuf) -> DailyStats {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let path = dir.join(format!("stats-{today}.json"));
        if path.exists() {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(stats) = serde_json::from_str::<DailyStats>(&data) {
                    return stats;
                }
            }
        }
        DailyStats {
            date: today,
            ..Default::default()
        }
    }

    pub fn save_stats(dir: &PathBuf, stats: &DailyStats) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("stats-{}.json", stats.date));
        let json = serde_json::to_string_pretty(stats).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    fn default_blocklist() -> Vec<String> {
        vec![
            "youtube.com".into(),
            "www.youtube.com".into(),
            "twitter.com".into(),
            "x.com".into(),
            "www.reddit.com".into(),
            "reddit.com".into(),
            "facebook.com".into(),
            "instagram.com".into(),
            "tiktok.com".into(),
        ]
    }
}
