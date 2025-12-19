/**
 * @fileoverview Task data store - manages task CRUD operations
 * @module data/TaskStore
 */

import type { Task, Callback } from '../types';
import { OrderingService } from '../services/OrderingService';
import type { PersistenceService } from './PersistenceService';
import type { HistoryManager, QueuedEvent } from './HistoryManager';

/**
 * Task store options
 */
export interface TaskStoreOptions {
  onChange?: Callback<Task[]>;
}

/**
 * Task data store
 * Manages task state and provides CRUD operations
 */
export class TaskStore {
  private tasks: Task[] = [];
  private options: TaskStoreOptions;
  private persistenceService: PersistenceService | null = null;
  private historyManager: HistoryManager | null = null;
  private isUndoRedo: boolean = false; // Flag to prevent recording history during undo/redo

  /**
   * @param options - Configuration
   */
  constructor(options: TaskStoreOptions = {}) {
    this.options = options;
  }

  /**
   * Get all tasks
   * @returns Defensive copy of all tasks
   */
  getAll(): Task[] {
    return [...this.tasks];
  }

  /**
   * Set persistence service (injected post-construction to avoid circular dependencies)
   * @param service - PersistenceService instance
   */
  setPersistenceService(service: PersistenceService): void {
    this.persistenceService = service;
  }

  /**
   * Set history manager (injected post-construction to avoid circular dependencies)
   * @param manager - HistoryManager instance
   */
  setHistoryManager(manager: HistoryManager): void {
    this.historyManager = manager;
  }

  /**
   * Set all tasks (replaces existing)
   * @param tasks - New tasks array
   * @note Does NOT queue events - used for loading data
   */
  setAll(tasks: Task[]): void {
    this.tasks = tasks || [];
    this._notifyChange();
  }

  /**
   * Get a task by ID
   * @param id - Task ID
   * @returns Task or undefined
   */
  getById(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /**
   * Add a new task
   * @param task - Task object
   * @returns Added task
   */
  add(task: Task): Task {
    this.tasks.push(task);
    
    // Create forward event (TASK_CREATED)
    const forwardEvent: QueuedEvent = {
      type: 'TASK_CREATED',
      targetId: task.id,
      payload: {
        id: task.id,
        parent_id: task.parentId ?? null,
        sort_key: task.sortKey,
        name: task.name,
        duration: task.duration,
        constraint_type: task.constraintType || 'asap',
        dependencies: task.dependencies || [],
        is_collapsed: task._collapsed || false,
      },
      timestamp: new Date(),
    };
    
    // Create backward event (TASK_DELETED - inverse)
    const backwardEvent: QueuedEvent = {
      type: 'TASK_DELETED',
      targetId: task.id,
      payload: {},
      timestamp: new Date(),
    };
    
    // Queue persistence event
    if (this.persistenceService) {
      this.persistenceService.queueEvent(forwardEvent.type, forwardEvent.targetId, forwardEvent.payload);
    }
    
    // Record action in history (unless this is an undo/redo operation)
    if (!this.isUndoRedo && this.historyManager) {
      this.historyManager.recordAction(forwardEvent, backwardEvent);
    }
    
    this._notifyChange();
    return task;
  }

  /**
   * Update a task
   * @param id - Task ID
   * @param updates - Partial task updates
   * @param skipHistory - If true, don't record in history (for undo/redo)
   * @returns Updated task or undefined
   */
  update(id: string, updates: Partial<Task>, skipHistory: boolean = false): Task | undefined {
    const task = this.getById(id);
    if (!task) return undefined;

    // Store old values for event payload
    const oldValues: Record<string, unknown> = {};
    
    // Process each non-calculated field
    for (const [field, newValue] of Object.entries(updates)) {
      // Skip calculated fields
      if (this.isCalculatedField(field)) {
        continue;
      }
      
      // Store old value
      oldValues[field] = (task as any)[field];
      
      // Map field names for database (camelCase to snake_case for some fields)
      const dbField = this.mapFieldToDb(field);
      
      // Create forward event (TASK_UPDATED with new value)
      const forwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: id,
        payload: {
          field: dbField,
          old_value: oldValues[field],
          new_value: newValue,
        },
        timestamp: new Date(),
      };
      
      // Create backward event (TASK_UPDATED with old value - inverse)
      const backwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: id,
        payload: {
          field: dbField,
          old_value: newValue,
          new_value: oldValues[field],
        },
        timestamp: new Date(),
      };
      
      // Queue persistence event
      if (this.persistenceService) {
        this.persistenceService.queueEvent(forwardEvent.type, forwardEvent.targetId, forwardEvent.payload);
      }
      
      // Record action in history (unless this is an undo/redo operation)
      if (!this.isUndoRedo && !skipHistory && this.historyManager) {
        this.historyManager.recordAction(forwardEvent, backwardEvent);
      }
    }

    Object.assign(task, updates);
    this._notifyChange();
    return task;
  }

  /**
   * Delete a task
   * @param id - Task ID
   * @param skipHistory - If true, don't record in history (for undo/redo)
   * @returns True if deleted
   */
  delete(id: string, skipHistory: boolean = false): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;

    const task = this.tasks[index];
    
    // CRITICAL: Clean up "ghost links" - remove dependencies referencing this task
    if (this.persistenceService && !this.isUndoRedo) {
      const tasksWithDependency = this.tasks.filter(t => 
        t.dependencies && t.dependencies.some(dep => dep.id === id)
      );

      for (const dependentTask of tasksWithDependency) {
        // Remove the dependency
        const updatedDependencies = dependentTask.dependencies.filter(dep => dep.id !== id);
        
        // Queue TASK_UPDATED event to remove the dependency
        this.persistenceService.queueEvent('TASK_UPDATED', dependentTask.id, {
          field: 'dependencies',
          old_value: dependentTask.dependencies,
          new_value: updatedDependencies,
        });
        
        // Update in memory
        dependentTask.dependencies = updatedDependencies;
      }
    }

    // Create forward event (TASK_DELETED)
    const forwardEvent: QueuedEvent = {
      type: 'TASK_DELETED',
      targetId: id,
      payload: {},
      timestamp: new Date(),
    };
    
    // Create backward event (TASK_CREATED - inverse)
    // Need to store full task data for recreation
    const backwardEvent: QueuedEvent = {
      type: 'TASK_CREATED',
      targetId: id,
      payload: {
        id: task.id,
        parent_id: task.parentId ?? null,
        sort_key: task.sortKey,
        name: task.name,
        duration: task.duration,
        constraint_type: task.constraintType || 'asap',
        constraint_date: task.constraintDate,
        dependencies: task.dependencies || [],
        progress: task.progress || 0,
        notes: task.notes || '',
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
    
    // Queue persistence event
    if (this.persistenceService) {
      this.persistenceService.queueEvent(forwardEvent.type, forwardEvent.targetId, forwardEvent.payload);
    }
    
    // Record action in history (unless this is an undo/redo operation)
    if (!this.isUndoRedo && !skipHistory && this.historyManager) {
      this.historyManager.recordAction(forwardEvent, backwardEvent);
    }

    this.tasks.splice(index, 1);
    this._notifyChange();
    return true;
  }

  /**
   * Find tasks matching a predicate
   * @param predicate - Filter function
   * @returns Matching tasks
   */
  find(predicate: (task: Task) => boolean): Task[] {
    return this.tasks.filter(predicate);
  }

  /**
   * Get children of a parent task, sorted by sortKey
   * @param parentId - Parent task ID (null for root tasks)
   * @returns Array of child tasks sorted by sortKey
   */
  getChildren(parentId: string | null): Task[] {
    const children = this.tasks.filter(t => (t.parentId ?? null) === parentId);
    
    // Sort by sortKey using proper string comparison
    return children.sort((a, b) => {
      const keyA = a.sortKey ?? '';
      const keyB = b.sortKey ?? '';
      if (keyA < keyB) return -1;
      if (keyA > keyB) return 1;
      return a.id.localeCompare(b.id); // Deterministic tiebreaker when sortKeys are equal
    });
  }

  /**
   * Check if a task is a parent
   * @param id - Task ID
   * @returns True if task has children
   */
  isParent(id: string): boolean {
    return this.tasks.some(t => t.parentId === id);
  }

  /**
   * Get task depth in hierarchy
   * @param id - Task ID
   * @param depth - Current depth (internal)
   * @returns Depth level
   */
  getDepth(id: string, depth: number = 0): number {
    const task = this.getById(id);
    if (!task || !task.parentId) return depth;
    return this.getDepth(task.parentId, depth + 1);
  }

  /**
   * Get flat list of visible tasks (respecting collapse state)
   * Tasks are sorted by sortKey within each parent level
   * @param isCollapsed - Function to check if task is collapsed
   * @returns Flat list of visible tasks in display order
   */
  getVisibleTasks(isCollapsed: (id: string) => boolean = () => false): Task[] {
    const result: Task[] = [];
    
    const addTask = (task: Task): void => {
      result.push(task);
      if (!isCollapsed(task.id) && this.isParent(task.id)) {
        // getChildren() already returns sorted children
        this.getChildren(task.id).forEach(child => addTask(child));
      }
    };
    
    // Get root tasks (parentId is null) - getChildren handles sorting
    const rootTasks = this.getChildren(null);
    rootTasks.forEach(root => addTask(root));
    
    return result;
  }

  /**
   * Get the last (highest) sort key among siblings
   * Used when appending new tasks
   * @param parentId - Parent ID to check siblings for
   * @returns Last sort key or null if no siblings
   */
  getLastSortKey(parentId: string | null): string | null {
    const siblings = this.getChildren(parentId);
    if (siblings.length === 0) return null;
    return siblings[siblings.length - 1].sortKey ?? null;
  }

  /**
   * Get the first (lowest) sort key among siblings
   * Used when prepending new tasks
   * @param parentId - Parent ID to check siblings for
   * @returns First sort key or null if no siblings
   */
  getFirstSortKey(parentId: string | null): string | null {
    const siblings = this.getChildren(parentId);
    if (siblings.length === 0) return null;
    return siblings[0].sortKey ?? null;
  }

  /**
   * Update a single task's sortKey
   * @param taskId - Task ID to update
   * @param sortKey - New sort key
   */
  updateSortKey(taskId: string, sortKey: string): void {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      const oldSortKey = task.sortKey;
      task.sortKey = sortKey;
      
      // Create forward event
      const forwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: taskId,
        payload: {
          field: 'sort_key',
          old_value: oldSortKey,
          new_value: sortKey,
        },
        timestamp: new Date(),
      };
      
      // Create backward event (inverse)
      const backwardEvent: QueuedEvent = {
        type: 'TASK_UPDATED',
        targetId: taskId,
        payload: {
          field: 'sort_key',
          old_value: sortKey,
          new_value: oldSortKey,
        },
        timestamp: new Date(),
      };
      
      // Queue persistence event
      if (this.persistenceService) {
        this.persistenceService.queueEvent(forwardEvent.type, forwardEvent.targetId, forwardEvent.payload);
      }
      
      // Record action in history (unless this is an undo/redo operation)
      if (!this.isUndoRedo && this.historyManager) {
        this.historyManager.recordAction(forwardEvent, backwardEvent);
      }
      
      this._notifyChange();
    }
  }

  /**
   * Temporarily disable change notifications
   * Useful for batch operations to prevent recursion
   * @returns Function to restore notifications
   */
  disableNotifications(): () => void {
    const originalOnChange = this.options.onChange;
    this.options.onChange = undefined;
    return () => {
      this.options.onChange = originalOnChange;
    };
  }

  /**
   * Apply an event from undo/redo (without recording history)
   * @param event - Event to apply
   */
  applyEvent(event: QueuedEvent): void {
    const wasUndoRedo = this.isUndoRedo;
    this.isUndoRedo = true; // Prevent recording history
    
    try {
      switch (event.type) {
        case 'TASK_CREATED':
          // Recreate task from payload
          const taskData = event.payload;
          const task: Task = {
            id: taskData.id as string,
            parentId: (taskData.parent_id as string | null) ?? null,
            sortKey: (taskData.sort_key as string) || '',
            name: (taskData.name as string) || 'New Task',
            notes: (taskData.notes as string) || '',
            duration: (taskData.duration as number) || 1,
            constraintType: (taskData.constraint_type as string) || 'asap',
            constraintDate: (taskData.constraint_date as string | null) ?? null,
            dependencies: Array.isArray(taskData.dependencies)
              ? taskData.dependencies
              : [],
            progress: (taskData.progress as number) || 0,
            actualStart: (taskData.actual_start as string | null) ?? null,
            actualFinish: (taskData.actual_finish as string | null) ?? null,
            remainingDuration: (taskData.remaining_duration as number | null) ?? null,
            baselineStart: (taskData.baseline_start as string | null) ?? null,
            baselineFinish: (taskData.baseline_finish as string | null) ?? null,
            baselineDuration: (taskData.baseline_duration as number | null) ?? null,
            _collapsed: Boolean(taskData.is_collapsed),
            level: 0,
            start: '',
            end: '',
          };
          
          // Add task directly without recording history
          this.tasks.push(task);
          
          // Queue persistence event (but don't record history)
          if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_CREATED', task.id, {
              id: task.id,
              parent_id: task.parentId ?? null,
              sort_key: task.sortKey,
              name: task.name,
              duration: task.duration,
              constraint_type: task.constraintType || 'asap',
              dependencies: task.dependencies || [],
              is_collapsed: task._collapsed || false,
            });
          }
          
          this._notifyChange();
          break;
          
        case 'TASK_UPDATED':
          const field = event.payload.field as string;
          const newValue = event.payload.new_value;
          
          // Map database field name back to camelCase
          const camelField = this.mapDbFieldToCamel(field);
          
          // Handle special cases
          if (field === 'dependencies') {
            const taskToUpdate = this.getById(event.targetId!);
            if (taskToUpdate) {
              taskToUpdate.dependencies = newValue as any[];
              // Queue persistence event
              if (this.persistenceService) {
                this.persistenceService.queueEvent('TASK_UPDATED', event.targetId!, {
                  field: 'dependencies',
                  old_value: taskToUpdate.dependencies,
                  new_value: newValue,
                });
              }
              this._notifyChange();
            }
          } else if (field === 'sort_key') {
            const taskToUpdate = this.getById(event.targetId!);
            if (taskToUpdate) {
              taskToUpdate.sortKey = newValue as string;
              // Queue persistence event
              if (this.persistenceService) {
                this.persistenceService.queueEvent('TASK_UPDATED', event.targetId!, {
                  field: 'sort_key',
                  old_value: taskToUpdate.sortKey,
                  new_value: newValue,
                });
              }
              this._notifyChange();
            }
          } else {
            const updates: Partial<Task> = { [camelField]: newValue } as Partial<Task>;
            const taskToUpdate = this.getById(event.targetId!);
            if (taskToUpdate) {
              const oldValue = (taskToUpdate as any)[camelField];
              Object.assign(taskToUpdate, updates);
              // Queue persistence event
              if (this.persistenceService) {
                this.persistenceService.queueEvent('TASK_UPDATED', event.targetId!, {
                  field: field,
                  old_value: oldValue,
                  new_value: newValue,
                });
              }
              this._notifyChange();
            }
          }
          break;
          
        case 'TASK_DELETED':
          const index = this.tasks.findIndex(t => t.id === event.targetId);
          if (index !== -1) {
            this.tasks.splice(index, 1);
            // Queue persistence event
            if (this.persistenceService) {
              this.persistenceService.queueEvent('TASK_DELETED', event.targetId!, {});
            }
            this._notifyChange();
          }
          break;
          
        default:
          console.warn(`[TaskStore] Unknown event type in applyEvent: ${event.type}`);
      }
    } finally {
      this.isUndoRedo = wasUndoRedo; // Restore flag
    }
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

  /**
   * Check if field is calculated (not persisted)
   * @param field - Field name
   * @returns True if field is calculated
   */
  private isCalculatedField(field: string): boolean {
    return [
      'start',
      'end',
      'level',
      'lateStart',
      'lateFinish',
      'totalFloat',
      'freeFloat',
      '_isCritical',
      '_health',
      '_earlyStart',
      '_earlyFinish',
      '_totalFloat',
      '_freeFloat',
    ].includes(field);
  }

  /**
   * Map camelCase field names to snake_case database column names
   * @param field - Field name in camelCase
   * @returns Database column name in snake_case
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
      'parentId': 'parent_id',
      'sortKey': 'sort_key',
      '_collapsed': 'is_collapsed',
    };

    return mapping[field] || field;
  }

  /**
   * Notify subscribers of changes
   * @private
   */
  private _notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange(this.tasks);
    }
  }
}
