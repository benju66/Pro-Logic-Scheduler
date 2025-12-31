/**
 * @fileoverview View Coordinator Service
 * @module services/migration/ViewCoordinator
 * 
 * Handles reactive subscriptions to ProjectController and coordinates
 * Grid/Gantt updates. This is the PRIMARY fix for the UI blocking issue.
 * 
 * KEY CHANGES FROM LEGACY:
 * 1. Subscribes to ProjectController.tasks$ (reactive, not polling)
 * 2. Subscribes to SelectionModel.state$ (reactive selection)
 * 3. Batches DOM updates using requestAnimationFrame
 * 4. Eliminates synchronous blocking operations
 * 
 * ARCHITECTURE:
 *   ProjectController.tasks$ ──┐
 *                              ├──► ViewCoordinator ──► Grid/Gantt
 *   SelectionModel.state$ ─────┘
 */

import { Subscription, distinctUntilChanged, debounceTime } from 'rxjs';
import { ProjectController } from '../ProjectController';
import { SelectionModel } from '../SelectionModel';
import type { Task, Calendar, CPMResult } from '../../types';
import type { VirtualScrollGridFacade, CanvasGanttFacade } from '../../ui/components/scheduler/types';

/**
 * View state snapshot
 */
export interface ViewState {
    tasks: Task[];
    calendar: Calendar;
    stats: CPMResult['stats'] | null;
    selectedIds: Set<string>;
    focusedId: string | null;
    focusedField: string | null;
}

/**
 * View Coordinator
 * 
 * Single source of truth for UI updates. Subscribes to state streams
 * and coordinates updates to Grid and Gantt components.
 */
export class ViewCoordinator {
    private static instance: ViewCoordinator;
    
    // Component references (set via setComponents)
    private grid: VirtualScrollGridFacade | null = null;
    private gantt: CanvasGanttFacade | null = null;
    
    // Subscriptions (for cleanup)
    private subscriptions: Subscription[] = [];
    
    // Update batching
    private pendingRender = false;
    private pendingGridData = false;
    private pendingGanttData = false;
    
    // Callbacks for external integration (e.g., RightSidebarManager)
    private selectionCallbacks: Array<(state: ViewState) => void> = [];
    private dataChangeCallbacks: Array<(tasks: Task[]) => void> = [];
    
    private constructor() {}
    
    public static getInstance(): ViewCoordinator {
        if (!ViewCoordinator.instance) {
            ViewCoordinator.instance = new ViewCoordinator();
        }
        return ViewCoordinator.instance;
    }
    
    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Set component references
     * Called by SchedulerService.init() after components are created
     */
    public setComponents(
        grid: VirtualScrollGridFacade | null,
        gantt: CanvasGanttFacade | null
    ): void {
        this.grid = grid;
        this.gantt = gantt;
        console.log('[ViewCoordinator] Components set');
    }
    
    /**
     * Initialize reactive subscriptions
     * 
     * This is the CRITICAL piece that fixes the UI blocking issue.
     * SchedulerService.init() should call this method.
     */
    public initSubscriptions(): void {
        this.dispose(); // Clean up any existing subscriptions
        
        const controller = ProjectController.getInstance();
        const selection = SelectionModel.getInstance();
        
        // =====================================================================
        // TASK SUBSCRIPTION - Core reactive update
        // =====================================================================
        const taskSub = controller.tasks$.pipe(
            // Don't re-render if task array is identical (reference equality)
            distinctUntilChanged()
        ).subscribe(tasks => {
            console.log(`[ViewCoordinator] tasks$ received: ${tasks.length} tasks`);
            
            // Update component data (non-blocking)
            this._scheduleGridDataUpdate(tasks);
            this._scheduleGanttDataUpdate(tasks);
            this._scheduleRender();
            
            // Notify external listeners
            this._notifyDataChange(tasks);
        });
        this.subscriptions.push(taskSub);
        
        // =====================================================================
        // STATS SUBSCRIPTION - Update summary displays
        // =====================================================================
        const statsSub = controller.stats$.subscribe(stats => {
            if (stats) {
                console.log(
                    `[ViewCoordinator] stats$ received: ${stats.taskCount} tasks, ` +
                    `${stats.criticalCount} critical`
                );
                // Stats updates are handled by StatsService subscriptions
                // We just log here for debugging
            }
        });
        this.subscriptions.push(statsSub);
        
        // =====================================================================
        // CALENDAR SUBSCRIPTION - Trigger re-render on calendar changes
        // =====================================================================
        const calSub = controller.calendar$.pipe(
            distinctUntilChanged()
        ).subscribe(calendar => {
            console.log('[ViewCoordinator] calendar$ changed');
            this._scheduleRender();
        });
        this.subscriptions.push(calSub);
        
        // =====================================================================
        // SELECTION SUBSCRIPTION - Instant UI feedback
        // =====================================================================
        const selSub = selection.state$.subscribe(state => {
            console.log(
                `[ViewCoordinator] selection$ changed: ${state.selectedIds.size} selected, ` +
                `focused: ${state.focusedId}`
            );
            
            // Update grid selection (synchronous for instant feedback)
            if (this.grid) {
                this.grid.setSelection(state.selectedIds, state.focusedId);
            }
            
            // Update gantt selection
            if (this.gantt) {
                this.gantt.setSelection(state.selectedIds);
            }
            
            // Notify external listeners
            this._notifySelectionChange({
                tasks: controller.tasks$.value,
                calendar: controller.calendar$.value,
                stats: controller.stats$.value,
                selectedIds: state.selectedIds,
                focusedId: state.focusedId,
                focusedField: state.focusedField
            });
        });
        this.subscriptions.push(selSub);
        
        // =====================================================================
        // ERROR SUBSCRIPTION - Handle worker errors
        // =====================================================================
        const errSub = controller.errors$.subscribe(error => {
            console.error('[ViewCoordinator] Error from ProjectController:', error);
            // Could show a toast here
        });
        this.subscriptions.push(errSub);
        
        console.log('[ViewCoordinator] Subscriptions initialized');
    }
    
    // =========================================================================
    // UPDATE SCHEDULING (Non-blocking batched updates)
    // =========================================================================
    
    /**
     * Schedule grid data update
     * Uses requestAnimationFrame to batch updates
     */
    private _scheduleGridDataUpdate(tasks: Task[]): void {
        if (this.pendingGridData) return;
        this.pendingGridData = true;
        
        requestAnimationFrame(() => {
            this.pendingGridData = false;
            this._updateGridData(tasks);
        });
    }
    
    /**
     * Schedule gantt data update
     */
    private _scheduleGanttDataUpdate(tasks: Task[]): void {
        if (this.pendingGanttData) return;
        this.pendingGanttData = true;
        
        requestAnimationFrame(() => {
            this.pendingGanttData = false;
            this._updateGanttData(tasks);
        });
    }
    
    /**
     * Schedule render
     */
    private _scheduleRender(): void {
        if (this.pendingRender) return;
        this.pendingRender = true;
        
        requestAnimationFrame(() => {
            this.pendingRender = false;
            this._render();
        });
    }
    
    // =========================================================================
    // DATA UPDATES
    // =========================================================================
    
    /**
     * Update grid data
     * Transforms tasks into visible flat list respecting collapse state
     */
    private _updateGridData(tasks: Task[]): void {
        if (!this.grid) return;
        
        const controller = ProjectController.getInstance();
        const visibleTasks = controller.getVisibleTasks(id => {
            const task = controller.getTaskById(id);
            return task?._collapsed || false;
        });
        
        // Build grid row data
        const gridData = visibleTasks.map(task => ({
            id: task.id,
            rowType: task.rowType || 'task',
            level: controller.getDepth(task.id),
            isParent: controller.isParent(task.id),
            isCollapsed: task._collapsed || false,
            ...task
        }));
        
        this.grid.data = gridData;
    }
    
    /**
     * Update gantt data
     */
    private _updateGanttData(tasks: Task[]): void {
        if (!this.gantt) return;
        
        const controller = ProjectController.getInstance();
        const visibleTasks = controller.getVisibleTasks(id => {
            const task = controller.getTaskById(id);
            return task?._collapsed || false;
        });
        
        // Build gantt data with levels
        const ganttData = visibleTasks.map(task => ({
            ...task,
            level: controller.getDepth(task.id),
            isParent: controller.isParent(task.id)
        }));
        
        this.gantt.data = ganttData;
    }
    
    /**
     * Trigger render on both components
     */
    private _render(): void {
        if (this.grid) {
            this.grid.render();
        }
        if (this.gantt) {
            this.gantt.render();
        }
    }
    
    // =========================================================================
    // IMMEDIATE UPDATES (for synchronous operations)
    // =========================================================================
    
    /**
     * Force immediate update (bypass scheduling)
     * Use sparingly - only when synchronous update is required
     */
    public forceUpdate(): void {
        const tasks = ProjectController.getInstance().tasks$.value;
        this._updateGridData(tasks);
        this._updateGanttData(tasks);
        this._render();
    }
    
    /**
     * Force immediate render only (data already updated)
     */
    public forceRender(): void {
        this._render();
    }
    
    // =========================================================================
    // CALLBACK REGISTRATION
    // =========================================================================
    
    /**
     * Register selection change callback
     * @returns Unsubscribe function
     */
    public onSelectionChange(callback: (state: ViewState) => void): () => void {
        this.selectionCallbacks.push(callback);
        return () => {
            const idx = this.selectionCallbacks.indexOf(callback);
            if (idx >= 0) this.selectionCallbacks.splice(idx, 1);
        };
    }
    
    /**
     * Register data change callback
     * @returns Unsubscribe function
     */
    public onDataChange(callback: (tasks: Task[]) => void): () => void {
        this.dataChangeCallbacks.push(callback);
        return () => {
            const idx = this.dataChangeCallbacks.indexOf(callback);
            if (idx >= 0) this.dataChangeCallbacks.splice(idx, 1);
        };
    }
    
    private _notifySelectionChange(state: ViewState): void {
        for (const callback of this.selectionCallbacks) {
            try {
                callback(state);
            } catch (err) {
                console.error('[ViewCoordinator] Selection callback error:', err);
            }
        }
    }
    
    private _notifyDataChange(tasks: Task[]): void {
        for (const callback of this.dataChangeCallbacks) {
            try {
                callback(tasks);
            } catch (err) {
                console.error('[ViewCoordinator] Data change callback error:', err);
            }
        }
    }
    
    // =========================================================================
    // SCROLL MANAGEMENT
    // =========================================================================
    
    /**
     * Scroll to a specific task
     */
    public scrollToTask(taskId: string): void {
        if (this.grid) {
            this.grid.scrollToTask(taskId);
        }
        if (this.gantt) {
            // Gantt scroll is synced via viewport
        }
    }
    
    // =========================================================================
    // CLEANUP
    // =========================================================================
    
    /**
     * Dispose all subscriptions
     */
    public dispose(): void {
        for (const sub of this.subscriptions) {
            sub.unsubscribe();
        }
        this.subscriptions = [];
        this.selectionCallbacks = [];
        this.dataChangeCallbacks = [];
        this.grid = null;
        this.gantt = null;
        console.log('[ViewCoordinator] Disposed');
    }
    
    /**
     * Reset singleton (for testing)
     */
    public static resetInstance(): void {
        if (ViewCoordinator.instance) {
            ViewCoordinator.instance.dispose();
        }
        ViewCoordinator.instance = null as any;
    }
}

/**
 * Singleton accessor
 */
export const viewCoordinator = ViewCoordinator.getInstance();
