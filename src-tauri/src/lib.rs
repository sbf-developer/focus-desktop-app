mod commands;
mod dns;
mod state;
mod tracker;

use std::thread;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};

use state::AppState;
use tracker::{get_foreground_app, is_user_idle};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = state::storage::data_dir();
    let app_state = AppState::new(data_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Focus", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Focus")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            start_background_services(app.handle().clone());

            if let Some(state) = app.try_state::<AppState>() {
                state.dns.ensure_unblocked_if_not_running();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_stats,
            commands::get_status,
            commands::get_blocklist,
            commands::add_domain,
            commands::remove_domain,
            commands::set_blocking,
            commands::reset_today_stats,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.dns.stop();
                    let stats = state.tracker.stats();
                    let _ = state::storage::save_stats(&state.data_dir, &stats);
                }
            }
        });
}

fn start_background_services(handle: tauri::AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));

            let Some(app_state) = handle.try_state::<AppState>() else {
                break;
            };

            let idle = is_user_idle(120);
            let raw_app = get_foreground_app();

            let (app, domain_from_title) = match raw_app {
                Some(ref s) if s.contains('|') => {
                    let parts: Vec<&str> = s.splitn(2, '|').collect();
                    (Some(parts[0].to_string()), parts.get(1).map(|d| d.to_string()))
                }
                other => (other, None),
            };

            let dns_domain = app_state.dns.last_domain();
            let domain = dns_domain.or(domain_from_title);

            app_state.tracker.tick(app, domain, idle);

            let _ = handle.emit("stats-updated", app_state.tracker.stats());
        }
    });
}
