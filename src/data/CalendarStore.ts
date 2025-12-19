/**
 * @fileoverview Calendar data store - manages calendar configuration
 * @module data/CalendarStore
 */

import type { Calendar, CalendarException, Callback } from '../types';
import { DEFAULT_WORKING_DAYS } from '../core/Constants';
import type { PersistenceService } from './PersistenceService';

/**
 * Calendar store options
 */
export interface CalendarStoreOptions {
  onChange?: Callback<Calendar>;
}

/**
 * Calendar data store
 * Manages calendar state (working days, exceptions/holidays)
 */
export class CalendarStore {
  private calendar: Calendar;
  private options: CalendarStoreOptions;
  private persistenceService: PersistenceService | null = null;

  /**
   * @param options - Configuration
   */
  constructor(options: CalendarStoreOptions = {}) {
    this.options = options;
    this.calendar = {
      workingDays: [...DEFAULT_WORKING_DAYS],
      exceptions: {},
    };
  }

  /**
   * Get calendar configuration
   * @returns Calendar object with workingDays and exceptions
   */
  get(): Calendar {
    return { ...this.calendar };
  }

  /**
   * Set persistence service (injected post-construction to avoid circular dependencies)
   * @param service - PersistenceService instance
   */
  setPersistenceService(service: PersistenceService): void {
    this.persistenceService = service;
  }

  /**
   * Set calendar configuration
   * @param calendar - Calendar configuration
   * @param skipEvent - If true, don't queue event (used for loading data)
   */
  set(calendar: Calendar, skipEvent: boolean = false): void {
    const oldCalendar = { ...this.calendar };
    
    this.calendar = {
      workingDays: calendar.workingDays || [...DEFAULT_WORKING_DAYS],
      exceptions: calendar.exceptions || {},
    };
    
    // Queue CALENDAR_UPDATED event (unless loading data)
    if (!skipEvent && this.persistenceService) {
      this.persistenceService.queueEvent('CALENDAR_UPDATED', null, {
        working_days: this.calendar.workingDays,
        exceptions: this.calendar.exceptions,
      });
    }
    
    this._notifyChange();
  }

  /**
   * Get working days
   * @returns Array of working day indices (0=Sun, 6=Sat)
   */
  getWorkingDays(): number[] {
    return [...this.calendar.workingDays];
  }

  /**
   * Set working days
   * @param days - Array of working day indices
   */
  setWorkingDays(days: number[]): void {
    this.calendar.workingDays = days || [...DEFAULT_WORKING_DAYS];
    this._notifyChange();
  }

  /**
   * Get all exceptions (holidays)
   * @returns Map of date strings to CalendarException objects
   */
  getExceptions(): Record<string, CalendarException> {
    return { ...this.calendar.exceptions };
  }

  /**
   * Add a calendar exception (holiday)
   * @param dateStr - Date string in "YYYY-MM-DD" format
   * @param exception - Exception object or description string (for backward compatibility)
   */
  addException(dateStr: string, exception: CalendarException | string): void {
    if (typeof exception === 'string') {
      // Backward compatibility: convert string to CalendarException
      this.calendar.exceptions[dateStr] = {
        date: dateStr,
        working: false,
        description: exception || 'Holiday',
      };
    } else {
      this.calendar.exceptions[dateStr] = {
        date: dateStr,
        working: exception.working ?? false,
        description: exception.description,
      };
    }
    this._notifyChange();
  }

  /**
   * Remove a calendar exception
   * @param dateStr - Date string in "YYYY-MM-DD" format
   */
  removeException(dateStr: string): void {
    delete this.calendar.exceptions[dateStr];
    this._notifyChange();
  }

  /**
   * Check if a date is an exception
   * @param dateStr - Date string in "YYYY-MM-DD" format
   * @returns True if date is an exception
   */
  isException(dateStr: string): boolean {
    return !!this.calendar.exceptions[dateStr];
  }

  /**
   * Notify subscribers of changes
   * @private
   */
  private _notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange(this.calendar);
    }
  }
}
