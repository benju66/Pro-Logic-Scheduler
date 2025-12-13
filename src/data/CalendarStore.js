// @ts-check
/**
 * @fileoverview Calendar data store - manages calendar configuration
 * @module data/CalendarStore
 */

/**
 * Calendar data store
 * Manages calendar state (working days, exceptions/holidays)
 * @class
 */
export class CalendarStore {
    /**
     * @param {Object} options - Configuration
     * @param {Function} options.onChange - Callback when calendar changes
     */
    constructor(options = {}) {
        this.options = options;
        this.calendar = {
            workingDays: [1, 2, 3, 4, 5], // Mon(1) - Fri(5)
            exceptions: {},               // "YYYY-MM-DD": "Reason"
        };
    }

    /**
     * Get calendar configuration
     * @returns {Object} Calendar object with workingDays and exceptions
     */
    get() {
        return { ...this.calendar };
    }

    /**
     * Set calendar configuration
     * @param {Object} calendar - Calendar configuration
     * @param {number[]} calendar.workingDays - Array of working day indices
     * @param {Object} calendar.exceptions - Map of date strings to reasons
     */
    set(calendar) {
        this.calendar = {
            workingDays: calendar.workingDays || [1, 2, 3, 4, 5],
            exceptions: calendar.exceptions || {},
        };
        this._notifyChange();
    }

    /**
     * Get working days
     * @returns {number[]} Array of working day indices (0=Sun, 6=Sat)
     */
    getWorkingDays() {
        return [...this.calendar.workingDays];
    }

    /**
     * Set working days
     * @param {number[]} days - Array of working day indices
     */
    setWorkingDays(days) {
        this.calendar.workingDays = days || [1, 2, 3, 4, 5];
        this._notifyChange();
    }

    /**
     * Get all exceptions (holidays)
     * @returns {Object} Map of date strings to reasons
     */
    getExceptions() {
        return { ...this.calendar.exceptions };
    }

    /**
     * Add a calendar exception (holiday)
     * @param {string} dateStr - Date string in "YYYY-MM-DD" format
     * @param {string} reason - Reason for exception
     */
    addException(dateStr, reason) {
        this.calendar.exceptions[dateStr] = reason || 'Holiday';
        this._notifyChange();
    }

    /**
     * Remove a calendar exception
     * @param {string} dateStr - Date string in "YYYY-MM-DD" format
     */
    removeException(dateStr) {
        delete this.calendar.exceptions[dateStr];
        this._notifyChange();
    }

    /**
     * Check if a date is an exception
     * @param {string} dateStr - Date string in "YYYY-MM-DD" format
     * @returns {boolean} True if date is an exception
     */
    isException(dateStr) {
        return !!this.calendar.exceptions[dateStr];
    }

    /**
     * Notify subscribers of changes
     * @private
     */
    _notifyChange() {
        if (this.options.onChange) {
            this.options.onChange(this.calendar);
        }
    }
}

