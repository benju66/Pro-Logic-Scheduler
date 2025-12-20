//! CPM (Critical Path Method) calculation engine
//! 
//! Ported from src/core/CPM.ts
//! Implements forward pass, backward pass, float calculation, and critical path marking

use crate::types::{Task, Calendar, CPMResult, CPMStats};
use crate::date_utils::{add_work_days, calc_work_days, calc_work_days_difference, today};
use std::collections::HashMap;

const MAX_CPM_ITERATIONS: usize = 50;

/// Successor map entry
#[derive(Clone)]
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
    let mut iterations = 0;
    let mut changed = true;
    
    // Collect parent IDs upfront to avoid borrow issues
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    while changed && iterations < MAX_CPM_ITERATIONS {
        changed = false;
        iterations += 1;
        
        // Build a map of task IDs to their current dates for dependency lookup
        let task_dates: HashMap<String, (String, String)> = tasks.iter()
            .map(|t| (t.id.clone(), (t.start.clone(), t.end.clone())))
            .collect();
        
        for i in 0..tasks.len() {
            let task_id = tasks[i].id.clone();
            
            // Skip parent tasks - their dates are calculated from children
            if parent_ids.contains(&task_id) {
                continue;
            }
            
            let mut earliest_start: Option<String> = None;
            
            // Process dependencies
            for dep in &tasks[i].dependencies.clone() {
                if let Some((pred_start, pred_end)) = task_dates.get(&dep.id) {
                    if pred_start.is_empty() || pred_end.is_empty() {
                        continue;
                    }
                    
                    let link_type = &dep.link_type;
                    let lag = dep.lag;
                    
                    let dep_start = match link_type.as_str() {
                        "FS" => add_work_days(pred_end, 1 + lag, calendar),
                        "SS" => add_work_days(pred_start, lag, calendar),
                        "FF" => {
                            let duration = tasks[i].duration;
                            add_work_days(pred_end, -get_duration_offset(duration) + lag, calendar)
                        }
                        "SF" => {
                            let duration = tasks[i].duration;
                            add_work_days(pred_start, -get_duration_offset(duration) + lag, calendar)
                        }
                        _ => add_work_days(pred_end, 1 + lag, calendar),
                    };
                    
                    if earliest_start.is_none() || dep_start > *earliest_start.as_ref().unwrap() {
                        earliest_start = Some(dep_start);
                    }
                }
            }
            
            // Apply constraints
            let mut final_start = earliest_start;
            let constraint_type = tasks[i].constraint_type.to_lowercase();
            let const_date = tasks[i].constraint_date.clone();
            
            match constraint_type.as_str() {
                "snet" => {
                    if let Some(cd) = const_date.clone() {
                        if final_start.is_none() || cd > *final_start.as_ref().unwrap() {
                            final_start = Some(cd);
                        }
                    }
                }
                "snlt" => {
                    if let Some(cd) = const_date.clone() {
                        let current = final_start.clone().unwrap_or_else(|| tasks[i].start.clone());
                        if !current.is_empty() && cd < current {
                            final_start = Some(cd);
                        }
                    }
                }
                "fnet" => {
                    if let Some(cd) = const_date.clone() {
                        let duration = tasks[i].duration;
                        let implied_start = add_work_days(&cd, -get_duration_offset(duration), calendar);
                        if final_start.is_none() || implied_start > *final_start.as_ref().unwrap() {
                            final_start = Some(implied_start);
                        }
                    }
                }
                "fnlt" => {
                    // FNLT does NOT affect forward pass - will be applied in backward pass
                }
                "mfo" => {
                    if let Some(cd) = const_date {
                        let duration = tasks[i].duration;
                        tasks[i].end = cd.clone();
                        tasks[i].start = add_work_days(&cd, -get_duration_offset(duration), calendar);
                        continue; // Skip normal calculation
                    }
                }
                _ => {
                    // ASAP or default
                    if final_start.is_none() && tasks[i].start.is_empty() {
                        final_start = Some(today());
                    }
                }
            }
            
            if final_start.is_none() {
                final_start = if tasks[i].start.is_empty() { None } else { Some(tasks[i].start.clone()) };
            }
            
            // Update if changed
            if let Some(fs) = final_start {
                if tasks[i].start != fs {
                    tasks[i].start = fs.clone();
                    changed = true;
                }
                
                // Calculate end date (Early Finish)
                let duration = tasks[i].duration;
                if !tasks[i].start.is_empty() && duration >= 0 {
                    let new_end = add_work_days(&tasks[i].start, get_duration_offset(duration), calendar);
                    if tasks[i].end != new_end {
                        tasks[i].end = new_end;
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
pub fn calculate_parent_dates(tasks: &mut [Task], calendar: &Calendar) {
    let max_depth = tasks.iter()
        .map(|t| get_depth(&t.id, tasks, 0))
        .max()
        .unwrap_or(0);
    
    // Collect parent info upfront
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    let task_depths: HashMap<String, i32> = tasks.iter()
        .map(|t| (t.id.clone(), get_depth(&t.id, tasks, 0)))
        .collect();
    
    for depth in (0..=max_depth).rev() {
        // First, collect children dates for each parent at this depth
        let mut parent_dates: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
        
        for task in tasks.iter() {
            if !parent_ids.contains(&task.id) {
                continue;
            }
            if task_depths.get(&task.id) != Some(&depth) {
                continue;
            }
            
            // Find children
            let mut min_start: Option<String> = None;
            let mut max_end: Option<String> = None;
            
            for child in tasks.iter() {
                if child.parent_id.as_ref().map_or(false, |pid| pid == &task.id) {
                    if !child.start.is_empty() {
                        if min_start.is_none() || child.start < *min_start.as_ref().unwrap() {
                            min_start = Some(child.start.clone());
                        }
                    }
                    if !child.end.is_empty() {
                        if max_end.is_none() || child.end > *max_end.as_ref().unwrap() {
                            max_end = Some(child.end.clone());
                        }
                    }
                }
            }
            
            parent_dates.insert(task.id.clone(), (min_start, max_end));
        }
        
        // Now apply the dates
        for task in tasks.iter_mut() {
            if let Some((min_start, max_end)) = parent_dates.get(&task.id) {
                if let Some(start) = min_start {
                    task.start = start.clone();
                }
                if let Some(end) = max_end {
                    task.end = end.clone();
                }
                
                // Calculate duration from start to end
                if !task.start.is_empty() && !task.end.is_empty() {
                    task.duration = calc_work_days(&task.start, &task.end, calendar);
                }
            }
        }
    }
}

/// Backward pass - calculate Late Start (LS) and Late Finish (LF)
pub fn backward_pass(tasks: &mut [Task], calendar: &Calendar, successor_map: &HashMap<String, Vec<SuccessorEntry>>) {
    // Find project end date (latest Early Finish among leaf tasks)
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    let mut project_end = String::new();
    for task in tasks.iter() {
        if !parent_ids.contains(&task.id) && !task.end.is_empty() {
            if project_end.is_empty() || task.end > project_end {
                project_end = task.end.clone();
            }
        }
    }
    
    if project_end.is_empty() {
        return;
    }
    
    let mut iterations = 0;
    let mut changed = true;
    
    while changed && iterations < MAX_CPM_ITERATIONS {
        changed = false;
        iterations += 1;
        
        // Build map of current late dates for lookup
        let late_dates: HashMap<String, (Option<String>, Option<String>)> = tasks.iter()
            .map(|t| (t.id.clone(), (t.late_start.clone(), t.late_finish.clone())))
            .collect();
        
        let task_data: HashMap<String, (String, String, i32, String, Option<String>)> = tasks.iter()
            .map(|t| (t.id.clone(), (
                t.start.clone(), 
                t.end.clone(), 
                t.duration,
                t.constraint_type.clone(),
                t.constraint_date.clone()
            )))
            .collect();
        
        for i in 0..tasks.len() {
            let task_id = tasks[i].id.clone();
            
            // Skip parent tasks
            if parent_ids.contains(&task_id) {
                continue;
            }
            
            let empty_vec = Vec::new();
            let successors = successor_map.get(&task_id).unwrap_or(&empty_vec);
            
            if successors.is_empty() {
                // No successors - Late Finish = Project End
                if tasks[i].late_finish.as_ref() != Some(&project_end) {
                    tasks[i].late_finish = Some(project_end.clone());
                    changed = true;
                }
            } else {
                let mut min_late_finish: Option<String> = None;
                
                for succ in successors {
                    if let Some((succ_start, succ_end, succ_duration, _, _)) = task_data.get(&succ.id) {
                        if succ_start.is_empty() || parent_ids.contains(&succ.id) {
                            continue;
                        }
                        
                        let (succ_late_start, _) = late_dates.get(&succ.id).cloned().unwrap_or((None, None));
                        
                        let succ_ls = succ_late_start.unwrap_or_else(|| succ_start.clone());
                        if succ_ls.is_empty() {
                            continue;
                        }
                        
                        let constrained_finish = match succ.link_type.as_str() {
                            "FS" => add_work_days(&succ_ls, -1 - succ.lag, calendar),
                            "SS" => {
                                let duration = tasks[i].duration;
                                add_work_days(&succ_ls, get_duration_offset(duration) - succ.lag, calendar)
                            }
                            "FF" => add_work_days(&succ_ls, get_duration_offset(*succ_duration) - succ.lag, calendar),
                            "SF" => add_work_days(&succ_ls, -succ.lag, calendar),
                            _ => add_work_days(&succ_ls, -1 - succ.lag, calendar),
                        };
                        
                        if min_late_finish.is_none() || constrained_finish < *min_late_finish.as_ref().unwrap() {
                            min_late_finish = Some(constrained_finish);
                        }
                    }
                }
                
                if let Some(lf) = min_late_finish {
                    if tasks[i].late_finish.as_ref() != Some(&lf) {
                        tasks[i].late_finish = Some(lf);
                        changed = true;
                    }
                }
            }
            
            // Apply FNLT constraint
            let constraint_type = tasks[i].constraint_type.to_lowercase();
            if constraint_type == "fnlt" {
                if let Some(cd) = tasks[i].constraint_date.clone() {
                    if tasks[i].late_finish.is_none() || cd < *tasks[i].late_finish.as_ref().unwrap() {
                        tasks[i].late_finish = Some(cd);
                        changed = true;
                    }
                }
            }
            
            // Calculate Late Start from Late Finish
            if let Some(ref lf) = tasks[i].late_finish {
                let duration = tasks[i].duration;
                let new_ls = add_work_days(lf, -get_duration_offset(duration), calendar);
                if tasks[i].late_start.as_ref() != Some(&new_ls) {
                    tasks[i].late_start = Some(new_ls);
                    changed = true;
                }
            }
        }
    }
    
    if iterations >= MAX_CPM_ITERATIONS {
        println!("[CPM] Backward pass reached max iterations - possible circular dependency");
    }
}

/// Calculate Total Float and Free Float for all tasks
pub fn calculate_float(tasks: &mut [Task], calendar: &Calendar, successor_map: &HashMap<String, Vec<SuccessorEntry>>) {
    // Collect parent IDs upfront
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    // First pass: calculate float for leaf tasks
    // Collect task data for lookup
    let task_data: HashMap<String, (String, String, bool)> = tasks.iter()
        .map(|t| (t.id.clone(), (t.start.clone(), t.end.clone(), parent_ids.contains(&t.id))))
        .collect();
    
    for i in 0..tasks.len() {
        let task_id = tasks[i].id.clone();
        
        if parent_ids.contains(&task_id) {
            // Parent tasks: will calculate from children in second pass
            continue;
        }
        
        // Total Float = Late Start - Early Start (in work days)
        if let (Some(ref ls), ref start) = (&tasks[i].late_start, &tasks[i].start) {
            if !start.is_empty() {
                tasks[i].total_float_days = Some(calc_work_days_difference(start, ls, calendar));
            } else {
                tasks[i].total_float_days = Some(0);
            }
        } else {
            tasks[i].total_float_days = Some(0);
        }
        tasks[i].total_float = tasks[i].total_float_days.map(|v| v as f64);
        
        // Free Float calculation
        let empty_vec = Vec::new();
        let successors = successor_map.get(&task_id).unwrap_or(&empty_vec);
        
        if successors.is_empty() {
            // No successors - free float equals total float
            tasks[i].free_float_days = tasks[i].total_float_days;
            tasks[i].free_float = tasks[i].total_float;
        } else {
            let mut min_free_float: Option<i32> = None;
            
            for succ in successors {
                if let Some((succ_start, succ_end, is_parent)) = task_data.get(&succ.id) {
                    if succ_start.is_empty() || *is_parent {
                        continue;
                    }
                    
                    let lag = succ.lag;
                    let task_start = &tasks[i].start;
                    let task_end = &tasks[i].end;
                    
                    let free_float_for_succ = match succ.link_type.as_str() {
                        "FS" => calc_work_days_difference(task_end, succ_start, calendar) - 1 - lag,
                        "SS" => calc_work_days_difference(task_start, succ_start, calendar) - lag,
                        "FF" => calc_work_days_difference(task_end, succ_end, calendar) - lag,
                        "SF" => calc_work_days_difference(task_start, succ_end, calendar) - lag,
                        _ => calc_work_days_difference(task_end, succ_start, calendar) - 1 - lag,
                    };
                    
                    if min_free_float.is_none() || free_float_for_succ < min_free_float.unwrap() {
                        min_free_float = Some(free_float_for_succ);
                    }
                }
            }
            
            // Free float cannot exceed total float
            let total_float_val = tasks[i].total_float_days.unwrap_or(0);
            tasks[i].free_float_days = min_free_float.map(|mff| {
                (mff.max(0)).min(total_float_val)
            }).or(Some(total_float_val));
            tasks[i].free_float = tasks[i].free_float_days.map(|v| v as f64);
        }
    }
    
    // Second pass: calculate parent task floats from children
    let max_depth = tasks.iter()
        .map(|t| get_depth(&t.id, tasks, 0))
        .max()
        .unwrap_or(0);
    
    let task_depths: HashMap<String, i32> = tasks.iter()
        .map(|t| (t.id.clone(), get_depth(&t.id, tasks, 0)))
        .collect();
    
    for depth in (0..=max_depth).rev() {
        // Collect child floats for each parent at this depth
        let mut parent_floats: HashMap<String, Option<i32>> = HashMap::new();
        
        for task in tasks.iter() {
            if !parent_ids.contains(&task.id) {
                continue;
            }
            if task_depths.get(&task.id) != Some(&depth) {
                continue;
            }
            
            let mut child_floats: Vec<i32> = Vec::new();
            for child in tasks.iter() {
                if child.parent_id.as_ref().map_or(false, |pid| pid == &task.id) {
                    if let Some(tf) = child.total_float_days {
                        child_floats.push(tf);
                    }
                }
            }
            
            let min_float = if child_floats.is_empty() {
                Some(0)
            } else {
                child_floats.iter().min().copied()
            };
            
            parent_floats.insert(task.id.clone(), min_float);
        }
        
        // Apply the floats
        for task in tasks.iter_mut() {
            if let Some(min_float) = parent_floats.get(&task.id) {
                task.total_float_days = *min_float;
                task.total_float = task.total_float_days.map(|v| v as f64);
                task.free_float_days = Some(0);
                task.free_float = Some(0.0);
            }
        }
    }
}

/// Mark critical path based on Total Float
pub fn mark_critical_path(tasks: &mut [Task]) {
    // Collect parent IDs upfront
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    // First pass: mark leaf tasks based on float
    for task in tasks.iter_mut() {
        if parent_ids.contains(&task.id) {
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
    
    let task_depths: HashMap<String, i32> = tasks.iter()
        .map(|t| (t.id.clone(), get_depth(&t.id, tasks, 0)))
        .collect();
    
    for depth in (0..=max_depth).rev() {
        // Collect critical status for parents at this depth
        let mut parent_critical: HashMap<String, bool> = HashMap::new();
        
        for task in tasks.iter() {
            if !parent_ids.contains(&task.id) {
                continue;
            }
            if task_depths.get(&task.id) != Some(&depth) {
                continue;
            }
            
            let has_critical_child = tasks.iter()
                .filter(|c| c.parent_id.as_ref().map_or(false, |pid| pid == &task.id))
                .any(|c| c.is_critical.unwrap_or(false));
            
            parent_critical.insert(task.id.clone(), has_critical_child);
        }
        
        // Apply critical status
        for task in tasks.iter_mut() {
            if let Some(&is_crit) = parent_critical.get(&task.id) {
                task.is_critical = Some(is_crit);
            }
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
    
    // Collect parent IDs for filtering
    let parent_ids: Vec<String> = tasks.iter()
        .filter(|t| is_parent(&t.id, tasks))
        .map(|t| t.id.clone())
        .collect();
    
    // Find project end date
    let valid_ends: Vec<String> = tasks.iter()
        .filter(|t| !t.end.is_empty() && !parent_ids.contains(&t.id))
        .map(|t| t.end.clone())
        .collect();
    
    let mut sorted_ends = valid_ends;
    sorted_ends.sort();
    sorted_ends.reverse();
    let project_end = sorted_ends.first().cloned().unwrap_or_default();
    
    // Calculate project duration in work days
    let leaf_tasks: Vec<&Task> = tasks.iter()
        .filter(|t| !t.start.is_empty() && !parent_ids.contains(&t.id))
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
        .filter(|t| t.is_critical.unwrap_or(false) && !parent_ids.contains(&t.id))
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