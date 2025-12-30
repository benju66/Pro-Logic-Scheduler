/**
 * MockRustEngine.ts - Test Mode Mock Engine
 * 
 * Mocks the Rust engine for E2E testing when Tauri APIs aren't available.
 * This allows Playwright tests to verify scheduling logic without requiring
 * the actual Tauri desktop app.
 * 
 * NOTE: This is ONLY for testing. Production always uses RustEngine.
 * 
 * @author Pro Logic Scheduler
 * @version 4.0.0 - Phase 1 Test Mode
 */

import type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
import type { Task, Calendar, CPMResult } from '../../types';
import { DateUtils } from '../DateUtils';

/**
 * Mock Rust Engine for testing
 * 
 * Implements basic CPM calculations in JavaScript for test verification.
 * The actual production app uses RustEngine with full Tauri integration.
 */
export class MockRustEngine implements ISchedulingEngine {
    /** Initialization flag */
    private initialized = false;
    
    /** Internal task storage */
    private tasks: Task[] = [];
    
    /** Calendar configuration */
    private calendar: Calendar | null = null;
    
    /** Context functions */
    private context: TaskHierarchyContext | null = null;

    /**
     * Initialize engine with project data
     */
    async initialize(
        tasks: Task[], 
        calendar: Calendar,
        context: TaskHierarchyContext
    ): Promise<void> {
        this.context = context;
        this.calendar = calendar;
        this.tasks = tasks.filter(t => !t.rowType || t.rowType === 'task');
        this.initialized = true;
        console.log('[MockRustEngine] Initialized with', this.tasks.length, 'tasks (TEST MODE)');
    }

    /**
     * Update a single task in engine state
     */
    async updateTask(id: string, updates: Partial<Task>): Promise<void> {
        if (!this.initialized) {
            console.warn('[MockRustEngine] updateTask called before initialization');
            return;
        }

        const index = this.tasks.findIndex(t => t.id === id);
        if (index >= 0) {
            this.tasks[index] = { ...this.tasks[index], ...updates };
        }
    }

    /**
     * Add a new task to engine state
     */
    async addTask(task: Task): Promise<void> {
        if (!this.initialized) {
            console.warn('[MockRustEngine] addTask called before initialization');
            return;
        }

        this.tasks.push(task);
        console.log(`[MockRustEngine] Added task ${task.id}`);
    }

    /**
     * Delete a task from engine state
     */
    async deleteTask(taskId: string): Promise<void> {
        if (!this.initialized) {
            console.warn('[MockRustEngine] deleteTask called before initialization');
            return;
        }

        this.tasks = this.tasks.filter(t => t.id !== taskId);
        console.log(`[MockRustEngine] Deleted task ${taskId}`);
    }

    /**
     * Bulk sync all tasks
     */
    async syncTasks(tasks: Task[]): Promise<void> {
        if (!this.initialized) {
            console.warn('[MockRustEngine] syncTasks called before initialization');
            return;
        }

        this.tasks = tasks.filter(t => !t.rowType || t.rowType === 'task');
        console.log(`[MockRustEngine] Synced ${this.tasks.length} tasks`);
    }

    /**
     * Run CPM calculation
     * 
     * Implements forward pass CPM calculation for testing.
     * This matches the behavior expected from the Rust engine.
     */
    async recalculateAll(): Promise<CPMResult> {
        if (!this.initialized || !this.calendar || !this.context) {
            throw new Error('[MockRustEngine] Cannot recalculate: not initialized');
        }

        const calculatedTasks: Task[] = [];
        const taskMap = new Map<string, Task>();
        
        // Create a map for quick lookup - will be updated as we calculate
        this.tasks.forEach(task => {
            taskMap.set(task.id, { ...task });
        });

        // Forward pass: calculate early start and early finish
        // Multiple passes to handle dependencies (simple iterative approach)
        let changed = true;
        let iterations = 0;
        const MAX_ITERATIONS = 100;
        
        while (changed && iterations < MAX_ITERATIONS) {
            changed = false;
            iterations++;
            
            for (const task of this.tasks) {
                const current = taskMap.get(task.id)!;
                let newStart = current.start || '';
                let newEnd = current.end || '';
                
                // Skip if it's a parent task (summary task)
                if (this.context!.isParent(task.id)) {
                    continue;
                }

                // If task already has both dates calculated, skip
                if (newStart && newEnd && newStart !== '' && newEnd !== '') {
                    continue;
                }

                // If task has a fixed start date, use it
                if (task.start && task.start !== '' && (!newEnd || newEnd === '')) {
                    newStart = task.start;
                    newEnd = DateUtils.addWorkDays(
                        task.start,
                        (task.duration || 1) - 1,
                        this.calendar!
                    );
                } else if (task.dependencies && task.dependencies.length > 0) {
                    // Calculate start based on dependencies
                    let earliestStart = '';
                    
                    for (const dep of task.dependencies) {
                        const predecessor = taskMap.get(dep.id);
                        if (!predecessor) continue;
                        
                        let depDate = '';
                        
                        // Handle different link types
                        if (dep.type === 'FS') {
                            // Finish-to-Start: start after predecessor ends
                            if (predecessor.end && predecessor.end !== '') {
                                // FS means start on the day AFTER predecessor ends
                                depDate = DateUtils.addWorkDays(predecessor.end, 1, this.calendar!);
                            }
                        } else if (dep.type === 'SS') {
                            // Start-to-Start: start when predecessor starts
                            if (predecessor.start && predecessor.start !== '') {
                                depDate = predecessor.start;
                            }
                        }
                        
                        if (depDate) {
                            // Apply lag
                            if (dep.lag && dep.lag !== 0) {
                                depDate = DateUtils.addWorkDays(depDate, dep.lag, this.calendar!);
                            }
                            
                            if (!earliestStart || depDate > earliestStart) {
                                earliestStart = depDate;
                            }
                        }
                    }
                    
                    if (earliestStart) {
                        newStart = earliestStart;
                        newEnd = DateUtils.addWorkDays(
                            earliestStart,
                            (task.duration || 1) - 1,
                            this.calendar!
                        );
                    }
                }
                
                // Check if anything changed
                if (newStart !== current.start || newEnd !== current.end) {
                    taskMap.set(task.id, { ...current, start: newStart, end: newEnd });
                    changed = true;
                }
            }
        }
        
        // Collect results
        for (const task of this.tasks) {
            calculatedTasks.push(taskMap.get(task.id)!);
        }

        console.log(`[MockRustEngine] CPM completed in ${iterations} iterations`);
        
        return {
            tasks: calculatedTasks,
            statistics: {
                totalTasks: calculatedTasks.length,
                calculatedTasks: calculatedTasks.filter(t => t.start && t.start !== '').length,
                criticalPathLength: 0, // Not calculated in mock
            }
        };
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        this.initialized = false;
        this.tasks = [];
        this.calendar = null;
        this.context = null;
        console.log('[MockRustEngine] Disposed');
    }
}
