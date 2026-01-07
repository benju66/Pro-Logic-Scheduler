/**
 * @fileoverview EditingStateManager - Single Source of Truth for Editing State
 * @module services/EditingStateManager
 * 
 * Centralized state management for cell editing across the application.
 * Implements observer pattern for reactive state updates.
 * 
 * Architecture:
 * - EditingStateManager (owns state, publishes changes)
 *   ├── KeyboardService (subscribes - determines shortcut behavior)
 *   ├── GridRenderer/VirtualScrollGrid (subscribes - visual feedback)
 *   └── SchedulerService (subscribes - coordination)
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Editing context - describes what is being edited
 */
export interface EditingContext {
    /** Task ID being edited */
    taskId: string;
    /** Field/column being edited */
    field: string;
    /** Timestamp when editing started */
    startedAt: number;
    /** Original value before editing (for potential revert) */
    originalValue?: unknown;
}

/**
 * Editing state
 */
export interface EditingState {
    /** Whether currently in edit mode */
    isEditing: boolean;
    /** Context of current edit (null if not editing) */
    context: EditingContext | null;
    /** Previous context (for debugging/undo) */
    previousContext: EditingContext | null;
}

/**
 * State change event
 */
export interface EditingStateChangeEvent {
    /** Previous state */
    previousState: EditingState;
    /** New state */
    newState: EditingState;
    /** What triggered the change */
    trigger: EditingTrigger;
    /** Timestamp */
    timestamp: number;
}

/**
 * What triggered the state change
 */
export type EditingTrigger = 
    // User-initiated triggers
    | 'f2'              // F2 key to enter edit mode
    | 'click'           // Click on editable cell
    | 'double-click'    // Double-click on cell
    | 'typing'          // Started typing (future: inline edit)
    | 'escape'          // Escape key to exit (revert)
    | 'enter'           // Enter key to commit and exit
    | 'tab'             // Tab to move to next cell
    | 'shift-tab'       // Shift+Tab to move to previous cell
    | 'blur'            // Focus lost (click elsewhere)
    | 'arrow'           // Arrow key navigation (exits edit)
    // Programmatic triggers (app logic)
    | 'programmatic'    // App logic forced state change (e.g., Ctrl+Enter, Insert)
    | 'external'        // External code requested state change (deprecated - use 'programmatic')
    | 'task-deleted'    // Task was deleted while editing
    | 'data-updated'    // Data was updated while editing
    | 'destroy';        // Component destroyed

/**
 * Type guard: Is this a programmatic trigger?
 */
export function isProgrammaticTrigger(trigger: EditingTrigger): boolean {
    return trigger === 'programmatic' || 
           trigger === 'external' || 
           trigger === 'task-deleted' || 
           trigger === 'data-updated' || 
           trigger === 'destroy';
}

/**
 * Type guard: Is this a user-initiated trigger?
 */
export function isUserTrigger(trigger: EditingTrigger): boolean {
    return !isProgrammaticTrigger(trigger);
}

/**
 * Subscriber callback type
 */
export type EditingStateSubscriber = (event: EditingStateChangeEvent) => void;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
    /** Only notify on specific triggers */
    triggers?: EditingTrigger[];
    /** Only notify when entering edit mode */
    onEnterOnly?: boolean;
    /** Only notify when exiting edit mode */
    onExitOnly?: boolean;
}

// ============================================================================
// EDITING STATE MANAGER
// ============================================================================

/**
 * Centralized editing state manager
 * 
 * Usage:
 * ```typescript
 * const manager = EditingStateManager.getInstance();
 * 
 * // Subscribe to changes
 * const unsubscribe = manager.subscribe((event) => {
 *     console.log('Editing state changed:', event);
 * });
 * 
 * // Enter edit mode
 * manager.enterEditMode({ taskId: '123', field: 'name' }, 'f2');
 * 
 * // Check state
 * if (manager.isEditing()) {
 *     const ctx = manager.getContext();
 * }
 * 
 * // Exit edit mode
 * manager.exitEditMode('escape');
 * 
 * // Cleanup
 * unsubscribe();
 * ```
 */
export class EditingStateManager {
    // Singleton instance
    private static instance: EditingStateManager | null = null;

    // Current state
    private state: EditingState = {
        isEditing: false,
        context: null,
        previousContext: null,
    };

    // Subscribers
    private subscribers: Map<symbol, { callback: EditingStateSubscriber; options?: SubscriptionOptions }> = new Map();

    // Debug mode
    private debugMode: boolean = false;

    // ========================================================================
    // SINGLETON / DI
    // ========================================================================

    /**
     * Constructor is public for Pure DI compatibility.
     * Use getInstance() for singleton access or inject directly.
     * 
     * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
     */
    public constructor() {}

    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static getInstance(): EditingStateManager {
        if (!EditingStateManager.instance) {
            EditingStateManager.instance = new EditingStateManager();
        }
        return EditingStateManager.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static setInstance(instance: EditingStateManager): void {
        EditingStateManager.instance = instance;
    }

    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static resetInstance(): void {
        if (EditingStateManager.instance) {
            EditingStateManager.instance.subscribers.clear();
            EditingStateManager.instance.state = {
                isEditing: false,
                context: null,
                previousContext: null,
            };
        }
        EditingStateManager.instance = null;
    }

    // ========================================================================
    // STATE QUERIES
    // ========================================================================

    /**
     * Check if currently editing
     */
    isEditing(): boolean {
        return this.state.isEditing;
    }

    /**
     * Get current editing context
     */
    getContext(): EditingContext | null {
        return this.state.context;
    }

    /**
     * Get full state (immutable copy)
     */
    getState(): Readonly<EditingState> {
        return { ...this.state };
    }

    /**
     * Check if editing a specific task/field
     */
    isEditingCell(taskId: string, field?: string): boolean {
        if (!this.state.isEditing || !this.state.context) {
            return false;
        }
        if (this.state.context.taskId !== taskId) {
            return false;
        }
        if (field !== undefined && this.state.context.field !== field) {
            return false;
        }
        return true;
    }

    /**
     * Check if editing a specific task (any field)
     */
    isEditingTask(taskId: string): boolean {
        return this.state.isEditing && this.state.context?.taskId === taskId;
    }

    // ========================================================================
    // STATE MUTATIONS
    // ========================================================================

    /**
     * Enter edit mode
     * @param context - What to edit (taskId, field)
     * @param trigger - What triggered this (for debugging/analytics)
     * @param originalValue - Optional original value for potential revert
     */
    enterEditMode(
        context: Omit<EditingContext, 'startedAt' | 'originalValue'>,
        trigger: EditingTrigger,
        originalValue?: unknown
    ): void {
        // If already editing the same cell, no-op
        if (this.state.isEditing && 
            this.state.context?.taskId === context.taskId && 
            this.state.context?.field === context.field) {
            this._debug('enterEditMode: Already editing this cell, ignoring');
            return;
        }

        const previousState = { ...this.state };
        
        // If editing a different cell, save previous context
        const previousContext = this.state.context;

        this.state = {
            isEditing: true,
            context: {
                ...context,
                startedAt: Date.now(),
                originalValue,
            },
            previousContext,
        };

        this._notifySubscribers(previousState, trigger);
        this._debug('enterEditMode:', { context: this.state.context, trigger });
    }

    /**
     * Exit edit mode
     * @param trigger - What triggered the exit
     */
    exitEditMode(trigger: EditingTrigger): void {
        // If not editing, no-op
        if (!this.state.isEditing) {
            this._debug('exitEditMode: Not editing, ignoring');
            return;
        }

        const previousState = { ...this.state };

        this.state = {
            isEditing: false,
            context: null,
            previousContext: previousState.context,
        };

        this._notifySubscribers(previousState, trigger);
        this._debug('exitEditMode:', { trigger, previousContext: previousState.context });
    }

    /**
     * Move to a different cell (exit current, enter new)
     * Used for Tab/Enter navigation
     */
    moveToCell(
        newContext: Omit<EditingContext, 'startedAt' | 'originalValue'>,
        trigger: EditingTrigger,
        originalValue?: unknown
    ): void {
        const previousState = { ...this.state };

        this.state = {
            isEditing: true,
            context: {
                ...newContext,
                startedAt: Date.now(),
                originalValue,
            },
            previousContext: previousState.context,
        };

        this._notifySubscribers(previousState, trigger);
        this._debug('moveToCell:', { from: previousState.context, to: this.state.context, trigger });
    }

    /**
     * Force reset state (for error recovery, task deletion, etc.)
     */
    reset(): void {
        const previousState = { ...this.state };

        this.state = {
            isEditing: false,
            context: null,
            previousContext: null,
        };

        this._notifySubscribers(previousState, 'external');
        this._debug('reset: State cleared');
    }

    /**
     * Check if currently editing task exists in data
     * Used to detect if task was deleted while editing
     */
    validateEditingTask(taskExists: (taskId: string) => boolean): void {
        if (this.state.isEditing && this.state.context) {
            if (!taskExists(this.state.context.taskId)) {
                this._debug('validateEditingTask: Task no longer exists, resetting state');
                this.reset();
            }
        }
    }

    // ========================================================================
    // SUBSCRIPTIONS
    // ========================================================================

    /**
     * Subscribe to state changes
     * @param callback - Function to call on state change
     * @param options - Optional filtering options
     * @returns Unsubscribe function
     */
    subscribe(callback: EditingStateSubscriber, options?: SubscriptionOptions): () => void {
        const id = Symbol('subscriber');
        this.subscribers.set(id, { callback, options });

        // Return unsubscribe function
        return () => {
            this.subscribers.delete(id);
        };
    }

    /**
     * Notify all subscribers of state change
     */
    private _notifySubscribers(previousState: EditingState, trigger: EditingTrigger): void {
        const event: EditingStateChangeEvent = {
            previousState,
            newState: { ...this.state },
            trigger,
            timestamp: Date.now(),
        };

        for (const [, { callback, options }] of this.subscribers) {
            // Apply filters
            if (options?.triggers && !options.triggers.includes(trigger)) {
                continue;
            }
            if (options?.onEnterOnly && !this.state.isEditing) {
                continue;
            }
            if (options?.onExitOnly && this.state.isEditing) {
                continue;
            }

            try {
                callback(event);
            } catch (error) {
                console.error('[EditingStateManager] Subscriber error:', error);
            }
        }
    }

    // ========================================================================
    // DEBUG
    // ========================================================================

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    /**
     * Log debug message
     */
    private _debug(...args: unknown[]): void {
        if (this.debugMode) {
            console.log('[EditingStateManager]', ...args);
        }
    }
}

// ============================================================================
// CONVENIENCE EXPORT
// ============================================================================

/**
 * @deprecated Use constructor injection instead.
 * Shorthand for EditingStateManager.getInstance()
 * 
 * @see docs/adr/001-dependency-injection.md
 */
export function getEditingStateManager(): EditingStateManager {
    return EditingStateManager.getInstance();
}

