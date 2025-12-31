/**
 * @fileoverview Migration Services Index
 * @module services/migration
 * 
 * New architecture services extracted from SchedulerService
 * using the Strangler Fig pattern.
 * 
 * Use with FeatureFlags to incrementally enable new architecture:
 * 
 *   import { FeatureFlags } from '../../core/FeatureFlags';
 *   import { schedulingLogic, viewCoordinator } from './migration';
 * 
 *   if (FeatureFlags.get('USE_SCHEDULING_LOGIC_SERVICE')) {
 *     schedulingLogic.applyEdit(taskId, field, value, context);
 *   } else {
 *     this._applyTaskEdit(taskId, field, value);
 *   }
 */

// Core Services
export { SchedulingLogicService, schedulingLogic } from './SchedulingLogicService';
export type { TaskEditResult } from './SchedulingLogicService';

export { ViewCoordinator, viewCoordinator } from './ViewCoordinator';
export type { ViewState } from './ViewCoordinator';
