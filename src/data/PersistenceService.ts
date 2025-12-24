/**
 * @fileoverview Persistence Service - Async Write Queue for SQLite
 * @module data/PersistenceService
 * * ENHANCED: 
 * - Retry logic for SQLITE_BUSY (database locked)
 * - Safe transaction handling
 * - Integration with SnapshotService
 */

import Database from '@tauri-apps/plugin-sql';
import type { SnapshotService } from './SnapshotService';
import type { DatabaseInterface } from './DatabaseTypes';

interface QueuedEvent {
  type: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export class PersistenceService {
  private db: DatabaseInterface | null = null;
  private writeQueue: QueuedEvent[] = [];
  private isProcessing: boolean = false;
  private flushInterval: number = 200; // Increased to 200ms to reduce lock contention
  private flushTimer: number | null = null;
  private isInitialized: boolean = false;
  
  // Snapshot service integration
  private snapshotService: SnapshotService | null = null;
  private getTasksForSnapshot: (() => unknown[]) | null = null;
  private getCalendarForSnapshot: (() => unknown) | null = null;
  private getTradePartnersForSnapshot: (() => unknown[]) | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
      throw new Error('[PersistenceService] FATAL: Tauri environment required');
    }

    try {
      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      // Enable WAL mode for better concurrency
      await this.db.execute('PRAGMA journal_mode=WAL;');
      await this.runMigrations();
      this.startFlushLoop();
      this.isInitialized = true;
      console.log('[PersistenceService] ✅ Initialized (WAL Mode)');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PersistenceService] ❌ Initialization failed:', errorMessage, error);
      this.isInitialized = false;
    }
  }

  setSnapshotService(
    service: SnapshotService,
    getTasks: () => unknown[],
    getCalendar: () => unknown
  ): void {
    this.snapshotService = service;
    this.getTasksForSnapshot = getTasks;
    this.getCalendarForSnapshot = getCalendar;
  }

  setTradePartnersAccessor(getter: () => unknown[]): void {
    this.getTradePartnersForSnapshot = getter;
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    const schema = this.loadSchema();
    const statements = schema
      .split(';')
      .map(s => s.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        await this.db.execute(statement);
      } catch (err) {
        const error = err as Error;
        const errorMessage = error?.message || String(err || 'Unknown error');
        if (!errorMessage.includes('already exists') && !errorMessage.includes('duplicate')) {
          console.warn('[PersistenceService] Schema statement failed:', statement.substring(0, 60) + '...', errorMessage);
        }
      }
    }

    // Explicit migrations
    const migrations = [
      `ALTER TABLE tasks ADD COLUMN scheduling_mode TEXT NOT NULL DEFAULT 'Auto'`,
      `ALTER TABLE snapshots ADD COLUMN trade_partners_json TEXT DEFAULT '[]'`
    ];

    for (const migration of migrations) {
      try {
        await this.db.execute(migration);
        console.log(`[PersistenceService] ✅ Applied migration: ${migration.substring(0, 50)}...`);
      } catch (e) {
        // Ignore duplicate column errors
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
    scheduling_mode TEXT NOT NULL DEFAULT 'Auto',
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
CREATE INDEX IF NOT EXISTS idx_tasks_scheduling_mode ON tasks(scheduling_mode);

-- CALENDAR TABLE
CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    exceptions TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO calendar (id) VALUES (1);

-- TRADE PARTNERS TABLE
CREATE TABLE IF NOT EXISTS trade_partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    color TEXT NOT NULL DEFAULT '#3B82F6',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trade_partners_name ON trade_partners(name);

-- TASK <-> TRADE PARTNER JUNCTION TABLE
CREATE TABLE IF NOT EXISTS task_trade_partners (
    task_id TEXT NOT NULL,
    trade_partner_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, trade_partner_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (trade_partner_id) REFERENCES trade_partners(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ttp_task ON task_trade_partners(task_id);
CREATE INDEX IF NOT EXISTS idx_ttp_partner ON task_trade_partners(trade_partner_id);

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
    trade_partners_json TEXT DEFAULT '[]',
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
      let transactionStarted = false;

      try {
        if (!this.db) {
          console.warn('[PersistenceService] Database not available - events lost');
          this.writeQueue = []; // Clear queue to prevent memory leak
          this.isProcessing = false;
          return;
        }

        // Retry logic for obtaining lock
        let retries = 3;
        while (retries > 0) {
          try {
            await this.db.execute('BEGIN IMMEDIATE TRANSACTION');
            transactionStarted = true;
            break;
          } catch (e) {
            const err = e as Error;
            const msg = err?.message || String(e);
            if (msg.includes('locked') || msg.includes('busy')) {
              retries--;
              if (retries === 0) throw e; // Give up after retries
              await new Promise(resolve => setTimeout(resolve, 50)); // Wait 50ms
            } else {
              throw e; // Throw other errors immediately
            }
          }
        }

        // Take a batch of events
        const batch = this.writeQueue.slice(0, 50); // Peek first
        
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
        
        // Remove processed events from queue ONLY after commit
        this.writeQueue.splice(0, batch.length);

        if (batch.length > 0) {
          console.log(`[PersistenceService] Flushed ${batch.length} events`);
          
          if (this.snapshotService && this.getTasksForSnapshot && this.getCalendarForSnapshot) {
            await this.snapshotService.onEventsPersisted(
              batch.length,
              this.getTasksForSnapshot(),
              this.getCalendarForSnapshot(),
              this.getTradePartnersForSnapshot?.() || []
            );
          }
        }
      } catch (error) {
        const err = error as Error;
        const msg = err?.message || String(error);
        
        // Only log error if it's not just a lock (which we retried)
        if (!msg.includes('locked') && !msg.includes('busy')) {
          console.error('[PersistenceService] Flush failed:', error);
        }

        if (this.db && transactionStarted) {
          try {
            await this.db.execute('ROLLBACK');
          } catch (rollbackError) {
            // Ignore rollback errors (likely "no transaction active")
          }
        }
      } finally {
        this.isProcessing = false;
      }
    }, this.flushInterval);
  }

  private async applyEventToMaterializedView(event: QueuedEvent): Promise<void> {
    if (!this.db) return;

    try {
      switch (event.type) {
        case 'TASK_CREATED':
          await this.db.execute(
            `INSERT OR REPLACE INTO tasks (id, parent_id, sort_key, name, notes, duration, 
             constraint_type, constraint_date, scheduling_mode, dependencies, progress, 
             actual_start, actual_finish, remaining_duration,
             baseline_start, baseline_finish, baseline_duration, is_collapsed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.payload.id,
              event.payload.parent_id ?? null,
              event.payload.sort_key,
              event.payload.name ?? 'New Task',
              event.payload.notes ?? '',
              event.payload.duration ?? 1,
              event.payload.constraint_type ?? 'asap',
              event.payload.constraint_date ?? null,
              event.payload.scheduling_mode ?? 'Auto',
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
          
          // Map field names to database columns
          const fieldMap: Record<string, string> = {
            'constraintType': 'constraint_type',
            'constraintDate': 'constraint_date',
            'schedulingMode': 'scheduling_mode',
            'parentId': 'parent_id',
            'sortKey': 'sort_key',
            'actualStart': 'actual_start',
            'actualFinish': 'actual_finish',
            'remainingDuration': 'remaining_duration',
            'baselineStart': 'baseline_start',
            'baselineFinish': 'baseline_finish',
            'baselineDuration': 'baseline_duration',
            'isCollapsed': 'is_collapsed',
            'tradePartnerIds': 'tradePartnerIds', // Handled via junction, skip here?
          };
          
          // Skip fields that are handled by other tables or events
          if (field === 'tradePartnerIds') return;

          const dbField = fieldMap[field] || field;
          const dbValue = field === 'dependencies' ? JSON.stringify(value) : value;
          
          await this.db.execute(
            `UPDATE tasks SET ${dbField} = ?, updated_at = datetime('now') WHERE id = ?`,
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

        // =========== TRADE PARTNERS ===========
        case 'TRADE_PARTNER_CREATED':
          await this.db.execute(
            `INSERT INTO trade_partners (id, name, contact, phone, email, color, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              event.payload.id,
              event.payload.name ?? 'New Trade Partner',
              event.payload.contact ?? '',
              event.payload.phone ?? '',
              event.payload.email ?? '',
              event.payload.color ?? '#3B82F6',
              event.payload.notes ?? ''
            ]
          );
          break;

        case 'TRADE_PARTNER_UPDATED':
          const tpField = event.payload.field as string;
          const tpValue = event.payload.new_value;
          
          const allowedFields = ['name', 'contact', 'phone', 'email', 'color', 'notes'];
          if (!allowedFields.includes(tpField)) return;
          
          await this.db.execute(
            `UPDATE trade_partners SET ${tpField} = ?, updated_at = datetime('now') WHERE id = ?`,
            [tpValue, event.targetId]
          );
          break;

        case 'TRADE_PARTNER_DELETED':
          await this.db.execute(
            `DELETE FROM trade_partners WHERE id = ?`,
            [event.targetId]
          );
          break;

        case 'TASK_TRADE_PARTNER_ASSIGNED':
          await this.db.execute(
            `INSERT OR IGNORE INTO task_trade_partners (task_id, trade_partner_id)
             VALUES (?, ?)`,
            [event.targetId, event.payload.trade_partner_id]
          );
          break;

        case 'TASK_TRADE_PARTNER_UNASSIGNED':
          await this.db.execute(
            `DELETE FROM task_trade_partners 
             WHERE task_id = ? AND trade_partner_id = ?`,
            [event.targetId, event.payload.trade_partner_id]
          );
          break;
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
        await this.db.execute('BEGIN IMMEDIATE TRANSACTION');
        for (const event of batch) {
          await this.db.execute(
            `INSERT INTO events (event_type, target_id, payload, timestamp)
             VALUES (?, ?, ?, ?)`,
            [event.type, event.targetId, JSON.stringify(event.payload), event.timestamp.toISOString()]
          );
          await this.applyEventToMaterializedView(event);
        }
        await this.db.execute('COMMIT');
        console.log(`[PersistenceService] Flushed ${batch.length} events (shutdown)`);
      } catch (error) {
        console.error('[PersistenceService] Final flush failed:', error);
        // Try rollback but don't crash
        try { await this.db.execute('ROLLBACK'); } catch (e) {}
        this.writeQueue.unshift(...batch); // Put back
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