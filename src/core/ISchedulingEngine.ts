/**
 * ISchedulingEngine.ts - Dual Engine Interface
 * 
 * Defines the contract for CPM calculation engines.
 * Both JavaScript and Rust implementations must be STATEFUL.
 * 
 * @author Pro Logic Scheduler
 * @version 3.0.0 - Phase 3 Dual Engine
 */

import type { Task, Calendar, CPMResult } from '../types';

/**
 * Context functions for hierarchy calculations
 * Required for CPM to understand parent/child relationships
 */
export interface TaskHierarchyContext {
    /** Check if a task has children */
    isParent: (id: string) => boolean;
    /** Get depth level of a task in hierarchy */
    getDepth: (id: string, depth?: number) => number;
}

/**
 * Scheduling Engine Interface
 * 
 * Both implementations (JS and Rust) must:
 * 1. Store tasks and calendar internally after initialize()
 * 2. Update internal state on updateTask()
 * 3. Use internal state for recalculateAll()
 */
export interface ISchedulingEngine {
    /**
     * Initialize the engine with project data
     * 
     * @param tasks - Array of all tasks in the project
     * @param calendar - Calendar configuration (work days, holidays)
     * @param context - Hierarchy helper functions
     */
    initialize(
        tasks: Task[], 
        calendar: Calendar,
        context: TaskHierarchyContext
    ): Promise<void>;

    /**
     * Update a single task in the engine's internal state
     * 
     * IMPORTANT: This assumes the task already exists in the engine state.
     * For new tasks, use addTask() instead.
     * 
     * @param id - Task ID to update
     * @param updates - Partial task with changed fields
     */
    updateTask(id: string, updates: Partial<Task>): Promise<void>;

    /**
     * Add a new task to the engine's internal state
     * 
     * @param task - Complete task object to add
     */
    addTask(task: Task): Promise<void>;

    /**
     * Delete a task from the engine's internal state
     * 
     * @param taskId - Task ID to delete
     */
    deleteTask(taskId: string): Promise<void>;

    /**
     * Sync all tasks (bulk update)
     * 
     * Used when multiple tasks change at once (e.g., after indent/outdent)
     * 
     * @param tasks - Complete task array to replace internal state
     */
    syncTasks(tasks: Task[]): Promise<void>;

    /**
     * Run full CPM calculation on internal state
     * 
     * @returns CPMResult with calculated tasks and statistics
     */
    recalculateAll(): Promise<CPMResult>;

    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
}

