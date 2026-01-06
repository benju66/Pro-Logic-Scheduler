/**
 * @fileoverview ISnapshotService Interface
 * @module services/interfaces/ISnapshotService
 * 
 * Interface for SnapshotService - periodic state snapshots.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import type { Task, Calendar, TradePartner } from '../../types';

/**
 * SnapshotService Interface
 * 
 * Creates periodic snapshots for faster data loading.
 * Persistence boundary - requires interface for testing.
 */
export interface ISnapshotService {
    /**
     * Initialize the snapshot service
     */
    init(): Promise<void>;
    
    /**
     * Set callbacks to access current state for automatic snapshots
     */
    setStateAccessors(
        getTasks: () => Task[],
        getCalendar: () => Calendar,
        getTradePartners?: () => TradePartner[]
    ): void;
    
    /**
     * Start periodic snapshot creation
     * Must be called AFTER setStateAccessors
     */
    startPeriodicSnapshots(): void;
    
    /**
     * Stop periodic snapshots
     */
    stopPeriodicSnapshots(): void;
    
    /**
     * Create a snapshot immediately
     */
    createSnapshot(
        tasks: Task[],
        calendar: Calendar,
        tradePartners?: TradePartner[]
    ): Promise<void>;
    
    /**
     * Notify that an event was persisted (for threshold tracking)
     */
    notifyEventPersisted(): void;
}
