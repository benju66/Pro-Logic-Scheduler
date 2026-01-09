/**
 * @fileoverview Shared Types for Scheduler Service Decomposition
 * @module services/scheduler/types
 * 
 * Common types used across extracted scheduler services.
 * These types enable loose coupling between services via dependency injection.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { Task, Calendar, TradePartner, GridColumn, ColumnPreferences } from '../../types';

// =========================================================================
// CALLBACK TYPES
// =========================================================================

/**
 * Common callback types used across scheduler services.
 * These enable the "callback injection" pattern to avoid circular dependencies.
 */
export interface SchedulerCallbacks {
    /** Called after a task is added */
    onTaskAdded?: () => void;
    /** Called after a task is deleted */
    onTaskDeleted?: () => void;
    /** Called when rendering is needed (legacy - prefer ViewCoordinator) */
    onRender?: () => void;
    /** Called to show toast notifications */
    onToast?: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

// =========================================================================
// ACCESSOR INTERFACES
// =========================================================================

/**
 * Grid facade interface for services that need grid access.
 * Abstracts away the concrete VirtualScrollGridFacade implementation.
 */
export interface GridAccessor {
    /** Scroll the grid to show a specific task */
    scrollToTask: (id: string) => void;
    /** Highlight a specific cell */
    highlightCell: (id: string, field: string) => void;
    /** Focus a specific cell for editing */
    focusCell: (id: string, field: string) => void;
    /** Update grid selection state */
    setSelection: (ids: Set<string>, focusedId?: string | null, options?: { 
        focusCell?: boolean; 
        focusField?: string 
    }) => void;
    /** Get current scroll position */
    getScrollTop?: () => number;
    /** Set scroll position */
    setScrollTop?: (value: number) => void;
    /** Update column definitions (Phase 9 - ColumnPreferencesService) */
    updateColumns?: (columns: import('../../types').GridColumn[]) => void;
}

/**
 * Gantt facade interface for services that need gantt access.
 * Abstracts away the concrete CanvasGanttFacade implementation.
 */
export interface GanttAccessor {
    /** Update gantt selection state */
    setSelection: (ids: Set<string>) => void;
    /** Set the gantt view mode (day, week, month) */
    setViewMode: (mode: string) => void;
    /** Get visibility state */
    isVisible?: () => boolean;
}

// =========================================================================
// VIEW STATE TYPES
// =========================================================================

/**
 * Current view mode for the scheduler
 */
export type ViewMode = 'edit' | 'readonly' | 'collapsed';

/**
 * Navigation direction for keyboard navigation
 */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right' | 'first' | 'last';

/**
 * View state snapshot
 */
export interface ViewStateSnapshot {
    /** Current view mode */
    mode: ViewMode;
    /** Whether gantt is visible */
    ganttVisible: boolean;
    /** Current zoom level */
    zoomLevel: number;
    /** Current focused task ID */
    focusedTaskId: string | null;
    /** Current focused field */
    focusedField: string | null;
}

// =========================================================================
// MODAL TYPES
// =========================================================================

/**
 * Modal type identifiers
 */
export type ModalType = 
    | 'calendar'
    | 'links'
    | 'tradePartner'
    | 'tradePartnerDirectory'
    | 'settings'
    | 'columnPreferences';

/**
 * Modal open options
 */
export interface ModalOpenOptions {
    /** Task ID context (if applicable) */
    taskId?: string;
    /** Initial data to populate */
    initialData?: unknown;
    /** Callback when modal closes */
    onClose?: () => void;
}

// =========================================================================
// FILE OPERATION TYPES
// =========================================================================

/**
 * File format for import/export operations
 */
export type FileFormat = 'json' | 'xml' | 'csv' | 'msproject';

/**
 * File operation result
 */
export interface FileOperationResult {
    success: boolean;
    message?: string;
    filePath?: string;
    error?: Error;
}

// =========================================================================
// CONTEXT MENU TYPES
// =========================================================================

/**
 * Context menu action identifiers
 */
export type ContextMenuAction = 
    | 'indent'
    | 'outdent'
    | 'delete'
    | 'insertAbove'
    | 'insertBelow'
    | 'insertChild'
    | 'duplicate'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'editLinks'
    | 'setBaseline';

/**
 * Context menu item definition
 */
export interface ContextMenuItem {
    id: ContextMenuAction;
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    separator?: boolean;
}

// =========================================================================
// BASELINE TYPES
// =========================================================================

/**
 * Baseline data snapshot
 */
export interface BaselineData {
    /** When the baseline was set */
    timestamp: Date;
    /** Task snapshots at baseline time */
    tasks: Map<string, {
        start: Date | null;
        finish: Date | null;
        duration: number;
    }>;
}

// =========================================================================
// SERVICE DEPENDENCY INTERFACES
// =========================================================================

/**
 * Common dependencies for task operation services.
 * Used by TaskOperationsService, ContextMenuService, etc.
 */
export interface TaskOperationDeps {
    /** Get grid accessor (may be null before init) */
    getGrid: () => GridAccessor | null;
    /** Get gantt accessor (may be null before init) */
    getGantt: () => GanttAccessor | null;
    /** Show toast notification */
    showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
    /** Callback after task added */
    onTaskAdded?: () => void;
    /** Callback after task deleted */
    onTaskDeleted?: () => void;
    /** Callback after hierarchy changed (indent/outdent) */
    onHierarchyChanged?: () => void;
}

/**
 * Dependencies for view state operations.
 */
export interface ViewStateDeps {
    /** Get grid accessor */
    getGrid: () => GridAccessor | null;
    /** Get gantt accessor */
    getGantt: () => GanttAccessor | null;
    /** Trigger view update */
    onViewChange?: () => void;
}

/**
 * Dependencies for file operations.
 */
export interface FileOperationDeps {
    /** Show toast notification */
    showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
    /** Callback after data loaded */
    onDataLoaded?: () => void;
    /** Callback after data saved */
    onDataSaved?: () => void;
}
