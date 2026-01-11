/**
 * @fileoverview Viewport Factory Service
 * @module services/scheduler/ViewportFactoryService
 * 
 * Factory for creating viewport facades (Grid and Gantt).
 * Extracted from SchedulerService as part of the decomposition plan.
 * 
 * RESPONSIBILITIES:
 * - Create VirtualScrollGridFacade wrappers
 * - Create CanvasGanttFacade wrappers
 * - Provide clean facade interfaces for viewport access
 * 
 * ARCHITECTURE:
 * - Pure factory functions - no state
 * - Creates facades that wrap SchedulerViewport
 * - Follows adapter pattern for interface compatibility
 * 
 * @see docs/PHASE4_DECOMPOSITION_AUDIT.md - Phase 4.1
 */

import type { Task, Calendar, GridColumn } from '../../types';
import type { SchedulerViewport } from '../../ui/components/scheduler/SchedulerViewport';
import type { GridRenderer } from '../../ui/components/scheduler/GridRenderer';
import type { GanttRenderer } from '../../ui/components/scheduler/GanttRenderer';
import type {
    VirtualScrollGridFacade,
    CanvasGanttFacade
} from '../../ui/components/scheduler/types';

/**
 * Dependencies required by ViewportFactoryService
 */
export interface ViewportFactoryServiceDeps {
    // No dependencies - pure factory functions
}

/**
 * Viewport Factory Service
 * 
 * Creates facade wrappers for viewport components to provide
 * clean interfaces for service access.
 */
export class ViewportFactoryService {
    constructor(_deps: ViewportFactoryServiceDeps) {
        // No dependencies needed - pure factory
    }

    /**
     * Create facade wrapper for VirtualScrollGrid API compatibility
     * 
     * @param viewport - The SchedulerViewport instance
     * @returns VirtualScrollGridFacade wrapper
     */
    createGridFacade(viewport: SchedulerViewport): VirtualScrollGridFacade {
        // Return a facade object that implements VirtualScrollGrid interface
        return {
            setData: (tasks: Task[]) => viewport.setData(tasks),
            setVisibleData: (tasks: Task[]) => viewport.setVisibleData(tasks),
            setSelection: (selectedIds: Set<string>, focusedId?: string | null, options?: { focusCell?: boolean; focusField?: string }) => {
                viewport.setSelection([...selectedIds], focusedId ?? null, options);
            },
            scrollToTask: (taskId: string) => viewport.scrollToTask(taskId),
            focusCell: (taskId: string, field: string) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.focusCell(taskId, field);
                }
            },
            highlightCell: (taskId: string, field: string) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.highlightCell(taskId, field);
                }
            },
            focus: () => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.focus();
                }
            },
            refresh: () => viewport.refresh(),
            updateColumns: (columns: GridColumn[]) => viewport.updateGridColumns(columns),
            updateRow: (taskId: string) => viewport.updateRow(taskId),
            setScrollTop: (scrollTop: number) => viewport.setScrollTop(scrollTop),
            getScrollTop: () => viewport.getScrollTop(),
            setCalendar: (calendar: Calendar) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.setCalendar(calendar);
                }
            },
            getStats: () => ({
                totalTasks: viewport.getData().length,
                visibleRange: '0-0',
                renderedRows: 0,
                poolSize: 0,
                renderCount: 0,
            }),
            destroy: () => viewport.destroy(),
        };
    }

    /**
     * Create facade wrapper for CanvasGantt API compatibility
     * 
     * @param viewport - The SchedulerViewport instance
     * @returns CanvasGanttFacade wrapper
     */
    createGanttFacade(viewport: SchedulerViewport): CanvasGanttFacade {
        // Return a facade object that implements CanvasGantt interface
        return {
            setData: (tasks: Task[]) => viewport.setData(tasks),
            setSelection: (selectedIds: Set<string>) => {
                viewport.setSelection([...selectedIds]);
            },
            setViewMode: (mode: string) => {
                const ganttRenderer = (viewport as any).ganttRenderer as GanttRenderer | null;
                if (ganttRenderer) {
                    ganttRenderer.setViewMode(mode);
                }
            },
            setScrollTop: (scrollTop: number) => viewport.setScrollTop(scrollTop),
            getScrollTop: () => viewport.getScrollTop(),
            scrollToTask: (taskId: string) => viewport.scrollToTask(taskId),
            refresh: () => viewport.refresh(),
            getStats: () => ({
                totalTasks: viewport.getData().length,
                visibleRange: '0-0',
                renderedRows: 0,
                poolSize: 0,
                renderCount: 0,
            }),
            destroy: () => viewport.destroy(),
        };
    }
}
