/**
 * @fileoverview Migration Services Index
 * @module services/migration
 * 
 * New architecture services extracted from SchedulerService
 * using the Strangler Fig pattern.
 * 
 * Services should be instantiated in main.ts Composition Root
 * and passed via constructor injection.
 * 
 * @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md
 */

// Core Services
export { SchedulingLogicService } from './SchedulingLogicService';
export type { TaskEditResult } from './SchedulingLogicService';

export { ViewCoordinator } from './ViewCoordinator';
export type { ViewState } from './ViewCoordinator';
