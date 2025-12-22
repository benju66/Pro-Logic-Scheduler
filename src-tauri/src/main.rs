// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod types;
mod engine_state;
mod commands;
mod date_utils;
mod cpm;

use tauri::{Emitter, Manager, WindowEvent};
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
            
            // Get main window
            let main_window = app.get_webview_window("main").unwrap();
            
            // Clone window reference for use in closure
            let window_for_emit = main_window.clone();
            
            // Listen for close request
            main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Prevent immediate close
                    api.prevent_close();
                    
                    // Signal frontend to flush data
                    // Frontend will call `close_window` command when ready
                    window_for_emit.emit("shutdown-requested", ()).ok();
                }
            });
            
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
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Called by frontend after shutdown flush is complete
#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}