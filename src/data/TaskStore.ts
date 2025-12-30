/**
 * @fileoverview Task data store - manages task CRUD operations
 * @module data/TaskStore
 * 
 * CRITICAL: All mutations now properly record history including:
 * - Ghost link cleanup on delete
 * - Composite actions for multi-task operations
 * - Proper field mapping between camelCase and snake_case
 */

import type { Task, Callback, Dependency, ConstraintType } from '../types';
// OrderingService removed - sortKey generation handled elsewhere
import type { PersistenceService } from './PersistenceService';
import type { HistoryManager, QueuedEvent } from './HistoryManager';
import type { ProjectController } from '../services/ProjectController';

/**
 * Task store options
 */
export interface TaskStoreOptions {
  onChange?: Callback<Task[]>;
}

/**
 * Calculated fields that should NOT be persisted or recorded in history
 */
const CALCULATED_FIELDS = new Set([
  'start', 'end', 'level', 'lateStart', 'lateFinish',
  'totalFloat', 'freeFloat', '_isCritical', '_health',
  '_lateStart', '_lateFinish', '_totalFloat', '_freeFloat'
]);

/**
 * Field name mappings: camelCase to snake_case
 */
const FIELD_TO_DB: Record<string, string> = {
  'parentId': 'parent_id',
  'sortKey': 'sort_key',
  'rowType': 'row_type',
  'constraintType': 'constraint_type',
  'constraintDate': 'constraint_date',
  'actualStart': 'actual_start',
  'actualFinish': 'actual_finish',
  'remainingDuration': 'remaining_duration',
  'baselineStart': 'baseline_start',
  'baselineFinish': 'baseline_finish',
  'baselineDuration': 'baseline_duration',
  'isCollapsed': 'is_collapsed',
  '_collapsed': 'is_collapsed',
};

/**
 * Field name mappings: snake_case to camelCase
 */
const DB_TO_FIELD: Record<string, string> = {
  'parent_id': 'parentId',
  'sort_key': 'sortKey',
  'row_type': 'rowType',
  'constraint_type': 'constraintType',
  'constraint_date': 'constraintDate',
  'actual_start': 'actualStart',
  'actual_finish': 'actualFinish',
  'remaining_duration': 'remainingDuration',
  'baseline_start': 'baselineStart',
  'baseline_finish': 'baselineFinish',
  'baseline_duration': 'baselineDuration',
  'is_collapsed': '_collapsed',
};

/**
 * Task data store
 * Manages task state and provides CRUD operations with full event sourcing
 */
export class TaskStore {
  private tasks: Task[] = [];
  private taskMap: Map<string, Task> = new Map(); // O(1) lookup optimization
  private options: TaskStoreOptions;
  private persistenceService: PersistenceService | null = null;
  private historyManager: HistoryManager | null = null;
  private projectController: ProjectController | null = null;
  private isApplyingEvent: boolean = false; // Flag to prevent recording history during applyEvent
  private isSyncingToController: boolean = false; // Prevent loops when syncing

  constructor(options: TaskStoreOptions = {}) {
    this.options = options;
  }

  // =========================================================================
  // SERVICE INJECTION
  // =========================================================================

  setPersistenceService(service: PersistenceService): void {
    this.persistenceService = service;
  }

  setHistoryManager(manager: HistoryManager): void {
    this.historyManager = manager;
  }

  /**
   * Set ProjectController for syncing mutations to WASM worker
   * This ensures both legacy (TaskStore) and new (ProjectController) systems stay in sync
   * during the migration period
   */
  setProjectController(controller: ProjectController): void {
    this.projectController = controller;
    console.log('[TaskStore] ProjectController attached for mutation sync');
  }

  // =========================================================================
  // READ OPERATIONS
  // =========================================================================

  getAll(): Task[] {
    return [...this.tasks];
  }

  getById(id: string): Task | undefined {
    return this.taskMap.get(id); // O(1) lookup instead of O(n)
  }

  getChildren(parentId: string | null): Task[] {
    const children = this.tasks.filter(t => (t.parentId ?? null) === parentId);
    return children.sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
  }

  isParent(id: string): boolean {
    return this.tasks.some(t => t.parentId === id);
  }

  getDepth(id: string, depth: number = 0): number {
    const task = this.getById(id);
    if (!task || !task.parentId) return depth;
    return this.getDepth(task.parentId, depth + 1);
  }

  getVisibleTasks(isCollapsed: (id: string) => boolean): Task[] {
    const result: Task[] = [];
    const addVisibleChildren = (parentId: string | null) => {
      const children = this.getChildren(parentId);
      for (const child of children) {
        result.push(child);
        if (!isCollapsed(child.id)) {
          addVisibleChildren(child.id);
        }
      }
    };
    addVisibleChildren(null);
    return result;
  }

  // =========================================================================
  // BLANK ROW OPERATIONS
  // =========================================================================

  /**
   * Create a blank row (visual spacer)
   * @param sortKey - Position in the list
   * @param parentId - Parent task ID (for hierarchy)
   */
  createBlankRow(sortKey: string, parentId: string | null = null): Task {
    const blankRow: Task = {
      id: `blank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      rowType: 'blank',
      name: '',  // Blank rows have no name
      parentId: parentId,
      sortKey: sortKey,
      duration: 0,
      dependencies: [],
      progress: 0,
      constraintType: 'asap',
      constraintDate: null,
      notes: '',
      start: '',
      end: '',
      level: 0,  // Blank rows start at root level (recalculated by CPM)
    };
    
    return this.add(blankRow, 'Insert Blank Row');
  }

  /**
   * Convert a blank row to a regular task (wake up)
   */
  wakeUpBlankRow(taskId: string, name: string = 'New Task'): Task | undefined {
    const task = this.getById(taskId);
    if (!task || task.rowType !== 'blank') return undefined;
    
    return this.update(taskId, {
      rowType: 'task',
      name: name,
      duration: 1,
      constraintType: 'asap',
    }, 'Convert Blank to Task');
  }

  /**
   * Revert a task back to blank row (if empty)
   */
  revertToBlankRow(taskId: string): Task | undefined {
    const task = this.getById(taskId);
    if (!task) return undefined;
    
    return this.update(taskId, {
      rowType: 'blank',
      name: '',
      duration: 0,
      dependencies: [],
    }, 'Revert to Blank Row');
  }

  /**
   * Check if a task is a blank row
   */
  isBlankRow(taskId: string): boolean {
    const task = this.getById(taskId);
    return task?.rowType === 'blank';
  }

  /**
   * Get all schedulable tasks (exclude blank/phantom rows)
   */
  getSchedulableTasks(): Task[] {
    return this.tasks.filter(t => !t.rowType || t.rowType === 'task');
  }

  getLastSortKey(parentId: string | null): string | null {
    const siblings = this.getChildren(parentId);
    if (siblings.length === 0) return null;
    return siblings[siblings.length - 1].sortKey ?? null;
  }

  getFirstSortKey(parentId: string | null): string | null {
    const siblings = this.getChildren(parentId);
    if (siblings.length === 0) return null;
    return siblings[0].sortKey ?? null;
  }

  // =========================================================================
  // WRITE OPERATIONS
  // =========================================================================

  /**
   * Set all tasks (replaces existing)
   * Does NOT queue events - used for loading data
   */
  setAll(tasks: Task[]): void {
    this.tasks = tasks || [];
    this._updateMap();
    this._notifyChange();

    // Sync to ProjectController (for WASM worker and UI via SchedulerViewport)
    if (this.projectController && !this.isSyncingToController) {
      this.isSyncingToController = true;
      try {
        this.projectController.syncTasks(this.tasks);
      } finally {
        this.isSyncingToController = false;
      }
    }
  }

  /**
   * Add a new task
   */
  add(task: Task, label?: string): Task {
    this.tasks.push(task);
    this.taskMap.set(task.id, task); // Update Map
    
    const forwardEvent = this._createTaskCreatedEvent(task);
    const backwardEvent: QueuedEvent = {
      type: 'TASK_DELETED',
      targetId: task.id,
      payload: {},
      timestamp: new Date(),
    };
    
    this._queueAndRecord(forwardEvent, backwardEvent, label || 'Add Task');
    this._notifyChange();

    // Sync to ProjectController (for WASM worker)
    if (this.projectController && !this.isSyncingToController && !this.isApplyingEvent) {
      this.isSyncingToController = true;
      try {
        this.projectController.addTask(task);
      } finally {
        this.isSyncingToController = false;
      }
    }

    return task;
  }

  /**
   * Update a task with partial updates
   */
  update(id: string, updates: Partial<Task>, label?: string): Task | undefined {
    const task = this.getById(id);
    if (!task) return undefined;

    // Filter out calculated fields and process each update
    for (const [field, newValue] of Object.entries(updates)) {
      if (CALCULATED_FIELDS.has(field)) continue;
      
      const oldValue = (task as any)[field];
      if (oldValue === newValue) continue; // Skip if no change
      
      const dbField = this._mapFieldToDb(field);
      
      const forwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: id,
        payload: { field: dbField, old_value: oldValue, new_value: newValue },
        timestamp: new Date(),
      };
      
      const backwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: id,
        payload: { field: dbField, old_value: newValue, new_value: oldValue },
        timestamp: new Date(),
      };
      
      this._queueAndRecord(forwardEvent, backwardEvent, label || `Update ${field}`);
    }

    Object.assign(task, updates);
    this.taskMap.set(id, task); // Update Map (task object reference unchanged, but ensure Map is current)
    this._notifyChange();

    // Sync mutation to ProjectController (for WASM worker)
    // This ensures the worker has the latest state
    if (this.projectController && !this.isSyncingToController && !this.isApplyingEvent) {
      this.isSyncingToController = true;
      try {
        // Filter out calculated fields for worker
        const workerUpdates: Partial<Task> = {};
        for (const [field, value] of Object.entries(updates)) {
          if (!CALCULATED_FIELDS.has(field)) {
            workerUpdates[field as keyof Task] = value as any;
          }
        }
        if (Object.keys(workerUpdates).length > 0) {
          this.projectController.updateTask(id, workerUpdates);
        }
      } finally {
        this.isSyncingToController = false;
      }
    }

    return task;
  }

  /**
   * Update sortKey specifically (used by OrderingService)
   */
  updateSortKey(taskId: string, sortKey: string): void {
    const task = this.getById(taskId);
    if (!task) return;
    
    const oldSortKey = task.sortKey;
    if (oldSortKey === sortKey) return;
    
    task.sortKey = sortKey;
    
    const forwardEvent: QueuedEvent = {
      type: 'TASK_UPDATED',
      targetId: taskId,
      payload: { field: 'sort_key', old_value: oldSortKey, new_value: sortKey },
      timestamp: new Date(),
    };
    
    const backwardEvent: QueuedEvent = {
      type: 'TASK_UPDATED',
      targetId: taskId,
      payload: { field: 'sort_key', old_value: sortKey, new_value: oldSortKey },
      timestamp: new Date(),
    };
    
    this._queueAndRecord(forwardEvent, backwardEvent, 'Reorder Task');
    this._notifyChange();
  }

  /**
   * Delete a task and its children
   * INCLUDES ghost link cleanup with proper undo support
   * 
   * @param id - Task ID to delete
   * @param deleteChildren - If true, recursively delete children (default: true)
   */
  delete(id: string, deleteChildren: boolean = true): boolean {
    const task = this.getById(id);
    if (!task) return false;

    // Collect all tasks to delete
    const idsToDelete: string[] = [];
    const tasksToDelete: Task[] = [];
    
    const collectTasks = (taskId: string): void => {
      const t = this.getById(taskId);
      if (!t) return;
      
      if (deleteChildren) {
        const children = this.getChildren(taskId);
        children.forEach(child => collectTasks(child.id));
      }
      
      idsToDelete.push(taskId);
      tasksToDelete.push({ ...t }); // Deep copy for undo
    };
    
    collectTasks(id);

    // Start composite action if deleting multiple tasks
    const isComposite = idsToDelete.length > 1 || this._hasIncomingDependencies(idsToDelete);
    if (isComposite && this.historyManager && !this.isApplyingEvent) {
      this.historyManager.beginComposite(`Delete ${idsToDelete.length} Task(s)`);
    }

    // Step 1: Clean up ghost links (dependencies pointing to deleted tasks)
    // Note: Side effects are important, result is recorded in composite action
    this._cleanupGhostLinks(idsToDelete);

    // Step 2: Delete each task
    for (let i = tasksToDelete.length - 1; i >= 0; i--) {
      const taskToDelete = tasksToDelete[i];
      
      const forwardEvent: QueuedEvent = {
        type: 'TASK_DELETED',
        targetId: taskToDelete.id,
        payload: {},
        timestamp: new Date(),
      };
      
      // Backward event contains full task data for recreation
      const backwardEvent = this._createTaskCreatedEvent(taskToDelete);
      
      this._queueAndRecord(forwardEvent, backwardEvent);
      
      // Remove from array and Map
      const idx = this.tasks.findIndex(t => t.id === taskToDelete.id);
      if (idx !== -1) {
        this.tasks.splice(idx, 1);
        this.taskMap.delete(taskToDelete.id); // Update Map
      }
    }

    // End composite action
    if (isComposite && this.historyManager && !this.isApplyingEvent) {
      this.historyManager.endComposite();
    }

    this._notifyChange();

    // Sync deletions to ProjectController (for WASM worker)
    // We only need to delete the root task - WASM worker handles descendants
    if (this.projectController && !this.isSyncingToController && !this.isApplyingEvent) {
      this.isSyncingToController = true;
      try {
        this.projectController.deleteTask(id);
      } finally {
        this.isSyncingToController = false;
      }
    }

    return true;
  }

  /**
   * Move a task (change parent and/or sortKey)
   * Used for indent/outdent and drag-drop operations
   */
  move(taskId: string, newParentId: string | null, newSortKey: string, label?: string): boolean {
    const task = this.getById(taskId);
    if (!task) return false;

    const oldParentId = task.parentId ?? null;
    const oldSortKey = task.sortKey;

    // Skip if no change
    if (oldParentId === newParentId && oldSortKey === newSortKey) return true;

    task.parentId = newParentId;
    task.sortKey = newSortKey;

    const forwardEvent: QueuedEvent = {
      type: 'TASK_MOVED',
      targetId: taskId,
      payload: {
        old_parent_id: oldParentId,
        new_parent_id: newParentId,
        old_sort_key: oldSortKey,
        new_sort_key: newSortKey,
      },
      timestamp: new Date(),
    };

    const backwardEvent: QueuedEvent = {
      type: 'TASK_MOVED',
      targetId: taskId,
      payload: {
        old_parent_id: newParentId,
        new_parent_id: oldParentId,
        old_sort_key: newSortKey,
        new_sort_key: oldSortKey,
      },
      timestamp: new Date(),
    };

    this._queueAndRecord(forwardEvent, backwardEvent, label || 'Move Task');
    this._notifyChange();

    // Sync move to ProjectController (for WASM worker)
    if (this.projectController && !this.isSyncingToController && !this.isApplyingEvent) {
      this.isSyncingToController = true;
      try {
        this.projectController.updateTask(taskId, { 
          parentId: newParentId, 
          sortKey: newSortKey 
        });
      } finally {
        this.isSyncingToController = false;
      }
    }

    return true;
  }

  /**
   * Update dependencies for a task
   */
  updateDependencies(taskId: string, newDependencies: Dependency[], label?: string): boolean {
    const task = this.getById(taskId);
    if (!task) return false;

    const oldDependencies = [...(task.dependencies || [])];
    task.dependencies = newDependencies;

    const forwardEvent: QueuedEvent = {
      type: 'TASK_UPDATED',
      targetId: taskId,
      payload: {
        field: 'dependencies',
        old_value: oldDependencies,
        new_value: newDependencies,
      },
      timestamp: new Date(),
    };

    const backwardEvent: QueuedEvent = {
      type: 'TASK_UPDATED',
      targetId: taskId,
      payload: {
        field: 'dependencies',
        old_value: newDependencies,
        new_value: oldDependencies,
      },
      timestamp: new Date(),
    };

    this._queueAndRecord(forwardEvent, backwardEvent, label || 'Update Dependencies');
    this._notifyChange();
    return true;
  }

  // =========================================================================
  // EVENT APPLICATION (for undo/redo)
  // =========================================================================

  /**
   * Apply events from undo/redo without recording new history
   */
  applyEvents(events: QueuedEvent[]): void {
    this.isApplyingEvent = true;
    
    try {
      for (const event of events) {
        this._applyEvent(event);
      }
    } finally {
      this.isApplyingEvent = false;
    }
    
    this._notifyChange();
  }

  /**
   * Apply a single event
   */
  private _applyEvent(event: QueuedEvent): void {
    switch (event.type) {
      case 'TASK_CREATED':
        this._applyTaskCreated(event);
        break;
        
      case 'TASK_UPDATED':
        this._applyTaskUpdated(event);
        break;
        
      case 'TASK_DELETED':
        this._applyTaskDeleted(event);
        break;
        
      case 'TASK_MOVED':
        this._applyTaskMoved(event);
        break;
        
      default:
        console.warn(`[TaskStore] Unknown event type: ${event.type}`);
    }
  }

  private _applyTaskCreated(event: QueuedEvent): void {
    const payload = event.payload;
    
    const task: Task = {
      id: payload.id as string,
      parentId: (payload.parent_id as string | null) ?? null,
      sortKey: (payload.sort_key as string) || '',
      rowType: (payload.row_type as 'task' | 'blank' | 'phantom') || 'task',
      name: (payload.name as string) || 'New Task',
      notes: (payload.notes as string) || '',
      duration: (payload.duration as number) || 1,
      constraintType: ((payload.constraint_type as string) || 'asap') as ConstraintType,
      constraintDate: (payload.constraint_date as string | null) ?? null,
      dependencies: this._parseDependencies(payload.dependencies),
      progress: (payload.progress as number) || 0,
      actualStart: (payload.actual_start as string | null) ?? null,
      actualFinish: (payload.actual_finish as string | null) ?? null,
      remainingDuration: (payload.remaining_duration as number | null) ?? undefined,
      baselineStart: (payload.baseline_start as string | null) ?? null,
      baselineFinish: (payload.baseline_finish as string | null) ?? null,
      baselineDuration: (payload.baseline_duration as number | null) ?? undefined,
      _collapsed: Boolean(payload.is_collapsed),
      level: 0,
      start: '',
      end: '',
    };
    
    // Check if task already exists (shouldn't happen, but be safe)
    const existingIdx = this.tasks.findIndex(t => t.id === task.id);
    if (existingIdx >= 0) {
      this.tasks[existingIdx] = task;
      this.taskMap.set(task.id, task); // Update Map
    } else {
      this.tasks.push(task);
      this.taskMap.set(task.id, task); // Update Map
    }
    
    // Queue for persistence
    if (this.persistenceService) {
      this.persistenceService.queueEvent(event.type, event.targetId, event.payload);
    }
  }

  private _applyTaskUpdated(event: QueuedEvent): void {
    const task = this.getById(event.targetId!);
    if (!task) return;
    
    const field = event.payload.field as string;
    const newValue = event.payload.new_value;
    
    const camelField = this._mapDbFieldToCamel(field);
    
    if (field === 'dependencies') {
      task.dependencies = this._parseDependencies(newValue);
    } else {
      (task as any)[camelField] = newValue;
    }
    
    this.taskMap.set(task.id, task); // Update Map (task object reference unchanged, but ensure Map is current)
    
    // Queue for persistence
    if (this.persistenceService) {
      this.persistenceService.queueEvent(event.type, event.targetId, event.payload);
    }
  }

  private _applyTaskDeleted(event: QueuedEvent): void {
    const idx = this.tasks.findIndex(t => t.id === event.targetId);
    if (idx !== -1) {
      this.tasks.splice(idx, 1);
      this.taskMap.delete(event.targetId!); // Update Map
    }
    
    // Queue for persistence
    if (this.persistenceService) {
      this.persistenceService.queueEvent(event.type, event.targetId, event.payload);
    }
  }

  private _applyTaskMoved(event: QueuedEvent): void {
    const task = this.getById(event.targetId!);
    if (!task) return;
    
    task.parentId = (event.payload.new_parent_id as string | null) ?? null;
    task.sortKey = event.payload.new_sort_key as string;
    
    // Queue for persistence
    if (this.persistenceService) {
      this.persistenceService.queueEvent(event.type, event.targetId, event.payload);
    }
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  /**
   * Temporarily disable change notifications
   */
  disableNotifications(): () => void {
    const originalOnChange = this.options.onChange;
    this.options.onChange = undefined;
    return () => {
      this.options.onChange = originalOnChange;
    };
  }

  /**
   * Update the Map index to keep it in sync with tasks array
   * Called after bulk operations or when Map might be out of sync
   * @private
   */
  private _updateMap(): void {
    this.taskMap.clear();
    this.tasks.forEach(task => {
      this.taskMap.set(task.id, task);
    });
  }

  private _notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange(this.tasks);
    }
  }

  private _queueAndRecord(forward: QueuedEvent, backward: QueuedEvent, label?: string): void {
    // NOTE: Persistence is now handled by ProjectController (via the sync hooks in add/update/delete/move)
    // We only record to history here for undo/redo support
    // REMOVED: if (this.persistenceService) { this.persistenceService.queueEvent(...) }
    
    // Record in history (unless applying events from undo/redo)
    if (this.historyManager && !this.isApplyingEvent) {
      this.historyManager.recordAction(forward, backward, label);
    }
  }

  private _createTaskCreatedEvent(task: Task): QueuedEvent {
    return {
      type: 'TASK_CREATED',
      targetId: task.id,
      payload: {
        id: task.id,
        parent_id: task.parentId ?? null,
        sort_key: task.sortKey,
        row_type: task.rowType ?? 'task',
        name: task.name,
        notes: task.notes || '',
        duration: task.duration,
        constraint_type: task.constraintType || 'asap',
        constraint_date: task.constraintDate ?? null,
        dependencies: task.dependencies || [],
        progress: task.progress || 0,
        actual_start: task.actualStart ?? null,
        actual_finish: task.actualFinish ?? null,
        remaining_duration: task.remainingDuration ?? null,
        baseline_start: task.baselineStart ?? null,
        baseline_finish: task.baselineFinish ?? null,
        baseline_duration: task.baselineDuration ?? null,
        is_collapsed: task._collapsed || false,
      },
      timestamp: new Date(),
    };
  }

  private _hasIncomingDependencies(taskIds: string[]): boolean {
    const idSet = new Set(taskIds);
    return this.tasks.some(t => 
      !idSet.has(t.id) && 
      t.dependencies?.some(dep => idSet.has(dep.id))
    );
  }

  /**
   * Clean up ghost links (dependencies pointing to tasks being deleted)
   * Records events for proper undo support
   */
  private _cleanupGhostLinks(deletedIds: string[]): void {
    const idSet = new Set(deletedIds);
    
    for (const task of this.tasks) {
      if (idSet.has(task.id)) continue; // Skip tasks being deleted
      
      const hasBadDeps = task.dependencies?.some(dep => idSet.has(dep.id));
      if (!hasBadDeps) continue;
      
      const oldDeps = [...(task.dependencies || [])];
      const newDeps = oldDeps.filter(dep => !idSet.has(dep.id));
      
      // Record the cleanup
      const forwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: task.id,
        payload: {
          field: 'dependencies',
          old_value: oldDeps,
          new_value: newDeps,
        },
        timestamp: new Date(),
      };
      
      const backwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: task.id,
        payload: {
          field: 'dependencies',
          old_value: newDeps,
          new_value: oldDeps,
        },
        timestamp: new Date(),
      };
      
      this._queueAndRecord(forwardEvent, backwardEvent);
      
      // Apply the change
      task.dependencies = newDeps;
    }
  }

  private _mapFieldToDb(field: string): string {
    return FIELD_TO_DB[field] || field;
  }

  private _mapDbFieldToCamel(field: string): string {
    return DB_TO_FIELD[field] || field;
  }

  private _parseDependencies(value: unknown): Dependency[] {
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
}
