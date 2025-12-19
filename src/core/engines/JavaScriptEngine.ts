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
     * CRITICAL: This is NOT a no-op. The interface contract requires
     * that recalculateAll() uses internal state, so we must keep it current.
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
            // Task not found - might be a new task, add it
            console.warn(`[JavaScriptEngine] Task ${id} not found for update, adding as new`);
            this.tasks.push(updates as Task);
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

