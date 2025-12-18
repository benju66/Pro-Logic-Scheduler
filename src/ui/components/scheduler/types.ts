/**
 * @fileoverview Shared types for Unified Scheduler V2
 * @module ui/components/scheduler/types
 */

import type { Task, GridColumn, LinkType } from '../../../types';

/**
 * Viewport state passed to renderers
 */
export interface ViewportState {
    /** Vertical scroll position (controlled by Viewport) */
    scrollTop: number;
    /** Viewport height */
    viewportHeight: number;
    /** Visible row indices */
    visibleRange: VisibleRange;
    /** Row height (shared constant) */
    rowHeight: number;
    /** Total scroll height */
    totalHeight: number;
}

/**
 * Visible row range
 */
export interface VisibleRange {
    /** Index of first visible row */
    start: number;
    /** Index of last visible row */
    end: number;
}

/**
 * Binding context for row data
 */
export interface BindingContext {
    task: Task;
    index: number;
    isSelected: boolean;
    isParent: boolean;
    isCollapsed: boolean;
    isCritical: boolean;
    depth: number;
}

/**
 * Pooled row element
 */
export interface PooledRow {
    element: HTMLElement;
    cells: Map<string, PooledCell>;
    dataIndex: number;
}

/**
 * Pooled cell element
 */
export interface PooledCell {
    container: HTMLElement;
    input: HTMLInputElement | HTMLSelectElement | null;
    text: HTMLSpanElement | null;
    checkbox: HTMLInputElement | null;
    icons: Map<string, HTMLSpanElement>;
    actionButtons: HTMLButtonElement[];
    collapseBtn: HTMLButtonElement | null;
    indent: HTMLSpanElement | null;
}

/**
 * Renderer interface
 */
export interface IRenderer {
    render(state: ViewportState): void;
    setData(tasks: Task[]): void;
    setSelection(selectedIds: Set<string>): void;
    destroy(): void;
}

/**
 * Grid renderer options
 */
export interface GridRendererOptions {
    container: HTMLElement;
    rowHeight: number;
    bufferRows: number;
    columns: GridColumn[];
    
    // Callbacks
    onCellChange?: (taskId: string, field: string, value: unknown) => void;
    onRowClick?: (taskId: string, event: MouseEvent) => void;
    onRowDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onAction?: (taskId: string, action: string, event: MouseEvent) => void;
    onToggleCollapse?: (taskId: string) => void;
    onSelectionChange?: (selectedIds: string[]) => void;
    onRowMove?: (taskIds: string[], targetId: string, position: 'before' | 'after') => void;
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
    getDepth?: (taskId: string) => number;
}

/**
 * Gantt renderer options
 */
export interface GanttRendererOptions {
    container: HTMLElement;
    rowHeight: number;
    headerHeight: number;
    
    // Callbacks
    onBarClick?: (taskId: string, event: MouseEvent) => void;
    onBarDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onBarDrag?: (task: Task, start: string, end: string) => void;
    onDependencyClick?: (taskId: string, depId: string, event: MouseEvent) => void;
    onNeedsRender?: () => void;  // Callback when gantt needs viewport to render
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
}

/**
 * Scheduler viewport options
 */
export interface SchedulerViewportOptions {
    rowHeight?: number;
    headerHeight?: number;
    bufferRows?: number;
    
    // Event callbacks (forwarded to SchedulerService)
    onRowClick?: (taskId: string, event: MouseEvent) => void;
    onRowDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onCellChange?: (taskId: string, field: string, value: unknown) => void;
    onAction?: (taskId: string, action: string, event: MouseEvent) => void;
    onToggleCollapse?: (taskId: string) => void;
    onSelectionChange?: (selectedIds: string[]) => void;
    onRowMove?: (taskIds: string[], targetId: string, position: 'before' | 'after') => void;
    onBarClick?: (taskId: string, event: MouseEvent) => void;
    onBarDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onBarDrag?: (task: Task, start: string, end: string) => void;
    onDependencyClick?: (taskId: string, depId: string, event: MouseEvent) => void;
    onError?: (source: 'grid' | 'gantt', error: unknown) => void;
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
    getDepth?: (taskId: string) => number;
}

/**
 * Pool system options
 */
export interface PoolSystemOptions {
    container: HTMLElement;
    columns: GridColumn[];
    poolSize: number;
    rowHeight: number;
    maxActionButtons: number;
}

/**
 * Pool system options
 */
export interface PoolSystemOptions {
    container: HTMLElement;
    columns: GridColumn[];
    poolSize: number;
    rowHeight: number;
    maxActionButtons: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
    renderCount: number;
    totalRenderTime: number;
    maxRenderTime: number;
    slowFrames: number;
    avgRenderTime: number;
}

