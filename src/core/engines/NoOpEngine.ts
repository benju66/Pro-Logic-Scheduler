/**
 * NoOpEngine.ts - Stub Engine for Phase 7 Migration
 * 
 * This is a transitional engine that implements ISchedulingEngine
 * but delegates to ProjectController for actual calculations.
 * 
 * PHASE 7: Replaces RustEngine and MockRustEngine.
 * All calculations now happen in the WASM Worker via ProjectController.
 * This stub keeps SchedulerService working during the migration.
 * 
 * @author Pro Logic Scheduler
 * @version 5.0.0 - Phase 7 Cleanup
 */

import type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
import type { Task, Calendar, CPMResult } from '../../types';
import { ProjectController } from '../../services/ProjectController';

/**
 * No-Op Engine - Delegates to ProjectController
 * 
 * This engine doesn't perform calculations itself.
 * It's a bridge that keeps SchedulerService working while
 * ProjectController handles the actual WASM-based calculations.
 */
export class NoOpEngine implements ISchedulingEngine {
    /** Reference to ProjectController singleton */
    private controller: ProjectController;
    
    /** Initialization flag */
    private initialized = false;

    constructor() {
        this.controller = ProjectController.getInstance();
    }

    /**
     * Initialize engine - no-op since ProjectController is already initialized
     */
    async initialize(
        _tasks: Task[], 
        _calendar: Calendar,
        _context: TaskHierarchyContext
    ): Promise<void> {
        // ProjectController is already initialized by AppInitializer
        // This is just for interface compatibility
        this.initialized = true;
        console.log('[NoOpEngine] Initialized (delegating to ProjectController)');
    }

    /**
     * Update task - delegates to ProjectController
     */
    async updateTask(id: string, _updates: Partial<Task>): Promise<void> {
        if (!this.initialized) {
            console.warn('[NoOpEngine] updateTask called before initialization');
            return;
        }
        
        // ProjectController already handles this via GridRenderer/GanttRenderer
        // This is called by SchedulerService for backwards compatibility
        // We don't need to do anything here since the update already went through ProjectController
        console.log(`[NoOpEngine] updateTask ${id} (no-op - handled by ProjectController)`);
    }

    /**
     * Add task - delegates to ProjectController
     */
    async addTask(task: Task): Promise<void> {
        if (!this.initialized) {
            console.warn('[NoOpEngine] addTask called before initialization');
            return;
        }
        
        // Forward to ProjectController
        this.controller.addTask(task);
        console.log(`[NoOpEngine] addTask ${task.id} -> ProjectController`);
    }

    /**
     * Delete task - delegates to ProjectController
     */
    async deleteTask(taskId: string): Promise<void> {
        if (!this.initialized) {
            console.warn('[NoOpEngine] deleteTask called before initialization');
            return;
        }
        
        // Forward to ProjectController
        this.controller.deleteTask(taskId);
        console.log(`[NoOpEngine] deleteTask ${taskId} -> ProjectController`);
    }

    /**
     * Sync tasks - delegates to ProjectController
     */
    async syncTasks(tasks: Task[]): Promise<void> {
        if (!this.initialized) {
            console.warn('[NoOpEngine] syncTasks called before initialization');
            return;
        }
        
        // Forward to ProjectController
        this.controller.syncTasks(tasks);
        console.log(`[NoOpEngine] syncTasks (${tasks.length} tasks) -> ProjectController`);
    }

    /**
     * Recalculate all - returns current state from ProjectController
     * 
     * Note: Actual calculation happens in the WASM Worker.
     * This method returns the last calculated results.
     */
    async recalculateAll(): Promise<CPMResult> {
        if (!this.initialized) {
            throw new Error('[NoOpEngine] Cannot recalculate: not initialized');
        }

        // Trigger a recalculation in ProjectController
        this.controller.forceRecalculate();
        
        // Wait a moment for calculation to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Return current state from ProjectController
        const tasks = this.controller.getTasks();
        const stats = this.controller.getStats();
        
        console.log(`[NoOpEngine] recalculateAll -> ${tasks.length} tasks from ProjectController`);
        
        return {
            tasks,
            stats: stats || {
                calcTime: 0,
                taskCount: tasks.length,
                criticalCount: 0,
                projectEnd: '',
                duration: 0,
            }
        };
    }

    /**
     * Dispose - no-op (ProjectController lifecycle is managed separately)
     */
    async dispose(): Promise<void> {
        this.initialized = false;
        console.log('[NoOpEngine] Disposed');
    }
}
