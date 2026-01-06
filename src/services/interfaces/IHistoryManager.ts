/**
 * @fileoverview IHistoryManager Interface
 * @module services/interfaces/IHistoryManager
 * 
 * Interface for HistoryManager - undo/redo functionality.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

/**
 * Queued event for history operations
 */
export interface QueuedHistoryEvent {
    type: string;
    targetId: string | null;
    payload: Record<string, unknown>;
    timestamp: Date;
}

/**
 * Undoable action containing forward/backward events
 */
export interface UndoableAction {
    /** Human-readable label for the action */
    label?: string;
    /** Forward events (applied for redo) */
    forward: QueuedHistoryEvent[];
    /** Backward events (applied for undo, in reverse order) */
    backward: QueuedHistoryEvent[];
}

/**
 * History state change callback
 */
export type HistoryStateCallback = (state: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel?: string;
    redoLabel?: string;
}) => void;

/**
 * HistoryManager Interface
 * 
 * Manages undo/redo using Command Pattern with Event Sourcing.
 * External behavior boundary - requires interface for testing.
 */
export interface IHistoryManager {
    /**
     * Record an undoable action
     */
    recordAction(forward: QueuedHistoryEvent, backward: QueuedHistoryEvent, label?: string): void;
    
    /**
     * Begin a composite action (groups multiple events)
     */
    beginComposite(label: string): void;
    
    /**
     * End a composite action
     */
    endComposite(): void;
    
    /**
     * Cancel a composite action without recording
     */
    cancelComposite(): void;
    
    /**
     * Check if composite action is active
     */
    isCompositeActive(): boolean;
    
    /**
     * Perform undo operation
     * @returns Backward events to apply, or null if nothing to undo
     */
    undo(): QueuedHistoryEvent[] | null;
    
    /**
     * Perform redo operation
     * @returns Forward events to apply, or null if nothing to redo
     */
    redo(): QueuedHistoryEvent[] | null;
    
    /**
     * Check if undo is available
     */
    canUndo(): boolean;
    
    /**
     * Check if redo is available
     */
    canRedo(): boolean;
    
    /**
     * Get label for next undo operation
     */
    getUndoLabel(): string | undefined;
    
    /**
     * Get label for next redo operation
     */
    getRedoLabel(): string | undefined;
    
    /**
     * Set callback for state changes
     */
    setOnStateChange(callback: HistoryStateCallback | undefined): void;
    
    /**
     * Clear all history
     */
    clear(): void;
}
