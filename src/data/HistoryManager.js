/**
 * @fileoverview History manager - handles undo/redo functionality
 * @module data/HistoryManager
 */

/**
 * History manager for undo/redo operations
 * @class
 */
export class HistoryManager {
    /**
     * @param {Object} options - Configuration
     * @param {number} options.maxHistory - Maximum history entries (default: 50)
     */
    constructor(options = {}) {
        this.options = options;
        this.maxHistory = options.maxHistory || 50;
        this.history = [];
        this.future = [];
    }

    /**
     * Save a checkpoint (snapshot of state)
     * @param {string} snapshot - JSON stringified state
     */
    saveCheckpoint(snapshot) {
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
    }

    /**
     * Undo - restore previous state
     * @param {string} currentSnapshot - Current state snapshot
     * @returns {string|undefined} Previous state snapshot or undefined
     */
    undo(currentSnapshot) {
        if (this.history.length === 0) {
            return undefined;
        }

        // Save current state to future
        this.future.push(currentSnapshot);

        // Restore previous state
        return this.history.pop();
    }

    /**
     * Redo - restore next state
     * @param {string} currentSnapshot - Current state snapshot
     * @returns {string|undefined} Next state snapshot or undefined
     */
    redo(currentSnapshot) {
        if (this.future.length === 0) {
            return undefined;
        }

        // Save current state to history
        this.history.push(currentSnapshot);

        // Restore next state
        return this.future.pop();
    }

    /**
     * Check if undo is available
     * @returns {boolean} True if undo is possible
     */
    canUndo() {
        return this.history.length > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean} True if redo is possible
     */
    canRedo() {
        return this.future.length > 0;
    }

    /**
     * Clear all history
     */
    clear() {
        this.history = [];
        this.future = [];
    }
}

