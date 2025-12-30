/**
 * Engine exports
 * 
 * PHASE 7: RustEngine and MockRustEngine have been removed.
 * All calculations now happen in the WASM Worker via ProjectController.
 * NoOpEngine is a compatibility stub for SchedulerService during migration.
 */
export { NoOpEngine } from './NoOpEngine';
export type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
