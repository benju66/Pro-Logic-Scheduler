/**
 * Engine exports
 * 
 * Production: RustEngine (Tauri desktop app)
 * Testing: MockRustEngine (when Tauri APIs unavailable)
 */
export { RustEngine } from './RustEngine';
export { MockRustEngine } from './MockRustEngine';
export type { ISchedulingEngine, TaskHierarchyContext } from '../ISchedulingEngine';

