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
// Services will be added as they are extracted in subsequent phases:
// 
// Phase 2: TaskOperationsService
// Phase 3: ViewStateService
// Phase 4: ContextMenuService
// Phase 5: ModalCoordinator
// Phase 6: FileOperationsService
// Phase 7: BaselineService
// Phase 8: TradePartnerService
// Phase 9: ColumnPreferencesService
// =========================================================================

// TODO: Uncomment as services are extracted
// export { TaskOperationsService } from './TaskOperationsService';
// export { ViewStateService } from './ViewStateService';
// export { ContextMenuService } from './ContextMenuService';
// export { ModalCoordinator } from './ModalCoordinator';
// export { FileOperationsService } from './FileOperationsService';
// export { BaselineService } from './BaselineService';
// export { TradePartnerService } from './TradePartnerService';
// export { ColumnPreferencesService } from './ColumnPreferencesService';
