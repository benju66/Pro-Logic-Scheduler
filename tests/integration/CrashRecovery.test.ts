/**
 * @fileoverview Integration test for Crash Recovery
 * @module tests/integration/CrashRecovery-test
 * 
 * Verifies that no data is lost if the app crashes before a flush completes.
 * Tests the shutdown handler's flushNow() functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersistenceService } from '../../src/data/PersistenceService';
import { DataLoader } from '../../src/data/DataLoader';
import { TaskStore } from '../../src/data/TaskStore';
import type { Task } from '../../src/types';

// Mock Tauri SQL plugin at module level
vi.mock('tauri-plugin-sql-api', () => {
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

describe('Crash Recovery Tests', () => {
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let eventRows: Array<{ id: number; type: string; target_id: string | null; payload: string; timestamp: string }>;
  let taskRows: Array<Record<string, unknown>>;

  beforeEach(async () => {
    // Get the mocked database from the module
    const sqlModule = await import('tauri-plugin-sql-api');
    mockDb = (sqlModule as any).__mockDb;

    // Reset mocks and data
    vi.clearAllMocks();
    eventRows = [];
    taskRows = [];

    // Mock Tauri environment
    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn(() => 123 as any), // Don't auto-execute - simulate crash
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
      if (query.includes('INSERT INTO events')) {
        // Track events being inserted
        const eventId = eventRows.length + 1;
        const payload = bindings?.[2] ? JSON.stringify(bindings[2]) : '{}';
        eventRows.push({
          id: eventId,
          type: bindings?.[0] as string || '',
          target_id: bindings?.[1] as string | null || null,
          payload: payload,
          timestamp: new Date().toISOString(),
        });
        return { lastInsertId: eventId, rowsAffected: 1 };
      }
      if (query.includes('INSERT INTO tasks')) {
        // INSERT INTO tasks (id, parent_id, sort_key, name, duration, constraint_type, dependencies, is_collapsed)
        // VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        if (bindings && bindings.length >= 8) {
          const taskId = bindings[0] as string;
          const taskData: Record<string, unknown> = {
            id: taskId,
            parent_id: bindings[1] || null,
            sort_key: bindings[2] || '',
            name: bindings[3] || '',
            duration: bindings[4] !== undefined ? bindings[4] : 1,
            constraint_type: bindings[5] || 'asap',
            dependencies: bindings[6] ? (typeof bindings[6] === 'string' ? bindings[6] : JSON.stringify(bindings[6])) : '[]',
            is_collapsed: bindings[7] ? 1 : 0,
            notes: '',
            constraint_date: null,
            progress: 0,
            actual_start: null,
            actual_finish: null,
            remaining_duration: null,
            baseline_start: null,
            baseline_finish: null,
            baseline_duration: null,
          };
          
          const existingIndex = taskRows.findIndex(t => t.id === taskId);
          if (existingIndex >= 0) {
            taskRows[existingIndex] = taskData;
          } else {
            taskRows.push(taskData);
          }
        }
        return { lastInsertId: 1, rowsAffected: 1 };
      }
      if (query.includes('UPDATE tasks SET')) {
        // UPDATE tasks SET field = ? WHERE id = ?
        if (bindings && bindings.length >= 2) {
          const taskId = bindings[bindings.length - 1] as string;
          const existingIndex = taskRows.findIndex(t => t.id === taskId);
          if (existingIndex >= 0) {
            // Extract field name from query and update
            const fieldMatch = query.match(/SET\s+(\w+)\s*=/);
            if (fieldMatch) {
              const field = fieldMatch[1];
              const value = bindings[0];
              (taskRows[existingIndex] as any)[field] = value;
            }
          }
        }
        return { lastInsertId: 0, rowsAffected: 1 };
      }
      if (query.includes('DELETE FROM tasks')) {
        const taskId = bindings?.[0] as string;
        const index = taskRows.findIndex(t => t.id === taskId);
        if (index >= 0) {
          taskRows.splice(index, 1);
        }
        return { lastInsertId: 0, rowsAffected: 1 };
      }
      return { lastInsertId: 1, rowsAffected: 1 };
    });

    mockDb.select.mockImplementation(async (query: string) => {
      if (query.includes('SELECT * FROM events')) {
        return eventRows;
      }
      if (query.includes('SELECT * FROM tasks')) {
        return taskRows;
      }
      if (query.includes('SELECT * FROM snapshots')) {
        return []; // No snapshots for this test
      }
      if (query.includes('SELECT MAX(event_id)')) {
        return [{ 'MAX(event_id)': eventRows.length }];
      }
      return [];
    });
  });

  it('should recover data after crash - task persists after flushNow()', async () => {
    // Step 1: Initialize PersistenceService
    const persistenceService1 = new PersistenceService();
    await persistenceService1.init();

    // Step 2: Add a task (queues event but doesn't flush yet)
    const task: Task = {
      id: 'crash_test_task',
      name: 'Task Before Crash',
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

    // Queue the event (simulating TaskStore.add())
    persistenceService1.queueEvent('TASK_CREATED', task.id, {
      id: task.id,
      parent_id: task.parentId ?? null,
      sort_key: task.sortKey,
      name: task.name,
      duration: task.duration,
      constraint_type: task.constraintType || 'asap',
      dependencies: task.dependencies || [],
      is_collapsed: false,
    });

    // Verify event is queued but not yet flushed
    expect(eventRows.length).toBe(0); // No events in DB yet
    expect(taskRows.length).toBe(0); // No tasks in DB yet

    // Step 3: Simulate "Crash" - flush timer doesn't fire
    // (setInterval mock doesn't execute, so flush doesn't happen automatically)

    // Step 4: Manually call flushNow() (simulating shutdown handler)
    await persistenceService1.flushNow();

    // Verify data was flushed to database
    expect(eventRows.length).toBeGreaterThan(0);
    expect(taskRows.length).toBeGreaterThan(0);
    expect(taskRows.some(t => t.id === 'crash_test_task')).toBe(true);

    // Step 5: Re-initialize PersistenceService/DataLoader (simulating app restart)
    const dataLoader = new DataLoader();
    await dataLoader.init();

    // Step 6: Load data
    const { tasks } = await dataLoader.loadData();

    // Assert: The task exists in the loaded data
    expect(tasks.length).toBeGreaterThan(0);
    const recoveredTask = tasks.find(t => t.id === 'crash_test_task');
    expect(recoveredTask).toBeDefined();
    expect(recoveredTask!.name).toBe('Task Before Crash');
    expect(recoveredTask!.duration).toBe(5);
  });

  it('should recover multiple queued events after crash', async () => {
    // Initialize PersistenceService
    const persistenceService = new PersistenceService();
    await persistenceService.init();

    // Queue multiple events
    const tasks: Task[] = [
      {
        id: 'task_1',
        name: 'Task 1',
        parentId: null,
        sortKey: 'a0',
        duration: 3,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      },
      {
        id: 'task_2',
        name: 'Task 2',
        parentId: null,
        sortKey: 'a1',
        duration: 5,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      },
    ];

    // Queue events
    for (const task of tasks) {
      persistenceService.queueEvent('TASK_CREATED', task.id, {
        id: task.id,
        parent_id: task.parentId ?? null,
        sort_key: task.sortKey,
        name: task.name,
        duration: task.duration,
        constraint_type: task.constraintType || 'asap',
        dependencies: task.dependencies || [],
        is_collapsed: false,
      });
    }

    // Verify events are queued but not flushed
    expect(eventRows.length).toBe(0);
    expect(taskRows.length).toBe(0);

    // Simulate crash recovery - flushNow()
    await persistenceService.flushNow();

    // Verify all events were flushed
    expect(eventRows.length).toBe(2);
    expect(taskRows.length).toBe(2);

    // Re-initialize and load
    const dataLoader = new DataLoader();
    await dataLoader.init();
    const { tasks: loadedTasks } = await dataLoader.loadData();

    // Verify all tasks were recovered
    expect(loadedTasks.length).toBe(2);
    expect(loadedTasks.find(t => t.id === 'task_1')).toBeDefined();
    expect(loadedTasks.find(t => t.id === 'task_2')).toBeDefined();
  });

  it('should handle partial flush - some events persisted before crash', async () => {
    // Initialize PersistenceService with shorter flush interval for testing
    const persistenceService = new PersistenceService();
    await persistenceService.init();

    // Queue first event
    persistenceService.queueEvent('TASK_CREATED', 'task_1', {
      id: 'task_1',
      parent_id: null,
      sort_key: 'a0',
      name: 'Task 1',
      duration: 3,
      constraint_type: 'asap',
      dependencies: [],
      is_collapsed: false,
    });

    // Manually flush first event (simulating partial flush)
    await persistenceService.flushNow();

    // Verify first event was flushed
    expect(eventRows.length).toBe(1);
    expect(taskRows.length).toBe(1);

    // Queue second event (but don't flush - simulate crash)
    persistenceService.queueEvent('TASK_CREATED', 'task_2', {
      id: 'task_2',
      parent_id: null,
      sort_key: 'a1',
      name: 'Task 2',
      duration: 5,
      constraint_type: 'asap',
      dependencies: [],
      is_collapsed: false,
    });

    // Simulate crash recovery - flushNow() should flush remaining event
    await persistenceService.flushNow();

    // Verify both events are now persisted
    expect(eventRows.length).toBe(2);
    expect(taskRows.length).toBe(2);

    // Re-initialize and load
    const dataLoader = new DataLoader();
    await dataLoader.init();
    const { tasks: loadedTasks } = await dataLoader.loadData();

    // Verify both tasks were recovered
    expect(loadedTasks.length).toBe(2);
    expect(loadedTasks.find(t => t.id === 'task_1')).toBeDefined();
    expect(loadedTasks.find(t => t.id === 'task_2')).toBeDefined();
  });
});

