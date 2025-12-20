/**
 * @fileoverview Performance test for SQLite loading
 * @module tests/perf/LoadTest-test
 * 
 * Ensures the "Ferrari" engine still runs fast with SQLite.
 * Tests snapshot creation and loading performance with 10k tasks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersistenceService } from '../../src/data/PersistenceService';
import { SnapshotService } from '../../src/data/SnapshotService';
import { DataLoader } from '../../src/data/DataLoader';
import { TaskStore } from '../../src/data/TaskStore';
import type { Task, Calendar } from '../../src/types';
import { OrderingService } from '../../src/services/OrderingService';

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

describe('Load Performance Tests', () => {
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let snapshots: Array<{ id: number; tasks_json: string; calendar_json: string; event_id: number; created_at: string }>;
  let events: Array<{ id: number; type: string; target_id: string | null; payload: string; timestamp: string }>;
  let tasks: Array<Record<string, unknown>>;

  beforeEach(async () => {
    // Get the mocked database from the module
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;

    // Reset mocks and data
    vi.clearAllMocks();
    snapshots = [];
    events = [];
    tasks = [];

    // Mock Tauri environment
    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn(() => 123 as any),
      clearInterval: vi.fn(),
    };

    // Mock database operations
    mockDb.execute.mockImplementation(async (query: string, bindings?: unknown[]) => {
      if (query.includes('CREATE TABLE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      if (query.includes('CREATE INDEX')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      if (query.includes('INSERT OR IGNORE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      if (query.includes('INSERT INTO snapshots')) {
        const snapshotId = snapshots.length + 1;
        const tasksJson = bindings?.[0] as string || '[]';
        const calendarJson = bindings?.[1] as string || '{}';
        const eventId = bindings?.[2] as number || 0;
        snapshots.push({
          id: snapshotId,
          tasks_json: tasksJson,
          calendar_json: calendarJson,
          event_id: eventId,
          created_at: new Date().toISOString(),
        });
        return { lastInsertId: snapshotId, rowsAffected: 1 };
      }
      if (query.includes('INSERT INTO events')) {
        const eventId = events.length + 1;
        const payload = bindings?.[2] ? (typeof bindings[2] === 'string' ? bindings[2] : JSON.stringify(bindings[2])) : '{}';
        events.push({
          id: eventId,
          type: bindings?.[0] as string || '',
          target_id: bindings?.[1] as string | null || null,
          payload: payload,
          timestamp: bindings?.[3] ? (bindings[3] as string) : new Date().toISOString(),
        });
        return { lastInsertId: eventId, rowsAffected: 1 };
      }
      if (query.includes('INSERT INTO tasks') || query.includes('UPDATE tasks SET')) {
        if (bindings && bindings.length > 0) {
          const taskId = bindings[0] as string;
          const existingIndex = tasks.findIndex(t => t.id === taskId);
          const taskData: Record<string, unknown> = {
            id: taskId,
            parent_id: bindings[1] || null,
            sort_key: bindings[2] || '',
            name: bindings[3] || '',
            notes: bindings[4] || '',
            duration: bindings[5] || 1,
            constraint_type: bindings[6] || 'asap',
            constraint_date: bindings[7] || null,
            dependencies: bindings[8] ? JSON.stringify(bindings[8]) : '[]',
            progress: bindings[9] || 0,
            actual_start: bindings[10] || null,
            actual_finish: bindings[11] || null,
            remaining_duration: bindings[12] || null,
            baseline_start: bindings[13] || null,
            baseline_finish: bindings[14] || null,
            baseline_duration: bindings[15] || null,
            is_collapsed: bindings[16] ? 1 : 0,
          };
          
          if (existingIndex >= 0) {
            tasks[existingIndex] = taskData;
          } else {
            tasks.push(taskData);
          }
        }
        return { lastInsertId: 1, rowsAffected: 1 };
      }
      return { lastInsertId: 1, rowsAffected: 1 };
    });

    mockDb.select.mockImplementation(async (query: string) => {
      if (query.includes('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1') ||
          query.includes('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1')) {
        return snapshots.length > 0 ? [snapshots[snapshots.length - 1]] : [];
      }
      if (query.includes('SELECT event_id FROM snapshots ORDER BY id DESC LIMIT 1')) {
        return snapshots.length > 0 ? [{ event_id: snapshots[snapshots.length - 1].event_id }] : [];
      }
      if (query.includes('SELECT * FROM events WHERE id >')) {
        // Return events after snapshot
        const snapshotEventId = snapshots.length > 0 ? snapshots[snapshots.length - 1].event_id : 0;
        const filteredEvents = events.filter(e => e.id > snapshotEventId);
        // Map to EventRow format expected by DataLoader
        return filteredEvents.map(e => ({
          id: e.id,
          event_type: e.type,
          target_id: e.target_id,
          payload: e.payload,
          timestamp: e.timestamp,
          user_id: null,
          session_id: null,
        }));
      }
      if (query.includes('SELECT * FROM tasks')) {
        return tasks;
      }
      if (query.includes('SELECT MAX(id) as max_id FROM events')) {
        return [{ max_id: events.length > 0 ? events[events.length - 1].id : 0 }];
      }
      if (query.includes('SELECT MAX(event_id)') || query.includes('SELECT MAX(id)')) {
        return [{ 'MAX(event_id)': events.length, 'MAX(id)': events.length > 0 ? events[events.length - 1].id : 0 }];
      }
      return [];
    });
  });

  /**
   * Generate 10,000 tasks for performance testing
   */
  function generateTasks(count: number): Task[] {
    const taskList: Task[] = [];
    let lastSortKey: string | null = null;
    const parentSortKeys: Record<string, string> = {}; // Track sort keys for parents

    for (let i = 0; i < count; i++) {
      const parentId = i > 0 && i % 10 === 0 ? `task_${i - 10}` : null;
      let sortKey: string;
      
      if (parentId) {
        // Child task - use parent's sort key as base
        const parentSortKey = parentSortKeys[parentId] || lastSortKey;
        sortKey = OrderingService.generateAppendKey(parentSortKey);
      } else {
        // Root task
        sortKey = OrderingService.generateAppendKey(lastSortKey);
        lastSortKey = sortKey;
      }
      
      // Store sort key for this task (for future children)
      parentSortKeys[`task_${i}`] = sortKey;

      const task: Task = {
        id: `task_${i}`,
        name: `Task ${i}`,
        parentId: parentId,
        sortKey: sortKey,
        duration: Math.floor(Math.random() * 10) + 1,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: i > 0 && i % 5 === 0 ? [{ id: `task_${i - 5}`, type: 'FS', lag: 0 }] : [],
        progress: Math.random() > 0.5 ? Math.floor(Math.random() * 100) : 0,
        notes: `Notes for task ${i}`,
        level: 0,
        start: '',
        end: '',
      };
      taskList.push(task);
    }

    return taskList;
  }

  it('should load 10k tasks in under 2 seconds', async () => {
    // Generate 10,000 tasks
    const taskList = generateTasks(10000);
    const calendar: Calendar = {
      workingDays: [1, 2, 3, 4, 5],
      exceptions: {},
    };

    // Initialize services
    const persistenceService = new PersistenceService();
    await persistenceService.init();

    // Create a dummy event so snapshot service knows there are events
    persistenceService.queueEvent('PROJECT_IMPORTED', null, {});
    await persistenceService.flushNow();

    const snapshotService = new SnapshotService();
    await snapshotService.init();

    // Measure snapshot creation time
    const snapshotStart = performance.now();
    await snapshotService.createSnapshot(taskList, calendar);
    const snapshotTime = performance.now() - snapshotStart;

    console.log(`[LoadTest] Snapshot creation: ${snapshotTime.toFixed(2)}ms`);

    // Verify snapshot was created
    expect(snapshots.length).toBe(1);
    const snapshotData = JSON.parse(snapshots[0].tasks_json);
    expect(snapshotData.length).toBe(10000);

    // Initialize DataLoader
    const dataLoader = new DataLoader();
    await dataLoader.init();

    // Measure loading time (snapshot parsing + event replay)
    const loadStart = performance.now();
    const { tasks: loadedTasks, calendar: loadedCalendar } = await dataLoader.loadData();
    const loadTime = performance.now() - loadStart;

    console.log(`[LoadTest] Data loading: ${loadTime.toFixed(2)}ms`);
    console.log(`[LoadTest] Loaded ${loadedTasks.length} tasks`);

    // Assert: Loading 10k tasks takes < 2 seconds
    expect(loadTime).toBeLessThan(2000);

    // Verify data integrity
    expect(loadedTasks.length).toBe(10000);
    expect(loadedTasks[0].id).toBe('task_0');
    expect(loadedTasks[9999].id).toBe('task_9999');
    expect(loadedCalendar.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle snapshot + event replay efficiently', async () => {
    // Generate 10,000 tasks
    const taskList = generateTasks(10000);
    const calendar: Calendar = {
      workingDays: [1, 2, 3, 4, 5],
      exceptions: {},
    };

    // Initialize services
    const persistenceService = new PersistenceService();
    await persistenceService.init();

    // Create a dummy event so snapshot service knows there are events
    persistenceService.queueEvent('PROJECT_IMPORTED', null, {});
    await persistenceService.flushNow();

    const snapshotService = new SnapshotService();
    await snapshotService.init();

    // Create snapshot
    await snapshotService.createSnapshot(taskList, calendar);

    // Add some events after snapshot (simulating recent changes)
    for (let i = 0; i < 50; i++) {
      persistenceService.queueEvent('TASK_UPDATED', `task_${i}`, {
        field: 'name',
        old_value: `Task ${i}`,
        new_value: `Updated Task ${i}`,
      });
    }

    // Flush events
    await persistenceService.flushNow();

    // Initialize DataLoader
    const dataLoader = new DataLoader();
    await dataLoader.init();

    // Measure loading time (should load snapshot + replay 50 events)
    const loadStart = performance.now();
    const { tasks: loadedTasks } = await dataLoader.loadData();
    const loadTime = performance.now() - loadStart;

    console.log(`[LoadTest] Snapshot + 50 events replay: ${loadTime.toFixed(2)}ms`);

    // Assert: Still under 2 seconds even with event replay
    expect(loadTime).toBeLessThan(2000);

    // Verify events were applied
    expect(loadedTasks.length).toBe(10000);
    expect(loadedTasks[0].name).toBe('Updated Task 0');
    expect(loadedTasks[49].name).toBe('Updated Task 49');
    expect(loadedTasks[50].name).toBe('Task 50'); // Unchanged
  });

  it('should create snapshot efficiently for 10k tasks', async () => {
    // Generate 10,000 tasks
    const taskList = generateTasks(10000);
    const calendar: Calendar = {
      workingDays: [1, 2, 3, 4, 5],
      exceptions: {},
    };

    // Initialize persistence service first (needed for events)
    const persistenceService = new PersistenceService();
    await persistenceService.init();
    
    // Create a dummy event so snapshot service knows there are events
    persistenceService.queueEvent('PROJECT_IMPORTED', null, {});
    await persistenceService.flushNow();

    // Initialize snapshot service
    const snapshotService = new SnapshotService();
    await snapshotService.init();

    // Measure snapshot creation time
    const snapshotStart = performance.now();
    await snapshotService.createSnapshot(taskList, calendar);
    const snapshotTime = performance.now() - snapshotStart;

    console.log(`[LoadTest] Snapshot creation for 10k tasks: ${snapshotTime.toFixed(2)}ms`);

    // Assert: Snapshot creation should be reasonable (< 1 second)
    expect(snapshotTime).toBeLessThan(1000);

    // Verify snapshot was created correctly
    expect(snapshots.length).toBe(1);
    const snapshotData = JSON.parse(snapshots[0].tasks_json);
    expect(snapshotData.length).toBe(10000);
  });
});

