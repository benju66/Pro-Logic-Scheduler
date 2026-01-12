/**
 * @fileoverview ViewStateService - Manages view state, navigation, and edit mode
 * @module services/scheduler/ViewStateService
 * 
 * Phase 3 of SchedulerService decomposition.
 * Extracts view state management, navigation, and edit mode operations
 * from SchedulerService into a focused, single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { ViewMode, GridColumn } from '../../types';
import { getTaskFieldValue } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ViewCoordinator } from '../migration/ViewCoordinator';
import type { GridAccessor, GanttAccessor } from './types';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Display settings for the scheduler view
 */
export interface DisplaySettings {
    /** Whether to highlight dependencies on task hover */
    highlightDependenciesOnHover: boolean;
    /** Whether driving path mode is active */
    drivingPathMode: boolean;
}

/**
 * Dependencies required by ViewStateService
 */
export interface ViewStateServiceDeps {
    /** ProjectController for task data access */
    projectController: ProjectController;
    /** SelectionModel for selection state */
    selectionModel: SelectionModel;
    /** EditingStateManager for edit mode state */
    editingStateManager: EditingStateManager;
    /** CommandService for executing commands */
    commandService: CommandService;
    /** ViewCoordinator for triggering reactive updates */
    viewCoordinator: ViewCoordinator;
    /** Get grid accessor (may be null before init) */
    getGrid: () => GridAccessor | null;
    /** Get gantt accessor (may be null before init) */
    getGantt: () => GanttAccessor | null;
    /** Get column definitions */
    getColumnDefinitions: () => GridColumn[];
    /** Close drawer panel */
    closeDrawer: () => void;
    /** Check if drawer is open */
    isDrawerOpen: () => boolean;
    /** Callback for selection change events */
    onSelectionChange: (selectedIds: string[]) => void;
    /** Callback to update header checkbox state */
    updateHeaderCheckboxState: (checkbox?: HTMLInputElement) => void;
}

// =========================================================================
// VIEW STATE SERVICE
// =========================================================================

/**
 * ViewStateService - Manages view state, navigation, and edit mode
 * 
 * This service handles:
 * - View mode (Day, Week, Month)
 * - Display settings (dependency highlighting, driving path)
 * - Keyboard navigation (Tab indent/outdent, Escape)
 * - Edit mode transitions (F2, Enter, Escape)
 * 
 * @example
 * ```typescript
 * const viewState = new ViewStateService({
 *     projectController,
 *     selectionModel,
 *     editingStateManager,
 *     commandService,
 *     viewCoordinator,
 *     getGrid: () => grid,
 *     getGantt: () => gantt,
 *     getColumnDefinitions: () => columns,
 *     closeDrawer: () => drawer.close(),
 *     isDrawerOpen: () => drawer.isOpen()
 * });
 * 
 * // Set view mode
 * viewState.setViewMode('Month');
 * 
 * // Enter edit mode for current cell
 * viewState.enterEditMode();
 * ```
 */
export class ViewStateService {
    private deps: ViewStateServiceDeps;

    // === Public State ===
    
    /** Current view mode (Day, Week, Month) */
    public viewMode: ViewMode = 'Week';
    
    /** Display settings */
    public displaySettings: DisplaySettings = {
        highlightDependenciesOnHover: true,
        drivingPathMode: false
    };

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: ViewStateServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // VIEW MODE
    // =========================================================================

    /**
     * Set view mode (Day, Week, Month)
     * @param mode - The view mode to set
     */
    setViewMode(mode: ViewMode): void {
        if (['Day', 'Week', 'Month'].includes(mode)) {
            this.viewMode = mode;
            const gantt = this.deps.getGantt();
            if (gantt) {
                gantt.setViewMode(this.viewMode);
            }
            // Use ViewCoordinator for reactive render
            this.deps.viewCoordinator.forceUpdate();
        }
    }

    /**
     * Get current view mode
     * @returns Current view mode
     */
    getViewMode(): ViewMode {
        return this.viewMode;
    }

    // =========================================================================
    // DISPLAY SETTINGS
    // =========================================================================

    /**
     * Get whether dependency highlighting on hover is enabled
     * @returns True if highlighting is enabled
     */
    getHighlightDependenciesOnHover(): boolean {
        return this.displaySettings.highlightDependenciesOnHover;
    }

    /**
     * Set whether dependency highlighting on hover is enabled
     * @param enabled - True to enable highlighting
     */
    setHighlightDependenciesOnHover(enabled: boolean): void {
        this.displaySettings.highlightDependenciesOnHover = enabled;
    }

    /**
     * Toggle driving path mode
     */
    toggleDrivingPathMode(): void {
        this.displaySettings.drivingPathMode = !this.displaySettings.drivingPathMode;
        this._updateGanttDrivingPathMode();
        this.deps.viewCoordinator.forceUpdate();
    }

    /**
     * Get whether driving path mode is active
     * @returns True if driving path mode is active
     */
    isDrivingPathMode(): boolean {
        return this.displaySettings.drivingPathMode;
    }

    /**
     * Update Gantt driving path mode display
     * @private
     */
    private _updateGanttDrivingPathMode(): void {
        // TODO: Implement driving path visualization in GanttRenderer
        // For now, this is a placeholder
        const gantt = this.deps.getGantt();
        if (gantt && this.displaySettings.drivingPathMode) {
            // Driving path mode is active - GanttRenderer should highlight critical path
            // This will be implemented when driving path feature is added
        }
    }

    // =========================================================================
    // KEYBOARD NAVIGATION HANDLERS
    // =========================================================================

    /**
     * Handle Tab indent - indent selected tasks
     */
    handleTabIndent(): void {
        // Delegate to CommandService
        this.deps.commandService.execute('hierarchy.indent');
    }

    /**
     * Handle Shift+Tab outdent - outdent selected tasks
     */
    handleTabOutdent(): void {
        // Delegate to CommandService
        this.deps.commandService.execute('hierarchy.outdent');
    }

    /**
     * Handle Escape key
     * - Closes drawer if open
     * - Cancels cut operation if active
     * - Clears selection otherwise
     */
    handleEscape(): void {
        // First check if drawer is open (UI-specific, not in command)
        if (this.deps.isDrawerOpen()) {
            this.deps.closeDrawer();
            return;
        }
        
        // Delegate to CommandService for cut cancel / selection clear
        this.deps.commandService.execute('selection.escape');
    }

    // =========================================================================
    // EDIT MODE
    // =========================================================================

    /**
     * Enter edit mode for the currently highlighted cell
     */
    enterEditMode(): void {
        const focusedId = this.deps.selectionModel.getFocusedId();
        const focusedColumn = this.deps.selectionModel.getFocusedField();
        if (!focusedId || !focusedColumn) return;
        
        const editingManager = this.deps.editingStateManager;
        const task = this.deps.projectController.getTaskById(focusedId);
        const originalValue = task ? getTaskFieldValue(task, focusedColumn as GridColumn['field']) : undefined;
        
        editingManager.enterEditMode(
            { taskId: focusedId, field: focusedColumn },
            'f2',
            originalValue
        );
        
        const grid = this.deps.getGrid();
        if (grid) {
            grid.focusCell(focusedId, focusedColumn);
        }
    }

    /**
     * Exit edit mode programmatically
     * Note: Mostly handled by EditingStateManager subscription
     */
    exitEditMode(): void {
        const editingManager = this.deps.editingStateManager;
        if (editingManager.isEditing()) {
            editingManager.exitEditMode('programmatic');
        }
    }

    /**
     * Check if currently in edit mode
     * @returns True if in edit mode
     */
    isEditMode(): boolean {
        return this.deps.editingStateManager.isEditing();
    }

    /**
     * Get the currently editing cell info
     * @returns Object with taskId and field, or null if not editing
     */
    getEditingCell(): { taskId: string; field: string } | null {
        const ctx = this.deps.editingStateManager.getContext();
        return ctx ? { taskId: ctx.taskId, field: ctx.field } : null;
    }

    // =========================================================================
    // DRIVING PATH UPDATES (called from selection updates)
    // =========================================================================

    /**
     * Update driving path visualization if mode is active
     * Called when selection changes
     */
    updateDrivingPathIfActive(): void {
        if (this.displaySettings.drivingPathMode) {
            this._updateGanttDrivingPathMode();
        }
    }

    // =========================================================================
    // SELECTION UI UPDATES (Phase 4.3: Merged from SchedulerService)
    // =========================================================================

    /**
     * Update selection in UI components (grid, gantt, header checkbox)
     * Called when selection state changes
     */
    updateSelection(): void {
        const grid = this.deps.getGrid();
        const gantt = this.deps.getGantt();
        
        if (grid) {
            grid.setSelection(
                new Set(this.deps.selectionModel.getSelectedIds()),
                this.deps.selectionModel.getFocusedId()
            );
        }
        if (gantt) {
            gantt.setSelection(new Set(this.deps.selectionModel.getSelectedIds()));
        }
        
        // Update header checkbox state
        this.updateHeaderCheckboxState();
        
        // Update driving path if mode is active
        this.updateDrivingPathIfActive();
        
        // Trigger selection change callbacks (for RightSidebarManager and other listeners)
        const selectedArray = Array.from(this.deps.selectionModel.getSelectedIds());
        this.deps.onSelectionChange(selectedArray);
    }

    /**
     * Update header checkbox state (checked/unchecked/indeterminate)
     * Delegates to ColumnPreferencesService via callback
     * 
     * @param checkbox - Optional checkbox element (if not provided, finds it)
     */
    updateHeaderCheckboxState(checkbox?: HTMLInputElement): void {
        this.deps.updateHeaderCheckboxState(checkbox);
    }
}
