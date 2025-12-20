/**
 * Flatpickr configuration for Pro Logic Scheduler
 * Provides consistent date picker behavior across all date cells
 */

import flatpickr from 'flatpickr';
import type { Instance, Options } from 'flatpickr/dist/types/instance';
import type { Calendar } from '../../../../types';

/**
 * Date format used throughout the application
 * ISO format for data, localized display for users
 */
export const DATE_FORMAT = 'Y-m-d'; // ISO format for storage
export const DATE_FORMAT_DISPLAY = 'm/d/Y'; // US format for display (configurable)

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
        onChange: (selectedDates, dateStr) => {
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
 */
export function formatDateISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse a date string flexibly
 * Supports: YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, etc.
 */
export function parseFlexibleDate(dateStr: string): Date | undefined {
    if (!dateStr || dateStr.trim() === '') return undefined;
    
    const cleaned = dateStr.trim();
    
    // Try ISO format first (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        const [year, month, day] = cleaned.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    
    // Try US format (MM/DD/YYYY or M/D/YYYY)
    const usMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (usMatch) {
        const [, month, day, year] = usMatch.map(Number);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(year, month - 1, day);
        }
    }
    
    // Try US format with 2-digit year (MM/DD/YY)
    const usShortMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (usShortMatch) {
        const [, month, day, shortYear] = usShortMatch.map(Number);
        // Assume 20XX for years 00-99
        const year = shortYear + 2000;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(year, month - 1, day);
        }
    }
    
    // Fallback to native Date parsing
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }
    
    return undefined;
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

