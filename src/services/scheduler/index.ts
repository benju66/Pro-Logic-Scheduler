/**
 * @fileoverview Barrel Export for Scheduler Services
 * @module services/scheduler
 * 
 * Central export point for all extracted scheduler services.
 * Services are extracted from SchedulerService.ts following the decomposition plan.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

// =========================================================================
// SHARED TYPES
// =========================================================================
export * from './types';

// =========================================================================
// EXTRACTED SERVICES
// Services are added as they are extracted in subsequent phases.
// @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
// =========================================================================

// Phase 2: TaskOperationsService - Task CRUD, hierarchy, movement
export { TaskOperationsService } from './TaskOperationsService';
export type { TaskOperationsServiceDeps } from './TaskOperationsService';

// Phase 3: ViewStateService - View state, navigation, edit mode
export { ViewStateService } from './ViewStateService';
export type { ViewStateServiceDeps, DisplaySettings } from './ViewStateService';

// Phase 4: ContextMenuService - Right-click context menus
export { ContextMenuService } from './ContextMenuService';
export type { ContextMenuServiceDeps } from './ContextMenuService';

// Phase 5: ModalCoordinator - Modal dialogs and panels
export { ModalCoordinator } from './ModalCoordinator';
export type { ModalCoordinatorDeps } from './ModalCoordinator';

// Phase 6: FileOperationsService - File open, save, import, export
export { FileOperationsService } from './FileOperationsService';
export type { FileOperationsServiceDeps } from './FileOperationsService';

// Phase 7: BaselineService - Baseline set, clear, variance
export { BaselineService } from './BaselineService';
export type { BaselineServiceDeps } from './BaselineService';

// Phase 8: TradePartnerService - Trade partner CRUD and task assignment
export { TradePartnerService } from './TradePartnerService';
export type { TradePartnerServiceDeps } from './TradePartnerService';

// Phase 9: ColumnPreferencesService - Column management, header rendering (Encapsulated Legacy)
export { ColumnPreferencesService } from './ColumnPreferencesService';
export type { ColumnPreferencesServiceDeps } from './ColumnPreferencesService';

// P1 Enhancement: GridNavigationController - Excel-style cell navigation
export { GridNavigationController } from './GridNavigationController';
export type { 
    GridNavigationControllerDeps, 
    CellPosition, 
    NavigationResult, 
    NavigationDirection 
} from './GridNavigationController';
