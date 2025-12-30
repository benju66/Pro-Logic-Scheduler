// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Pro Logic Scheduler - Tauri Desktop Application
//! 
//! PHASE 7: Simplified Backend
//! 
//! The Rust backend is now a minimal layer that provides:
//! - SQLite database access (via tauri-plugin-sql)
//! - File system access (via tauri-plugin-fs)
//! - Dialog support (via tauri-plugin-dialog)
//! - Shell commands (via tauri-plugin-shell)
//! - Window management (close_window command)
//! 
//! All scheduling calculations now happen in the WASM Worker.
//! State management is handled by ProjectController in TypeScript.
//! Persistence uses event sourcing via PersistenceService -> SQLite.

use tauri::{Emitter, Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        // SQLite database (used by PersistenceService and DataLoader)
        .plugin(tauri_plugin_sql::Builder::default().build())
        // File system access (for import/export)
        .plugin(tauri_plugin_fs::init())
        // Shell commands
        .plugin(tauri_plugin_shell::init())
        // File dialogs
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Automatically open DevTools in debug mode
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            
            // Get main window
            let main_window = app.get_webview_window("main").unwrap();
            
            // Clone window reference for use in closure
            let window_for_emit = main_window.clone();
            
            // Listen for close request - signal frontend to flush data
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
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Called by frontend after shutdown flush is complete
#[tauri::command]
async fn close_window(app: tauri::AppHandle) {
    app.exit(0);
}
