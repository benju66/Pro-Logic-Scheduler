/**
 * @fileoverview History manager - handles undo/redo functionality
 * @module data/HistoryManager
 */

import type { Callback } from '../types';
import { MAX_HISTORY_SIZE } from '../core/Constants';

/**
 * History manager options
 */
export interface HistoryManagerOptions {
  maxHistory?: number;
  onStateChange?: Callback<{ canUndo: boolean; canRedo: boolean }>;
}

/**
 * History manager for undo/redo operations
 */
export class HistoryManager {
  private history: string[] = [];
  private future: string[] = [];
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
   * Save a checkpoint (snapshot of state)
   * @param snapshot - JSON stringified state
   */
  saveCheckpoint(snapshot: string): void {
    // Don't save if same as last checkpoint
    if (this.history.length > 0 && this.history[this.history.length - 1] === snapshot) {
      return;
    }

    this.history.push(snapshot);
    
    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Clear future when new checkpoint saved
    this.future = [];
    this._notifyStateChange();
  }

  /**
   * Undo - restore previous state
   * @param currentSnapshot - Current state snapshot
   * @returns Previous state snapshot or undefined
   */
  undo(currentSnapshot: string): string | undefined {
    if (this.history.length === 0) {
      return undefined;
    }

    // Save current state to future
    this.future.push(currentSnapshot);

    // Restore previous state
    const previous = this.history.pop();
    this._notifyStateChange();
    return previous;
  }

  /**
   * Redo - restore next state
   * @param currentSnapshot - Current state snapshot
   * @returns Next state snapshot or undefined
   */
  redo(currentSnapshot: string): string | undefined {
    if (this.future.length === 0) {
      return undefined;
    }

    // Save current state to history
    this.history.push(currentSnapshot);

    // Restore next state
    const next = this.future.pop();
    this._notifyStateChange();
    return next;
  }

  /**
   * Check if undo is available
   * @returns True if undo is possible
   */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Check if redo is available
   * @returns True if redo is possible
   */
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.future = [];
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
