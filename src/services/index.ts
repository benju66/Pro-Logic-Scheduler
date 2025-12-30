/**
 * Services Index
 * 
 * Central export for all service modules.
 */

// Core Services (Phase 4 - New Architecture)
export { ProjectController } from './ProjectController';
export { SelectionModel, type SelectionState } from './SelectionModel';
export { IOManager } from './IOManager';

// Legacy Services (Will be refactored in future phases)
export { SchedulerService } from './SchedulerService';
export { AppInitializer, type AppInitializerOptions } from './AppInitializer';
export { UIEventManager } from './UIEventManager';
