/**
 * @fileoverview Data Loader - Loads data from SQLite with snapshot + replay optimization
 * @module data/DataLoader
 * 
 * Implements hybrid recovery approach:
 * - Loads latest snapshot (fast)
 * - Replays events since snapshot (typically 0-100 events)
 * - Returns data ready for CPM calculation
 */

import Database from '@tauri-apps/plugin-sql';
import type { Task, Calendar, ConstraintType } from '../types';
import { DEFAULT_WORKING_DAYS } from '../core/Constants';

/**
 * Database interface - matches PersistenceService
 */
interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Persisted task row from database
 */
interface PersistedTask {
  id: string;
  parent_id: string | null;
  sort_key: string;
  name: string;
  notes: string;
  duration: number;
  constraint_type: string;
  constraint_date: string | null;
  dependencies: string; // JSON string
  progress: number;
  actual_start: string | null;
  actual_finish: string | null;
  remaining_duration: number | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  baseline_duration: number | null;
  is_collapsed: number; // SQLite stores as INTEGER (0 or 1)
}

/**
 * Event row from database
 */
interface EventRow {
  id: number;
  event_type: string;
  target_id: string | null;
  payload: string; // JSON string
  timestamp: string;
  user_id: string | null;
  session_id: string | null;
}

/**
 * Snapshot row from database
 */
interface SnapshotRow {
  id: number;
  tasks_json: string;
  calendar_json: string;
  event_id: number;
  created_at: string;
}

/**
 * Data Loader
 * Handles loading data from SQLite with snapshot + replay optimization
 */
export class DataLoader {
  private db: DatabaseInterface | null = null;
  
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
        console.warn('[DataLoader] Not in Tauri environment - data loading disabled');
        return;
      }

      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      console.log('[DataLoader] ✅ Database connection initialized');
    } catch (error) {
      console.error('[DataLoader] ❌ Failed to connect to database:', error);
      throw error;
    }
  }
  
  /**
   * Load data from SQLite with snapshot + replay optimization
   * @returns Tasks and calendar ready for CPM calculation
   */
  async loadData(): Promise<{ tasks: Task[]; calendar: Calendar }> {
    if (!this.db) {
      await this.init();
    }

    if (!this.db) {
      // Fallback: return empty data
      console.warn('[DataLoader] Database not available - returning empty data');
      return {
        tasks: [],
        calendar: {
          workingDays: [...DEFAULT_WORKING_DAYS],
          exceptions: {},
        },
      };
    }

    // Step 1: Try to load latest snapshot
    const snapshot = await this.loadLatestSnapshot();
    
    let tasks: Task[];
    let calendar: Calendar;
    let lastEventId = 0;
    
    if (snapshot) {
      console.log('[DataLoader] Loading from snapshot', {
        eventId: snapshot.event_id,
        taskCount: JSON.parse(snapshot.tasks_json).length
      });
      
      tasks = JSON.parse(snapshot.tasks_json) as Task[];
      calendar = JSON.parse(snapshot.calendar_json) as Calendar;
      lastEventId = snapshot.event_id;
    } else {
      // No snapshot - load directly from tasks table
      console.log('[DataLoader] No snapshot found, loading from tasks table');
      
      const result = await this.db.select<PersistedTask[]>(
        `SELECT * FROM tasks ORDER BY sort_key`
      );
      
      tasks = (result || []).map(row => this.hydrateTask(row));
      calendar = await this.loadCalendar();
    }
    
    // Step 2: Replay events after snapshot
    const newEvents = await this.db.select<EventRow[]>(
      `SELECT * FROM events WHERE id > ? ORDER BY id ASC`,
      [lastEventId]
    );
    
    if (newEvents && newEvents.length > 0) {
      console.log(`[DataLoader] Replaying ${newEvents.length} events since snapshot`);
      tasks = this.replayEvents(tasks, newEvents);
    }
    
    // Step 3: Return data (CPM will be run by caller)
    return { tasks, calendar };
  }
  
  /**
   * Load latest snapshot from database
   */
  private async loadLatestSnapshot(): Promise<SnapshotRow | null> {
    if (!this.db) return null;

    try {
      const result = await this.db.select<SnapshotRow[]>(
        `SELECT * FROM snapshots ORDER BY id DESC LIMIT 1`
      );
      
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('[DataLoader] Failed to load snapshot:', error);
      return null;
    }
  }
  
  /**
   * Load calendar from database
   */
  private async loadCalendar(): Promise<Calendar> {
    if (!this.db) {
      return {
        workingDays: [...DEFAULT_WORKING_DAYS],
        exceptions: {},
      };
    }

    try {
      const result = await this.db.select<Array<{
        working_days: string;
        exceptions: string;
      }>>(
        `SELECT working_days, exceptions FROM calendar WHERE id = 1`
      );
      
      if (result && result.length > 0) {
        return {
          workingDays: JSON.parse(result[0].working_days),
          exceptions: JSON.parse(result[0].exceptions),
        };
      }
    } catch (error) {
      console.error('[DataLoader] Failed to load calendar:', error);
    }
    
    // Fallback to default calendar
    return {
      workingDays: [...DEFAULT_WORKING_DAYS],
      exceptions: {},
    };
  }
  
  /**
   * Replay events to update task state
   */
  private replayEvents(tasks: Task[], events: EventRow[]): Task[] {
    for (const event of events) {
      const payload = JSON.parse(event.payload);
      
      switch (event.event_type) {
        case 'TASK_CREATED':
          tasks.push(this.createTaskFromPayload(payload));
          break;
          
        case 'TASK_UPDATED':
          const taskToUpdate = tasks.find(t => t.id === event.target_id);
          if (taskToUpdate) {
            const field = payload.field as string;
            const newValue = payload.new_value;
            
            // Map field names (snake_case to camelCase)
            const camelField = this.mapDbFieldToCamel(field);
            (taskToUpdate as any)[camelField] = newValue;
            
            // Handle special cases
            if (field === 'dependencies') {
              taskToUpdate.dependencies = typeof newValue === 'string' 
                ? JSON.parse(newValue) 
                : newValue;
            }
          }
          break;
          
        case 'TASK_DELETED':
          tasks = tasks.filter(t => t.id !== event.target_id);
          break;
          
        case 'TASK_MOVED':
          const taskToMove = tasks.find(t => t.id === event.target_id);
          if (taskToMove) {
            taskToMove.parentId = payload.new_parent_id ?? null;
            taskToMove.sortKey = payload.new_sort_key;
          }
          break;
          
        case 'DEPENDENCY_ADDED':
        case 'DEPENDENCY_REMOVED':
        case 'DEPENDENCY_UPDATED':
          // Handle dependency changes
          const taskWithDeps = tasks.find(t => t.id === event.target_id);
          if (taskWithDeps && payload.dependencies) {
            taskWithDeps.dependencies = Array.isArray(payload.dependencies)
              ? payload.dependencies
              : JSON.parse(payload.dependencies);
          }
          break;
          
        // Other event types can be added here as needed
        default:
          console.debug(`[DataLoader] Unknown event type: ${event.event_type}`);
      }
    }
    
    return tasks;
  }
  
  /**
   * Create task from event payload
   */
  private createTaskFromPayload(payload: Record<string, unknown>): Task {
    return {
      id: payload.id as string,
      parentId: (payload.parent_id as string | null) ?? null,
      sortKey: (payload.sort_key as string) || '',
      name: (payload.name as string) || 'New Task',
      notes: (payload.notes as string) || '',
      duration: (payload.duration as number) || 1,
      constraintType: (payload.constraint_type as ConstraintType) || 'asap',
      constraintDate: (payload.constraint_date as string | null) ?? null,
      dependencies: Array.isArray(payload.dependencies)
        ? payload.dependencies
        : JSON.parse((payload.dependencies as string) || '[]'),
      progress: (payload.progress as number) || 0,
      actualStart: (payload.actual_start as string | null) ?? null,
      actualFinish: (payload.actual_finish as string | null) ?? null,
      remainingDuration: (payload.remaining_duration as number | null) ?? null,
      baselineStart: (payload.baseline_start as string | null) ?? null,
      baselineFinish: (payload.baseline_finish as string | null) ?? null,
      baselineDuration: (payload.baseline_duration as number | null) ?? null,
      _collapsed: Boolean(payload.is_collapsed),
      
      // Calculated fields - will be filled by CPM
      start: '',
      end: '',
      level: 0,
      _isCritical: false,
      _totalFloat: 0,
      _freeFloat: 0,
    };
  }
  
  /**
   * Convert persisted row to Task object
   */
  private hydrateTask(row: PersistedTask): Task {
    return {
      id: row.id,
      parentId: row.parent_id,
      sortKey: row.sort_key,
      name: row.name,
      notes: row.notes,
      duration: row.duration,
      constraintType: row.constraint_type as ConstraintType,
      constraintDate: row.constraint_date,
      dependencies: JSON.parse(row.dependencies || '[]'),
      progress: row.progress,
      actualStart: row.actual_start,
      actualFinish: row.actual_finish,
      remainingDuration: row.remaining_duration,
      baselineStart: row.baseline_start,
      baselineFinish: row.baseline_finish,
      baselineDuration: row.baseline_duration,
      _collapsed: Boolean(row.is_collapsed),
      
      // These will be filled by CPM.calculate()
      start: '',
      end: '',
      level: 0,
      _isCritical: false,
      _totalFloat: 0,
      _freeFloat: 0,
    };
  }
  
  /**
   * Map snake_case database field names to camelCase Task properties
   */
  private mapDbFieldToCamel(field: string): string {
    const mapping: Record<string, string> = {
      'actual_start': 'actualStart',
      'actual_finish': 'actualFinish',
      'remaining_duration': 'remainingDuration',
      'baseline_start': 'baselineStart',
      'baseline_finish': 'baselineFinish',
      'baseline_duration': 'baselineDuration',
      'constraint_type': 'constraintType',
      'constraint_date': 'constraintDate',
      'is_collapsed': '_collapsed',
      'parent_id': 'parentId',
      'sort_key': 'sortKey',
    };

    return mapping[field] || field;
  }
}

