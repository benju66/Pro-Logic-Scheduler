/**
 * @fileoverview Snapshot Service - Creates periodic snapshots
 * @module data/SnapshotService
 * 
 * FIXED:
 * - Actually creates snapshots on timer
 * - Properly tracks event count
 * - Creates snapshots when threshold reached
 */

import Database from '@tauri-apps/plugin-sql';
import type { Task, Calendar } from '../types';

interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export class SnapshotService {
  private db: DatabaseInterface | null = null;
  private lastSnapshotEventId: number = 0;
  private eventsSinceSnapshot: number = 0;
  private snapshotTimer: number | null = null;
  private readonly snapshotInterval: number = 5 * 60 * 1000; // 5 minutes
  private readonly eventThreshold: number = 1000;
  
  // Callbacks to get current state (set by SchedulerService)
  private getTasksCallback: (() => Task[]) | null = null;
  private getCalendarCallback: (() => Calendar) | null = null;
  
  async init(): Promise<void> {
    if (this.db) return;

    try {
      if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        console.warn('[SnapshotService] Not in Tauri environment');
        return;
      }

      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      await this.loadLastSnapshotEventId();
      console.log('[SnapshotService] ✅ Initialized');
    } catch (error) {
      console.error('[SnapshotService] ❌ Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Set callbacks to access current state for automatic snapshots
   */
  setStateAccessors(getTasks: () => Task[], getCalendar: () => Calendar): void {
    this.getTasksCallback = getTasks;
    this.getCalendarCallback = getCalendar;
  }
  
  /**
   * Start periodic snapshot creation
   * Must be called AFTER setStateAccessors
   */
  startPeriodicSnapshots(): void {
    if (this.snapshotTimer !== null) return;
    if (!this.getTasksCallback || !this.getCalendarCallback) {
      console.warn('[SnapshotService] Cannot start periodic snapshots - no state accessors');
      return;
    }

    this.snapshotTimer = window.setInterval(async () => {
      if (!this.getTasksCallback || !this.getCalendarCallback) return;
      
      try {
        const tasks = this.getTasksCallback();
        const calendar = this.getCalendarCallback();
        await this.createSnapshot(tasks, calendar);
      } catch (error) {
        console.error('[SnapshotService] Periodic snapshot failed:', error);
      }
    }, this.snapshotInterval);
    
    console.log(`[SnapshotService] Started periodic snapshots (every ${this.snapshotInterval / 60000} min)`);
  }
  
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
   * Called by PersistenceService after events are flushed
   */
  async onEventsPersisted(count: number, tasks: unknown, calendar: unknown): Promise<void> {
    this.eventsSinceSnapshot += count;
    
    if (this.eventsSinceSnapshot >= this.eventThreshold) {
      console.log(`[SnapshotService] Event threshold reached (${this.eventsSinceSnapshot})`);
      await this.createSnapshot(tasks as Task[], calendar as Calendar);
    }
  }
  
  async createSnapshot(tasks: Task[], calendar: Calendar): Promise<void> {
    if (!this.db) {
      console.warn('[SnapshotService] Database not initialized');
      return;
    }

    try {
      const result = await this.db.select<Array<{ max_id: number }>>(
        `SELECT MAX(id) as max_id FROM events`
      );
      const currentEventId = result && result.length > 0 ? (result[0].max_id || 0) : 0;
      
      if (currentEventId === 0) {
        console.log('[SnapshotService] No events yet - skipping snapshot');
        return;
      }
      
      if (currentEventId === this.lastSnapshotEventId) {
        console.log('[SnapshotService] No new events - skipping snapshot');
        return;
      }
      
      // Strip calculated fields
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
      }));
      
      await this.db.execute(
        `INSERT INTO snapshots (tasks_json, calendar_json, event_id) VALUES (?, ?, ?)`,
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
  
  stopPeriodicSnapshots(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
      console.log('[SnapshotService] Stopped periodic snapshots');
    }
  }
  
  getEventsSinceSnapshot(): number {
    return this.eventsSinceSnapshot;
  }
  
  getLastSnapshotEventId(): number {
    return this.lastSnapshotEventId;
  }
}
