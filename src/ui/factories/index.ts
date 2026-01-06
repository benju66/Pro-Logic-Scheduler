/**
 * @fileoverview UI Component Factory Functions
 * @module ui/factories
 * 
 * Factory functions for UI components that need dependencies injected.
 * Created as part of Pure DI migration (Phase 4b).
 * 
 * These factories are called in the Composition Root (main.ts) and passed
 * to SchedulerService, which calls them without needing to know the dependencies.
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md - Section 2.2
 */

import { GridRenderer } from '../components/scheduler/GridRenderer';
import { GanttRenderer } from '../components/scheduler/GanttRenderer';
import type { GridRendererOptions, GanttRendererOptions } from '../components/scheduler/types';
import type { ProjectController } from '../../services/ProjectController';
import type { SelectionModel } from '../../services/SelectionModel';

/**
 * Factory function type for GridRenderer
 */
export type GridRendererFactory = (options: GridRendererOptions) => GridRenderer;

/**
 * Factory function type for GanttRenderer
 */
export type GanttRendererFactory = (options: GanttRendererOptions) => GanttRenderer;

/**
 * Create a GridRenderer factory with dependencies captured in closure.
 * 
 * @param controller - ProjectController instance
 * @param selectionModel - SelectionModel instance
 * @returns Factory function that creates GridRenderer with injected dependencies
 * 
 * @example
 * // In main.ts (Composition Root):
 * const createGrid = createGridRendererFactory(projectController, selectionModel);
 * 
 * // In SchedulerService:
 * this.grid = createGrid(gridOptions);
 */
export function createGridRendererFactory(
    controller: ProjectController,
    selectionModel: SelectionModel
): GridRendererFactory {
    return (options: GridRendererOptions) => {
        return new GridRenderer(options, controller, selectionModel);
    };
}

/**
 * Create a GanttRenderer factory with dependencies captured in closure.
 * 
 * @param controller - ProjectController instance
 * @param selectionModel - SelectionModel instance
 * @returns Factory function that creates GanttRenderer with injected dependencies
 * 
 * @example
 * // In main.ts (Composition Root):
 * const createGantt = createGanttRendererFactory(projectController, selectionModel);
 * 
 * // In SchedulerService:
 * this.gantt = createGantt(ganttOptions);
 */
export function createGanttRendererFactory(
    controller: ProjectController,
    selectionModel: SelectionModel
): GanttRendererFactory {
    return (options: GanttRendererOptions) => {
        return new GanttRenderer(options, controller, selectionModel);
    };
}
