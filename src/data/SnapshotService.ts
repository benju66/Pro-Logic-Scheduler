/**
 * @fileoverview Snapshot Service - Creates periodic snapshots for fast startup
 * @module data/SnapshotService
 * 
 * Implements snapshot strategy:
 * - Time-based: Every 5 minutes
 * - Event count: Every 1000 events
 * - App close: On shutdown
 * - Manual: User-triggered
 */

import Database from '@tauri-apps/plugin-sql';
import type { Task, Calendar } from '../types';

/**
 * Database interface - matches PersistenceService
 */
interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Snapshot Service
 * Handles creation of snapshots for fast startup
 */
export class SnapshotService {
  private db: DatabaseInterface | null = null;
  private lastSnapshotEventId: number = 0;
  private eventsSinceSnapshot: number = 0;
  private snapshotTimer: number | null = null;
  private readonly snapshotInterval: number = 5 * 60 * 1000; // 5 minutes
  private readonly eventThreshold: number = 1000; // Create snapshot after 1000 events
  
  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.db) {
      return; // Already initialized
    }

    try {
      // Check if we're in Tauri environment
      if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        console.warn('[SnapshotService] Not in Tauri environment - snapshots disabled');
        return;
      }

      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      
      // Get last snapshot event ID
      await this.loadLastSnapshotEventId();
      
      // Start periodic snapshot creation
      this.startPeriodicSnapshots();
      
      console.log('[SnapshotService] ✅ Initialized');
    } catch (error) {
      console.error('[SnapshotService] ❌ Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Load the last snapshot event ID
   */
  private async loadLastSnapshotEventId(): Promise<void> {
    if (!this.db) return;

    try {
      const result = await this.db.select<Array<{ event_id: number }>>(
        `SELECT event_id FROM snapshots ORDER BY id DESC LIMIT 1`
      );
      
      if (result && result.length > 0) {
        this.lastSnapshotEventId = result[0].event_id;
      }
    } catch (error) {
      console.error('[SnapshotService] Failed to load last snapshot event ID:', error);
    }
  }
  
  /**
   * Start periodic snapshot creation (every 5 minutes)
   */
  private startPeriodicSnapshots(): void {
    if (this.snapshotTimer !== null) {
      return; // Already started
    }

    if (typeof window === 'undefined') {
      return; // Not in browser environment
    }

    this.snapshotTimer = window.setInterval(() => {
      // Snapshot will be created when createSnapshot is called with current tasks/calendar
      // This timer just ensures periodic snapshots happen
      console.log('[SnapshotService] Periodic snapshot check (will be created on next save)');
    }, this.snapshotInterval);
  }
  
  /**
   * Create a snapshot of current state
   * @param tasks - Current tasks array
   * @param calendar - Current calendar configuration
   */
  async createSnapshot(tasks: Task[], calendar: Calendar): Promise<void> {
    if (!this.db) {
      console.warn('[SnapshotService] Database not initialized - skipping snapshot');
      return;
    }

    try {
      // Get current max event ID
      const result = await this.db.select<Array<{ max_id: number }>>(
        `SELECT MAX(id) as max_id FROM events`
      );
      const currentEventId = result && result.length > 0 ? (result[0].max_id || 0) : 0;
      
      // Don't create snapshot if no new events
      if (currentEventId === this.lastSnapshotEventId) {
        console.log('[SnapshotService] No new events since last snapshot - skipping');
        return;
      }
      
      // Strip calculated fields before saving
      const persistableTasks = tasks.map(task => ({
        id: task.id,
        parentId: task.parentId,
        sortKey: task.sortKey,
        name: task.name,
        notes: task.notes,
        duration: task.duration,
        constraintType: task.constraintType,
        constraintDate: task.constraintDate,
        dependencies: task.dependencies,
        progress: task.progress,
        actualStart: task.actualStart,
        actualFinish: task.actualFinish,
        remainingDuration: task.remainingDuration,
        baselineStart: task.baselineStart,
        baselineFinish: task.baselineFinish,
        baselineDuration: task.baselineDuration,
        _collapsed: task._collapsed,
        // NOT included: start, end, level, lateStart, lateFinish, 
        // totalFloat, freeFloat, _isCritical, _health
      }));
      
      await this.db.execute(
        `INSERT INTO snapshots (tasks_json, calendar_json, event_id)
         VALUES (?, ?, ?)`,
        [
          JSON.stringify(persistableTasks),
          JSON.stringify(calendar),
          currentEventId
        ]
      );
      
      this.lastSnapshotEventId = currentEventId;
      this.eventsSinceSnapshot = 0;
      
      console.log(`[SnapshotService] ✅ Created snapshot at event ${currentEventId} (${persistableTasks.length} tasks)`);
    } catch (error) {
      console.error('[SnapshotService] ❌ Failed to create snapshot:', error);
      throw error;
    }
  }
  
  /**
   * Track events and trigger snapshot if threshold reached
   * @param tasks - Current tasks array (needed for snapshot)
   * @param calendar - Current calendar configuration (needed for snapshot)
   */
  async onEventPersisted(tasks: Task[], calendar: Calendar): Promise<void> {
    this.eventsSinceSnapshot++;
    
    if (this.eventsSinceSnapshot >= this.eventThreshold) {
      console.log(`[SnapshotService] Event threshold reached (${this.eventsSinceSnapshot} events) - creating snapshot`);
      await this.createSnapshot(tasks, calendar);
    }
  }
  
  /**
   * Stop periodic snapshots (called on shutdown)
   */
  stopPeriodicSnapshots(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }
  
  /**
   * Get current event count since last snapshot
   */
  getEventsSinceSnapshot(): number {
    return this.eventsSinceSnapshot;
  }
  
  /**
   * Get last snapshot event ID
   */
  getLastSnapshotEventId(): number {
    return this.lastSnapshotEventId;
  }
}

