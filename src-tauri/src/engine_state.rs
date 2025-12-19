//! Engine State Container
//! 
//! Manages the stateful project data for the Rust CPM engine.
//! Uses Mutex for thread-safe access from Tauri commands.

use std::collections::HashMap;
use std::sync::Mutex;
use crate::types::{Task, Calendar, CPMResult, CPMStats};

/// Project state container
/// 
/// Holds all data needed for CPM calculations.
/// Protected by Mutex for thread-safe access.
#[derive(Default)]
pub struct ProjectState {
    /// Tasks indexed by ID for O(1) lookup
    pub tasks: HashMap<String, Task>,
    
    /// Task order for iteration (maintains sortKey order)
    pub task_order: Vec<String>,
    
    /// Calendar configuration
    pub calendar: Option<Calendar>,
    
    /// Initialization flag
    pub initialized: bool,
}

impl ProjectState {
    /// Create new empty state
    pub fn new() -> Self {
        Self::default()
    }

    /// Load tasks from array
    pub fn load_tasks(&mut self, tasks: Vec<Task>) {
        // Store task order
        self.task_order = tasks.iter().map(|t| t.id.clone()).collect();
        
        // Index by ID for fast lookup
        self.tasks = tasks.into_iter().map(|t| (t.id.clone(), t)).collect();
    }

    /// Update a single task
    pub fn update_task(&mut self, id: &str, updates: serde_json::Value) -> Result<(), String> {
        if let Some(task) = self.tasks.get_mut(id) {
            // Apply updates from JSON object
            if let Some(obj) = updates.as_object() {
                for (key, value) in obj {
                    match key.as_str() {
                        "name" => {
                            if let Some(v) = value.as_str() {
                                task.name = v.to_string();
                            }
                        }
                        "duration" => {
                            if let Some(v) = value.as_i64() {
                                task.duration = v as i32;
                            }
                        }
                        "start" => {
                            if let Some(v) = value.as_str() {
                                task.start = v.to_string();
                            }
                        }
                        "end" => {
                            if let Some(v) = value.as_str() {
                                task.end = v.to_string();
                            }
                        }
                        "progress" => {
                            if let Some(v) = value.as_i64() {
                                task.progress = v as i32;
                            }
                        }
                        "constraintType" => {
                            if let Some(v) = value.as_str() {
                                task.constraint_type = v.to_string();
                            }
                        }
                        "constraintDate" => {
                            task.constraint_date = value.as_str().map(|s| s.to_string());
                        }
                        "notes" => {
                            if let Some(v) = value.as_str() {
                                task.notes = v.to_string();
                            }
                        }
                        "parentId" => {
                            task.parent_id = value.as_str().map(|s| s.to_string());
                        }
                        "level" => {
                            if let Some(v) = value.as_i64() {
                                task.level = v as i32;
                            }
                        }
                        "sortKey" => {
                            if let Some(v) = value.as_str() {
                                task.sort_key = v.to_string();
                            }
                        }
                        // Add more fields as needed
                        _ => {
                            // Ignore unknown fields for forward compatibility
                        }
                    }
                }
            }
            Ok(())
        } else {
            Err(format!("Task {} not found", id))
        }
    }

    /// Get all tasks in order
    pub fn get_tasks_ordered(&self) -> Vec<Task> {
        self.task_order
            .iter()
            .filter_map(|id| self.tasks.get(id).cloned())
            .collect()
    }

    /// Get task count
    pub fn task_count(&self) -> usize {
        self.tasks.len()
    }

    /// Clear all state
    pub fn clear(&mut self) {
        self.tasks.clear();
        self.task_order.clear();
        self.calendar = None;
        self.initialized = false;
    }

    /// Create a passthrough CPMResult (returns tasks as-is)
    /// Used until actual Rust CPM is implemented
    pub fn create_passthrough_result(&self) -> CPMResult {
        let tasks = self.get_tasks_ordered();
        let task_count = tasks.len() as i32;
        
        // Find project end (max end date)
        let project_end = tasks
            .iter()
            .map(|t| t.end.as_str())
            .max()
            .unwrap_or("")
            .to_string();

        CPMResult {
            tasks,
            stats: CPMStats {
                calc_time: 0.0,
                task_count,
                critical_count: 0,
                project_end,
                duration: 0,
                error: Some("Rust CPM not yet implemented - using passthrough".to_string()),
            },
        }
    }
}

/// Application state wrapper for Tauri
/// 
/// Use with `tauri::Builder::manage()` for dependency injection
pub struct AppState {
    pub project: Mutex<ProjectState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project: Mutex::new(ProjectState::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

