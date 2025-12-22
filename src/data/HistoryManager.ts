/**
 * @fileoverview History manager - handles undo/redo functionality with Event Sourcing
 * @module data/HistoryManager
 * 
 * Implements Command Pattern for undo/redo:
 * - Stores forward/backward event pairs instead of snapshots
 * - Supports COMPOSITE ACTIONS for multi-step operations
 * - Undo applies backward events (in reverse order for composites)
 * - Redo applies forward events
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
 * Can be a single event or a composite of multiple events
 */
export interface UndoableAction {
  /** Human-readable label for the action (e.g., "Indent Task", "Delete 3 Tasks") */
  label?: string;
  /** Forward events (applied in order for redo) */
  forward: QueuedEvent[];
  /** Backward events (applied in REVERSE order for undo) */
  backward: QueuedEvent[];
}

/**
 * History manager options
 */
export interface HistoryManagerOptions {
  maxHistory?: number;
  onStateChange?: Callback<{ canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string }>;
}

/**
 * History manager for undo/redo operations
 * Uses Command Pattern with Event Sourcing
 * 
 * COMPOSITE ACTIONS:
 * For operations that involve multiple events (e.g., delete parent with children),
 * use beginComposite()/endComposite() to group them into a single undoable action.
 */
export class HistoryManager {
  private undoStack: UndoableAction[] = [];
  private redoStack: UndoableAction[] = [];
  private maxHistory: number;
  private options: HistoryManagerOptions;
  
  // Composite action tracking
  private compositeForward: QueuedEvent[] = [];
  private compositeBackward: QueuedEvent[] = [];
  private compositeLabel: string | null = null;
  private isCompositeActive: boolean = false;

  /**
   * @param options - Configuration
   */
  constructor(options: HistoryManagerOptions = {}) {
    this.options = options;
    this.maxHistory = options.maxHistory ?? MAX_HISTORY_SIZE;
  }

  /**
   * Begin a composite action
   * All events recorded until endComposite() will be grouped as a single undoable action
   * 
   * @param label - Human-readable label for the composite action
   */
  beginComposite(label: string): void {
    if (this.isCompositeActive) {
      console.warn('[HistoryManager] Composite already active, ending previous one');
      this.endComposite();
    }
    
    this.isCompositeActive = true;
    this.compositeLabel = label;
    this.compositeForward = [];
    this.compositeBackward = [];
  }

  /**
   * End a composite action and push to undo stack
   * If no events were recorded, nothing is pushed
   */
  endComposite(): void {
    if (!this.isCompositeActive) {
      console.warn('[HistoryManager] No composite action active');
      return;
    }
    
    if (this.compositeForward.length > 0) {
      this.undoStack.push({
        label: this.compositeLabel || undefined,
        forward: this.compositeForward,
        backward: this.compositeBackward,
      });
      
      this.redoStack = []; // Clear redo on new action
      
      // Limit history size
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      
      this._notifyStateChange();
    }
    
    // Reset composite state
    this.isCompositeActive = false;
    this.compositeLabel = null;
    this.compositeForward = [];
    this.compositeBackward = [];
  }

  /**
   * Cancel a composite action without recording
   */
  cancelComposite(): void {
    this.isCompositeActive = false;
    this.compositeLabel = null;
    this.compositeForward = [];
    this.compositeBackward = [];
  }

  /**
   * Check if a composite action is active
   */
  isInComposite(): boolean {
    return this.isCompositeActive;
  }

  /**
   * Record an action with its inverse
   * If a composite is active, adds to composite; otherwise creates standalone action
   * 
   * @param forwardEvent - Event that performs the action
   * @param backwardEvent - Event that undoes the action
   * @param label - Optional label for standalone actions
   */
  recordAction(forwardEvent: QueuedEvent, backwardEvent: QueuedEvent, label?: string): void {
    if (this.isCompositeActive) {
      // Add to composite
      this.compositeForward.push(forwardEvent);
      this.compositeBackward.push(backwardEvent);
    } else {
      // Standalone action
      this.undoStack.push({
        label,
        forward: [forwardEvent],
        backward: [backwardEvent],
      });
      
      this.redoStack = []; // Clear redo on new action
      
      // Limit history size
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      
      this._notifyStateChange();
    }
  }

  /**
   * Undo last action
   * @returns Array of backward events to apply (in order), or null if nothing to undo
   */
  undo(): QueuedEvent[] | null {
    const action = this.undoStack.pop();
    if (!action) {
      return null;
    }
    
    this.redoStack.push(action);
    this._notifyStateChange();
    
    // Return backward events in REVERSE order (last change first)
    return [...action.backward].reverse();
  }

  /**
   * Redo last undone action
   * @returns Array of forward events to apply (in order), or null if nothing to redo
   */
  redo(): QueuedEvent[] | null {
    const action = this.redoStack.pop();
    if (!action) {
      return null;
    }
    
    this.undoStack.push(action);
    this._notifyStateChange();
    
    // Return forward events in original order
    return [...action.forward];
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Get label for next undo action
   */
  getUndoLabel(): string | undefined {
    if (this.undoStack.length === 0) return undefined;
    return this.undoStack[this.undoStack.length - 1].label;
  }

  /**
   * Get label for next redo action
   */
  getRedoLabel(): string | undefined {
    if (this.redoStack.length === 0) return undefined;
    return this.redoStack[this.redoStack.length - 1].label;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.cancelComposite();
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
        undoLabel: this.getUndoLabel(),
        redoLabel: this.getRedoLabel(),
      });
    }
  }
}
