/**
 * @fileoverview IProjectController Interface
 * @module services/interfaces/IProjectController
 * 
 * Interface for ProjectController - the primary data layer abstraction.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import type { BehaviorSubject, Subject } from 'rxjs';
import type { Task, Calendar, CPMResult } from '../../types';
import type { IPersistenceService } from './IPersistenceService';
import type { IHistoryManager } from './IHistoryManager';

/**
 * ProjectController Interface
 * 
 * The primary interface between the UI and the WASM Worker.
 * Exposes observable state streams and task/calendar operations.
 */
export interface IProjectController {
    // =========================================================================
    // Observable State
    // =========================================================================
    
    /** Current task list - updated after every calculation */
    readonly tasks$: BehaviorSubject<Task[]>;
    
    /** Current calendar configuration */
    readonly calendar$: BehaviorSubject<Calendar>;
    
    /** CPM statistics from last calculation */
    readonly stats$: BehaviorSubject<CPMResult['stats'] | null>;
    
    /** Whether the worker/engine is initialized and ready */
    readonly isInitialized$: BehaviorSubject<boolean>;
    
    /** Whether the worker is currently processing a calculation */
    readonly isCalculating$: BehaviorSubject<boolean>;
    
    /** Error stream for error handling */
    readonly errors$: Subject<string>;
    
    // =========================================================================
    // Persistence Integration
    // =========================================================================
    
    /** Set the persistence service for event sourcing */
    setPersistenceService(service: IPersistenceService): void;
    
    /** Get the persistence service */
    getPersistenceService(): IPersistenceService | null;
    
    /** Check if persistence service is attached */
    hasPersistenceService(): boolean;
    
    /** Set the history manager for undo/redo */
    setHistoryManager(manager: IHistoryManager): void;
    
    /** Check if history manager is attached */
    hasHistoryManager(): boolean;
    
    /** Get the history manager instance */
    getHistoryManager(): IHistoryManager | null;
    
    // =========================================================================
    // Task Operations
    // =========================================================================
    
    /** Add a new task */
    addTask(task: Task): void;
    
    /** Update an existing task */
    updateTask(id: string, updates: Partial<Task>): void;
    
    /** Delete a task */
    deleteTask(id: string): void;
    
    /** Sync tasks from external source (bulk update) */
    syncTasks(tasks: Task[]): void;
    
    /** Apply multiple events (for replay) */
    applyEvents(events: Array<{ type: string; targetId: string | null; payload: Record<string, unknown> }>): void;
    
    /** Apply a single event */
    applyEvent(
        type: string,
        targetId: string | null,
        payload: Record<string, unknown>,
        options?: { skipRecalc?: boolean; skipRender?: boolean }
    ): void;
    
    // =========================================================================
    // Calendar Operations
    // =========================================================================
    
    /** Update calendar configuration */
    updateCalendar(calendar: Calendar): void;
    
    // =========================================================================
    // Calculation Control
    // =========================================================================
    
    /** Force a full CPM recalculation */
    forceRecalculate(): void;
    
    // =========================================================================
    // State Accessors
    // =========================================================================
    
    /** Get current tasks array */
    getTasks(): Task[];
    
    /** Get current calendar */
    getCalendar(): Calendar;
    
    /** Get current CPM stats */
    getStats(): CPMResult['stats'] | null;
    
    /** Check if engine is initialized */
    isInitialized(): boolean;
    
    /** Get task by ID */
    getTaskById(id: string): Task | undefined;
    
    /** Check if task is a parent (has children) */
    isParent(id: string): boolean;
    
    /** Get depth of task in hierarchy */
    getDepth(id: string, depth?: number): number;
    
    /** Get children of a parent task */
    getChildren(parentId: string | null): Task[];
    
    /** Get visible tasks respecting collapse state */
    getVisibleTasks(isCollapsed: (id: string) => boolean): Task[];
    
    /** Get last sort key under a parent */
    getLastSortKey(parentId: string | null): string | null;
    
    /** Get first sort key under a parent */
    getFirstSortKey(parentId: string | null): string | null;
    
    /** Check if task is a blank row */
    isBlankRow(id: string): boolean;
    
    /** Get all schedulable tasks (non-blank) */
    getSchedulableTasks(): Task[];
    
    /** Get all descendants of a task */
    getDescendants(id: string): Task[];
    
    // =========================================================================
    // Task Creation & Movement
    // =========================================================================
    
    /** Create a blank placeholder row */
    createBlankRow(sortKey: string, parentId?: string | null): Task;
    
    /** Convert blank row to real task */
    wakeUpBlankRow(taskId: string, name?: string): Task | undefined;
    
    /** Move task to new position */
    moveTask(taskId: string, newParentId: string | null, newSortKey: string): boolean;
    
    /** Update task sort key */
    updateSortKey(taskId: string, newSortKey: string): boolean;
    
    // =========================================================================
    // Lifecycle
    // =========================================================================
    
    /** Dispose of resources */
    dispose(): void;
}
