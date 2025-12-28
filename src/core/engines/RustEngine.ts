/**
 * RustEngine.ts - Tauri Desktop CPM Engine
 * 
 * Communicates with stateful Rust backend via Tauri commands.
 * Uses full Rust CPM implementation (src-tauri/src/cpm.rs) for all calculations.
 * 
 * @author Pro Logic Scheduler
 * @version 4.0.0 - Desktop Only
 */

import { invoke } from '@tauri-apps/api/core';
import type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
import type { Task, Calendar, CPMResult } from '../../types';

/**
 * Rust-based scheduling engine
 * 
 * Maintains state in Rust backend via Tauri commands.
 * Designed for high performance with 10k+ tasks.
 */
export class RustEngine implements ISchedulingEngine {
    /** Initialization flag */
    private initialized = false;
    
    /** Context functions (kept for potential JS fallback) */
    private context: TaskHierarchyContext | null = null;

    /**
     * Initialize engine with project data
     * Sends all tasks and calendar to Rust backend
     */
    async initialize(
        tasks: Task[], 
        calendar: Calendar,
        context: TaskHierarchyContext
    ): Promise<void> {
        this.context = context;
        
        try {
            // Filter out blank rows before sending to Rust engine
            const schedulableTasks = tasks.filter(t => !t.rowType || t.rowType === 'task');
            const tasksJson = JSON.stringify(schedulableTasks);
            const calendarJson = JSON.stringify(calendar);
            
            const result = await invoke<string>('initialize_engine', {
                tasksJson,
                calendarJson,
            });
            
            this.initialized = true;
            console.log(`[RustEngine] ${result}`);
        } catch (error) {
            console.error('[RustEngine] Initialization failed:', error);
            throw new Error(`RustEngine initialization failed: ${error}`);
        }
    }

    /**
     * Update a single task in Rust state
     * 
     * CRITICAL: Assumes the task already exists in Rust state.
     * Do not fall back to syncTasks automatically.
     */
    async updateTask(id: string, updates: Partial<Task>): Promise<void> {
        if (!this.initialized) {
            console.warn('[RustEngine] updateTask called before initialization');
            return;
        }

        try {
            const updatesJson = JSON.stringify(updates);
            await invoke<string>('update_engine_task', { id, updatesJson });
        } catch (error) {
            console.error(`[RustEngine] Failed to update task ${id}:`, error);
            // Don't throw - allow graceful degradation
        }
    }

    /**
     * Add a new task to Rust state
     */
    async addTask(task: Task): Promise<void> {
        if (!this.initialized) {
            console.warn('[RustEngine] addTask called before initialization');
            return;
        }

        try {
            const taskJson = JSON.stringify(task);
            await invoke<string>('add_engine_task', { taskJson });
            console.log(`[RustEngine] Added task ${task.id}`);
        } catch (error) {
            console.error(`[RustEngine] Failed to add task ${task.id}:`, error);
            // Don't throw - allow graceful degradation
        }
    }

    /**
     * Delete a task from Rust state
     */
    async deleteTask(taskId: string): Promise<void> {
        if (!this.initialized) {
            console.warn('[RustEngine] deleteTask called before initialization');
            return;
        }

        try {
            await invoke<string>('delete_engine_task', { id: taskId });
            console.log(`[RustEngine] Deleted task ${taskId}`);
        } catch (error) {
            console.error(`[RustEngine] Failed to delete task ${taskId}:`, error);
            // Don't throw - allow graceful degradation
        }
    }

    /**
     * Bulk sync all tasks to Rust state
     */
    async syncTasks(tasks: Task[]): Promise<void> {
        if (!this.initialized) {
            console.warn('[RustEngine] syncTasks called before initialization');
            return;
        }

        try {
            // Filter out blank rows before sending to Rust engine
            const schedulableTasks = tasks.filter(t => !t.rowType || t.rowType === 'task');
            const tasksJson = JSON.stringify(schedulableTasks);
            const result = await invoke<string>('sync_engine_tasks', { tasksJson });
            console.log(`[RustEngine] ${result}`);
        } catch (error) {
            console.error('[RustEngine] Failed to sync tasks:', error);
            throw error;
        }
    }

    /**
     * Run CPM calculation
     * 
     * Phase 3a: Returns passthrough result from Rust (no actual CPM)
     * Phase 3b: Will return full Rust CPM calculation
     */
    async recalculateAll(): Promise<CPMResult> {
        if (!this.initialized) {
            throw new Error('[RustEngine] Cannot recalculate: not initialized');
        }

        try {
            const resultJson = await invoke<string>('calculate_cpm');
            const result: CPMResult = JSON.parse(resultJson);
            
            return result;
        } catch (error) {
            console.error('[RustEngine] CPM calculation failed:', error);
            throw error;
        }
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        if (this.initialized) {
            try {
                await invoke<string>('clear_engine');
            } catch (error) {
                console.error('[RustEngine] Failed to clear engine:', error);
            }
        }
        
        this.initialized = false;
        this.context = null;
        console.log('[RustEngine] Disposed');
    }

    /**
     * Get engine status (for debugging)
     */
    async getStatus(): Promise<{ initialized: boolean; taskCount: number; hasCalendar: boolean }> {
        try {
            const statusJson = await invoke<string>('get_engine_status');
            return JSON.parse(statusJson);
        } catch (error) {
            return { initialized: false, taskCount: 0, hasCalendar: false };
        }
    }
}

