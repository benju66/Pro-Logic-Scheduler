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
   * Get tasks by parent ID
   * @param parentId - Parent task ID
   * @returns Child tasks sorted by displayOrder
   */
  getChildren(parentId: string | null): Task[] {
    const children = this.tasks.filter(t => t.parentId === parentId);
    
    // Create a map of task ID to array index for stable secondary sorting
    const indexMap = new Map<string, number>();
    this.tasks.forEach((task, index) => {
      indexMap.set(task.id, index);
    });
    
    // Sort by displayOrder (lower = first), then by original array index for stable sort
    return children.sort((a, b) => {
      const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      // Fallback to original array index for stable, deterministic sort
      const indexA = indexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = indexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
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
   * @param isCollapsed - Function to check if task is collapsed
   * @returns Flat list of visible tasks sorted by displayOrder
   */
  getVisibleTasks(isCollapsed: (id: string) => boolean = () => false): Task[] {
    const result: Task[] = [];
    
    const addTask = (task: Task): void => {
      result.push(task);
      if (!isCollapsed(task.id) && this.isParent(task.id)) {
        // getChildren already sorts by displayOrder
        this.getChildren(task.id).forEach(child => addTask(child));
      }
    };

    // Create a map of task ID to array index for stable secondary sorting
    const indexMap = new Map<string, number>();
    this.tasks.forEach((task, index) => {
      indexMap.set(task.id, index);
    });

    // Get root tasks sorted by displayOrder
    const rootTasks = this.tasks.filter(t => !t.parentId).sort((a, b) => {
      const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      // Fallback to original array index for stable, deterministic sort
      const indexA = indexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = indexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });

    rootTasks.forEach(root => addTask(root));
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
