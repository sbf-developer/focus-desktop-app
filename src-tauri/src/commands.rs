use tauri::State;

use crate::state::{storage, AppState, AppStatus, DailyStats};

#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> DailyStats {
    state.tracker.stats()
}

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> AppStatus {
    AppStatus {
        blocking_enabled: *state.blocking_enabled.read(),
        blocking_active: state.dns.is_running(),
        blocklist_count: state.blocklist.read().len(),
        current_app: state.tracker.current_app(),
        current_domain: state.tracker.current_domain(),
        is_idle: state.tracker.is_idle(),
    }
}

#[tauri::command]
pub fn get_blocklist(state: State<'_, AppState>) -> Vec<String> {
    state.blocklist.read().clone()
}

#[tauri::command]
pub fn add_domain(state: State<'_, AppState>, domain: String) -> Result<Vec<String>, String> {
    let normalized = domain.trim().to_lowercase();
    if normalized.is_empty() || !normalized.contains('.') {
        return Err("Enter a valid domain (e.g. youtube.com)".into());
    }
    let mut list = state.blocklist.write();
    if !list.iter().any(|d| d == &normalized) {
        list.push(normalized);
    }
    storage::save_blocklist(&state.data_dir, &list)?;
    state.dns.update_blocklist(list.clone());
    Ok(list.clone())
}

#[tauri::command]
pub fn remove_domain(state: State<'_, AppState>, domain: String) -> Result<Vec<String>, String> {
    let mut list = state.blocklist.write();
    list.retain(|d| d != &domain);
    storage::save_blocklist(&state.data_dir, &list)?;
    state.dns.update_blocklist(list.clone());
    Ok(list.clone())
}

#[tauri::command]
pub fn set_blocking(state: State<'_, AppState>, enabled: bool) -> Result<AppStatus, String> {
    if enabled {
        state.dns.start()?;
        *state.blocking_enabled.write() = true;
    } else {
        state.dns.stop();
        *state.blocking_enabled.write() = false;
    }
    Ok(get_status(state))
}

#[tauri::command]
pub fn reset_today_stats(state: State<'_, AppState>) -> Result<(), String> {
    state.tracker.reset_stats()
}
