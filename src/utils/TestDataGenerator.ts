/**
 * @fileoverview Test Data Generator Utility
 * @module utils/TestDataGenerator
 * 
 * Utility for generating mock test data.
 * Extracted from SchedulerService to separate test utilities from production code.
 * 
 * RESPONSIBILITIES:
 * - Generate mock tasks for testing/performance testing
 * - Create realistic test data with dependencies and hierarchy
 * 
 * @see docs/PHASE3_DECOMPOSITION_AUDIT.md - Phase 3.2
 */

import { DateUtils } from '../core/DateUtils';
import { OrderingService } from '../services/OrderingService';
import type { Task } from '../types';
import type { ProjectController } from '../services/ProjectController';
import type { ToastService } from '../ui/services/ToastService';

/**
 * Dependencies required by TestDataGenerator
 */
export interface TestDataGeneratorDeps {
    /** ProjectController for syncing tasks */
    projectController: ProjectController;
    /** ToastService for success notification */
    toastService: ToastService;
}

/**
 * Test Data Generator
 * 
 * Generates mock tasks for testing and performance benchmarking.
 * Creates realistic test data with:
 * - Random durations and dates
 * - Hierarchical relationships (parent-child)
 * - Dependencies between tasks
 */
export class TestDataGenerator {
    private deps: TestDataGeneratorDeps;

    constructor(deps: TestDataGeneratorDeps) {
        this.deps = deps;
    }

    /**
     * Generate mock tasks for testing
     * 
     * Creates tasks with:
     * - Random durations (1-10 days)
     * - Random start dates (within 200 work days)
     * - Some hierarchical relationships (20% chance after 10 tasks)
     * - Some dependencies (30% chance after 5 tasks)
     * 
     * @param count - Number of tasks to generate
     */
    generateMockTasks(count: number): void {
        const today = DateUtils.today();
        const existingTasks = this.deps.projectController.getTasks();
        const tasks: Task[] = [...existingTasks];
        
        // Pre-generate all sortKeys to avoid stale reads
        const lastKey = this.deps.projectController.getLastSortKey(null);
        const sortKeys = OrderingService.generateBulkKeys(lastKey, null, count);
        
        const calendar = this.deps.projectController.getCalendar();
        
        for (let i = 0; i < count; i++) {
            const duration = Math.floor(Math.random() * 10) + 1;
            const startOffset = Math.floor(Math.random() * 200);
            const startDate = DateUtils.addWorkDays(today, startOffset, calendar);
            const endDate = DateUtils.addWorkDays(startDate, duration - 1, calendar);
            
            const task: Task = {
                id: `task_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`,
                name: `Task ${existingTasks.length + i + 1}`,
                start: startDate,
                end: endDate,
                duration: duration,
                parentId: null,
                dependencies: [],
                progress: Math.floor(Math.random() * 100),
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                level: 0,
                sortKey: sortKeys[i],
                _collapsed: false,
            };
            
            // Add hierarchical relationships (20% chance after 10 tasks)
            if (i > 10 && Math.random() < 0.2) {
                const parentIndex = Math.floor(Math.random() * Math.min(i, 20));
                task.parentId = tasks[parentIndex]?.id || null;
            }
            
            // Add dependencies (30% chance after 5 tasks)
            if (i > 5 && Math.random() < 0.3) {
                const predIndex = Math.floor(Math.random() * Math.min(i, 10));
                if (tasks[predIndex] && tasks[predIndex].id !== task.parentId) {
                    task.dependencies.push({
                        id: tasks[predIndex].id,
                        type: 'FS',
                        lag: 0,
                    });
                }
            }
            
            tasks.push(task);
        }
        
        this.deps.projectController.syncTasks(tasks);
        // NOTE: ProjectController handles recalc/save via Worker
        
        this.deps.toastService?.success(`Generated ${count} tasks`);
    }
}
