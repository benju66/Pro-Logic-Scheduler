//! CPM (Critical Path Method) calculation engine
//! 
//! Ported from src/core/CPM.ts
//! Implements forward pass, backward pass, float calculation, and critical path marking

use crate::types::{Task, Calendar, CPMResult, CPMStats};
use crate::date_utils::{add_work_days, calc_work_days, calc_work_days_difference, today};
use std::collections::HashMap;

const MAX_CPM_ITERATIONS: usize = 50;
const DEFAULT_LINK_TYPE: &str = "FS";

/// Successor map entry
struct SuccessorEntry {
    id: String,
    link_type: String,
    lag: i32,
}

/// Get duration offset for CPM date calculations
/// EF = ES + Duration - 1
/// Returns 0 for milestones (duration=0)
fn get_duration_offset(duration: i32) -> i32 {
    if duration <= 0 {
        0
    } else {
        duration - 1
    }
}

/// Check if a task is a parent (has children)
fn is_parent(task_id: &str, tasks: &[Task]) -> bool {
    tasks.iter().any(|t| t.parent_id.as_ref().map_or(false, |pid| pid == task_id))
}

/// Get depth level of a task in hierarchy
fn get_depth(task_id: &str, tasks: &[Task], depth: i32) -> i32 {
    if let Some(task) = tasks.iter().find(|t| t.id == task_id) {
        if let Some(parent_id) = &task.parent_id {
            return get_depth(parent_id, tasks, depth + 1);
        }
    }
    depth
}

/// Build a map of task successors for efficient backward pass
fn build_successor_map(tasks: &[Task]) -> HashMap<String, Vec<SuccessorEntry>> {
    let mut successor_map: HashMap<String, Vec<SuccessorEntry>> = HashMap::new();
    
    // Initialize empty arrays for all tasks
    for task in tasks {
        successor_map.insert(task.id.clone(), Vec::new());
    }
    
    // Build successor relationships from dependencies
    for task in tasks {
        for dep in &task.dependencies {
            if let Some(successors) = successor_map.get_mut(&dep.id) {
                successors.push(SuccessorEntry {
                    id: task.id.clone(),
                    link_type: dep.link_type.clone(),
                    lag: dep.lag,
                });
            }
        }
    }
    
    successor_map
}

/// Forward pass - calculate Early Start (ES) and Early Finish (EF)
pub fn forward_pass(tasks: &mut [Task], calendar: &Calendar) {
    let mut changed = true;
    let mut iterations = 0;
    
    while changed && iterations < MAX_CPM_ITERATIONS {
        changed = false;
        iterations += 1;
        
        for task in tasks.iter_mut() {
            if is_parent(&task.id, tasks) {
                continue;
            }
            
            let mut earliest_start: Option<String> = None;
            
            // Calculate based on dependencies (predecessors)
            if !task.dependencies.is_empty() {
                for dep in &task.dependencies {
                    let pred = tasks.iter().find(|t| t.id == dep.id);
                    if let Some(pred) = pred {
                        if pred.start.is_empty() || pred.end.is_empty() {
                            continue;
                        }
                        
                        let lag = dep.lag;
                        let dep_start = match dep.link_type.as_str() {
                            "FS" => add_work_days(&pred.end, 1 + lag, calendar),
                            "SS" => add_work_days(&pred.start, lag, calendar),
                            "FF" => add_work_days(&pred.end, lag - get_duration_offset(task.duration), calendar),
                            "SF" => add_work_days(&pred.start, lag - get_duration_offset(task.duration), calendar),
                            _ => add_work_days(&pred.end, 1 + lag, calendar),
                        };
                        
                        // Take the maximum (latest) start date from all predecessors
                        if earliest_start.is_none() || dep_start > earliest_start.as_ref().unwrap() {
                            earliest_start = Some(dep_start);
                        }
                    }
                }
            }
            
            // Apply constraints
            let const_type = task.constraint_type.as_str();
            let const_date = task.constraint_date.as_ref();
            
            let mut final_start = earliest_start;
            
            match const_type {
                "snet" => {
                    if let Some(cd) = const_date {
                        if final_start.is_none() || cd > final_start.as_ref().unwrap() {
                            final_start = Some(cd.clone());
                        }
                    }
                }
                "snlt" => {
                    if let Some(cd) = const_date {
                        if final_start.is_none() || final_start.as_ref().unwrap() > cd {
                            final_start = Some(cd.clone());
                        }
                    }
                }
                "fnet" => {
                    if let Some(cd) = const_date {
                        let implied_start = add_work_days(cd, -get_duration_offset(task.duration), calendar);
                        if final_start.is_none() || implied_start > final_start.as_ref().unwrap() {
                            final_start = Some(implied_start);
                        }
                    }
                }
                "fnlt" => {
                    // FNLT does NOT affect forward pass - will be applied in backward pass
                }
                "mfo" => {
                    if let Some(cd) = const_date {
                        task.end = cd.clone();
                        task.start = add_work_days(cd, -get_duration_offset(task.duration), calendar);
                        continue; // Skip normal calculation
                    }
                }
                _ => {
                    // ASAP or default
                    if final_start.is_none() && task.start.is_empty() {
                        final_start = Some(today());
                    }
                }
            }
            
            if final_start.is_none() {
                final_start = if task.start.is_empty() { None } else { Some(task.start.clone()) };
            }
            
            // Update if changed
            if let Some(fs) = final_start {
                if task.start != fs {
                    task.start = fs.clone();
                    changed = true;
                }
                
                // Calculate end date (Early Finish)
                if !task.start.is_empty() && task.duration >= 0 {
                    let new_end = add_work_days(&task.start, get_duration_offset(task.duration), calendar);
                    if task.end != new_end {
                        task.end = new_end;
                        changed = true;
                    }
                }
            }
        }
    }
    
    if iterations >= MAX_CPM_ITERATIONS {
        println!("[CPM] Forward pass reached max iterations - possible circular dependency");
    }
}

/// Calculate parent (summary) task dates from children
fn calculate_parent_dates(tasks: &mut [Task], calendar: &Calendar) {
    let max_depth = tasks.iter()
        .map(|t| get_depth(&t.id, tasks, 0))
        .max()
        .unwrap_or(0);
    
    for depth in (0..=max_depth).rev() {
        for parent in tasks.iter_mut() {
            if !is_parent(&parent.id, tasks) {
                continue;
            }
            if get_depth(&parent.id, tasks, 0) != depth {
                continue;
            }
            
            let children: Vec<&Task> = tasks.iter()
                .filter(|c| c.parent_id.as_ref().map_or(false, |pid| pid == &parent.id))
                .filter(|c| !c.start.is_empty() && !c.end.is_empty())
                .collect();
            
            if !children.is_empty() {
                let mut starts: Vec<String> = children.iter()
                    .map(|c| c.start.clone())
                    .collect();
                starts.sort();
                
                let mut ends: Vec<String> = children.iter()
                    .map(|c| c.end.clone())
                    .collect();
                ends.sort();
                
                if !starts.is_empty() && !ends.is_empty() {
                    parent.start = starts[0].clone();
                    parent.end = ends[ends.len() - 1].clone();
                    parent.duration = calc_work_days(&parent.start, &parent.end, calendar);
                }
            }
        }
    }
}

/// Backward pass - calculate Late Start (LS) and Late Finish (LF)
pub fn backward_pass(tasks: &mut [Task], calendar: &Calendar, successor_map: &HashMap<String, Vec<SuccessorEntry>>) {
    // Find project Late Finish (maximum end date of all leaf tasks)
    let valid_ends: Vec<String> = tasks.iter()
        .filter(|t| !t.end.is_empty() && !is_parent(&t.id, tasks))
        .map(|t| t.end.clone())
        .collect();
    
    if valid_ends.is_empty() {
        return;
    }
    
    let mut sorted_ends = valid_ends;
    sorted_ends.sort();
    sorted_ends.reverse();
    let project_late_finish = sorted_ends[0].clone();
    
    // Initialize late dates for tasks with no successors
    for task in tasks.iter_mut() {
        if is_parent(&task.id, tasks) {
            task.late_finish = None;
            task.late_start = None;
            continue;
        }
        
        let successors = successor_map.get(&task.id).map_or(&Vec::new(), |v| v);
        if successors.is_empty() {
            // No successors - late finish equals project end
            let mut late_finish = project_late_finish.clone();
            
            // Apply FNLT constraint if present
            if task.constraint_type == "fnlt" {
                if let Some(cd) = &task.constraint_date {
                    if cd < &late_finish {
                        late_finish = cd.clone();
                    }
                }
            }
            
            task.late_finish = Some(late_finish.clone());
            task.late_start = Some(add_work_days(&late_finish, -get_duration_offset(task.duration), calendar));
        } else {
            // Will be calculated in iteration
            task.late_finish = None;
            task.late_start = None;
        }
    }
    
    // Iterate until stable (propagate backwards from successors)
    let mut changed = true;
    let mut iterations = 0;
    
    while changed && iterations < MAX_CPM_ITERATIONS {
        changed = false;
        iterations += 1;
        
        for task in tasks.iter_mut() {
            if is_parent(&task.id, tasks) {
                continue;
            }
            
            let successors = successor_map.get(&task.id).map_or(&Vec::new(), |v| v);
            if successors.is_empty() {
                continue; // Already initialized
            }
            
            let mut min_late_finish: Option<String> = None;
            let mut all_successors_calculated = true;
            
            for succ in successors {
                let succ_task = tasks.iter().find(|t| t.id == succ.id);
                if let Some(succ_task) = succ_task {
                    // Skip parent tasks in successor calculations
                    if is_parent(&succ_task.id, tasks) {
                        continue;
                    }
                    
                    if succ_task.late_start.is_none() || succ_task.late_finish.is_none() {
                        all_successors_calculated = false;
                        continue;
                    }
                    
                    let lag = succ.lag;
                    let constrained_finish = match succ.link_type.as_str() {
                        "FS" => add_work_days(succ_task.late_start.as_ref().unwrap(), -1 - lag, calendar),
                        "SS" => add_work_days(succ_task.late_start.as_ref().unwrap(), get_duration_offset(task.duration) - lag, calendar),
                        "FF" => add_work_days(succ_task.late_finish.as_ref().unwrap(), -lag, calendar),
                        "SF" => add_work_days(succ_task.late_finish.as_ref().unwrap(), get_duration_offset(task.duration) - lag, calendar),
                        _ => add_work_days(succ_task.late_start.as_ref().unwrap(), -1 - lag, calendar),
                    };
                    
                    // Take the minimum (earliest) late finish from all successors
                    if min_late_finish.is_none() || constrained_finish < min_late_finish.as_ref().unwrap() {
                        min_late_finish = Some(constrained_finish);
                    }
                }
            }
            
            // Apply FNLT (Finish No Later Than) constraint
            if task.constraint_type == "fnlt" {
                if let Some(cd) = &task.constraint_date {
                    if let Some(ref mlf) = min_late_finish {
                        if cd < mlf {
                            min_late_finish = Some(cd.clone());
                        }
                    } else {
                        min_late_finish = Some(cd.clone());
                    }
                }
            }
            
            // Update if we have a valid late finish
            if let Some(mlf) = min_late_finish {
                if task.late_finish.as_ref().map_or(true, |lf| lf != &mlf) {
                    task.late_finish = Some(mlf.clone());
                    task.late_start = Some(add_work_days(&mlf, -get_duration_offset(task.duration), calendar));
                    changed = true;
                }
            } else if !all_successors_calculated {
                changed = true;
            }
        }
    }
    
    // Handle any remaining tasks without late dates
    for task in tasks.iter_mut() {
        if is_parent(&task.id, tasks) {
            continue;
        }
        
        if task.late_finish.is_none() {
            let mut late_finish = project_late_finish.clone();
            
            // Apply FNLT constraint if present
            if task.constraint_type == "fnlt" {
                if let Some(cd) = &task.constraint_date {
                    if cd < &late_finish {
                        late_finish = cd.clone();
                    }
                }
            }
            
            task.late_finish = Some(late_finish.clone());
            task.late_start = Some(add_work_days(&late_finish, -get_duration_offset(task.duration), calendar));
        }
    }
    
    if iterations >= MAX_CPM_ITERATIONS {
        println!("[CPM] Backward pass reached max iterations - possible circular dependency");
    }
}

/// Calculate Total Float and Free Float for all tasks
pub fn calculate_float(tasks: &mut [Task], calendar: &Calendar, successor_map: &HashMap<String, Vec<SuccessorEntry>>) {
    for task in tasks.iter_mut() {
        if is_parent(&task.id, tasks) {
            // Parent tasks: calculate from children
            let children: Vec<&Task> = tasks.iter()
                .filter(|c| c.parent_id.as_ref().map_or(false, |pid| pid == &task.id))
                .collect();
            
            if !children.is_empty() {
                let child_floats: Vec<i32> = children.iter()
                    .filter_map(|c| c.total_float_days)
                    .collect();
                
                task.total_float_days = if child_floats.is_empty() {
                    Some(0)
                } else {
                    Some(*child_floats.iter().min().unwrap())
                };
                task.total_float = task.total_float_days.map(|v| v as f64);
                task.free_float_days = Some(0);
                task.free_float = Some(0.0);
            } else {
                task.total_float_days = Some(0);
                task.total_float = Some(0.0);
                task.free_float_days = Some(0);
                task.free_float = Some(0.0);
            }
            continue;
        }
        
        // Total Float = Late Start - Early Start (in work days)
        if let (Some(ref ls), ref start) = (&task.late_start, &task.start) {
            if !start.is_empty() {
                task.total_float_days = Some(calc_work_days_difference(start, ls, calendar));
            } else {
                task.total_float_days = Some(0);
            }
        } else {
            task.total_float_days = Some(0);
        }
        task.total_float = task.total_float_days.map(|v| v as f64);
        
        // Free Float calculation
        let successors = successor_map.get(&task.id).map_or(&Vec::new(), |v| v);
        
        if successors.is_empty() {
            // No successors - free float equals total float
            task.free_float_days = task.total_float_days;
            task.free_float = task.total_float;
        } else {
            let mut min_free_float: Option<i32> = None;
            
            for succ in successors {
                let succ_task = tasks.iter().find(|t| t.id == succ.id);
                if let Some(succ_task) = succ_task {
                    if succ_task.start.is_empty() || is_parent(&succ_task.id, tasks) {
                        continue;
                    }
                    
                    let lag = succ.lag;
                    let free_float_for_succ = match succ.link_type.as_str() {
                        "FS" => calc_work_days_difference(&task.end, &succ_task.start, calendar) - 1 - lag,
                        "SS" => calc_work_days_difference(&task.start, &succ_task.start, calendar) - lag,
                        "FF" => calc_work_days_difference(&task.end, &succ_task.end, calendar) - lag,
                        "SF" => calc_work_days_difference(&task.start, &succ_task.end, calendar) - lag,
                        _ => calc_work_days_difference(&task.end, &succ_task.start, calendar) - 1 - lag,
                    };
                    
                    if min_free_float.is_none() || free_float_for_succ < min_free_float.unwrap() {
                        min_free_float = Some(free_float_for_succ);
                    }
                }
            }
            
            // Free float cannot exceed total float
            let total_float_val = task.total_float_days.unwrap_or(0);
            task.free_float_days = min_free_float.map(|mff| {
                (mff.max(0)).min(total_float_val)
            }).or(Some(total_float_val));
            task.free_float = task.free_float_days.map(|v| v as f64);
        }
    }
}

/// Mark critical path based on Total Float
pub fn mark_critical_path(tasks: &mut [Task]) {
    // First pass: mark leaf tasks based on float
    for task in tasks.iter_mut() {
        if is_parent(&task.id, tasks) {
            task.is_critical = Some(false); // Will be set in second pass
        } else {
            task.is_critical = Some(task.total_float_days.map_or(false, |tf| tf <= 0));
        }
    }
    
    // Second pass: mark parent tasks as critical if any child is critical
    let max_depth = tasks.iter()
        .map(|t| get_depth(&t.id, tasks, 0))
        .max()
        .unwrap_or(0);
    
    for depth in (0..=max_depth).rev() {
        for task in tasks.iter_mut() {
            if !is_parent(&task.id, tasks) {
                continue;
            }
            if get_depth(&task.id, tasks, 0) != depth {
                continue;
            }
            
            let children: Vec<&Task> = tasks.iter()
                .filter(|c| c.parent_id.as_ref().map_or(false, |pid| pid == &task.id))
                .collect();
            
            task.is_critical = Some(children.iter().any(|c| c.is_critical.unwrap_or(false)));
        }
    }
}

/// Main CPM calculation function
pub fn calculate(tasks: &mut [Task], calendar: &Calendar) -> CPMResult {
    let start_time = std::time::Instant::now();
    
    if tasks.is_empty() {
        return CPMResult {
            tasks: Vec::new(),
            stats: CPMStats {
                calc_time: 0.0,
                task_count: 0,
                critical_count: 0,
                project_end: String::new(),
                duration: 0,
                error: None,
            },
        };
    }
    
    // Step 1: Build successor map for backward pass
    let successor_map = build_successor_map(tasks);
    
    // Step 2: Forward pass - calculate Early Start and Early Finish
    forward_pass(tasks, calendar);
    
    // Step 3: Calculate parent dates from children
    calculate_parent_dates(tasks, calendar);
    
    // Step 4: Backward pass - calculate Late Start and Late Finish
    backward_pass(tasks, calendar, &successor_map);
    
    // Step 5: Calculate float values
    calculate_float(tasks, calendar, &successor_map);
    
    // Step 6: Mark critical path based on float
    mark_critical_path(tasks);
    
    let calc_time = start_time.elapsed().as_secs_f64() * 1000.0; // Convert to milliseconds
    
    // Find project end date
    let valid_ends: Vec<String> = tasks.iter()
        .filter(|t| !t.end.is_empty() && !is_parent(&t.id, tasks))
        .map(|t| t.end.clone())
        .collect();
    
    let mut sorted_ends = valid_ends;
    sorted_ends.sort();
    sorted_ends.reverse();
    let project_end = sorted_ends.first().cloned().unwrap_or_default();
    
    // Calculate project duration in work days
    let leaf_tasks: Vec<&Task> = tasks.iter()
        .filter(|t| !t.start.is_empty() && !is_parent(&t.id, tasks))
        .collect();
    
    let mut starts: Vec<String> = leaf_tasks.iter()
        .map(|t| t.start.clone())
        .collect();
    starts.sort();
    
    let project_start = starts.first().cloned().unwrap_or_default();
    let duration = if !project_start.is_empty() && !project_end.is_empty() {
        calc_work_days(&project_start, &project_end, calendar)
    } else {
        0
    };
    
    let critical_count = tasks.iter()
        .filter(|t| t.is_critical.unwrap_or(false) && !is_parent(&t.id, tasks))
        .count();
    
    CPMResult {
        tasks: tasks.to_vec(),
        stats: CPMStats {
            calc_time,
            task_count: tasks.len() as i32,
            critical_count: critical_count as i32,
            project_end,
            duration,
            error: None,
        },
    }
}

