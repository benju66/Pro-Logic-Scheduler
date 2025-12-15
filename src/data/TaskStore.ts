/**
 * @fileoverview Task data store - manages task CRUD operations
 * @module data/TaskStore
 */

import type { Task, Callback } from '../types';

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
   * @returns All tasks
   */
  getAll(): Task[] {
    return this.tasks;
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
   * Get tasks by parent ID
   * @param parentId - Parent task ID
   * @returns Child tasks
   */
  getChildren(parentId: string | null): Task[] {
    return this.tasks.filter(t => t.parentId === parentId);
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
   * @param isCollapsed - Function to check if task is collapsed
   * @returns Flat list of visible tasks
   */
  getVisibleTasks(isCollapsed: (id: string) => boolean = () => false): Task[] {
    const result: Task[] = [];
    
    const addTask = (task: Task): void => {
      result.push(task);
      if (!isCollapsed(task.id) && this.isParent(task.id)) {
        this.getChildren(task.id).forEach(child => addTask(child));
      }
    };

    this.tasks.filter(t => !t.parentId).forEach(root => addTask(root));
    return result;
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
