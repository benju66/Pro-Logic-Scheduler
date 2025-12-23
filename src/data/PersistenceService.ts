/**
 * @fileoverview Persistence Service - Async Write Queue for SQLite
 * @module data/PersistenceService
 * 
 * ENHANCED: 
 * - Complete event type handling for all defined event types
 * - Integration with SnapshotService for event counting
 * - Proper CALENDAR_UPDATED handling
 */

import Database from '@tauri-apps/plugin-sql';
import type { SnapshotService } from './SnapshotService';

interface QueuedEvent {
  type: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  timestamp: Date;
}

interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export class PersistenceService {
  private db: DatabaseInterface | null = null;
  private writeQueue: QueuedEvent[] = [];
  private isProcessing: boolean = false;
  private flushInterval: number = 100; // ms
  private flushTimer: number | null = null;
  private isInitialized: boolean = false;
  
  // Snapshot service integration
  private snapshotService: SnapshotService | null = null;
  private getTasksForSnapshot: (() => unknown[]) | null = null;
  private getCalendarForSnapshot: (() => unknown) | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
      throw new Error('[PersistenceService] FATAL: Tauri environment required');
    }

    try {
      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      await this.runMigrations();
      this.startFlushLoop();
      this.isInitialized = true;
      console.log('[PersistenceService] ✅ Initialized');
    } catch (error) {
      console.error('[PersistenceService] ❌ Initialization failed:', error);
      this.isInitialized = true; // Allow app to continue
    }
  }

  /**
   * Set snapshot service and data accessors for automatic snapshot triggering
   */
  setSnapshotService(
    service: SnapshotService,
    getTasks: () => unknown[],
    getCalendar: () => unknown
  ): void {
    this.snapshotService = service;
    this.getTasksForSnapshot = getTasks;
    this.getCalendarForSnapshot = getCalendar;
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    const schema = this.loadSchema();
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await this.db.execute(statement);
        } catch (err) {
          const error = err as Error;
          if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
            console.warn('[PersistenceService] Schema statement failed:', statement.substring(0, 50), error.message);
          }
        }
      }
    }
    console.log('[PersistenceService] ✅ Schema migrations complete');
  }

  private loadSchema(): string {
    return `
-- TASKS TABLE
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    sort_key TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'New Task',
    notes TEXT DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 1,
    constraint_type TEXT NOT NULL DEFAULT 'asap',
    constraint_date TEXT,
    dependencies TEXT NOT NULL DEFAULT '[]',
    progress INTEGER NOT NULL DEFAULT 0,
    actual_start TEXT,
    actual_finish TEXT,
    remaining_duration INTEGER,
    baseline_start TEXT,
    baseline_finish TEXT,
    baseline_duration INTEGER,
    is_collapsed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent_sort ON tasks(parent_id, sort_key);
CREATE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id);

-- CALENDAR TABLE
CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    exceptions TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO calendar (id) VALUES (1);

-- EVENTS TABLE
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    target_id TEXT,
    payload TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT,
    session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(target_id);

-- SNAPSHOTS TABLE
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tasks_json TEXT NOT NULL,
    calendar_json TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id)
);
    `.trim();
  }

  queueEvent(type: string, targetId: string | null, payload: Record<string, unknown>): void {
    if (!this.isInitialized) {
      console.warn('[PersistenceService] Not initialized - event queued but may be lost');
    }

    this.writeQueue.push({
      type,
      targetId,
      payload,
      timestamp: new Date()
    });
  }

  private startFlushLoop(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = window.setInterval(async () => {
      if (this.isProcessing || this.writeQueue.length === 0) return;

      this.isProcessing = true;

      try {
        const batch = this.writeQueue.splice(0, 50);

        if (!this.db) {
          console.warn('[PersistenceService] Database not available - events lost');
          this.isProcessing = false;
          return;
        }

        await this.db.execute('BEGIN TRANSACTION');

        for (const event of batch) {
          await this.db.execute(
            `INSERT INTO events (event_type, target_id, payload, timestamp)
             VALUES (?, ?, ?, ?)`,
            [
              event.type,
              event.targetId,
              JSON.stringify(event.payload),
              event.timestamp.toISOString()
            ]
          );

          await this.applyEventToMaterializedView(event);
        }

        await this.db.execute('COMMIT');

        if (batch.length > 0) {
          console.log(`[PersistenceService] Flushed ${batch.length} events`);
          
          // Notify snapshot service
          if (this.snapshotService && this.getTasksForSnapshot && this.getCalendarForSnapshot) {
            await this.snapshotService.onEventsPersisted(
              batch.length,
              this.getTasksForSnapshot(),
              this.getCalendarForSnapshot()
            );
          }
        }
      } catch (error) {
        console.error('[PersistenceService] Flush failed:', error);
        if (this.db) {
          try {
            await this.db.execute('ROLLBACK');
          } catch (rollbackError) {
            console.error('[PersistenceService] Rollback failed:', rollbackError);
          }
        }
      } finally {
        this.isProcessing = false;
      }
    }, this.flushInterval);
  }

  /**
   * Apply event to materialized views (tasks and calendar tables)
   */
  private async applyEventToMaterializedView(event: QueuedEvent): Promise<void> {
    if (!this.db) return;

    try {
      switch (event.type) {
        case 'TASK_CREATED':
          await this.db.execute(
            `INSERT OR REPLACE INTO tasks (id, parent_id, sort_key, name, notes, duration, 
             constraint_type, constraint_date, dependencies, progress, 
             actual_start, actual_finish, remaining_duration,
             baseline_start, baseline_finish, baseline_duration, is_collapsed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.payload.id,
              event.payload.parent_id ?? null,
              event.payload.sort_key,
              event.payload.name ?? 'New Task',
              event.payload.notes ?? '',
              event.payload.duration ?? 1,
              event.payload.constraint_type ?? 'asap',
              event.payload.constraint_date ?? null,
              JSON.stringify(event.payload.dependencies || []),
              event.payload.progress ?? 0,
              event.payload.actual_start ?? null,
              event.payload.actual_finish ?? null,
              event.payload.remaining_duration ?? null,
              event.payload.baseline_start ?? null,
              event.payload.baseline_finish ?? null,
              event.payload.baseline_duration ?? null,
              event.payload.is_collapsed ? 1 : 0
            ]
          );
          break;

        case 'TASK_UPDATED':
          const field = event.payload.field as string;
          const value = event.payload.new_value;
          
          // Validate field is not calculated
          const calculatedFields = ['start', 'end', 'level', 'lateStart', 'lateFinish', 
                                    'totalFloat', 'freeFloat', '_isCritical', '_health'];
          if (calculatedFields.includes(field)) return;
          
          const dbValue = field === 'dependencies' ? JSON.stringify(value) : value;
          
          await this.db.execute(
            `UPDATE tasks SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`,
            [dbValue, event.targetId]
          );
          break;

        case 'TASK_DELETED':
          await this.db.execute(`DELETE FROM tasks WHERE id = ?`, [event.targetId]);
          break;

        case 'TASK_MOVED':
          await this.db.execute(
            `UPDATE tasks SET parent_id = ?, sort_key = ?, updated_at = datetime('now') WHERE id = ?`,
            [
              event.payload.new_parent_id ?? null,
              event.payload.new_sort_key,
              event.targetId
            ]
          );
          break;

        case 'CALENDAR_UPDATED':
          await this.db.execute(
            `UPDATE calendar SET working_days = ?, exceptions = ?, updated_at = datetime('now') WHERE id = 1`,
            [
              JSON.stringify(event.payload.new_working_days || [1,2,3,4,5]),
              JSON.stringify(event.payload.new_exceptions || {})
            ]
          );
          break;

        default:
          console.debug(`[PersistenceService] Unhandled event type for materialized view: ${event.type}`);
      }
    } catch (error) {
      console.error(`[PersistenceService] Failed to apply event ${event.type}:`, error);
      throw error;
    }
  }

  async flushNow(): Promise<void> {
    if (!this.db || !this.isInitialized) return;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 50);
      
      try {
        await this.db.execute('BEGIN TRANSACTION');

        for (const event of batch) {
          await this.db.execute(
            `INSERT INTO events (event_type, target_id, payload, timestamp)
             VALUES (?, ?, ?, ?)`,
            [
              event.type,
              event.targetId,
              JSON.stringify(event.payload),
              event.timestamp.toISOString()
            ]
          );

          await this.applyEventToMaterializedView(event);
        }

        await this.db.execute('COMMIT');
        console.log(`[PersistenceService] Flushed ${batch.length} events (shutdown)`);
      } catch (error) {
        console.error('[PersistenceService] Final flush failed:', error);
        if (this.db) {
          try {
            await this.db.execute('ROLLBACK');
          } catch (rollbackError) {
            // Ignore during shutdown
          }
        }
        this.writeQueue.unshift(...batch);
        break;
      }
    }

    console.log('[PersistenceService] ✅ Shutdown flush complete');
  }

  async purgeDatabase(): Promise<void> {
    if (!this.db) return;

    try {
      if (this.flushTimer !== null) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }

      this.writeQueue = [];

      await this.db.execute('DELETE FROM events');
      await this.db.execute('DELETE FROM tasks');
      await this.db.execute('DELETE FROM snapshots');
      await this.db.execute('DELETE FROM calendar');
      await this.db.execute('VACUUM');

      console.log('[PersistenceService] ☢️ Database purged');
    } catch (error) {
      console.error('[PersistenceService] Failed to purge database:', error);
      throw error;
    }
  }

  getQueueSize(): number {
    return this.writeQueue.length;
  }

  getInitialized(): boolean {
    return this.isInitialized;
  }
}
