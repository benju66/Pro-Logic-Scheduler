/**
 * @fileoverview IClipboardManager Interface
 * @module services/interfaces/IClipboardManager
 * 
 * Interface for ClipboardManager - copy/cut/paste operations.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import type { Task } from '../../types';

/**
 * Clipboard entry containing copied/cut task data
 */
export interface ClipboardEntry {
    /** Deep-cloned tasks */
    tasks: Task[];
    /** Original task IDs (for cut operations) */
    originalIds: string[];
    /** Whether this was a cut operation */
    isCut: boolean;
}

/**
 * ClipboardManager Interface
 * 
 * Manages clipboard state for copy/cut/paste operations.
 * External boundary (system clipboard interaction) - requires interface for testing.
 */
export interface IClipboardManager {
    /**
     * Set clipboard contents from a copy operation
     */
    setCopy(tasks: Task[], originalIds: string[]): void;
    
    /**
     * Set clipboard contents from a cut operation
     */
    setCut(tasks: Task[], originalIds: string[]): void;
    
    /**
     * Get current clipboard contents
     */
    get(): ClipboardEntry | null;
    
    /**
     * Check if clipboard has content
     */
    hasContent(): boolean;
    
    /**
     * Check if clipboard is from a cut operation
     */
    isCut(): boolean;
    
    /**
     * Get clipboard tasks (cloned)
     */
    getTasks(): Task[];
    
    /**
     * Get original IDs (for cut operations)
     */
    getOriginalIds(): string[];
    
    /**
     * Clear clipboard (after paste from cut)
     */
    clear(): void;
    
    /**
     * Cancel a pending cut (revert to normal state)
     */
    cancelCut(): void;
}
