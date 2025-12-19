//! Tauri Commands for Scheduling Engine
//! 
//! These commands are invoked from TypeScript via `invoke()`

use tauri::State;
use crate::engine_state::AppState;
use crate::types::{Task, Calendar, CPMResult};

/// Initialize the engine state with tasks and calendar
/// 
/// Called from RustEngine.initialize()
#[tauri::command]
pub fn initialize_engine(
    tasks_json: String,
    calendar_json: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Parse tasks
    let tasks: Vec<Task> = serde_json::from_str(&tasks_json)
        .map_err(|e| format!("Failed to parse tasks: {}", e))?;
    
    // Parse calendar
    let calendar: Calendar = serde_json::from_str(&calendar_json)
        .map_err(|e| format!("Failed to parse calendar: {}", e))?;

    // Lock state and update
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;
    
    project.load_tasks(tasks);
    project.calendar = Some(calendar);
    project.initialized = true;

    let count = project.task_count();
    println!("[Rust Engine] Initialized with {} tasks", count);
    
    Ok(format!("Initialized with {} tasks", count))
}

/// Update a single task in the engine state
/// 
/// Called from RustEngine.updateTask()
/// Assumes the task already exists
#[tauri::command]
pub fn update_engine_task(
    id: String,
    updates_json: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Parse updates as generic JSON value
    let updates: serde_json::Value = serde_json::from_str(&updates_json)
        .map_err(|e| format!("Failed to parse updates: {}", e))?;

    // Lock state and update
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    if !project.initialized {
        return Err("Engine not initialized".to_string());
    }

    project.update_task(&id, updates)?;
    
    Ok("Updated".to_string())
}

/// Add a new task to the engine state
/// 
/// Called from RustEngine.addTask()
#[tauri::command]
pub fn add_engine_task(
    task_json: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Parse task
    let task: Task = serde_json::from_str(&task_json)
        .map_err(|e| format!("Failed to parse task: {}", e))?;

    // Lock state and add
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    if !project.initialized {
        return Err("Engine not initialized".to_string());
    }

    project.add_task(task);
    
    println!("[Rust Engine] Added task");
    Ok("Added".to_string())
}

/// Delete a task from the engine state
/// 
/// Called from RustEngine.deleteTask()
#[tauri::command]
pub fn delete_engine_task(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Lock state and delete
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    if !project.initialized {
        return Err("Engine not initialized".to_string());
    }

    project.delete_task(&id)?;
    
    println!("[Rust Engine] Deleted task {}", id);
    Ok("Deleted".to_string())
}

/// Sync all tasks (bulk update)
/// 
/// Called from RustEngine.syncTasks()
#[tauri::command]
pub fn sync_engine_tasks(
    tasks_json: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tasks: Vec<Task> = serde_json::from_str(&tasks_json)
        .map_err(|e| format!("Failed to parse tasks: {}", e))?;

    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    if !project.initialized {
        return Err("Engine not initialized".to_string());
    }

    let count = tasks.len();
    project.load_tasks(tasks);
    
    println!("[Rust Engine] Synced {} tasks", count);
    Ok(format!("Synced {} tasks", count))
}

/// Run CPM calculation
/// 
/// Called from RustEngine.recalculateAll()
/// Uses actual Rust CPM implementation
#[tauri::command]
pub fn calculate_cpm(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    if !project.initialized {
        return Err("Engine not initialized".to_string());
    }

    // Get calendar - must be initialized
    let calendar = project.calendar.as_ref()
        .ok_or("Calendar not initialized".to_string())?;

    // Get tasks as mutable vector
    let mut tasks = project.get_tasks_ordered();
    
    // Run CPM calculation
    use crate::cpm::calculate;
    let result = calculate(&mut tasks, calendar);
    
    // Update project state with calculated tasks
    project.load_tasks(result.tasks.clone());
    
    serde_json::to_string(&result)
        .map_err(|e| format!("Failed to serialize result: {}", e))
}

/// Get engine status (for debugging)
#[tauri::command]
pub fn get_engine_status(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    Ok(format!(
        "{{ \"initialized\": {}, \"taskCount\": {}, \"hasCalendar\": {} }}",
        project.initialized,
        project.task_count(),
        project.calendar.is_some()
    ))
}

/// Clear engine state
#[tauri::command]
pub fn clear_engine(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut project = state.project.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))?;

    project.clear();
    
    Ok("Cleared".to_string())
}

