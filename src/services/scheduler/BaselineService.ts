/**
 * @fileoverview BaselineService - Baseline set, clear, and variance calculation
 * @module services/scheduler/BaselineService
 * 
 * Phase 7 of SchedulerService decomposition.
 * Extracts baseline operations from SchedulerService into a focused,
 * single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { Task, Calendar } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ToastService } from '../../ui/services/ToastService';
import { calculateVariance as calculateVarianceFn } from '../../core/calculations';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by BaselineService
 */
export interface BaselineServiceDeps {
    /** ProjectController for task data access */
    projectController: ProjectController;
    /** ColumnRegistry for baseline column visibility */
    columnRegistry: ColumnRegistry;
    /** ToastService for user notifications */
    toastService: ToastService;
    /** Save checkpoint for undo/redo */
    saveCheckpoint: () => void;
    /** Save data to storage */
    saveData: () => void;
    /** Rebuild grid columns after baseline change */
    rebuildGridColumns: () => void;
    /** Get calendar for variance calculation */
    getCalendar: () => Calendar;
}

/** Baseline column IDs that are shown/hidden together */
const BASELINE_COLUMN_IDS = [
    'baselineStart',
    'actualStart', 
    'startVariance',
    'baselineFinish',
    'actualFinish',
    'finishVariance'
];

// =========================================================================
// BASELINE SERVICE
// =========================================================================

/**
 * BaselineService - Handles baseline set, clear, and variance calculations
 * 
 * This service handles:
 * - Checking if baseline exists
 * - Setting baseline from current schedule
 * - Clearing baseline data
 * - Updating baseline UI visibility
 * - Calculating variance between baseline and actual
 * 
 * @example
 * ```typescript
 * const baselineService = new BaselineService({
 *     projectController,
 *     columnRegistry,
 *     toastService,
 *     saveCheckpoint: () => scheduler.saveCheckpoint(),
 *     saveData: () => scheduler.saveData(),
 *     rebuildGridColumns: () => scheduler._rebuildGridColumns(),
 *     getCalendar: () => scheduler.calendar
 * });
 * 
 * // Save baseline
 * baselineService.setBaseline();
 * 
 * // Calculate variance
 * const variance = baselineService.calculateVariance(task);
 * ```
 */
export class BaselineService {
    private deps: BaselineServiceDeps;
    private _hasBaseline: boolean = false;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: BaselineServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // BASELINE STATE
    // =========================================================================

    /**
     * Check if baseline has been set for any task
     * @returns True if baseline exists
     */
    hasBaseline(): boolean {
        if (this._hasBaseline) return true;
        
        // Check if any task has baseline data
        const tasks = this.deps.projectController.getTasks();
        const hasBaselineData = tasks.some(task => 
            task.baselineStart !== null && task.baselineStart !== undefined ||
            task.baselineFinish !== null && task.baselineFinish !== undefined
        );
        
        this._hasBaseline = hasBaselineData;
        
        // Sync baseline column visibility with registry
        if (hasBaselineData) {
            this.deps.columnRegistry.setColumnsVisibility(BASELINE_COLUMN_IDS, true);
        }
        
        return hasBaselineData;
    }

    /**
     * Get the current baseline state (for external access)
     * @returns True if baseline has been set
     */
    get hasBaselineState(): boolean {
        return this._hasBaseline;
    }

    /**
     * Set the baseline state (for initialization)
     * @param value - New baseline state
     */
    set hasBaselineState(value: boolean) {
        this._hasBaseline = value;
    }

    // =========================================================================
    // BASELINE OPERATIONS
    // =========================================================================

    /**
     * Set baseline from current schedule
     * Saves current start/end/duration as baseline for all tasks
     */
    setBaseline(): void {
        const isUpdate = this._hasBaseline;
        console.log(`[BaselineService] ${isUpdate ? 'Updating' : 'Saving'} baseline...`);
        
        this.deps.saveCheckpoint();
        
        const tasks = this.deps.projectController.getTasks();
        let baselineCount = 0;
        
        tasks.forEach(task => {
            if (task.start && task.end && task.duration) {
                task.baselineStart = task.start;
                task.baselineFinish = task.end;
                task.baselineDuration = task.duration;
                baselineCount++;
            }
        });
        
        this._hasBaseline = baselineCount > 0;
        
        // Set baseline column visibility via ColumnRegistry
        this.deps.columnRegistry.setColumnsVisibility(BASELINE_COLUMN_IDS, this._hasBaseline);
        
        // Rebuild grid columns to show actual/variance columns
        this.deps.rebuildGridColumns();
        
        // Update UI button visibility
        this.updateBaselineButtonVisibility();
        
        this.deps.saveData();
        const action = isUpdate ? 'updated' : 'saved';
        this.deps.toastService.success(`Baseline ${action} for ${baselineCount} task${baselineCount !== 1 ? 's' : ''}`);
        
        console.log(`[BaselineService] ✅ Baseline ${action} for`, baselineCount, 'tasks');
    }

    /**
     * Clear baseline data from all tasks
     */
    clearBaseline(): void {
        console.log('[BaselineService] Clearing baseline...');
        
        this.deps.saveCheckpoint();
        
        const tasks = this.deps.projectController.getTasks();
        let clearedCount = 0;
        
        tasks.forEach(task => {
            if (task.baselineStart !== null || task.baselineFinish !== null) {
                task.baselineStart = null;
                task.baselineFinish = null;
                task.baselineDuration = undefined;
                clearedCount++;
            }
        });
        
        this._hasBaseline = false;
        
        // Hide baseline columns via ColumnRegistry
        this.deps.columnRegistry.setColumnsVisibility(BASELINE_COLUMN_IDS, false);
        
        // Rebuild grid columns to hide actual/variance columns
        this.deps.rebuildGridColumns();
        
        // Update UI button visibility
        this.updateBaselineButtonVisibility();
        
        this.deps.saveData();
        this.deps.toastService.success(`Baseline cleared from ${clearedCount} task${clearedCount !== 1 ? 's' : ''}`);
        
        console.log('[BaselineService] ✅ Baseline cleared from', clearedCount, 'tasks');
    }

    // =========================================================================
    // UI UPDATES
    // =========================================================================

    /**
     * Update baseline button text and menu item state based on baseline existence
     * - Button shows "Save Baseline" or "Update Baseline"
     * - Clear menu item is disabled when no baseline exists
     */
    updateBaselineButtonVisibility(): void {
        // Update toolbar button text
        const baselineBtn = document.getElementById('baseline-btn');
        const baselineBtnText = document.getElementById('baseline-btn-text');
        
        if (baselineBtn && baselineBtnText) {
            if (this._hasBaseline) {
                baselineBtnText.textContent = 'Update Baseline';
                baselineBtn.title = 'Update Baseline with Current Schedule';
            } else {
                baselineBtnText.textContent = 'Save Baseline';
                baselineBtn.title = 'Save Current Schedule as Baseline';
            }
        }
        
        // Update Clear Baseline menu item state
        const clearMenuItem = document.getElementById('clear-baseline-menu-item');
        if (clearMenuItem) {
            if (this._hasBaseline) {
                clearMenuItem.classList.remove('disabled');
                clearMenuItem.removeAttribute('disabled');
            } else {
                clearMenuItem.classList.add('disabled');
                clearMenuItem.setAttribute('disabled', 'true');
            }
        }
    }

    // =========================================================================
    // VARIANCE CALCULATION
    // =========================================================================

    /**
     * Calculate variance for a task
     * @param task - Task to calculate variance for
     * @returns Variance object with start and finish variances in work days
     */
    calculateVariance(task: Task): { start: number | null; finish: number | null } {
        // Delegated to standalone module for Pure DI compatibility
        return calculateVarianceFn(task, this.deps.getCalendar());
    }
}
