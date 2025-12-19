/**
 * JavaScriptEngine.ts - Browser CPM Engine
 * 
 * Wraps the existing CPM.ts for browser-based calculation.
 * Maintains STATEFUL copy of tasks for interface compliance.
 * 
 * @author Pro Logic Scheduler
 * @version 3.0.0 - Phase 3 Dual Engine
 */

import type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
import type { Task, Calendar, CPMResult } from '../../types';
import { CPM } from '../CPM';

/**
 * JavaScript-based scheduling engine
 * 
 * Uses the existing pure CPM.ts calculator but maintains
 * stateful task storage to comply with ISchedulingEngine interface.
 */
export class JavaScriptEngine implements ISchedulingEngine {
    /** Internal task storage - MUST stay in sync */
    private tasks: Task[] = [];
    
    /** Calendar configuration */
    private calendar: Calendar | null = null;
    
    /** Hierarchy context functions */
    private context: TaskHierarchyContext | null = null;
    
    /** Initialization flag */
    private initialized = false;

    /**
     * Initialize engine with project data
     * Creates a deep copy to ensure we own the state
     */
    async initialize(
        tasks: Task[], 
        calendar: Calendar,
        context: TaskHierarchyContext
    ): Promise<void> {
        // Deep copy to ensure we own the state and mutations don't leak
        this.tasks = JSON.parse(JSON.stringify(tasks));
        this.calendar = { ...calendar };
        this.context = context;
        this.initialized = true;
        
        console.log(`[JavaScriptEngine] Initialized with ${this.tasks.length} tasks`);
    }

    /**
     * Update a single task in internal state
     * 
     * CRITICAL: Assumes the task already exists in internal state.
     * For new tasks, use addTask() instead.
     */
    async updateTask(id: string, updates: Partial<Task>): Promise<void> {
        if (!this.initialized) {
            console.warn('[JavaScriptEngine] updateTask called before initialization');
            return;
        }

        const taskIndex = this.tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            // Merge updates into existing task
            this.tasks[taskIndex] = {
                ...this.tasks[taskIndex],
                ...updates,
            };
        } else {
            console.warn(`[JavaScriptEngine] Task ${id} not found for update`);
        }
    }

    /**
     * Add a new task to internal state
     */
    async addTask(task: Task): Promise<void> {
        if (!this.initialized) {
            console.warn('[JavaScriptEngine] addTask called before initialization');
            return;
        }

        // Check if task already exists
        const existingIndex = this.tasks.findIndex(t => t.id === task.id);
        if (existingIndex !== -1) {
            console.warn(`[JavaScriptEngine] Task ${task.id} already exists, updating instead`);
            this.tasks[existingIndex] = task;
        } else {
            this.tasks.push(task);
            console.log(`[JavaScriptEngine] Added task ${task.id}`);
        }
    }

    /**
     * Delete a task from internal state
     */
    async deleteTask(taskId: string): Promise<void> {
        if (!this.initialized) {
            console.warn('[JavaScriptEngine] deleteTask called before initialization');
            return;
        }

        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            this.tasks.splice(taskIndex, 1);
            console.log(`[JavaScriptEngine] Deleted task ${taskId}`);
        } else {
            console.warn(`[JavaScriptEngine] Task ${taskId} not found for deletion`);
        }
    }

    /**
     * Bulk sync all tasks
     * Replaces internal state completely
     */
    async syncTasks(tasks: Task[]): Promise<void> {
        if (!this.initialized) {
            console.warn('[JavaScriptEngine] syncTasks called before initialization');
            return;
        }

        // Deep copy to maintain state ownership
        this.tasks = JSON.parse(JSON.stringify(tasks));
        console.log(`[JavaScriptEngine] Synced ${this.tasks.length} tasks`);
    }

    /**
     * Run CPM calculation on internal state
     * 
     * Uses the pure CPM.calculate() function with our stateful task array
     */
    async recalculateAll(): Promise<CPMResult> {
        if (!this.initialized || !this.calendar || !this.context) {
            throw new Error('[JavaScriptEngine] Cannot recalculate: not initialized');
        }

        // Use internal state (this.tasks), not external arguments
        const result = CPM.calculate(this.tasks, this.calendar, {
            isParent: this.context.isParent,
            getDepth: this.context.getDepth,
        });

        // Update internal state with calculated values
        // This ensures subsequent calls have the latest calculated data
        this.tasks = result.tasks;

        return result;
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        this.tasks = [];
        this.calendar = null;
        this.context = null;
        this.initialized = false;
        console.log('[JavaScriptEngine] Disposed');
    }

    /**
     * Get current task count (for debugging)
     */
    getTaskCount(): number {
        return this.tasks.length;
    }
}

