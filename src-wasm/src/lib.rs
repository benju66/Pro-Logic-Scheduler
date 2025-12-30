//! Pro Logic Scheduler - WASM CPM Engine
//!
//! This crate provides a WebAssembly-compatible CPM (Critical Path Method)
//! scheduling engine. It exposes a `SchedulerEngine` class to JavaScript
//! that can be used directly or via a Web Worker.
//!
//! ## Usage from JavaScript
//!
//! ```javascript
//! import init, { SchedulerEngine } from 'scheduler_wasm';
//!
//! await init();
//! const engine = new SchedulerEngine();
//! engine.initialize(tasks, calendar);
//! const result = engine.calculate();
//! ```

mod utils;
mod types;
mod cpm;
mod date_utils;

use wasm_bindgen::prelude::*;
use crate::types::{Task, Calendar};

// Import console.log for debugging
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
    
    #[wasm_bindgen(js_namespace = console)]
    fn warn(s: &str);
    
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
}

/// Log macro for console output
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (crate::log(&format_args!($($t)*).to_string()))
}

/// The main scheduler engine exposed to JavaScript
/// 
/// This struct holds the task list and calendar configuration,
/// and provides methods for CPM calculation.
#[wasm_bindgen]
pub struct SchedulerEngine {
    tasks: Vec<Task>,
    calendar: Option<Calendar>,
    initialized: bool,
}

#[wasm_bindgen]
impl SchedulerEngine {
    /// Create a new SchedulerEngine instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> SchedulerEngine {
        utils::set_panic_hook();
        log("[WASM] SchedulerEngine created");
        SchedulerEngine {
            tasks: Vec::new(),
            calendar: None,
            initialized: false,
        }
    }

    /// Initialize the engine with tasks and calendar
    /// 
    /// # Arguments
    /// * `tasks_val` - JavaScript array of Task objects
    /// * `calendar_val` - JavaScript Calendar object
    /// 
    /// # Returns
    /// Ok(()) on success, or a JsValue error
    pub fn initialize(&mut self, tasks_val: JsValue, calendar_val: JsValue) -> Result<(), JsValue> {
        // Deserialize from JS objects
        let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_val)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
        
        let calendar: Calendar = serde_wasm_bindgen::from_value(calendar_val)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize calendar: {}", e)))?;
        
        self.tasks = tasks;
        self.calendar = Some(calendar);
        self.initialized = true;
        
        log(&format!("[WASM] Engine initialized with {} tasks", self.tasks.len()));
        Ok(())
    }

    /// Add a new task to the engine
    pub fn add_task(&mut self, task_val: JsValue) -> Result<(), JsValue> {
        if !self.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        
        let task: Task = serde_wasm_bindgen::from_value(task_val)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize task: {}", e)))?;
        
        self.tasks.push(task);
        Ok(())
    }

    /// Update an existing task
    /// 
    /// # Arguments
    /// * `task_id` - ID of the task to update
    /// * `updates_val` - JavaScript object with fields to update
    pub fn update_task(&mut self, task_id: String, updates_val: JsValue) -> Result<(), JsValue> {
        if !self.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        // Find the task
        let task_index = self.tasks.iter().position(|t| t.id == task_id);
        
        if let Some(index) = task_index {
            // Parse updates as JSON value to handle partial updates
            let updates: serde_json::Value = serde_wasm_bindgen::from_value(updates_val)
                .map_err(|e| JsValue::from_str(&format!("Failed to deserialize updates: {}", e)))?;
            
            // Apply updates to the task
            let task = &mut self.tasks[index];
            
            if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
                task.name = name.to_string();
            }
            if let Some(duration) = updates.get("duration").and_then(|v| v.as_i64()) {
                task.duration = duration as i32;
            }
            if let Some(start) = updates.get("start").and_then(|v| v.as_str()) {
                task.start = start.to_string();
            }
            if let Some(end) = updates.get("end").and_then(|v| v.as_str()) {
                task.end = end.to_string();
            }
            if let Some(constraint_type) = updates.get("constraintType").and_then(|v| v.as_str()) {
                task.constraint_type = constraint_type.to_string();
            }
            if let Some(constraint_date) = updates.get("constraintDate") {
                task.constraint_date = constraint_date.as_str().map(|s| s.to_string());
            }
            if let Some(scheduling_mode) = updates.get("schedulingMode").and_then(|v| v.as_str()) {
                task.scheduling_mode = scheduling_mode.to_string();
            }
            if let Some(progress) = updates.get("progress").and_then(|v| v.as_i64()) {
                task.progress = progress as i32;
            }
            if let Some(notes) = updates.get("notes").and_then(|v| v.as_str()) {
                task.notes = notes.to_string();
            }
            if let Some(parent_id) = updates.get("parentId") {
                task.parent_id = parent_id.as_str().map(|s| s.to_string());
            }
            if let Some(sort_key) = updates.get("sortKey").and_then(|v| v.as_str()) {
                task.sort_key = sort_key.to_string();
            }
            
            Ok(())
        } else {
            Err(JsValue::from_str(&format!("Task not found: {}", task_id)))
        }
    }

    /// Delete a task by ID
    pub fn delete_task(&mut self, task_id: String) -> Result<(), JsValue> {
        if !self.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        let original_len = self.tasks.len();
        self.tasks.retain(|t| t.id != task_id);
        
        if self.tasks.len() == original_len {
            Err(JsValue::from_str(&format!("Task not found: {}", task_id)))
        } else {
            Ok(())
        }
    }

    /// Sync all tasks (bulk replace)
    pub fn sync_tasks(&mut self, tasks_val: JsValue) -> Result<(), JsValue> {
        let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_val)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize tasks: {}", e)))?;
        
        self.tasks = tasks;
        log(&format!("[WASM] Synced {} tasks", self.tasks.len()));
        Ok(())
    }

    /// Update calendar configuration
    pub fn update_calendar(&mut self, calendar_val: JsValue) -> Result<(), JsValue> {
        let calendar: Calendar = serde_wasm_bindgen::from_value(calendar_val)
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize calendar: {}", e)))?;
        
        self.calendar = Some(calendar);
        log("[WASM] Calendar updated");
        Ok(())
    }

    /// Run CPM calculation and return results
    /// 
    /// # Returns
    /// A JavaScript object containing:
    /// - `tasks`: Array of tasks with calculated dates
    /// - `stats`: Calculation statistics
    pub fn calculate(&mut self) -> Result<JsValue, JsValue> {
        if !self.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        let calendar = self.calendar.as_ref()
            .ok_or_else(|| JsValue::from_str("Calendar not initialized"))?;
        
        // Run CPM calculation
        let result = cpm::calculate(&mut self.tasks, calendar);
        
        // Update internal tasks with calculated values
        self.tasks = result.tasks.clone();
        
        log(&format!(
            "[WASM] CPM complete: {} tasks, {} critical, {:.2}ms",
            result.stats.task_count,
            result.stats.critical_count,
            result.stats.calc_time
        ));
        
        // Convert result to JsValue
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
    }

    /// Get current task count
    pub fn task_count(&self) -> usize {
        self.tasks.len()
    }

    /// Check if engine is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Get all tasks as JavaScript array
    pub fn get_tasks(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.tasks)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize tasks: {}", e)))
    }

    /// Dispose and free resources
    pub fn dispose(&mut self) {
        self.tasks.clear();
        self.calendar = None;
        self.initialized = false;
        log("[WASM] Engine disposed");
    }
}

impl Default for SchedulerEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Module initialization - called when WASM module is loaded
#[wasm_bindgen(start)]
pub fn main() {
    utils::set_panic_hook();
    log("[WASM] Scheduler WASM module loaded");
}
