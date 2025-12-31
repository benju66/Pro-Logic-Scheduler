/**
 * Engine exports
 * 
 * PHASE 8: All engine implementations have been removed.
 * Calculations now happen in the WASM Worker via ProjectController.
 * The ISchedulingEngine interface is kept for type definitions only.
 */
export type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';
