/**
 * @fileoverview IDataLoader Interface
 * @module services/interfaces/IDataLoader
 * 
 * Interface for DataLoader - SQLite data loading with snapshot replay.
 * Created as part of Pure DI migration (Phase 4a).
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import type { Task, Calendar, TradePartner } from '../../types';

/**
 * Loaded data structure
 */
export interface LoadedData {
    tasks: Task[];
    calendar: Calendar;
    tradePartners: TradePartner[];
}

/**
 * DataLoader Interface
 * 
 * Loads data from SQLite using snapshot + event replay pattern.
 * Database boundary - requires interface for testing.
 */
export interface IDataLoader {
    /**
     * Initialize database connection
     */
    init(): Promise<void>;
    
    /**
     * Load all data from database
     * Uses latest snapshot + event replay
     */
    loadData(): Promise<LoadedData>;
}
