/**
 * @fileoverview Date utility functions for working day calculations
 * @module core/DateUtils
 * 
 * Date utility functions for the scheduler engine.
 * Handles working day calculations with calendar awareness (holidays, weekends).
 * 
 * All date operations respect the provided calendar configuration:
 * - workingDays: Array of day indices (0=Sunday, 1=Monday, etc.)
 * - exceptions: Object mapping date strings to holiday reasons
 */

import type { Calendar } from '../types';
import { DEFAULT_WORKING_DAYS } from './Constants';

/**
 * DateUtils class providing static methods for date calculations
 * All methods are calendar-aware and handle working days correctly
 */
export class DateUtils {
    
    /**
     * Default calendar configuration
     * Mon(1) through Fri(5) as working days
     */
    static readonly DEFAULT_CALENDAR: Calendar = {
        workingDays: [...DEFAULT_WORKING_DAYS],
        exceptions: {},
    };

    /**
     * Check if a date is a working day based on the calendar
     * 
     * @param date - The date to check
     * @param calendar - Calendar configuration
     * @returns True if the date is a working day
     * 
     * @example
     * const calendar = { workingDays: [1,2,3,4,5], exceptions: { "2025-12-25": { date: "2025-12-25", working: false, description: "Christmas" } } };
     * DateUtils.isWorkDay(new Date("2025-12-25"), calendar); // false (holiday)
     * DateUtils.isWorkDay(new Date("2025-12-22"), calendar); // true (Monday)
     * DateUtils.isWorkDay(new Date("2025-12-21"), calendar); // false (Sunday)
     */
    static isWorkDay(date: Date, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): boolean {
        // Normalize to noon UTC to avoid timezone issues
        // Extract date string first, then create date at noon UTC (same pattern as addWorkDays)
        const dateStr = date.toISOString().split('T')[0];
        const normalizedDate = new Date(dateStr + 'T12:00:00');
        
        // Check exceptions first
        const exception = calendar.exceptions[dateStr];
        if (exception) {
            // Handle string format for backward compatibility
            // String exceptions (e.g., "Christmas") are non-working days
            if (typeof exception === 'string') {
                return false;
            }
            // Object format uses the working property
            return exception.working;
        }
        
        // Check working days (0=Sunday, 1=Monday, etc.)
        const dayOfWeek = normalizedDate.getUTCDay();
        return calendar.workingDays.includes(dayOfWeek);
    }

    /**
     * Add working days to a date string
     * 
     * Handles both positive and negative day additions.
     * Skips non-working days (weekends and holidays) when counting.
     * Ensures the result always lands on a working day.
     * 
     * @param dateStr - Start date string in "YYYY-MM-DD" format
     * @param days - Number of working days to add (can be negative)
     * @param calendar - Calendar configuration
     * @returns Result date string in "YYYY-MM-DD" format
     * 
     * @example
     * // Adding 5 working days from Friday
     * DateUtils.addWorkDays("2025-01-03", 5, calendar); // "2025-01-10" (skips weekend)
     * 
     * // Subtracting 1 working day from Monday
     * DateUtils.addWorkDays("2025-01-06", -1, calendar); // "2025-01-03" (Friday)
     */
    static addWorkDays(dateStr: string, days: number, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): string {
        if (!dateStr) return dateStr;
        
        const date = new Date(dateStr + 'T12:00:00');
        
        // Special case: when days is 0, adjust to next working day if current date is non-working
        if (days === 0) {
            while (!DateUtils.isWorkDay(date, calendar)) {
                date.setDate(date.getDate() + 1);
            }
            return date.toISOString().split('T')[0];
        }
        
        const direction = days >= 0 ? 1 : -1;
        let remaining = Math.abs(days);
        
        // Move through calendar days, counting only working days
        while (remaining > 0) {
            date.setDate(date.getDate() + direction);
            if (DateUtils.isWorkDay(date, calendar)) {
                remaining--;
            }
        }
        
        // Ensure we land on a working day (edge case handling)
        while (!DateUtils.isWorkDay(date, calendar)) {
            date.setDate(date.getDate() + direction);
        }
        
        return date.toISOString().split('T')[0];
    }

    /**
     * Calculate working days between two dates (inclusive)
     * 
     * Counts the number of working days from start to end date,
     * including both the start and end dates if they are working days.
     * 
     * @param startStr - Start date string in "YYYY-MM-DD" format
     * @param endStr - End date string in "YYYY-MM-DD" format
     * @param calendar - Calendar configuration
     * @returns Number of working days (minimum 1)
     * 
     * @example
     * // Monday to Friday = 5 working days
     * DateUtils.calcWorkDays("2025-01-06", "2025-01-10", calendar); // 5
     * 
     * // Friday to next Friday (spans weekend) = 6 working days
     * DateUtils.calcWorkDays("2025-01-03", "2025-01-10", calendar); // 6
     */
    static calcWorkDays(startStr: string, endStr: string, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): number {
        if (!startStr || !endStr) return 0;
        
        let current = new Date(startStr + 'T12:00:00');
        let end = new Date(endStr + 'T12:00:00');
        
        // Handle reversed date range
        if (current > end) {
            [current, end] = [end, current];
        }
        
        let count = 0;
        while (current <= end) {
            if (DateUtils.isWorkDay(current, calendar)) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return Math.max(1, count);
    }

    /**
     * Calculate the signed difference in work days between two dates
     * 
     * Unlike calcWorkDays which counts inclusive days, this method
     * returns a signed difference suitable for float calculations.
     * 
     * @param startStr - Start date string in "YYYY-MM-DD" format
     * @param endStr - End date string in "YYYY-MM-DD" format
     * @param calendar - Calendar configuration
     * @returns Signed work day difference (positive if endDate > startDate)
     * 
     * @example
     * // Forward difference
     * DateUtils.calcWorkDaysDifference("2025-01-06", "2025-01-08", calendar); // 2
     * 
     * // Backward difference
     * DateUtils.calcWorkDaysDifference("2025-01-08", "2025-01-06", calendar); // -2
     * 
     * // Same date
     * DateUtils.calcWorkDaysDifference("2025-01-06", "2025-01-06", calendar); // 0
     */
    static calcWorkDaysDifference(startStr: string, endStr: string, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): number {
        if (!startStr || !endStr) return 0;
        
        const start = new Date(startStr + 'T12:00:00');
        const end = new Date(endStr + 'T12:00:00');
        
        if (start.getTime() === end.getTime()) return 0;
        
        const isPositive = end > start;
        let current = new Date(start);
        let count = 0;
        
        if (isPositive) {
            while (current < end) {
                current.setDate(current.getDate() + 1);
                if (DateUtils.isWorkDay(current, calendar)) {
                    count++;
                }
            }
        } else {
            while (current > end) {
                if (DateUtils.isWorkDay(current, calendar)) {
                    count--;
                }
                current.setDate(current.getDate() - 1);
            }
        }
        
        return count;
    }

    /**
     * Parse a date string to a Date object
     * Uses noon to avoid timezone issues
     * 
     * @param dateStr - Date string or Date object
     * @returns Parsed Date object or null if invalid
     */
    static parseDate(dateStr: string | Date): Date | null {
        if (!dateStr) return null;
        if (dateStr instanceof Date) return dateStr;
        return new Date(dateStr + 'T12:00:00');
    }

    /**
     * Format a Date object to ISO date string (YYYY-MM-DD)
     * 
     * @param date - Date object to format
     * @returns Formatted date string
     */
    static formatDateISO(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Get today's date as an ISO string
     * 
     * @returns Today's date in "YYYY-MM-DD" format
     */
    static today(): string {
        return new Date().toISOString().split('T')[0];
    }
}

// Also export individual functions for convenience (preserve existing API)
export const isWorkDay = DateUtils.isWorkDay;
export const addWorkDays = DateUtils.addWorkDays;
export const calcWorkDays = DateUtils.calcWorkDays;
export const calcWorkDaysDifference = DateUtils.calcWorkDaysDifference;
export const parseDate = DateUtils.parseDate;
export const formatDateISO = DateUtils.formatDateISO;

export default DateUtils;
