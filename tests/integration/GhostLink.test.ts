/**
 * @fileoverview Integration test for Ghost Link Cleanup
 * @module tests/integration/GhostLink-test
 * 
 * Tests that deleting a task properly cleans up dependencies in other tasks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { PersistenceService } from '../../src/data/PersistenceService';
import type { Task } from '../../src/types';

// Mock Tauri SQL plugin at module level
vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    execute: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
  };
  const mockDatabaseLoad = vi.fn().mockResolvedValue(mockDb);
  return {
    default: {
      load: mockDatabaseLoad,
    },
    __mockDb: mockDb, // Export for test access
  };
});

describe('Ghost Link Cleanup Tests', () => {
  let taskStore: TaskStore;
  let persistenceService: PersistenceService;
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let queuedEvents: Array<{ type: string; targetId: string | null; payload: Record<string, unknown> }>;

  beforeEach(async () => {
    // Get the mocked database from the module
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;

    // Reset mocks
    vi.clearAllMocks();
    mockDb.execute.mockReset();
    mockDb.select.mockReset();
    mockDb.close.mockReset();
    mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });

    // Track queued events
    queuedEvents = [];

    // Mock Tauri environment
    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setTimeout(() => fn(), ms);
        return 123 as any;
      }),
      clearInterval: vi.fn(),
    };

    // Initialize persistence service
    mockDb.execute.mockImplementation(async (query: string) => {
      if (query.includes('CREATE TABLE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      if (query.includes('CREATE INDEX')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      if (query.includes('INSERT OR IGNORE')) {
        return { lastInsertId: 1, rowsAffected: 1 };
      }
      return { lastInsertId: 1, rowsAffected: 1 };
    });

    persistenceService = new PersistenceService();
    await persistenceService.init();
    
    // Override queueEvent to track events
    const originalQueueEvent = persistenceService.queueEvent.bind(persistenceService);
    persistenceService.queueEvent = (type: string, targetId: string | null, payload: Record<string, unknown>) => {
      queuedEvents.push({ type, targetId, payload });
      return originalQueueEvent(type, targetId, payload);
    };

    // Clear mock calls from initialization
    mockDb.execute.mockClear();
    queuedEvents = [];

    // Create task store and inject persistence
    taskStore = new TaskStore();
    taskStore.setPersistenceService(persistenceService);
  });

  it('should clean up ghost links when deleting a task', () => {
    // Create Task A
    const taskA: Task = {
      id: 'task_a',
      name: 'Task A',
      parentId: null,
      sortKey: 'a0',
      duration: 5,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Create Task B that depends on Task A
    const taskB: Task = {
      id: 'task_b',
      name: 'Task B',
      parentId: null,
      sortKey: 'a1',
      duration: 3,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [
        { id: 'task_a', type: 'FS', lag: 0 }
      ],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Add both tasks
    taskStore.add(taskA);
    taskStore.add(taskB);

    // Clear events from add operations
    queuedEvents = [];

    // Delete Task A
    const deleted = taskStore.delete('task_a');

    // Verify deletion succeeded
    expect(deleted).toBe(true);
    expect(taskStore.getById('task_a')).toBeUndefined();

    // Verify Task B's dependency list is now empty
    const taskBAfter = taskStore.getById('task_b');
    expect(taskBAfter).toBeDefined();
    expect(taskBAfter!.dependencies).toEqual([]);

    // Verify events were queued correctly
    // Should have:
    // 1. TASK_UPDATED for Task B (removing dependency)
    // 2. TASK_DELETED for Task A
    
    const taskBUpdateEvents = queuedEvents.filter(e => 
      e.type === 'TASK_UPDATED' && e.targetId === 'task_b'
    );
    expect(taskBUpdateEvents.length).toBe(1);
    
    const taskBUpdateEvent = taskBUpdateEvents[0];
    expect(taskBUpdateEvent.payload.field).toBe('dependencies');
    expect(taskBUpdateEvent.payload.old_value).toEqual([{ id: 'task_a', type: 'FS', lag: 0 }]);
    expect(taskBUpdateEvent.payload.new_value).toEqual([]);

    const taskADeleteEvents = queuedEvents.filter(e => 
      e.type === 'TASK_DELETED' && e.targetId === 'task_a'
    );
    expect(taskADeleteEvents.length).toBe(1);
  });

  it('should handle multiple tasks depending on the deleted task', () => {
    // Create Task A
    const taskA: Task = {
      id: 'task_a',
      name: 'Task A',
      parentId: null,
      sortKey: 'a0',
      duration: 5,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Create Task B that depends on Task A
    const taskB: Task = {
      id: 'task_b',
      name: 'Task B',
      parentId: null,
      sortKey: 'a1',
      duration: 3,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [
        { id: 'task_a', type: 'FS', lag: 0 }
      ],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Create Task C that also depends on Task A
    const taskC: Task = {
      id: 'task_c',
      name: 'Task C',
      parentId: null,
      sortKey: 'a2',
      duration: 2,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [
        { id: 'task_a', type: 'SS', lag: 1 }
      ],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Add all tasks
    taskStore.add(taskA);
    taskStore.add(taskB);
    taskStore.add(taskC);

    // Clear events from add operations
    queuedEvents = [];

    // Delete Task A
    taskStore.delete('task_a');

    // Verify both Task B and Task C have empty dependencies
    const taskBAfter = taskStore.getById('task_b');
    const taskCAfter = taskStore.getById('task_c');
    
    expect(taskBAfter!.dependencies).toEqual([]);
    expect(taskCAfter!.dependencies).toEqual([]);

    // Verify TASK_UPDATED events were queued for both B and C
    const updateEvents = queuedEvents.filter(e => e.type === 'TASK_UPDATED');
    expect(updateEvents.length).toBe(2);
    
    const taskBUpdate = updateEvents.find(e => e.targetId === 'task_b');
    const taskCUpdate = updateEvents.find(e => e.targetId === 'task_c');
    
    expect(taskBUpdate).toBeDefined();
    expect(taskCUpdate).toBeDefined();
    expect(taskBUpdate!.payload.new_value).toEqual([]);
    expect(taskCUpdate!.payload.new_value).toEqual([]);
  });

  it('should handle tasks with multiple dependencies correctly', () => {
    // Create Task A
    const taskA: Task = {
      id: 'task_a',
      name: 'Task A',
      parentId: null,
      sortKey: 'a0',
      duration: 5,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Create Task B that depends on Task A and another task
    const taskB: Task = {
      id: 'task_b',
      name: 'Task B',
      parentId: null,
      sortKey: 'a1',
      duration: 3,
      constraintType: 'asap',
      constraintDate: null,
      dependencies: [
        { id: 'task_a', type: 'FS', lag: 0 },
        { id: 'other_task', type: 'FS', lag: 0 }
      ],
      progress: 0,
      notes: '',
      level: 0,
      start: '',
      end: '',
    };

    // Add tasks
    taskStore.add(taskA);
    taskStore.add(taskB);

    // Clear events from add operations
    queuedEvents = [];

    // Delete Task A
    taskStore.delete('task_a');

    // Verify Task B still has the other dependency
    const taskBAfter = taskStore.getById('task_b');
    expect(taskBAfter!.dependencies).toEqual([
      { id: 'other_task', type: 'FS', lag: 0 }
    ]);

    // Verify TASK_UPDATED event was queued with correct payload
    const updateEvent = queuedEvents.find(e => 
      e.type === 'TASK_UPDATED' && e.targetId === 'task_b'
    );
    
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.payload.field).toBe('dependencies');
    expect(updateEvent!.payload.old_value).toEqual([
      { id: 'task_a', type: 'FS', lag: 0 },
      { id: 'other_task', type: 'FS', lag: 0 }
    ]);
    expect(updateEvent!.payload.new_value).toEqual([
      { id: 'other_task', type: 'FS', lag: 0 }
    ]);
  });
});

