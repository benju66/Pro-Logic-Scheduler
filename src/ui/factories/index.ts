/**
 * @fileoverview UI Component Factory Functions
 * @module ui/factories
 * 
 * Factory functions for UI components that need dependencies injected.
 * Created as part of Pure DI migration.
 * 
 * These factories are called in the Composition Root (main.ts) and passed
 * to SchedulerService, which calls them without needing to know the dependencies.
 * 
 * The RendererFactory interface abstracts away renderer dependencies, preventing
 * "prop drilling" where SchedulerService would need to receive deps it doesn't use.
 * 
 * @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md - Section 3.1, 6.4
 */

import { GridRenderer } from '../components/scheduler/GridRenderer';
import { GanttRenderer } from '../components/scheduler/GanttRenderer';
import type { GridRendererOptions, GanttRendererOptions } from '../components/scheduler/types';
import type { ProjectController } from '../../services/ProjectController';
import type { SelectionModel } from '../../services/SelectionModel';
import type { EditingStateManager } from '../../services/EditingStateManager';

/**
 * Factory function type for GridRenderer
 */
export type GridRendererFactory = (options: GridRendererOptions) => GridRenderer;

/**
 * Factory function type for GanttRenderer
 */
export type GanttRendererFactory = (options: GanttRendererOptions) => GanttRenderer;

/**
 * RendererFactory interface - abstracts renderer creation from SchedulerService.
 * 
 * This prevents SchedulerService from needing to know about EditingStateManager
 * or other renderer-specific dependencies. The factory closure captures these deps.
 * 
 * AUDIT VERIFIED:
 * - GridRenderer uses EditingStateManager (15 internal calls)
 * - GanttRenderer only needs ProjectController + SelectionModel
 * 
 * @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md - Section 10 (Audit Findings)
 */
export interface RendererFactory {
    createGrid(options: GridRendererOptions): GridRenderer;
    createGantt(options: GanttRendererOptions): GanttRenderer;
}

/**
 * Create a GridRenderer factory with dependencies captured in closure.
 * 
 * AUDIT VERIFIED: GridRenderer uses EditingStateManager internally (15 calls).
 * 
 * @param controller - ProjectController instance
 * @param selectionModel - SelectionModel instance
 * @param editingStateManager - EditingStateManager instance (used internally by GridRenderer)
 * @returns Factory function that creates GridRenderer with injected dependencies
 * 
 * @example
 * // In main.ts (Composition Root):
 * const createGrid = createGridRendererFactory(projectController, selectionModel, editingStateManager);
 * 
 * // In SchedulerService:
 * this.grid = createGrid(gridOptions);
 */
export function createGridRendererFactory(
    controller: ProjectController,
    selectionModel: SelectionModel,
    editingStateManager: EditingStateManager
): GridRendererFactory {
    return (options: GridRendererOptions) => {
        return new GridRenderer(options, controller, selectionModel, editingStateManager);
    };
}

/**
 * Create a GanttRenderer factory with dependencies captured in closure.
 * 
 * AUDIT VERIFIED: GanttRenderer only needs ProjectController + SelectionModel.
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

/**
 * Create a RendererFactory object with all dependencies captured.
 * 
 * This is the preferred way to create the factory for SchedulerService.
 * 
 * @example
 * // In main.ts (Composition Root):
 * const rendererFactory = createRendererFactory({
 *     projectController,
 *     selectionModel,
 *     editingStateManager
 * });
 * 
 * const schedulerService = new SchedulerService({
 *     rendererFactory,
 *     // ... other deps
 * });
 */
export function createRendererFactory(deps: {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    editingStateManager: EditingStateManager;
}): RendererFactory {
    return {
        createGrid: (options) => new GridRenderer(
            options,
            deps.projectController,
            deps.selectionModel,
            deps.editingStateManager
        ),
        createGantt: (options) => new GanttRenderer(
            options,
            deps.projectController,
            deps.selectionModel
        )
    };
}
