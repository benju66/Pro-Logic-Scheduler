/**
 * @fileoverview Persistence Service - Async Write Queue for SQLite
 * @module data/PersistenceService
 * 
 * Implements the "Optimistic UI" pattern:
 * - RAM is the read source (instant updates)
 * - SQLite is the write-behind log (async persistence)
 * - Events are queued and flushed in batches
 */

// Note: For Tauri v1, we'll need to check the exact import path
// The spec shows '@tauri-apps/plugin-sql' but v1 might use a different path
// This will be adjusted based on actual Tauri plugin availability

interface QueuedEvent {
  type: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Database interface - abstracted for Tauri v1/v2 compatibility
 */
interface Database {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Persistence Service
 * Handles async write queue for SQLite persistence
 */
export class PersistenceService {
  private db: Database | null = null;
  private writeQueue: QueuedEvent[] = [];
  private isProcessing: boolean = false;
  private flushInterval: number = 100; // ms
  private snapshotInterval: number = 5 * 60 * 1000; // 5 minutes
  private flushTimer: number | null = null;
  private isInitialized: boolean = false;

  /**
   * Initialize the persistence service
   * Connects to SQLite database and runs schema migrations
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[PersistenceService] Already initialized');
      return;
    }

    try {
      // Check if we're in Tauri environment
      if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        console.warn('[PersistenceService] Not in Tauri environment - persistence disabled');
        this.isInitialized = true;
        return;
      }

      // Load database - Tauri SQL plugin
      // Note: For Tauri v1, the plugin API may differ from v2
      // If plugin is not available, this will gracefully degrade
      try {
        // Try Tauri v2 API first
        const sqlModule = await import('@tauri-apps/plugin-sql');
        const Database = sqlModule.default || sqlModule;
        this.db = await Database.load('sqlite:scheduler.db') as Database;
      } catch (importError) {
        // Try Tauri v1 API (if different)
        // Note: tauri-plugin-sql may not be available for v1
        // In that case, persistence will be disabled
        console.warn('[PersistenceService] SQL plugin not available - persistence disabled');
        throw new Error('SQL plugin not available - may require Tauri v2 or plugin installation');
      }

      // Run schema migrations
      await this.runMigrations();

      // Start background flush loop
      this.startFlushLoop();

      this.isInitialized = true;
      console.log('[PersistenceService] ✅ Initialized');
    } catch (error) {
      console.error('[PersistenceService] ❌ Initialization failed:', error);
      // Don't throw - allow app to continue without persistence
      this.isInitialized = true;
    }
  }

  /**
   * Run schema migrations from schema.sql
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    try {
      // Load and execute schema.sql
      // For now, we'll embed the schema as a constant
      // In production, you might want to load it from a file
      const schema = await this.loadSchema();
      
      // Split schema into individual statements
      const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await this.db.execute(statement);
          } catch (err) {
            // Ignore "table already exists" errors
            const error = err as Error;
            if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
              console.warn('[PersistenceService] Schema statement failed:', statement.substring(0, 50), error.message);
            }
          }
        }
      }

      console.log('[PersistenceService] ✅ Schema migrations complete');
    } catch (error) {
      console.error('[PersistenceService] ❌ Schema migration failed:', error);
      throw error;
    }
  }

  /**
   * Load schema from schema.sql file
   * Falls back to embedded schema if file loading fails
   */
  private async loadSchema(): Promise<string> {
    try {
      // Try to load from file (for development)
      const response = await fetch('/src/sql/schema.sql');
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      // Fall through to embedded schema
    }

    // Embedded schema as fallback
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

  /**
   * Queue an event for async persistence
   * This is called by TaskStore on every mutation
   * 
   * @param type - Event type (e.g., 'TASK_UPDATED')
   * @param targetId - Target task ID (null for project-level events)
   * @param payload - Event payload (will be JSON stringified)
   */
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

  /**
   * Background loop to flush queued events
   */
  private startFlushLoop(): void {
    if (this.flushTimer !== null) {
      return; // Already started
    }

    this.flushTimer = window.setInterval(async () => {
      if (this.isProcessing || this.writeQueue.length === 0) return;

      this.isProcessing = true;

      try {
        // Batch write for efficiency (max 50 events per flush)
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

          // Also update tasks table (materialized view)
          await this.applyEventToTasks(event);
        }

        await this.db.execute('COMMIT');

        if (batch.length > 0) {
          console.log(`[PersistenceService] Flushed ${batch.length} events`);
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
        // Events stay in queue for retry
        // Put them back at the front of the queue
        this.writeQueue.unshift(...batch);
      } finally {
        this.isProcessing = false;
      }
    }, this.flushInterval);
  }

  /**
   * Apply event to tasks table (keeps it in sync with events)
   */
  private async applyEventToTasks(event: QueuedEvent): Promise<void> {
    if (!this.db) return;

    try {
      switch (event.type) {
        case 'TASK_CREATED':
          await this.db.execute(
            `INSERT INTO tasks (id, parent_id, sort_key, name, duration, 
             constraint_type, dependencies, is_collapsed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.payload.id,
              event.payload.parent_id ?? null,
              event.payload.sort_key,
              event.payload.name ?? 'New Task',
              event.payload.duration ?? 1,
              event.payload.constraint_type ?? 'asap',
              JSON.stringify(event.payload.dependencies || []),
              event.payload.is_collapsed ? 1 : 0
            ]
          );
          break;

        case 'TASK_UPDATED':
          const field = event.payload.field as string;
          const value = event.payload.new_value;

          // Validate field is allowed (not a calculated field)
          const allowedFields = [
            'name', 'notes', 'duration', 'constraint_type', 'constraint_date',
            'dependencies', 'progress', 'actual_start', 'actual_finish',
            'remaining_duration', 'is_collapsed', 'baseline_start',
            'baseline_finish', 'baseline_duration'
          ];

          if (!allowedFields.includes(field)) {
            console.warn(`[PersistenceService] Ignoring update to calculated field: ${field}`);
            return;
          }

          // Map field names (camelCase to snake_case)
          const dbField = this.mapFieldToDb(field);

          await this.db.execute(
            `UPDATE tasks SET ${dbField} = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [
              field === 'dependencies' ? JSON.stringify(value) : value,
              event.targetId
            ]
          );
          break;

        case 'TASK_DELETED':
          await this.db.execute(
            `DELETE FROM tasks WHERE id = ?`,
            [event.targetId]
          );
          break;

        case 'TASK_MOVED':
          await this.db.execute(
            `UPDATE tasks SET 
              parent_id = ?, 
              sort_key = ?,
              updated_at = datetime('now')
             WHERE id = ?`,
            [
              event.payload.new_parent_id ?? null,
              event.payload.new_sort_key,
              event.targetId
            ]
          );
          break;

        // Other event types can be added here as needed
        default:
          // Unknown event type - just log it
          console.debug(`[PersistenceService] Unknown event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[PersistenceService] Failed to apply event ${event.type}:`, error);
      throw error; // Re-throw to trigger transaction rollback
    }
  }

  /**
   * Map camelCase field names to snake_case database column names
   */
  private mapFieldToDb(field: string): string {
    const mapping: Record<string, string> = {
      'actualStart': 'actual_start',
      'actualFinish': 'actual_finish',
      'remainingDuration': 'remaining_duration',
      'baselineStart': 'baseline_start',
      'baselineFinish': 'baseline_finish',
      'baselineDuration': 'baseline_duration',
      'constraintType': 'constraint_type',
      'constraintDate': 'constraint_date',
      'isCollapsed': 'is_collapsed'
    };

    return mapping[field] || field;
  }

  /**
   * Force flush all pending events (called on app close)
   */
  async flushNow(): Promise<void> {
    if (!this.db || !this.isInitialized) {
      return;
    }

    // Stop the flush loop
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Process remaining queue
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

          await this.applyEventToTasks(event);
        }

        await this.db.execute('COMMIT');
        console.log(`[PersistenceService] Flushed ${batch.length} events (shutdown)`);
      } catch (error) {
        console.error('[PersistenceService] Final flush failed:', error);
        if (this.db) {
          try {
            await this.db.execute('ROLLBACK');
          } catch (rollbackError) {
            // Ignore rollback errors during shutdown
          }
        }
        // Put events back for next startup (they'll be retried)
        this.writeQueue.unshift(...batch);
        break; // Exit loop on error
      }
    }

    console.log('[PersistenceService] ✅ Shutdown flush complete');
  }

  /**
   * Get current queue size (for debugging)
   */
  getQueueSize(): number {
    return this.writeQueue.length;
  }

  /**
   * Check if service is initialized
   */
  getInitialized(): boolean {
    return this.isInitialized;
  }
}

