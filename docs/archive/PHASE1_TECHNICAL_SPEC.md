# Phase 1 Technical Specification
## Critical Fixes - Detailed Implementation Guide

**Phase:** 1 - Critical Fixes  
**Duration:** 3 weeks  
**Priority:** 🔴 CRITICAL  
**Status:** Planning

---

## Overview

Phase 1 addresses the most critical issues that prevent production deployment:
1. Race conditions in task operations
2. Data integrity vulnerabilities
3. Unreliable task ordering
4. Duplicate operations causing performance issues

This document provides detailed technical specifications for each fix.

---

## 1. Operation Queue & Mutex Pattern

### 1.1 Problem Statement

**Current Issue:**
```typescript
// VULNERABLE CODE
addTask() {
  const tasks = this.taskStore.getAll();  // Race condition here
  tasks.splice(tasks.length, 0, newTask);  // Concurrent modification
  this.taskStore.setAll(tasks);            // Overwrites concurrent changes
}
```

**Scenario:**
- User clicks "Add Task" rapidly 10 times
- All 10 calls read `tasks` array simultaneously (length = 100)
- All 10 insert at index 100
- Only 1 task survives, 9 are lost

### 1.2 Solution Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Action                          │
│              (Click "Add Task" button)                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              OperationQueue.enqueue()                    │
│  • Serializes operations                                │
│  • Returns Promise                                       │
│  • Handles errors                                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            OperationLock.acquire()                      │
│  • Mutex lock                                           │
│  • Prevents concurrent execution                        │
│  • Timeout protection                                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            TaskStore.addTask()                          │
│  • Atomic operation                                     │
│  • Immutable update                                    │
│  • State version increment                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            OperationLock.release()                      │
│  • Unlock mutex                                         │
│  • Process next operation                              │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Implementation Details

#### 1.3.1 OperationQueue Class

**File:** `src/data/OperationQueue.ts`

```typescript
/**
 * @fileoverview Operation Queue - Serializes operations to prevent race conditions
 * @module data/OperationQueue
 */

export interface QueuedOperation<T = void> {
  id: string;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout: number;
}

export class OperationQueue {
  private queue: QueuedOperation[] = [];
  private processing: boolean = false;
  private defaultTimeout: number = 5000; // 5 seconds

  /**
   * Enqueue an operation for serialized execution
   * @param operation - Async operation to execute
   * @param timeout - Operation timeout in ms
   * @returns Promise that resolves when operation completes
   */
  async enqueue<T>(
    operation: () => Promise<T>,
    timeout: number = this.defaultTimeout
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedOp: QueuedOperation<T> = {
        id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        operation,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout,
      };

      this.queue.push(queuedOp);
      this._processQueue();
    });
  }

  /**
   * Process the queue serially
   * @private
   */
  private async _processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const op = this.queue.shift()!;
      
      // Check timeout
      const elapsed = Date.now() - op.timestamp;
      if (elapsed > op.timeout) {
        op.reject(new Error(`Operation ${op.id} timed out after ${op.timeout}ms`));
        continue;
      }

      try {
        const result = await op.operation();
        op.resolve(result);
      } catch (error) {
        op.reject(error as Error);
      }
    }

    this.processing = false;
  }

  /**
   * Get queue status
   */
  getStatus(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Clear the queue (emergency use only)
   */
  clear(): void {
    this.queue.forEach(op => {
      op.reject(new Error('Operation queue cleared'));
    });
    this.queue = [];
    this.processing = false;
  }
}
```

#### 1.3.2 OperationLock Class

**File:** `src/core/OperationLock.ts`

```typescript
/**
 * @fileoverview Operation Lock - Mutex for critical sections
 * @module core/OperationLock
 */

export class OperationLock {
  private locked: boolean = false;
  private lockQueue: Array<() => void> = [];
  private lockTimeout: number = 10000; // 10 seconds

  /**
   * Acquire lock (wait if already locked)
   * @param timeout - Maximum wait time in ms
   * @returns Promise that resolves when lock acquired
   */
  async acquire(timeout: number = this.lockTimeout): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.lockQueue.indexOf(resolve);
        if (index !== -1) {
          this.lockQueue.splice(index, 1);
          reject(new Error('Lock acquisition timeout'));
        }
      }, timeout);

      this.lockQueue.push(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  /**
   * Release lock and process next waiter
   */
  release(): void {
    if (!this.locked) {
      console.warn('[OperationLock] Attempted to release unlocked lock');
      return;
    }

    this.locked = false;

    if (this.lockQueue.length > 0) {
      const next = this.lockQueue.shift()!;
      this.locked = true;
      next();
    }
  }

  /**
   * Check if lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Execute operation with automatic lock management
   * @param operation - Operation to execute
   * @returns Promise with operation result
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
}
```

#### 1.3.3 Integration with TaskStore

**File:** `src/data/TaskStore.ts` (updates)

```typescript
import { OperationQueue } from './OperationQueue';
import { OperationLock } from '../core/OperationLock';

export class TaskStore {
  private tasks: Task[] = [];
  private options: TaskStoreOptions;
  private operationQueue: OperationQueue;
  private operationLock: OperationLock;
  private version: number = 0; // State versioning

  constructor(options: TaskStoreOptions = {}) {
    this.options = options;
    this.operationQueue = new OperationQueue();
    this.operationLock = new OperationLock();
  }

  /**
   * Get all tasks (returns defensive copy)
   * @returns Copy of all tasks
   */
  getAll(): Task[] {
    return [...this.tasks]; // Defensive copy
  }

  /**
   * Add a new task (queued and locked)
   * @param task - Task object
   * @returns Promise that resolves with added task
   */
  async add(task: Task): Promise<Task> {
    return this.operationQueue.enqueue(async () => {
      return this.operationLock.execute(async () => {
        // Validate task
        this._validateTask(task);

        // Check for duplicate ID
        if (this.tasks.some(t => t.id === task.id)) {
          throw new Error(`Task with ID ${task.id} already exists`);
        }

        // Add task
        this.tasks = [...this.tasks, task]; // Immutable update
        this.version++;
        this._notifyChange();
        return task;
      });
    });
  }

  /**
   * Set all tasks (queued and locked)
   * @param tasks - New tasks array
   */
  async setAll(tasks: Task[]): Promise<void> {
    return this.operationQueue.enqueue(async () => {
      return this.operationLock.execute(async () => {
        // Validate all tasks
        tasks.forEach(task => this._validateTask(task));

        // Check for duplicate IDs
        const ids = new Set(tasks.map(t => t.id));
        if (ids.size !== tasks.length) {
          throw new Error('Duplicate task IDs detected');
        }

        // Update tasks
        this.tasks = [...tasks]; // Immutable update
        this.version++;
        this._notifyChange();
      });
    });
  }

  /**
   * Validate task data
   * @private
   */
  private _validateTask(task: Task): void {
    if (!task.id) {
      throw new Error('Task must have an ID');
    }
    if (!task.name) {
      throw new Error('Task must have a name');
    }
    if (task.duration < 1) {
      throw new Error('Task duration must be at least 1 day');
    }
    // Add more validation as needed
  }

  /**
   * Get current state version
   */
  getVersion(): number {
    return this.version;
  }
}
```

#### 1.3.4 Integration with SchedulerService

**File:** `src/services/SchedulerService.ts` (updates)

```typescript
async addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
  // Guard: Don't allow task creation during initialization
  if (!this.isInitialized) {
    console.log('[SchedulerService] ⚠️ addTask() blocked - not initialized');
    return;
  }

  try {
    this.saveCheckpoint();
    
    const today = DateUtils.today();
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: taskData.name || 'New Task',
      start: taskData.start || today,
      end: taskData.end || today,
      duration: taskData.duration || 1,
      parentId: taskData.parentId || null,
      dependencies: taskData.dependencies || [],
      progress: taskData.progress || 0,
      constraintType: taskData.constraintType || 'asap',
      constraintDate: taskData.constraintDate || null,
      notes: taskData.notes || '',
      level: taskData.level || 0,
      _collapsed: false,
      displayOrder: 0, // Will be set by store
      // ... other fields
    } as Task;

    // Preserve parentId inheritance logic if focused task exists
    if (this.focusedId) {
      const focusedTask = await this.taskStore.getById(this.focusedId);
      if (focusedTask) {
        task.parentId = taskData.parentId ?? focusedTask.parentId ?? null;
      }
    } else {
      task.parentId = taskData.parentId ?? null;
    }

    // Calculate displayOrder (always append to bottom)
    const allTasks = this.taskStore.getAll();
    const maxOrder = allTasks.length > 0 
      ? Math.max(...allTasks.map(t => t.displayOrder ?? 0))
      : -1;
    task.displayOrder = maxOrder + 1;

    // Use async add method (queued and locked)
    const addedTask = await this.taskStore.add(task);
    
    // Note: recalculateAll() and render() will be triggered by onChange callback
    // No need to call them manually here
    
    // Select and focus the new task
    this.selectedIds.clear();
    this.selectedIds.add(addedTask.id);
    this.focusedId = addedTask.id;
    this._updateSelection();
    
    // Scroll to new task (after render completes)
    this._scrollToTaskAndFocus(addedTask.id);
    
    this.toastService.success('Task added');
    return addedTask;
  } catch (error) {
    const err = error as Error;
    console.error('[SchedulerService] Error adding task:', err);
    this.toastService.error('Failed to add task: ' + err.message);
    throw error;
  }
}
```

### 1.4 Testing Requirements

#### 1.4.1 Unit Tests

**File:** `tests/unit/OperationQueue.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { OperationQueue } from '../../src/data/OperationQueue';

describe('OperationQueue', () => {
  let queue: OperationQueue;

  beforeEach(() => {
    queue = new OperationQueue();
  });

  it('should execute operations serially', async () => {
    const results: number[] = [];
    
    // Enqueue 10 operations
    const promises = Array.from({ length: 10 }, (_, i) =>
      queue.enqueue(async () => {
        results.push(i);
        await new Promise(resolve => setTimeout(resolve, 10));
        return i;
      })
    );

    await Promise.all(promises);

    // Results should be in order
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('should handle operation errors', async () => {
    await expect(
      queue.enqueue(async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');
  });

  it('should timeout long-running operations', async () => {
    await expect(
      queue.enqueue(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
        },
        100 // 100ms timeout
      )
    ).rejects.toThrow('timed out');
  });
});
```

**File:** `tests/unit/OperationLock.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { OperationLock } from '../../src/core/OperationLock';

describe('OperationLock', () => {
  let lock: OperationLock;

  beforeEach(() => {
    lock = new OperationLock();
  });

  it('should prevent concurrent execution', async () => {
    let executionOrder: number[] = [];
    
    const op1 = lock.execute(async () => {
      executionOrder.push(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      executionOrder.push(1);
    });

    const op2 = lock.execute(async () => {
      executionOrder.push(2);
      await new Promise(resolve => setTimeout(resolve, 10));
      executionOrder.push(2);
    });

    await Promise.all([op1, op2]);

    // Operations should not interleave
    expect(executionOrder).toEqual([1, 1, 2, 2]);
  });
});
```

#### 1.4.2 Integration Tests

**File:** `tests/integration/TaskStoreConcurrency.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import type { Task } from '../../src/types';

describe('TaskStore Concurrency', () => {
  it('should handle 1000 rapid addTask calls', async () => {
    const store = new TaskStore();
    
    // Create 1000 tasks simultaneously
    const promises = Array.from({ length: 1000 }, (_, i) => {
      const task: Task = {
        id: `task_${i}`,
        name: `Task ${i}`,
        start: '2024-01-01',
        end: '2024-01-02',
        duration: 1,
        parentId: null,
        dependencies: [],
        progress: 0,
        constraintType: 'asap',
        constraintDate: null,
        notes: '',
        level: 0,
        displayOrder: i,
      };
      return store.add(task);
    });

    await Promise.all(promises);

    const allTasks = store.getAll();
    expect(allTasks.length).toBe(1000);
    
    // Verify all tasks exist
    const ids = new Set(allTasks.map(t => t.id));
    expect(ids.size).toBe(1000);
  });
});
```

---

## 2. Immutable State Pattern

### 2.1 Problem Statement

**Current Issue:**
```typescript
// VULNERABLE CODE
getAll(): Task[] {
  return this.tasks; // Returns reference - can be mutated externally
}

// External code can do:
const tasks = store.getAll();
tasks.push(maliciousTask); // Mutates internal state!
```

### 2.2 Solution

**Updated Code:**
```typescript
getAll(): Task[] {
  return [...this.tasks]; // Defensive copy - immutable
}

// All mutations use immutable patterns:
setAll(tasks: Task[]): void {
  this.tasks = [...tasks]; // Create new array
  this._notifyChange();
}

add(task: Task): void {
  this.tasks = [...this.tasks, task]; // Immutable append
  this._notifyChange();
}
```

### 2.3 Migration Guide

**Before:**
```typescript
const tasks = store.getAll();
tasks.splice(index, 0, newTask);
store.setAll(tasks);
```

**After:**
```typescript
const tasks = store.getAll();
const newTasks = [
  ...tasks.slice(0, index),
  newTask,
  ...tasks.slice(index)
];
await store.setAll(newTasks);
```

---

## 3. Explicit Ordering Guarantee

### 3.1 Problem Statement

**Current Issue:**
- Display order depends on array order
- Array order can change unpredictably
- No guarantee new tasks appear at bottom

### 3.2 Solution

**Add displayOrder field:**
```typescript
interface Task {
  // ... existing fields
  displayOrder: number; // Explicit ordering field
}
```

**Update getVisibleTasks:**
```typescript
getVisibleTasks(isCollapsed: (id: string) => boolean = () => false): Task[] {
  const result: Task[] = [];
  
  const addTask = (task: Task): void => {
    result.push(task);
    if (!isCollapsed(task.id) && this.isParent(task.id)) {
      // Sort children by displayOrder
      const children = this.getChildren(task.id)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      children.forEach(child => addTask(child));
    }
  };

  // Sort root tasks by displayOrder
  const rootTasks = this.tasks
    .filter(t => !t.parentId)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  
  rootTasks.forEach(root => addTask(root));
  return result;
}
```

**Update addTask:**
```typescript
async add(task: Task): Promise<Task> {
  return this.operationQueue.enqueue(async () => {
    return this.operationLock.execute(async () => {
      // Calculate displayOrder (always append to bottom)
      const allTasks = this.getAll();
      const maxOrder = allTasks.length > 0
        ? Math.max(...allTasks.map(t => t.displayOrder ?? 0))
        : -1;
      
      task.displayOrder = maxOrder + 1;
      
      // Add task
      this.tasks = [...this.tasks, task];
      this.version++;
      this._notifyChange();
      return task;
    });
  });
}
```

### 3.3 Migration Script

**File:** `src/data/migrations/addDisplayOrder.ts`

```typescript
/**
 * Migration: Add displayOrder to existing tasks
 */
export function migrateAddDisplayOrder(tasks: Task[]): Task[] {
  return tasks.map((task, index) => ({
    ...task,
    displayOrder: task.displayOrder ?? index,
  }));
}
```

---

## 4. Remove Duplicate Operations

### 4.1 Problem Statement

**Current Issue:**
```typescript
// setAll() triggers onChange
this.taskStore.setAll(tasks);  // → _onTasksChanged() → recalculateAll() + render()

// But addTask() ALSO calls them
this.recalculateAll();  // DUPLICATE!
this.render();          // DUPLICATE!
```

### 4.2 Solution

**Refactor _onTasksChanged:**
```typescript
private _onTasksChanged(): void {
  // Prevent recursion
  if (this._isRecalculating) {
    return;
  }
  
  // Batch recalculation
  if (this._recalcScheduled) {
    return; // Already scheduled
  }
  
  this._recalcScheduled = true;
  requestAnimationFrame(() => {
    this._recalcScheduled = false;
    this.recalculateAll();
    this.render();
  });
}
```

**Remove duplicate calls:**
```typescript
async addTask(): Promise<Task> {
  // ... create task ...
  
  await this.taskStore.add(task);
  
  // REMOVED: this.recalculateAll(); // Handled by onChange
  // REMOVED: this.render();          // Handled by onChange
  
  // Only update selection and scroll
  this.selectedIds.clear();
  this.selectedIds.add(task.id);
  this._updateSelection();
  this._scrollToTaskAndFocus(task.id);
}
```

---

## Implementation Checklist

### Week 1: Core Infrastructure
- [ ] Create `OperationQueue` class
- [ ] Create `OperationLock` class
- [ ] Write unit tests for queue and lock
- [ ] Integrate with `TaskStore`
- [ ] Update `TaskStore.getAll()` to return copies
- [ ] Add state versioning

### Week 2: Task Operations
- [ ] Refactor `TaskStore.add()` to use queue
- [ ] Refactor `TaskStore.setAll()` to use queue
- [ ] Add `displayOrder` field to `Task` interface
- [ ] Update `getVisibleTasks()` to sort by `displayOrder`
- [ ] Update `addTask()` to set `displayOrder`
- [ ] Create migration script for existing data
- [ ] Write integration tests

### Week 3: Cleanup & Optimization
- [ ] Remove duplicate `recalculateAll()` calls
- [ ] Remove duplicate `render()` calls
- [ ] Add render batching
- [ ] Update all mutation points to use immutable patterns
- [ ] Performance testing
- [ ] Documentation
- [ ] Code review

---

## Success Criteria

### Functional Requirements
- ✅ 1000 rapid clicks = 1000 tasks added correctly
- ✅ No lost tasks under any scenario
- ✅ New tasks always appear at bottom
- ✅ Order preserved across all operations
- ✅ No duplicate recalculations/renders

### Performance Requirements
- ✅ Operations complete in < 100ms
- ✅ Queue processing overhead < 5ms
- ✅ Memory overhead < 10%
- ✅ No performance degradation

### Quality Requirements
- ✅ 100% test coverage for new code
- ✅ All existing tests pass
- ✅ No breaking changes to public API
- ✅ Comprehensive documentation

---

## Risk Mitigation

### Risk: Breaking Changes
**Mitigation:** Maintain backward compatibility, use feature flags

### Risk: Performance Impact
**Mitigation:** Profiling, performance budgets, optimization

### Risk: Timeline Slippage
**Mitigation:** Phased approach, prioritize critical fixes

---

## Next Steps

1. **Review & Approval**
   - Technical review
   - Architecture review
   - Approval to proceed

2. **Implementation**
   - Set up development branch
   - Begin Week 1 tasks
   - Daily standups

3. **Testing**
   - Continuous testing
   - Integration testing
   - Performance testing

4. **Deployment**
   - Code review
   - QA testing
   - Phased rollout

---

**Document Status:** Ready for Implementation  
**Last Updated:** 2024  
**Next Review:** After Week 1 completion

