//! Type definitions for Pro Logic Scheduler
//! 
//! These types mirror the TypeScript interfaces in src/types/index.ts
//! IMPORTANT: Field names use camelCase via serde rename to match JS

use serde::{Deserialize, Serialize};

/// Dependency link between tasks
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    /// Predecessor task ID
    pub id: String,
    
    /// Link type: "FS", "SS", "FF", "SF"
    #[serde(rename = "type")]
    pub link_type: String,
    
    /// Lag in working days (can be negative)
    pub lag: i32,
}

/// Task entity - the atomic unit of scheduling
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    // === Identity & Hierarchy ===
    pub id: String,
    pub name: String,
    
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    
    #[serde(rename = "sortKey")]
    pub sort_key: String,
    
    pub level: i32,
    
    // === Scheduling (Input) ===
    pub start: String,
    pub end: String,
    pub duration: i32,
    
    #[serde(rename = "constraintType")]
    pub constraint_type: String,
    
    #[serde(rename = "constraintDate")]
    pub constraint_date: Option<String>,
    
    pub dependencies: Vec<Dependency>,
    
    // === Status ===
    pub progress: i32,
    pub notes: String,
    
    // === Calculated Fields (Optional) ===
    #[serde(rename = "_isCritical", default)]
    pub is_critical: Option<bool>,
    
    #[serde(rename = "_totalFloat", default)]
    pub total_float: Option<f64>,
    
    #[serde(rename = "_freeFloat", default)]
    pub free_float: Option<f64>,
    
    #[serde(rename = "lateStart", default)]
    pub late_start: Option<String>,
    
    #[serde(rename = "lateFinish", default)]
    pub late_finish: Option<String>,
    
    #[serde(rename = "totalFloat", default)]
    pub total_float_days: Option<i32>,
    
    #[serde(rename = "freeFloat", default)]
    pub free_float_days: Option<i32>,
    
    // === UI State ===
    #[serde(rename = "_collapsed", default)]
    pub collapsed: Option<bool>,
    
    // === Actuals Tracking (Driver Mode) ===
    #[serde(rename = "actualStart", default)]
    pub actual_start: Option<String>,
    
    #[serde(rename = "actualFinish", default)]
    pub actual_finish: Option<String>,
    
    #[serde(rename = "remainingDuration", default)]
    pub remaining_duration: Option<i32>,
    
    // === Baseline Tracking ===
    #[serde(rename = "baselineStart", default)]
    pub baseline_start: Option<String>,
    
    #[serde(rename = "baselineFinish", default)]
    pub baseline_finish: Option<String>,
    
    #[serde(rename = "baselineDuration", default)]
    pub baseline_duration: Option<i32>,
    
    // === Optional Display ===
    #[serde(default)]
    pub wbs: Option<String>,
}

/// Calendar configuration
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    /// Working days (0=Sun, 1=Mon, ..., 6=Sat)
    #[serde(rename = "workingDays", default)]
    pub working_days: Vec<i32>,
    
    /// Date-specific exceptions (can be CalendarException object or string)
    #[serde(default)]
    pub exceptions: serde_json::Value,
}

/// CPM calculation statistics
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CPMStats {
    pub calc_time: f64,
    pub task_count: i32,
    pub critical_count: i32,
    pub project_end: String,
    pub duration: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// CPM calculation result
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CPMResult {
    pub tasks: Vec<Task>,
    pub stats: CPMStats,
}

