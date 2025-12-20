// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod types;
mod engine_state;
mod commands;
mod date_utils;
mod cpm;

use tauri::Manager;
use engine_state::AppState;
use commands::{
    initialize_engine,
    update_engine_task,
    add_engine_task,
    delete_engine_task,
    sync_engine_tasks,
    calculate_cpm,
    get_engine_status,
    clear_engine,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            // Automatically open DevTools in debug mode
            #[cfg(debug_assertions)]
            {
                // Tauri 2.x uses get_webview_window instead of get_window
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_engine,
            update_engine_task,
            add_engine_task,
            delete_engine_task,
            sync_engine_tasks,
            calculate_cpm,
            get_engine_status,
            clear_engine,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}