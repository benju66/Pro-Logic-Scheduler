/**
 * @fileoverview GridNavigationController - Excel-style grid cell navigation
 * @module services/scheduler/GridNavigationController
 * 
 * Industry-standard approach to grid navigation using coordinate-based positioning.
 * Separates navigation logic from selection and UI concerns for testability.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

// =========================================================================
// TYPES
// =========================================================================

/**
 * Cell position in the grid (row and column indices)
 */
export interface CellPosition {
    /** Row index (0-based, in visible task order) */
    rowIndex: number;
    /** Column index (0-based, in navigable column order) */
    colIndex: number;
}

/**
 * Result of a navigation operation
 */
export interface NavigationResult {
    /** Task ID at the new position */
    taskId: string;
    /** Column field name at the new position */
    field: string;
    /** The new cell position */
    position: CellPosition;
}

/**
 * Navigation direction
 */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Dependencies required by GridNavigationController
 */
export interface GridNavigationControllerDeps {
    /** Get list of visible task IDs in display order */
    getVisibleTaskIds: () => string[];
    /** Get list of navigable column field names */
    getNavigableColumns: () => string[];
    /** Check if currently in edit mode (navigation blocked) */
    isEditing: () => boolean;
}

// =========================================================================
// GRID NAVIGATION CONTROLLER
// =========================================================================

/**
 * GridNavigationController - Manages Excel-style grid cell navigation
 * 
 * This controller handles:
 * - Arrow key navigation (up/down/left/right)
 * - Boundary detection (can't go past first/last row/column)
 * - Edit mode blocking (no navigation while editing)
 * 
 * It does NOT handle:
 * - Selection (that's SelectionModel's job)
 * - UI updates (that's the caller's job)
 * - Scrolling (that's the Grid's job)
 * 
 * @example
 * ```typescript
 * const nav = new GridNavigationController({
 *     getVisibleTaskIds: () => ['task1', 'task2', 'task3'],
 *     getNavigableColumns: () => ['name', 'start', 'end', 'duration'],
 *     isEditing: () => editingManager.isEditing()
 * });
 * 
 * // Navigate down
 * const result = nav.navigate('down');
 * if (result) {
 *     selectionModel.setFocus(result.taskId, result.field);
 *     grid.highlightCell(result.taskId, result.field);
 * }
 * ```
 */
export class GridNavigationController {
    private deps: GridNavigationControllerDeps;
    
    /** Current position in the grid */
    private position: CellPosition = { rowIndex: 0, colIndex: 0 };
    
    /** Cached navigable columns (updated via setNavigableColumns) */
    private navigableColumns: string[] = [];
    
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    constructor(deps: GridNavigationControllerDeps) {
        this.deps = deps;
    }
    
    // =========================================================================
    // POSITION MANAGEMENT
    // =========================================================================
    
    /**
     * Get current cell position
     */
    getPosition(): CellPosition {
        return { ...this.position };
    }
    
    /**
     * Set current position directly (e.g., after a click)
     * @param taskId - Task ID to focus
     * @param field - Column field to focus
     * @returns true if position was set, false if task/field not found
     */
    setPosition(taskId: string, field: string): boolean {
        const taskIds = this.deps.getVisibleTaskIds();
        const columns = this.getColumns();
        
        const rowIndex = taskIds.indexOf(taskId);
        const colIndex = columns.indexOf(field);
        
        if (rowIndex === -1 || colIndex === -1) {
            return false;
        }
        
        this.position = { rowIndex, colIndex };
        return true;
    }
    
    /**
     * Set position by indices directly
     */
    setPositionByIndex(rowIndex: number, colIndex: number): void {
        this.position = { rowIndex, colIndex };
    }
    
    // =========================================================================
    // COLUMN MANAGEMENT
    // =========================================================================
    
    /**
     * Update the cached list of navigable columns
     * Call this when columns change (preferences update, etc.)
     */
    setNavigableColumns(columns: string[]): void {
        this.navigableColumns = [...columns];
    }
    
    /**
     * Get navigable columns (uses cache if available, otherwise fetches)
     */
    private getColumns(): string[] {
        if (this.navigableColumns.length === 0) {
            this.navigableColumns = this.deps.getNavigableColumns();
        }
        return this.navigableColumns;
    }
    
    // =========================================================================
    // NAVIGATION
    // =========================================================================
    
    /**
     * Navigate in a direction
     * 
     * @param direction - Direction to move: 'up', 'down', 'left', 'right'
     * @returns NavigationResult if navigation occurred, null if blocked/at boundary
     */
    navigate(direction: NavigationDirection): NavigationResult | null {
        // Block navigation during edit mode
        if (this.deps.isEditing()) {
            return null;
        }
        
        const taskIds = this.deps.getVisibleTaskIds();
        const columns = this.getColumns();
        
        // Can't navigate with no data
        if (taskIds.length === 0 || columns.length === 0) {
            return null;
        }
        
        // Ensure current position is valid
        const currentRow = Math.min(this.position.rowIndex, taskIds.length - 1);
        const currentCol = Math.min(this.position.colIndex, columns.length - 1);
        
        let newRow = currentRow;
        let newCol = currentCol;
        
        switch (direction) {
            case 'up':
                newRow = Math.max(0, currentRow - 1);
                break;
            case 'down':
                newRow = Math.min(taskIds.length - 1, currentRow + 1);
                break;
            case 'left':
                newCol = Math.max(0, currentCol - 1);
                break;
            case 'right':
                newCol = Math.min(columns.length - 1, currentCol + 1);
                break;
        }
        
        // Check if position actually changed
        if (newRow === currentRow && newCol === currentCol) {
            // At boundary, but still return current position for UI consistency
            // This allows the UI to re-highlight the current cell
        }
        
        // Update internal position
        this.position = { rowIndex: newRow, colIndex: newCol };
        
        return {
            taskId: taskIds[newRow],
            field: columns[newCol],
            position: { ...this.position }
        };
    }
    
    /**
     * Navigate and extend selection (for Shift+Arrow)
     * Returns the range of task IDs that should be selected
     * 
     * @param direction - Direction to move
     * @param anchorTaskId - The anchor point for range selection
     * @returns Object with navigation result and range of task IDs to select
     */
    navigateWithRange(
        direction: NavigationDirection, 
        anchorTaskId: string | null
    ): { result: NavigationResult; rangeTaskIds: string[] } | null {
        const navResult = this.navigate(direction);
        if (!navResult) return null;
        
        // If no anchor, just return the single task
        if (!anchorTaskId) {
            return {
                result: navResult,
                rangeTaskIds: [navResult.taskId]
            };
        }
        
        // Calculate range between anchor and new position
        const taskIds = this.deps.getVisibleTaskIds();
        const anchorIndex = taskIds.indexOf(anchorTaskId);
        
        if (anchorIndex === -1) {
            return {
                result: navResult,
                rangeTaskIds: [navResult.taskId]
            };
        }
        
        const start = Math.min(anchorIndex, navResult.position.rowIndex);
        const end = Math.max(anchorIndex, navResult.position.rowIndex);
        
        return {
            result: navResult,
            rangeTaskIds: taskIds.slice(start, end + 1)
        };
    }
    
    /**
     * Get the current task ID and field at the current position
     * Useful for querying current focus without navigating
     */
    getCurrentCell(): { taskId: string; field: string } | null {
        const taskIds = this.deps.getVisibleTaskIds();
        const columns = this.getColumns();
        
        if (taskIds.length === 0 || columns.length === 0) {
            return null;
        }
        
        const row = Math.min(this.position.rowIndex, taskIds.length - 1);
        const col = Math.min(this.position.colIndex, columns.length - 1);
        
        return {
            taskId: taskIds[row],
            field: columns[col]
        };
    }
    
    /**
     * Reset position to origin (0, 0)
     */
    reset(): void {
        this.position = { rowIndex: 0, colIndex: 0 };
    }
    
    /**
     * Invalidate column cache (call when columns change)
     */
    invalidateColumnCache(): void {
        this.navigableColumns = [];
    }
}
