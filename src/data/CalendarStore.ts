/**
 * @fileoverview Calendar data store with undo/redo support
 * @module data/CalendarStore
 */

import type { Calendar, CalendarException, Callback } from '../types';
import { DEFAULT_WORKING_DAYS } from '../core/Constants';
import type { PersistenceService } from './PersistenceService';
import type { HistoryManager, QueuedEvent } from './HistoryManager';

export interface CalendarStoreOptions {
  onChange?: Callback<Calendar>;
}

export class CalendarStore {
  private calendar: Calendar;
  private options: CalendarStoreOptions;
  private persistenceService: PersistenceService | null = null;
  private historyManager: HistoryManager | null = null;
  private isApplyingEvent: boolean = false;

  constructor(options: CalendarStoreOptions = {}) {
    this.options = options;
    this.calendar = {
      workingDays: [...DEFAULT_WORKING_DAYS],
      exceptions: {},
    };
  }

  // =========================================================================
  // SERVICE INJECTION
  // =========================================================================

  setPersistenceService(service: PersistenceService): void {
    this.persistenceService = service;
  }

  setHistoryManager(manager: HistoryManager): void {
    this.historyManager = manager;
  }

  // =========================================================================
  // READ OPERATIONS
  // =========================================================================

  get(): Calendar {
    return {
      workingDays: [...this.calendar.workingDays],
      exceptions: { ...this.calendar.exceptions },
    };
  }

  getWorkingDays(): number[] {
    return [...this.calendar.workingDays];
  }

  getExceptions(): Record<string, CalendarException> {
    return { ...this.calendar.exceptions };
  }

  // =========================================================================
  // WRITE OPERATIONS (with undo/redo support)
  // =========================================================================

  /**
   * Set entire calendar (used for loading data - skips events)
   */
  set(calendar: Calendar, skipEvent: boolean = false): void {
    const oldCalendar = this.get();
    
    this.calendar = {
      workingDays: calendar.workingDays || [...DEFAULT_WORKING_DAYS],
      exceptions: calendar.exceptions || {},
    };
    
    if (!skipEvent) {
      this._recordCalendarChange(oldCalendar, this.get(), 'Update Calendar');
    }
    
    this._notifyChange();
  }

  /**
   * Set working days
   */
  setWorkingDays(days: number[]): void {
    const oldCalendar = this.get();
    this.calendar.workingDays = days || [...DEFAULT_WORKING_DAYS];
    this._recordCalendarChange(oldCalendar, this.get(), 'Update Working Days');
    this._notifyChange();
  }

  /**
   * Add a calendar exception (holiday)
   */
  addException(dateStr: string, exception: CalendarException | string): void {
    const oldCalendar = this.get();
    
    if (typeof exception === 'string') {
      this.calendar.exceptions[dateStr] = {
        date: dateStr,
        working: false,
        description: exception || 'Holiday',
      };
    } else {
      this.calendar.exceptions[dateStr] = {
        date: dateStr,
        working: exception.working ?? false,
        description: exception.description || 'Exception',
      };
    }
    
    this._recordCalendarChange(oldCalendar, this.get(), 'Add Holiday');
    this._notifyChange();
  }

  /**
   * Remove a calendar exception
   */
  removeException(dateStr: string): void {
    if (!this.calendar.exceptions[dateStr]) return;
    
    const oldCalendar = this.get();
    delete this.calendar.exceptions[dateStr];
    this._recordCalendarChange(oldCalendar, this.get(), 'Remove Holiday');
    this._notifyChange();
  }

  // =========================================================================
  // EVENT APPLICATION (for undo/redo)
  // =========================================================================

  /**
   * Apply a calendar event from undo/redo
   */
  applyEvent(event: QueuedEvent): void {
    if (event.type !== 'CALENDAR_UPDATED') {
      console.warn(`[CalendarStore] Unknown event type: ${event.type}`);
      return;
    }
    
    this.isApplyingEvent = true;
    
    try {
      // The "new" state becomes our current state
      const workingDays = event.payload.new_working_days as number[] || [...DEFAULT_WORKING_DAYS];
      const exceptions = event.payload.new_exceptions as Record<string, CalendarException> || {};
      
      this.calendar = { workingDays, exceptions };
      
      // Queue for persistence
      if (this.persistenceService) {
        this.persistenceService.queueEvent(event.type, null, event.payload);
      }
    } finally {
      this.isApplyingEvent = false;
    }
    
    this._notifyChange();
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  private _recordCalendarChange(oldCal: Calendar, newCal: Calendar, label: string): void {
    if (this.isApplyingEvent) return;
    
    const forwardEvent: QueuedEvent = {
      type: 'CALENDAR_UPDATED',
      targetId: null,
      payload: {
        old_working_days: oldCal.workingDays,
        new_working_days: newCal.workingDays,
        old_exceptions: oldCal.exceptions,
        new_exceptions: newCal.exceptions,
      },
      timestamp: new Date(),
    };
    
    const backwardEvent: QueuedEvent = {
      type: 'CALENDAR_UPDATED',
      targetId: null,
      payload: {
        old_working_days: newCal.workingDays,
        new_working_days: oldCal.workingDays,
        old_exceptions: newCal.exceptions,
        new_exceptions: oldCal.exceptions,
      },
      timestamp: new Date(),
    };
    
    // Queue for persistence
    if (this.persistenceService) {
      this.persistenceService.queueEvent(forwardEvent.type, null, forwardEvent.payload);
    }
    
    // Record in history
    if (this.historyManager) {
      this.historyManager.recordAction(forwardEvent, backwardEvent, label);
    }
  }

  private _notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange(this.calendar);
    }
  }
}
