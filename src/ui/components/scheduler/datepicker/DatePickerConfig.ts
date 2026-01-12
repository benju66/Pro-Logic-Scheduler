/**
 * Flatpickr configuration for Pro Logic Scheduler
 * Provides consistent date picker behavior across all date cells
 */

import type { Instance } from 'flatpickr/dist/types/instance';
import type { BaseOptions } from 'flatpickr/dist/types/options';
import type { Calendar } from '../../../../types';

// Flatpickr options type alias
type Options = Partial<BaseOptions>;

/**
 * Date format used throughout the application
 * ISO format for data, localized display for users
 */
export const DATE_FORMAT = 'Y-m-d'; // ISO format for storage
export const DATE_FORMAT_DISPLAY = 'm/d/Y'; // US format for display (configurable)

/**
 * Format an ISO date string (YYYY-MM-DD) to display format (MM/DD/YYYY)
 * @param isoDateStr - ISO format date string
 * @returns Formatted display string or empty string if invalid
 */
export function formatDateForDisplay(isoDateStr: string): string {
    if (!isoDateStr || isoDateStr.trim() === '') return '';
    
    // Parse ISO format
    const match = isoDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const [, year, month, day] = match;
        // Return MM/DD/YYYY format
        return `${month}/${day}/${year}`;
    }
    
    // If not ISO format, try to parse and reformat
    const parsed = parseFlexibleDate(isoDateStr);
    if (parsed) {
        // Use UTC methods since dates are created at noon UTC
        const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const day = String(parsed.getUTCDate()).padStart(2, '0');
        const year = parsed.getUTCFullYear();
        return `${month}/${day}/${year}`;
    }
    
    return isoDateStr; // Return as-is if can't parse
}

/**
 * Create Flatpickr options for a date cell
 * @param options - Configuration options
 * @returns Flatpickr Options object
 */
export function createDatePickerOptions(options: {
    calendar?: Calendar;
    onChange?: (dateStr: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
    disabled?: boolean;
}): Options {
    const { calendar, onChange, onOpen, onClose, disabled } = options;
    
    // Build list of disabled dates from calendar exceptions
    const disabledDates: ((date: Date) => boolean)[] = [];
    
    if (calendar) {
        // Disable non-working weekdays
        const workingDays = new Set(calendar.workingDays);
        disabledDates.push((date: Date) => {
            const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
            return !workingDays.has(dayOfWeek);
        });
        
        // Disable exception dates (holidays, etc.)
        const exceptions = calendar.exceptions || {};
        const nonWorkingExceptions = new Set<string>();
        
        Object.entries(exceptions).forEach(([dateStr, exception]) => {
            // Handle both old format (string description) and new format (object)
            const isWorking = typeof exception === 'string' 
                ? false  // Old format: all exceptions were non-working
                : exception.working;
            
            if (!isWorking) {
                nonWorkingExceptions.add(dateStr);
            }
        });
        
        if (nonWorkingExceptions.size > 0) {
            disabledDates.push((date: Date) => {
                const dateStr = formatDateISO(date);
                return nonWorkingExceptions.has(dateStr);
            });
        }
    }
    
    return {
        // Date format
        dateFormat: DATE_FORMAT,
        altInput: true,
        altFormat: DATE_FORMAT_DISPLAY,
        
        // Allow typing
        allowInput: true,
        
        // Click opens picker (icon click handled separately)
        clickOpens: true,
        
        // Disable dates based on working calendar
        disable: disabledDates,
        
        // Visual options
        animate: true,
        monthSelectorType: 'dropdown',
        
        // Position
        position: 'auto',
        static: false,
        
        // Accessibility
        ariaDateFormat: 'F j, Y',
        
        // Disable if readonly
        ...(disabled ? { clickOpens: false, allowInput: false } : {}),
        
        // Callbacks
        onChange: (_selectedDates: Date[], dateStr: string) => {
            if (onChange && dateStr) {
                onChange(dateStr);
            }
        },
        onOpen: () => {
            onOpen?.();
        },
        onClose: () => {
            onClose?.();
        },
    };
}

/**
 * Format a Date object to ISO string (YYYY-MM-DD)
 * 
 * IMPORTANT: Uses UTC methods to ensure consistent date representation
 * regardless of timezone. This prevents date shifts when dates are created
 * at noon UTC (as in parseFlexibleDate and DateUtils).
 */
export function formatDateISO(date: Date): string {
    // Use UTC methods to avoid timezone shifts
    // Since dates are created at noon UTC, UTC methods will give the correct date
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse a date string flexibly
 * Supports: YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, etc.
 * 
 * IMPORTANT: Creates dates at noon UTC to avoid timezone issues.
 * This matches the pattern used in DateUtils to prevent date shifts.
 */
export function parseFlexibleDate(dateStr: string): Date | undefined {
    if (!dateStr || dateStr.trim() === '') return undefined;
    
    const cleaned = dateStr.trim();
    
    // Try ISO format first (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        // Use noon UTC to avoid timezone shifts (same pattern as DateUtils)
        return new Date(cleaned + 'T12:00:00');
    }
    
    // Try US format (MM/DD/YYYY or M/D/YYYY)
    const usMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (usMatch) {
        const [, month, day, year] = usMatch.map(Number);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            // Format as ISO and use noon UTC to avoid timezone shifts
            const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return new Date(isoStr + 'T12:00:00');
        }
    }
    
    // Try US format with 2-digit year (MM/DD/YY)
    const usShortMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (usShortMatch) {
        const [, month, day, shortYear] = usShortMatch.map(Number);
        // Assume 20XX for years 00-99
        const year = shortYear + 2000;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            // Format as ISO and use noon UTC to avoid timezone shifts
            const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return new Date(isoStr + 'T12:00:00');
        }
    }
    
    // Fallback: try parsing as ISO string with noon UTC
    // This handles formats like "2026-1-26" or other variations
    try {
        const parsed = new Date(cleaned + 'T12:00:00');
        if (!isNaN(parsed.getTime())) {
            return parsed;
        }
    } catch {
        // Ignore parsing errors
    }
    
    return undefined;
}

/**
 * Create Flatpickr options for the shared date picker popup
 * Used in static/external mode - popup only, doesn't wrap an input
 * 
 * @param options - Configuration options
 * @returns Flatpickr Options object for shared picker
 */
export function createSharedPickerOptions(options: {
    calendar?: Calendar;
    defaultDate?: string;
    positionElement?: HTMLElement;
    onChange?: (selectedDates: Date[], dateStr: string) => void;
    onClose?: () => void;
}): Options {
    const { calendar, defaultDate, positionElement, onChange, onClose } = options;
    
    // Build list of disabled dates from calendar exceptions
    const disabledDates: ((date: Date) => boolean)[] = [];
    
    if (calendar) {
        // Disable non-working weekdays
        const workingDays = new Set(calendar.workingDays);
        disabledDates.push((date: Date) => {
            const dayOfWeek = date.getDay();
            return !workingDays.has(dayOfWeek);
        });
        
        // Disable exception dates (holidays, etc.)
        const exceptions = calendar.exceptions || {};
        const nonWorkingExceptions = new Set<string>();
        
        Object.entries(exceptions).forEach(([dateStr, exception]) => {
            const isWorking = typeof exception === 'string' 
                ? false
                : exception.working;
            
            if (!isWorking) {
                nonWorkingExceptions.add(dateStr);
            }
        });
        
        if (nonWorkingExceptions.size > 0) {
            disabledDates.push((date: Date) => {
                const dateStr = formatDateISO(date);
                return nonWorkingExceptions.has(dateStr);
            });
        }
    }
    
    return {
        // Date format - ISO for data
        dateFormat: 'Y-m-d',
        
        // Default date if provided
        defaultDate: defaultDate || undefined,
        
        // Don't allow typing - this is popup only
        allowInput: false,
        
        // Open immediately
        clickOpens: false,
        
        // Disable dates based on working calendar
        disable: disabledDates,
        
        // Visual options
        animate: true,
        monthSelectorType: 'dropdown',
        
        // Position near the anchor element
        positionElement: positionElement,
        position: 'auto',
        static: false,
        
        // Accessibility
        ariaDateFormat: 'F j, Y',
        
        // Callbacks
        onChange: (selectedDates: Date[], dateStr: string) => {
            if (onChange) {
                onChange(selectedDates, dateStr);
            }
        },
        onClose: () => {
            onClose?.();
        },
    };
}

/**
 * Destroy a Flatpickr instance safely
 */
export function destroyDatePicker(instance: Instance | null | undefined): void {
    if (instance && typeof instance.destroy === 'function') {
        try {
            instance.destroy();
        } catch (e) {
            console.warn('[DatePicker] Error destroying instance:', e);
        }
    }
}

