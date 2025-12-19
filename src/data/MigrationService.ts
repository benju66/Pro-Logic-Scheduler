/**
 * @fileoverview Migration Service - Migrates data from localStorage to SQLite
 * @module data/MigrationService
 * 
 * Implements the "One-Way Door" migration pattern:
 * - Checks for localStorage data
 * - Migrates to SQLite with event sourcing
 * - Archives localStorage (doesn't delete - safety net)
 */

import Database from 'tauri-plugin-sql-api';
import type { Task, Calendar } from '../types';
import { PersistenceService } from './PersistenceService';

/**
 * Database interface - matches PersistenceService
 */
interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Migration Service
 * Handles migration from localStorage to SQLite
 */
export class MigrationService {
  private db: DatabaseInterface | null = null;
  private persistenceService: PersistenceService;
  
  static readonly OLD_STORAGE_KEY = 'pro_scheduler_v10';
  static readonly BACKUP_STORAGE_KEY = 'pro_scheduler_backup_v10';
  
  constructor(persistenceService: PersistenceService) {
    this.persistenceService = persistenceService;
  }
  
  /**
   * Initialize database connection
   * Must be called before migration
   */
  async init(): Promise<void> {
    if (this.db) {
      return; // Already initialized
    }

    // Get database from PersistenceService
    // We need to wait for PersistenceService to initialize first
    if (!this.persistenceService.getInitialized()) {
      await this.persistenceService.init();
    }

    // Access the database instance
    // Note: PersistenceService doesn't expose db directly, so we'll create our own connection
    // This is fine - SQLite handles multiple connections to the same file
    try {
      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
    } catch (error) {
      console.error('[MigrationService] Failed to connect to database:', error);
      throw error;
    }
  }
  
  /**
   * Check if migration is needed and perform it
   * @returns true if migration was performed, false if no data found
   */
  async migrateFromLocalStorage(): Promise<boolean> {
    // Check if we're in a browser environment (localStorage available)
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      console.log('[Migration] localStorage not available - skipping migration');
      return false;
    }

    const saved = localStorage.getItem(MigrationService.OLD_STORAGE_KEY);
    
    if (!saved) {
      console.log('[Migration] No localStorage data found');
      return false;
    }
    
    try {
      // Initialize database if not already done
      if (!this.db) {
        await this.init();
      }

      const parsed = JSON.parse(saved) as {
        tasks?: Task[];
        calendar?: Calendar;
        savedAt?: string;
        version?: string;
      };
      
      console.log('[Migration] Found localStorage data', {
        taskCount: parsed.tasks?.length ?? 0,
        version: parsed.version,
        savedAt: parsed.savedAt
      });
      
      // Step 1: Create PROJECT_IMPORTED event
      await this.createImportEvent(parsed);
      
      // Step 2: Populate tasks table
      await this.populateTasks(parsed.tasks || []);
      
      // Step 3: Populate calendar
      if (parsed.calendar) {
        await this.updateCalendar(parsed.calendar);
      }
      
      // Step 4: Archive localStorage (don't delete yet - safety net)
      localStorage.setItem(
        MigrationService.BACKUP_STORAGE_KEY, 
        saved
      );
      localStorage.removeItem(MigrationService.OLD_STORAGE_KEY);
      
      console.log('[Migration] ✅ Migration complete');
      return true;
      
    } catch (error) {
      console.error('[Migration] ❌ Migration failed:', error);
      // Don't delete localStorage on failure
      throw error;
    }
  }
  
  /**
   * Create PROJECT_IMPORTED event
   */
  private async createImportEvent(data: {
    tasks?: Task[];
    calendar?: Calendar;
    version?: string;
  }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.db.execute(
      `INSERT INTO events (event_type, payload) VALUES (?, ?)`,
      [
        'PROJECT_IMPORTED',
        JSON.stringify({
          source: 'localStorage_migration',
          task_count: data.tasks?.length ?? 0,
          version: data.version,
          timestamp: new Date().toISOString()
        })
      ]
    );
  }
  
  /**
   * Populate tasks table from localStorage data
   * Strips calculated fields - only persists inputs
   */
  private async populateTasks(tasks: Task[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Use transaction for atomicity
    await this.db.execute('BEGIN TRANSACTION');
    
    try {
      for (const task of tasks) {
        // Strip calculated fields - only persist inputs
        await this.db.execute(
          `INSERT INTO tasks (
            id, parent_id, sort_key, name, notes,
            duration, constraint_type, constraint_date, dependencies,
            progress, actual_start, actual_finish, remaining_duration,
            baseline_start, baseline_finish, baseline_duration,
            is_collapsed
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            task.parentId ?? null,
            task.sortKey ?? '',
            task.name,
            task.notes || '',
            task.duration,
            task.constraintType || 'asap',
            task.constraintDate ?? null,
            JSON.stringify(task.dependencies || []),
            task.progress || 0,
            task.actualStart ?? null,
            task.actualFinish ?? null,
            task.remainingDuration ?? null,
            task.baselineStart ?? null,
            task.baselineFinish ?? null,
            task.baselineDuration ?? null,
            task._collapsed ? 1 : 0
          ]
        );
      }
      
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }
  }
  
  /**
   * Update calendar table
   */
  private async updateCalendar(calendar: Calendar): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.db.execute(
      `UPDATE calendar SET 
        working_days = ?,
        exceptions = ?,
        updated_at = datetime('now')
       WHERE id = 1`,
      [
        JSON.stringify(calendar.workingDays),
        JSON.stringify(calendar.exceptions)
      ]
    );
  }
}

