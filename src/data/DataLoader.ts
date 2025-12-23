/**
 * @fileoverview Data Loader - Loads data from SQLite with snapshot + replay
 * @module data/DataLoader
 * 
 * ENHANCED:
 * - Complete event replay for ALL event types
 * - Proper calendar loading and event handling
 */

import Database from '@tauri-apps/plugin-sql';
import type { Task, Calendar, ConstraintType, Dependency, TradePartner } from '../types';
import { DEFAULT_WORKING_DAYS } from '../core/Constants';

interface DatabaseInterface {
  execute(query: string, bindings?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(query: string, bindings?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

interface PersistedTask {
  id: string;
  parent_id: string | null;
  sort_key: string;
  name: string;
  notes: string;
  duration: number;
  constraint_type: string;
  constraint_date: string | null;
  scheduling_mode?: string;
  dependencies: string;
  progress: number;
  actual_start: string | null;
  actual_finish: string | null;
  remaining_duration: number | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  baseline_duration: number | null;
  is_collapsed: number;
}

interface EventRow {
  id: number;
  event_type: string;
  target_id: string | null;
  payload: string;
  timestamp: string;
}

interface SnapshotRow {
  id: number;
  tasks_json: string;
  calendar_json: string;
  trade_partners_json: string;
  event_id: number;
  created_at: string;
}

export class DataLoader {
  private db: DatabaseInterface | null = null;
  
  async init(): Promise<void> {
    if (this.db) return;

    try {
      if (typeof window === 'undefined' || !(window as any).__TAURI__) {
        console.warn('[DataLoader] Not in Tauri environment');
        return;
      }

      this.db = await Database.load('sqlite:scheduler.db') as DatabaseInterface;
      console.log('[DataLoader] ✅ Database connection initialized');
    } catch (error) {
      console.error('[DataLoader] ❌ Failed to connect:', error);
      throw error;
    }
  }
  
  async loadData(): Promise<{ 
    tasks: Task[]; 
    calendar: Calendar; 
    tradePartners: TradePartner[];
  }> {
    if (!this.db) {
      await this.init();
    }

    if (!this.db) {
      return { 
        tasks: [], 
        calendar: { workingDays: [...DEFAULT_WORKING_DAYS], exceptions: {} },
        tradePartners: []
      };
    }

    // Step 1: Load from snapshot if available
    const snapshot = await this.loadLatestSnapshot();
    
    let tasks: Task[];
    let calendar: Calendar;
    let tradePartners: TradePartner[] = [];
    let lastEventId = 0;
    
    if (snapshot) {
      console.log(`[DataLoader] Loading from snapshot (event ${snapshot.event_id})`);
      
      const snapshotTasks = JSON.parse(snapshot.tasks_json);
      tasks = snapshotTasks.map((t: any) => ({
        ...t,
        level: t.level ?? 0,
        start: t.start ?? '',
        end: t.end ?? '',
        schedulingMode: t.schedulingMode ?? 'Auto',
        tradePartnerIds: t.tradePartnerIds ?? [],
      })) as Task[];
      
      calendar = JSON.parse(snapshot.calendar_json) as Calendar;
      
      // Load trade partners from snapshot
      try {
        tradePartners = JSON.parse(snapshot.trade_partners_json || '[]') as TradePartner[];
      } catch {
        tradePartners = [];
      }
      
      lastEventId = snapshot.event_id;
    } else {
      console.log('[DataLoader] No snapshot, loading from tables');
      
      const taskResult = await this.db.select<PersistedTask[]>(
        `SELECT * FROM tasks ORDER BY sort_key`
      );
      tasks = (taskResult || []).map(row => this.hydrateTask(row));
      
      // Load task trade partner assignments
      tasks = await this.loadTaskTradePartnerAssignments(tasks);
      
      calendar = await this.loadCalendar();
      tradePartners = await this.loadTradePartners();
    }
    
    // Step 2: Replay events since snapshot
    const newEvents = await this.db.select<EventRow[]>(
      `SELECT * FROM events WHERE id > ? ORDER BY id ASC`,
      [lastEventId]
    );
    
    if (newEvents && newEvents.length > 0) {
      console.log(`[DataLoader] Replaying ${newEvents.length} events`);
      const result = this.replayEvents(tasks, calendar, tradePartners, newEvents);
      tasks = result.tasks;
      calendar = result.calendar;
      tradePartners = result.tradePartners;
    }
    
    return { tasks, calendar, tradePartners };
  }
  
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
  
  private async loadCalendar(): Promise<Calendar> {
    if (!this.db) {
      return { workingDays: [...DEFAULT_WORKING_DAYS], exceptions: {} };
    }

    try {
      const result = await this.db.select<Array<{ working_days: string; exceptions: string }>>(
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
    
    return { workingDays: [...DEFAULT_WORKING_DAYS], exceptions: {} };
  }
  
  /**
   * Load trade partners from database
   */
  private async loadTradePartners(): Promise<TradePartner[]> {
    if (!this.db) return [];

    try {
      const result = await this.db.select<Array<{
        id: string;
        name: string;
        contact: string;
        phone: string;
        email: string;
        color: string;
        notes: string;
      }>>(`SELECT * FROM trade_partners ORDER BY name`);
      
      return (result || []).map(row => ({
        id: row.id,
        name: row.name,
        contact: row.contact || '',
        phone: row.phone || '',
        email: row.email || '',
        color: row.color || '#3B82F6',
        notes: row.notes || '',
      }));
    } catch (error) {
      console.error('[DataLoader] Failed to load trade partners:', error);
      return [];
    }
  }

  /**
   * Load task trade partner assignments and merge into tasks
   */
  private async loadTaskTradePartnerAssignments(tasks: Task[]): Promise<Task[]> {
    if (!this.db) return tasks;

    try {
      const result = await this.db.select<Array<{
        task_id: string;
        trade_partner_id: string;
      }>>(`SELECT task_id, trade_partner_id FROM task_trade_partners`);
      
      // Group by task_id
      const assignmentMap = new Map<string, string[]>();
      for (const row of result || []) {
        const existing = assignmentMap.get(row.task_id) || [];
        existing.push(row.trade_partner_id);
        assignmentMap.set(row.task_id, existing);
      }
      
      // Merge into tasks
      return tasks.map(task => ({
        ...task,
        tradePartnerIds: assignmentMap.get(task.id) || [],
      }));
    } catch (error) {
      console.error('[DataLoader] Failed to load task trade partner assignments:', error);
      return tasks;
    }
  }

  /**
   * Replay events to reconstruct state
   * Handles ALL event types defined in schema
   */
  private replayEvents(
    tasks: Task[], 
    calendar: Calendar,
    tradePartners: TradePartner[],
    events: EventRow[]
  ): { tasks: Task[]; calendar: Calendar; tradePartners: TradePartner[] } {
    
    for (const event of events) {
      const payload = JSON.parse(event.payload);
      
      switch (event.event_type) {
        // =========== TASK CRUD ===========
        case 'TASK_CREATED':
          tasks.push(this.createTaskFromPayload(payload));
          break;
          
        case 'TASK_UPDATED':
          this.applyTaskUpdate(tasks, event.target_id, payload);
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
          
        // =========== HIERARCHY ===========
        case 'TASK_INDENTED':
        case 'TASK_OUTDENTED':
          // These are semantic aliases for TASK_MOVED
          const hierarchyTask = tasks.find(t => t.id === event.target_id);
          if (hierarchyTask && payload.new_parent_id !== undefined) {
            hierarchyTask.parentId = payload.new_parent_id ?? null;
            if (payload.new_sort_key) {
              hierarchyTask.sortKey = payload.new_sort_key;
            }
          }
          break;
          
        // =========== DEPENDENCIES ===========
        case 'DEPENDENCY_ADDED':
        case 'DEPENDENCY_REMOVED':
        case 'DEPENDENCY_UPDATED':
          const depTask = tasks.find(t => t.id === event.target_id);
          if (depTask && payload.dependencies !== undefined) {
            depTask.dependencies = this.parseDependencies(payload.dependencies);
          } else if (depTask && payload.new_value !== undefined) {
            depTask.dependencies = this.parseDependencies(payload.new_value);
          }
          break;
          
        // =========== BASELINE ===========
        case 'BASELINE_SET':
          const baselineTask = tasks.find(t => t.id === event.target_id);
          if (baselineTask) {
            baselineTask.baselineStart = payload.baseline_start ?? null;
            baselineTask.baselineFinish = payload.baseline_finish ?? null;
            baselineTask.baselineDuration = payload.baseline_duration ?? null;
          }
          break;
          
        case 'BASELINE_CLEARED':
          const clearTask = tasks.find(t => t.id === event.target_id);
          if (clearTask) {
            clearTask.baselineStart = null;
            clearTask.baselineFinish = null;
            clearTask.baselineDuration = null;
          }
          break;
          
        // =========== CALENDAR ===========
        case 'CALENDAR_UPDATED':
          if (payload.new_working_days) {
            calendar.workingDays = payload.new_working_days;
          }
          if (payload.new_exceptions) {
            calendar.exceptions = payload.new_exceptions;
          }
          break;
          
        // =========== PROJECT ===========
        case 'PROJECT_IMPORTED':
          // Full replacement - payload contains all tasks and calendar
          if (payload.tasks) {
            tasks = payload.tasks.map((t: any) => this.createTaskFromPayload(t));
          }
          if (payload.calendar) {
            calendar = payload.calendar;
          }
          break;
          
        case 'PROJECT_CLEARED':
          tasks = [];
          calendar = { workingDays: [...DEFAULT_WORKING_DAYS], exceptions: {} };
          break;
          
        // =========== BULK ===========
        case 'BULK_UPDATE':
          if (payload.updates && Array.isArray(payload.updates)) {
            for (const update of payload.updates) {
              this.applyTaskUpdate(tasks, update.task_id, update);
            }
          }
          break;
          
        case 'BULK_DELETE':
          if (payload.task_ids && Array.isArray(payload.task_ids)) {
            const idsToDelete = new Set(payload.task_ids);
            tasks = tasks.filter(t => !idsToDelete.has(t.id));
          }
          break;

        // =========== TRADE PARTNERS ===========
        case 'TRADE_PARTNER_CREATED':
          tradePartners.push({
            id: payload.id,
            name: payload.name || 'New Trade Partner',
            contact: payload.contact || '',
            phone: payload.phone || '',
            email: payload.email || '',
            color: payload.color || '#3B82F6',
            notes: payload.notes || '',
          });
          break;

        case 'TRADE_PARTNER_UPDATED':
          const tpIndex = tradePartners.findIndex(tp => tp.id === event.target_id);
          if (tpIndex !== -1 && payload.field) {
            (tradePartners[tpIndex] as any)[payload.field] = payload.new_value;
          }
          break;

        case 'TRADE_PARTNER_DELETED':
          tradePartners = tradePartners.filter(tp => tp.id !== event.target_id);
          // Also remove from all task assignments
          for (const task of tasks) {
            if (task.tradePartnerIds) {
              task.tradePartnerIds = task.tradePartnerIds.filter(
                id => id !== event.target_id
              );
            }
          }
          break;

        case 'TASK_TRADE_PARTNER_ASSIGNED':
          const assignTask = tasks.find(t => t.id === event.target_id);
          if (assignTask) {
            if (!assignTask.tradePartnerIds) {
              assignTask.tradePartnerIds = [];
            }
            if (!assignTask.tradePartnerIds.includes(payload.trade_partner_id)) {
              assignTask.tradePartnerIds.push(payload.trade_partner_id);
            }
          }
          break;

        case 'TASK_TRADE_PARTNER_UNASSIGNED':
          const unassignTask = tasks.find(t => t.id === event.target_id);
          if (unassignTask && unassignTask.tradePartnerIds) {
            unassignTask.tradePartnerIds = unassignTask.tradePartnerIds.filter(
              id => id !== payload.trade_partner_id
            );
          }
          break;
        
        default:
          // Unknown event type - skip
          break;
      }
    }
    
    return { tasks, calendar, tradePartners };
  }
  
  private applyTaskUpdate(tasks: Task[], targetId: string | null, payload: any): void {
    if (!targetId) return;
    
    const task = tasks.find(t => t.id === targetId);
    if (!task) return;
    
    const field = payload.field as string;
    const newValue = payload.new_value;
    
    if (!field) return;
    
    // Map snake_case to camelCase
    const camelField = this.mapDbFieldToCamel(field);
    
    if (field === 'dependencies') {
      task.dependencies = this.parseDependencies(newValue);
    } else {
      (task as any)[camelField] = newValue;
    }
  }
  
  private createTaskFromPayload(payload: Record<string, unknown>): Task {
    return {
      id: payload.id as string,
      parentId: (payload.parent_id as string | null) ?? (payload.parentId as string | null) ?? null,
      sortKey: (payload.sort_key as string) || (payload.sortKey as string) || '',
      name: (payload.name as string) || 'New Task',
      notes: (payload.notes as string) || '',
      duration: (payload.duration as number) || 1,
      constraintType: ((payload.constraint_type || payload.constraintType) as ConstraintType) || 'asap',
      constraintDate: (payload.constraint_date as string | null) ?? (payload.constraintDate as string | null) ?? null,
      schedulingMode: ((payload.scheduling_mode || payload.schedulingMode) as 'Auto' | 'Manual') ?? 'Auto',
      dependencies: this.parseDependencies(payload.dependencies),
      progress: (payload.progress as number) || 0,
      actualStart: (payload.actual_start as string | null) ?? (payload.actualStart as string | null) ?? null,
      actualFinish: (payload.actual_finish as string | null) ?? (payload.actualFinish as string | null) ?? null,
      remainingDuration: (payload.remaining_duration as number | null) ?? (payload.remainingDuration as number | null) ?? null,
      baselineStart: (payload.baseline_start as string | null) ?? (payload.baselineStart as string | null) ?? null,
      baselineFinish: (payload.baseline_finish as string | null) ?? (payload.baselineFinish as string | null) ?? null,
      baselineDuration: (payload.baseline_duration as number | null) ?? (payload.baselineDuration as number | null) ?? null,
      _collapsed: Boolean(payload.is_collapsed ?? payload._collapsed),
      tradePartnerIds: (payload.trade_partner_ids as string[]) ?? (payload.tradePartnerIds as string[]) ?? [],
      level: 0,
      start: '',
      end: '',
    };
  }
  
  private hydrateTask(row: PersistedTask): Task {
    return {
      id: row.id,
      parentId: row.parent_id ?? null,
      sortKey: row.sort_key || '',
      name: row.name || 'New Task',
      notes: row.notes || '',
      duration: row.duration || 1,
      constraintType: (row.constraint_type as ConstraintType) || 'asap',
      constraintDate: row.constraint_date ?? null,
      schedulingMode: (row.scheduling_mode as 'Auto' | 'Manual') ?? 'Auto',
      dependencies: this.parseDependencies(row.dependencies),
      progress: row.progress || 0,
      actualStart: row.actual_start ?? null,
      actualFinish: row.actual_finish ?? null,
      remainingDuration: row.remaining_duration ?? null,
      baselineStart: row.baseline_start ?? null,
      baselineFinish: row.baseline_finish ?? null,
      baselineDuration: row.baseline_duration ?? null,
      _collapsed: Boolean(row.is_collapsed),
      tradePartnerIds: [],
      level: 0,
      start: '',
      end: '',
    };
  }

  private parseDependencies(value: unknown): Dependency[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return [];
  }
  
  private mapDbFieldToCamel(field: string): string {
    const mapping: Record<string, string> = {
      'parent_id': 'parentId',
      'sort_key': 'sortKey',
      'constraint_type': 'constraintType',
      'constraint_date': 'constraintDate',
      'scheduling_mode': 'schedulingMode',
      'actual_start': 'actualStart',
      'actual_finish': 'actualFinish',
      'remaining_duration': 'remainingDuration',
      'baseline_start': 'baselineStart',
      'baseline_finish': 'baselineFinish',
      'baseline_duration': 'baselineDuration',
      'is_collapsed': '_collapsed',
    };
    return mapping[field] || field;
  }
}
