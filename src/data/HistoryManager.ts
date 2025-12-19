/**
 * @fileoverview History manager - handles undo/redo functionality with Event Sourcing
 * @module data/HistoryManager
 * 
 * Implements Command Pattern for undo/redo:
 * - Stores forward/backward event pairs instead of snapshots
 * - Undo applies backward event
 * - Redo applies forward event
 */

import type { Callback } from '../types';
import { MAX_HISTORY_SIZE } from '../core/Constants';

/**
 * Queued event structure (matches PersistenceService)
 */
export interface QueuedEvent {
  type: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Undoable action - pairs forward and backward events
 */
export interface UndoableAction {
  forward: QueuedEvent;
  backward: QueuedEvent;
}

/**
 * History manager options
 */
export interface HistoryManagerOptions {
  maxHistory?: number;
  onStateChange?: Callback<{ canUndo: boolean; canRedo: boolean }>;
}

/**
 * History manager for undo/redo operations
 * Uses Command Pattern with Event Sourcing
 */
export class HistoryManager {
  private undoStack: UndoableAction[] = [];
  private redoStack: UndoableAction[] = [];
  private maxHistory: number;
  private options: HistoryManagerOptions;

  /**
   * @param options - Configuration
   */
  constructor(options: HistoryManagerOptions = {}) {
    this.options = options;
    this.maxHistory = options.maxHistory ?? MAX_HISTORY_SIZE;
  }

  /**
   * Record an action with its inverse
   * @param forwardEvent - Event that performs the action
   * @param backwardEvent - Event that undoes the action
   */
  recordAction(forwardEvent: QueuedEvent, backwardEvent: QueuedEvent): void {
    this.undoStack.push({ forward: forwardEvent, backward: backwardEvent });
    this.redoStack = []; // Clear redo on new action
    
    // Limit history size
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    
    this._notifyStateChange();
  }

  /**
   * Undo last action
   * @returns Backward event to apply, or null if nothing to undo
   */
  undo(): QueuedEvent | null {
    const action = this.undoStack.pop();
    if (!action) {
      return null;
    }
    
    this.redoStack.push(action);
    this._notifyStateChange();
    return action.backward;
  }

  /**
   * Redo last undone action
   * @returns Forward event to apply, or null if nothing to redo
   */
  redo(): QueuedEvent | null {
    const action = this.redoStack.pop();
    if (!action) {
      return null;
    }
    
    this.undoStack.push(action);
    this._notifyStateChange();
    return action.forward;
  }

  /**
   * Check if undo is available
   * @returns True if undo is possible
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   * @returns True if redo is possible
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this._notifyStateChange();
  }

  /**
   * Notify subscribers of state changes
   * @private
   */
  private _notifyStateChange(): void {
    if (this.options.onStateChange) {
      this.options.onStateChange({
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
      });
    }
  }
}
