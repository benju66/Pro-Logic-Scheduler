/**
 * @fileoverview Service Interfaces - External I/O Boundaries
 * @module services/interfaces
 * 
 * Interfaces for services that cross external boundaries (database, clipboard, etc.).
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * These interfaces enable:
 * - Easy mocking in unit tests
 * - Clear API contracts
 * - Dependency inversion
 * 
 * Note: Internal services (SelectionModel, EditingStateManager, etc.) don't need
 * interfaces - use their class types directly. TypeScript classes are interfaces.
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md - Section 2.3
 */

// Core data abstraction
export type { IProjectController } from './IProjectController';

// External I/O boundaries
export type { IPersistenceService, QueuedPersistenceEvent } from './IPersistenceService';
export type { IHistoryManager, QueuedHistoryEvent, UndoableAction, HistoryStateCallback } from './IHistoryManager';
export type { IClipboardManager, ClipboardEntry } from './IClipboardManager';
export type { IDataLoader, LoadedData } from './IDataLoader';
export type { ISnapshotService } from './ISnapshotService';
