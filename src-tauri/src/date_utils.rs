//! Date utility functions for working day calculations
//! 
//! Ported from src/core/DateUtils.ts
//! Handles working day calculations with calendar awareness (holidays, weekends)

use crate::types::Calendar;
use chrono::{NaiveDate, Datelike, Weekday};

/// Check if a date is a working day based on the calendar
pub fn is_work_day(date: &NaiveDate, calendar: &Calendar) -> bool {
    // Check exceptions first
    let date_str = date.format("%Y-%m-%d").to_string();
    
    // Check if there's an exception for this date
    if let Some(exception) = calendar.exceptions.get(&date_str) {
        // Handle both string and object formats
        if let Some(obj) = exception.as_object() {
            if let Some(working) = obj.get("working") {
                if let Some(working_bool) = working.as_bool() {
                    return working_bool;
                }
            }
        }
        // String exceptions are non-working days
        return false;
    }
    
    // Check working days (0=Sunday, 1=Monday, etc.)
    let day_of_week = date.weekday();
    let day_index = match day_of_week {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    };
    
    calendar.working_days.contains(&day_index)
}

/// Add working days to a date string
/// Returns result date string in "YYYY-MM-DD" format
pub fn add_work_days(date_str: &str, days: i32, calendar: &Calendar) -> String {
    if date_str.is_empty() {
        return date_str.to_string();
    }
    
    let mut date = match NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return date_str.to_string(),
    };
    
    // Special case: when days is 0, adjust to next working day if current date is non-working
    if days == 0 {
        while !is_work_day(&date, calendar) {
            date = date.succ_opt().unwrap_or(date);
        }
        return date.format("%Y-%m-%d").to_string();
    }
    
    let direction = if days >= 0 { 1 } else { -1 };
    let mut remaining = days.abs();
    
    // Move through calendar days, counting only working days
    while remaining > 0 {
        if direction > 0 {
            date = date.succ_opt().unwrap_or(date);
        } else {
            date = date.pred_opt().unwrap_or(date);
        }
        if is_work_day(&date, calendar) {
            remaining -= 1;
        }
    }
    
    // Ensure we land on a working day (edge case handling)
    while !is_work_day(&date, calendar) {
        if direction > 0 {
            date = date.succ_opt().unwrap_or(date);
        } else {
            date = date.pred_opt().unwrap_or(date);
        }
    }
    
    date.format("%Y-%m-%d").to_string()
}

/// Calculate working days between two dates (inclusive)
/// Returns minimum 1
pub fn calc_work_days(start_str: &str, end_str: &str, calendar: &Calendar) -> i32 {
    if start_str.is_empty() || end_str.is_empty() {
        return 0;
    }
    
    let start_date = match NaiveDate::parse_from_str(start_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return 0,
    };
    
    let end_date = match NaiveDate::parse_from_str(end_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return 0,
    };
    
    // Handle reversed date range
    let (start, end) = if start_date <= end_date {
        (start_date, end_date)
    } else {
        (end_date, start_date)
    };
    
    let mut count = 0;
    let mut current = start;
    while current <= end {
        if is_work_day(&current, calendar) {
            count += 1;
        }
        current = match current.succ_opt() {
            Some(d) => d,
            None => break,
        };
    }
    
    count.max(1)
}

/// Calculate the signed difference in work days between two dates
/// Returns signed work day difference (positive if end_date > start_date)
pub fn calc_work_days_difference(start_str: &str, end_str: &str, calendar: &Calendar) -> i32 {
    if start_str.is_empty() || end_str.is_empty() {
        return 0;
    }
    
    let start = match NaiveDate::parse_from_str(start_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return 0,
    };
    
    let end = match NaiveDate::parse_from_str(end_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return 0,
    };
    
    if start == end {
        return 0;
    }
    
    let is_positive = end > start;
    let mut current = start;
    let mut count = 0;
    
    if is_positive {
        while current < end {
            current = match current.succ_opt() {
                Some(d) => d,
                None => break,
            };
            if is_work_day(&current, calendar) {
                count += 1;
            }
        }
    } else {
        while current > end {
            if is_work_day(&current, calendar) {
                count -= 1;
            }
            current = match current.pred_opt() {
                Some(d) => d,
                None => break,
            };
        }
    }
    
    count
}

/// Get today's date as an ISO string
pub fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

