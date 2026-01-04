/**
 * @fileoverview Column Registry Type Definitions
 * @module core/columns/types
 * 
 * Core interfaces for the extensible column system.
 * Follows SOLID principles - each column type is self-contained.
 */

import type { Task, Calendar } from '../../types';

// =============================================================================
// COLUMN TYPES
// =============================================================================

/**
 * Supported column types
 * Each type has a corresponding renderer in the registry
 */
export type ColumnType = 
    | 'text'
    | 'number'
    | 'date'
    | 'select'
    | 'checkbox'
    | 'readonly'
    | 'actions'
    | 'drag'
    | 'health'
    | 'variance'
    | 'tradePartners'
    | 'schedulingMode'
    | 'rowNumber'
    | 'name';

// =============================================================================
// COLUMN DEFINITION (Metadata Only - No Functions)
// =============================================================================

/**
 * Column definition - pure metadata, no behavior
 * This allows column definitions to be serialized and stored
 */
export interface ColumnDefinition {
    /** Unique column identifier */
    id: string;
    
    /** Task field this column displays (or virtual field name) */
    field: keyof Task | string;
    
    /** Display label in header */
    label: string;
    
    /** Column type - references a registered renderer */
    type: ColumnType;
    
    /** Default width in pixels */
    width: number;
    
    /** Minimum width for resizing */
    minWidth?: number;
    
    /** Text alignment */
    align?: 'left' | 'center' | 'right';
    
    /** Is this column editable? */
    editable?: boolean;
    
    /** Is this column readonly for parent tasks? */
    readonlyForParent?: boolean;
    
    /** Can this column be resized? */
    resizable?: boolean;
    
    /** Is this column visible by default? */
    visible?: boolean;
    
    /** CSS class for header cell */
    headerClass?: string;
    
    /** CSS class for data cells */
    cellClass?: string;
    
    /** Options for select columns */
    options?: string[];
    
    /** Show constraint icon (for date columns) */
    showConstraintIcon?: boolean;
    
    /** Type-specific configuration */
    config?: ColumnConfig;
    
    /** Actions for actions column */
    actions?: ActionDefinition[];
}

/**
 * Action button definition for actions column
 */
export interface ActionDefinition {
    id: string;
    name?: string;
    label?: string;
    icon?: string;
    title?: string;
    color?: string;
}

/**
 * Type-specific configuration options
 */
export interface ColumnConfig {
    /** For variance columns: which field to show variance for */
    varianceField?: 'start' | 'finish';
    
    /** Custom placeholder text */
    placeholder?: string;
    
    /** Additional type-specific options */
    [key: string]: unknown;
}

// =============================================================================
// COLUMN CONTEXT (Runtime Data)
// =============================================================================

/**
 * Context passed to renderers during binding
 * Contains task data and display state
 */
export interface ColumnContext {
    /** The task being rendered */
    task: Task;
    
    /** Row index in the visible list */
    index: number;
    
    /** Is this task a parent (has children)? */
    isParent: boolean;
    
    /** Is this task collapsed (children hidden)? */
    isCollapsed: boolean;
    
    /** Is this task on the critical path? */
    isCritical: boolean;
    
    /** Hierarchy depth (0 = root level) */
    depth: number;
    
    /** Is this row currently selected? */
    isSelected: boolean;
}

// =============================================================================
// POOLED CELL (DOM Elements)
// =============================================================================

/**
 * Re-export PooledCell from scheduler types for convenience
 * This represents the pre-created DOM elements for a cell
 */
export type { PooledCell } from '../../ui/components/scheduler/types';

// =============================================================================
// COLUMN RENDERER INTERFACE
// =============================================================================

/**
 * Column renderer interface
 * Each column type implements this to handle rendering and editing
 */
export interface IColumnRenderer {
    /** The column type this renderer handles */
    readonly type: ColumnType;
    
    /**
     * Render cell content
     * Called during binding to populate the pre-created DOM elements
     * 
     * @param cell - Pre-created DOM elements from PoolSystem
     * @param ctx - Runtime context (task data, state)
     * @param column - Column definition (metadata)
     */
    render(cell: import('../../ui/components/scheduler/types').PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
    
    /**
     * Get raw display value (for accessibility, copy/paste, sorting)
     * 
     * @param task - The task to get value from
     * @param column - Column definition
     * @returns String representation of the value
     */
    getValue(task: Task, column: ColumnDefinition): string;
    
    /**
     * Handle cell edit start (optional)
     * Called when user begins editing a cell
     */
    onEditStart?(cell: import('../../ui/components/scheduler/types').PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
    
    /**
     * Handle cell edit end (optional)
     * Called when user finishes editing a cell
     */
    onEditEnd?(cell: import('../../ui/components/scheduler/types').PooledCell, ctx: ColumnContext, column: ColumnDefinition, value: string): void;
    
    /**
     * Validate input (optional)
     * 
     * @param value - The input value to validate
     * @param task - The task being edited
     * @param column - Column definition
     * @returns True if valid, false otherwise
     */
    validate?(value: string, task: Task, column: ColumnDefinition): boolean;
    
    /**
     * Parse input to task value (optional)
     * Converts user input to the appropriate value type
     * 
     * @param value - The input value to parse
     * @param column - Column definition
     * @returns Parsed value for the task field
     */
    parse?(value: string, column: ColumnDefinition): unknown;
}

// =============================================================================
// SERVICE CONTAINER INTERFACE
// =============================================================================

/**
 * Services that renderers may need access to
 * Injected via ServiceContainer for clean dependency management
 */
export interface RendererServices {
    /** Trade partner store for looking up partner names/colors */
    getTradePartner: (id: string) => { id: string; name: string; color: string } | undefined;
    
    /** Calculate variance between baseline and actual dates */
    calculateVariance: (task: Task) => { start: number | null; finish: number | null };
    
    /** Check if a cell is currently being edited */
    isEditingCell: (taskId: string, field: string) => boolean;
    
    /** Open the date picker popup */
    openDatePicker: (taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void;
    
    /** Handle date change */
    onDateChange: (taskId: string, field: string, value: string) => void;
    
    /** Get current calendar */
    getCalendar: () => Calendar | null;
    
    /** Get visual row number for a task */
    getVisualRowNumber: (task: Task) => number | null;
}

// =============================================================================
// COLUMN PREFERENCES (User Settings)
// =============================================================================

/**
 * User preferences for column display
 * Stored in localStorage
 */
export interface ColumnPreferences {
    /** Column visibility: columnId -> visible */
    visible: Record<string, boolean>;
    
    /** Column order: array of column IDs */
    order: string[];
    
    /** Pinned column IDs (sticky columns) */
    pinned: string[];
}
