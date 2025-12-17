/**
 * @fileoverview Task data store - manages task CRUD operations
 * @module data/TaskStore
 */

import type { Task, Callback } from '../types';
import { OrderingService } from '../services/OrderingService';

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
   * Set all tasks (replaces existing)
   * @param tasks - New tasks array
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
    this._notifyChange();
    return task;
  }

  /**
   * Update a task
   * @param id - Task ID
   * @param updates - Partial task updates
   * @returns Updated task or undefined
   */
  update(id: string, updates: Partial<Task>): Task | undefined {
    const task = this.getById(id);
    if (!task) return undefined;

    Object.assign(task, updates);
    this._notifyChange();
    return task;
  }

  /**
   * Delete a task
   * @param id - Task ID
   * @returns True if deleted
   */
  delete(id: string): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;

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
      return 0;
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
      task.sortKey = sortKey;
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
   * Notify subscribers of changes
   * @private
   */
  private _notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange(this.tasks);
    }
  }
}
