/**
 * @fileoverview IPersistenceService Interface
 * @module services/interfaces/IPersistenceService
 * 
 * Interface for PersistenceService - SQLite event queue persistence.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import type { ISnapshotService } from './ISnapshotService';

/**
 * Queued event structure for persistence
 */
export interface QueuedPersistenceEvent {
    type: string;
    targetId: string | null;
    payload: Record<string, unknown>;
    timestamp: Date;
}

/**
 * PersistenceService Interface
 * 
 * Manages async write queue for SQLite persistence.
 * External I/O boundary - requires interface for testing.
 */
export interface IPersistenceService {
    /**
     * Initialize the persistence service
     * Connects to SQLite, runs migrations, starts flush loop
     */
    init(): Promise<void>;
    
    /**
     * Queue an event for persistence
     * Events are batched and written periodically
     */
    queueEvent(type: string, targetId: string | null, payload: Record<string, unknown>): void;
    
    /**
     * Flush pending events to database immediately
     */
    flush(): Promise<void>;
    
    /**
     * Set the snapshot service for periodic snapshots
     */
    setSnapshotService(
        service: ISnapshotService,
        getTasks: () => unknown[],
        getCalendar: () => unknown
    ): void;
    
    /**
     * Set trade partners accessor for snapshots
     */
    setTradePartnersAccessor(getter: () => unknown[]): void;
    
    /**
     * Check if persistence is initialized
     */
    isReady(): boolean;
}
