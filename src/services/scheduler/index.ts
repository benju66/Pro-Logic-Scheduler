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

// TODO: Uncomment as services are extracted
// Phase 3: ViewStateService
// export { ViewStateService } from './ViewStateService';
// Phase 4: ContextMenuService
// export { ContextMenuService } from './ContextMenuService';
// Phase 5: ModalCoordinator
// export { ModalCoordinator } from './ModalCoordinator';
// Phase 6: FileOperationsService
// export { FileOperationsService } from './FileOperationsService';
// Phase 7: BaselineService
// export { BaselineService } from './BaselineService';
// Phase 8: TradePartnerService
// export { TradePartnerService } from './TradePartnerService';
// Phase 9: ColumnPreferencesService
// export { ColumnPreferencesService } from './ColumnPreferencesService';
