/**
 * @fileoverview Clipboard Manager - Manages clipboard state for copy/cut/paste operations
 * @module services/ClipboardManager
 * 
 * PHASE 2: Extracted from SchedulerService to support Command pattern.
 */

import type { Task } from '../types';

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
 * Manages clipboard state for copy/cut/paste operations.
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - getInstance() retained for backward compatibility during migration
 * - Use setInstance() in Composition Root or inject directly
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class ClipboardManager {
    private static instance: ClipboardManager | null = null;
    private clipboard: ClipboardEntry | null = null;

    /**
     * Constructor is public for Pure DI compatibility.
     */
    public constructor() {}

    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static getInstance(): ClipboardManager {
        if (!ClipboardManager.instance) {
            ClipboardManager.instance = new ClipboardManager();
        }
        return ClipboardManager.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static setInstance(instance: ClipboardManager): void {
        ClipboardManager.instance = instance;
    }
    
    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static resetInstance(): void {
        ClipboardManager.instance = null;
    }

    /**
     * Set clipboard contents from a copy operation
     */
    setCopy(tasks: Task[], originalIds: string[]): void {
        this.clipboard = {
            tasks: tasks.map(t => JSON.parse(JSON.stringify(t))),
            originalIds,
            isCut: false
        };
    }

    /**
     * Set clipboard contents from a cut operation
     */
    setCut(tasks: Task[], originalIds: string[]): void {
        this.clipboard = {
            tasks: tasks.map(t => JSON.parse(JSON.stringify(t))),
            originalIds,
            isCut: true
        };
    }

    /**
     * Get current clipboard contents
     */
    get(): ClipboardEntry | null {
        return this.clipboard;
    }

    /**
     * Check if clipboard has content
     */
    hasContent(): boolean {
        return this.clipboard !== null && this.clipboard.tasks.length > 0;
    }

    /**
     * Check if clipboard is from a cut operation
     */
    isCut(): boolean {
        return this.clipboard?.isCut ?? false;
    }

    /**
     * Get clipboard tasks (cloned)
     */
    getTasks(): Task[] {
        if (!this.clipboard) return [];
        return this.clipboard.tasks.map(t => JSON.parse(JSON.stringify(t)));
    }

    /**
     * Get original IDs (for cut operations)
     */
    getOriginalIds(): string[] {
        return this.clipboard?.originalIds ?? [];
    }

    /**
     * Clear clipboard (after paste from cut)
     */
    clear(): void {
        this.clipboard = null;
    }

    /**
     * Cancel a pending cut (revert to normal state without deleting)
     */
    cancelCut(): void {
        if (this.clipboard?.isCut) {
            this.clipboard = null;
        }
    }
}

/**
 * @deprecated Use constructor injection instead.
 * @see docs/adr/001-dependency-injection.md
 */
export function getClipboardManager(): ClipboardManager {
    return ClipboardManager.getInstance();
}
