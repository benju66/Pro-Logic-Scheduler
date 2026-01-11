/**
 * @fileoverview Type Safety Round-Trip Tests - Persistence Layer
 * @module tests/integration/TypeSafetyRoundTrip
 * 
 * PHASE 3.1: Verifies all Task fields survive the SQLite persistence cycle:
 * Task → Event Payload → SQLite → Hydrated Task
 * 
 * These tests ensure type safety and data integrity across the
 * serialization boundary between TypeScript and SQLite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Task, Dependency } from '../../src/types';
import {
  createCompleteTask,
  createRoundTripTestTasks,
  taskToEventPayload,
  rowToTask,
  assertTaskInputFieldsEqual,
  assertDependenciesEqual,
} from '../helpers/taskAssertions';

// Mock Tauri SQL plugin - must be hoisted
vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    execute: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
  };
  return {
    default: {
      load: vi.fn().mockResolvedValue(mockDb),
    },
    __mockDb: mockDb,
  };
});

import { PersistenceService } from '../../src/data/PersistenceService';

describe('Phase 3.1: Persistence Round-Trip Type Safety', () => {
  let persistenceService: PersistenceService;
  let capturedRows: Map<string, Record<string, unknown>>;
  let originalWindow: typeof window;
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Get mock from module
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;
    
    vi.clearAllMocks();
    capturedRows = new Map();

    // Mock Tauri environment
    originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        // Store callback but don't auto-execute
        return 123 as any;
      }),
      clearInterval: vi.fn(),
    };

    // Mock database operations - capture INSERT data
    mockDb.execute.mockImplementation(async (query: string, bindings?: unknown[]) => {
      // Handle schema creation
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX') || 
          query.includes('INSERT OR IGNORE') || query.includes('PRAGMA') ||
          query.includes('ALTER TABLE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      
      // Handle transaction
      if (query.includes('BEGIN') || query.includes('COMMIT') || query.includes('ROLLBACK')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }

      // Capture INSERT INTO events
      if (query.includes('INSERT INTO events')) {
        return { lastInsertId: 1, rowsAffected: 1 };
      }

      // Capture INSERT OR REPLACE INTO tasks - this is the key!
      if (query.includes('INSERT OR REPLACE INTO tasks') && bindings) {
        const row: Record<string, unknown> = {
          id: bindings[0],
          parent_id: bindings[1],
          sort_key: bindings[2],
          row_type: bindings[3],
          name: bindings[4],
          notes: bindings[5],
          duration: bindings[6],
          constraint_type: bindings[7],
          constraint_date: bindings[8],
          scheduling_mode: bindings[9],
          dependencies: bindings[10], // JSON string
          progress: bindings[11],
          actual_start: bindings[12],
          actual_finish: bindings[13],
          remaining_duration: bindings[14],
          baseline_start: bindings[15],
          baseline_finish: bindings[16],
          baseline_duration: bindings[17],
          is_collapsed: bindings[18],
        };
        capturedRows.set(row.id as string, row);
        return { lastInsertId: 1, rowsAffected: 1 };
      }

      // Handle UPDATE tasks
      if (query.includes('UPDATE tasks')) {
        return { lastInsertId: 0, rowsAffected: 1 };
      }

      return { lastInsertId: 0, rowsAffected: 0 };
    });

    mockDb.select.mockResolvedValue([]);

    persistenceService = new PersistenceService();
    await persistenceService.init();
    mockDb.execute.mockClear();
  });

  afterEach(async () => {
    if (persistenceService.getInitialized()) {
      await persistenceService.flushNow();
    }
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('Basic Field Preservation', () => {
    it('should preserve all required Task fields through persistence cycle', async () => {
      const originalTask = createCompleteTask({
        id: 'test-basic',
        name: 'Test Task',
        duration: 5,
        progress: 50,
        notes: 'Test notes',
      });

      // Persist
      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      // Verify capture
      const capturedRow = capturedRows.get(originalTask.id);
      expect(capturedRow).toBeDefined();

      // Hydrate
      const hydratedTask = rowToTask(capturedRow!);

      // Assert equality
      assertTaskInputFieldsEqual(originalTask, hydratedTask);
    });

    it('should preserve sortKey with special characters', async () => {
      const originalTask = createCompleteTask({
        id: 'test-sortkey',
        sortKey: 'a0V',  // Fractional indexing format
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.sortKey).toBe('a0V');
    });

    it('should preserve parentId for child tasks', async () => {
      const parentTask = createCompleteTask({ id: 'parent' });
      const childTask = createCompleteTask({
        id: 'child',
        parentId: 'parent',
        sortKey: 'a0a0',
      });

      // Persist both
      persistenceService.queueEvent('TASK_CREATED', parentTask.id, taskToEventPayload(parentTask));
      persistenceService.queueEvent('TASK_CREATED', childTask.id, taskToEventPayload(childTask));
      await persistenceService.flushNow();

      const capturedChild = capturedRows.get('child');
      const hydratedChild = rowToTask(capturedChild!);

      expect(hydratedChild.parentId).toBe('parent');
    });
  });

  describe('Dependencies Serialization', () => {
    it('should preserve empty dependencies array', async () => {
      const originalTask = createCompleteTask({
        id: 'test-no-deps',
        dependencies: [],
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      expect(capturedRow).toBeDefined();

      // Dependencies should be JSON string "[]"
      expect(capturedRow!.dependencies).toBe('[]');

      const hydratedTask = rowToTask(capturedRow!);
      expect(hydratedTask.dependencies).toEqual([]);
    });

    it('should preserve complex dependencies with all link types', async () => {
      const dependencies: Dependency[] = [
        { id: 'task-1', type: 'FS', lag: 0 },
        { id: 'task-2', type: 'SS', lag: 2 },
        { id: 'task-3', type: 'FF', lag: -1 },
        { id: 'task-4', type: 'SF', lag: 5 },
      ];

      const originalTask = createCompleteTask({
        id: 'test-deps',
        dependencies,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      assertDependenciesEqual(dependencies, hydratedTask.dependencies);
    });

    it('should preserve negative lag values', async () => {
      const originalTask = createCompleteTask({
        id: 'test-neg-lag',
        dependencies: [{ id: 'pred', type: 'FS', lag: -5 }],
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.dependencies[0].lag).toBe(-5);
    });
  });

  describe('Nullable Fields Handling', () => {
    it('should preserve null constraintDate', async () => {
      const originalTask = createCompleteTask({
        id: 'test-null-constraint',
        constraintType: 'asap',
        constraintDate: null,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      expect(capturedRow!.constraint_date).toBeNull();

      const hydratedTask = rowToTask(capturedRow!);
      expect(hydratedTask.constraintDate).toBeNull();
    });

    it('should preserve set constraintDate', async () => {
      const originalTask = createCompleteTask({
        id: 'test-set-constraint',
        constraintType: 'snet',
        constraintDate: '2024-03-15',
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.constraintDate).toBe('2024-03-15');
    });

    it('should convert undefined actuals to null in payload (SQLite NULL)', async () => {
      const originalTask = createCompleteTask({
        id: 'test-undefined-actuals',
        actualStart: undefined,
        actualFinish: undefined,
        remainingDuration: undefined,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      // PersistenceService converts undefined → null for SQLite NULL
      // This is expected behavior - SQLite doesn't have undefined
      expect(capturedRow!.actual_start).toBeNull();

      const hydratedTask = rowToTask(capturedRow!);
      // nullToUndefined should convert null → undefined
      expect(hydratedTask.actualStart).toBeUndefined();
      expect(hydratedTask.actualFinish).toBeUndefined();
    });

    it('should preserve set actuals fields', async () => {
      const originalTask = createCompleteTask({
        id: 'test-set-actuals',
        actualStart: '2024-01-05',
        actualFinish: '2024-01-10',
        remainingDuration: 0,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.actualStart).toBe('2024-01-05');
      expect(hydratedTask.actualFinish).toBe('2024-01-10');
      expect(hydratedTask.remainingDuration).toBe(0);
    });
  });

  describe('SchedulingMode Preservation', () => {
    it('should preserve schedulingMode = Auto', async () => {
      const originalTask = createCompleteTask({
        id: 'test-auto',
        schedulingMode: 'Auto',
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.schedulingMode).toBe('Auto');
    });

    it('should preserve schedulingMode = Manual', async () => {
      const originalTask = createCompleteTask({
        id: 'test-manual',
        schedulingMode: 'Manual',
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.schedulingMode).toBe('Manual');
    });

    it('should default undefined schedulingMode to Auto', async () => {
      const originalTask = createCompleteTask({
        id: 'test-default-mode',
      });
      delete (originalTask as any).schedulingMode;

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.schedulingMode).toBe('Auto');
    });
  });

  describe('RowType Preservation', () => {
    it('should preserve rowType = task', async () => {
      const originalTask = createCompleteTask({
        id: 'test-task-type',
        rowType: 'task',
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.rowType).toBe('task');
    });

    it('should preserve rowType = blank', async () => {
      const originalTask = createCompleteTask({
        id: 'test-blank-type',
        rowType: 'blank',
        name: '',
        duration: 0,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.rowType).toBe('blank');
    });
  });

  describe('Baseline Fields Preservation', () => {
    it('should preserve baseline fields', async () => {
      const originalTask = createCompleteTask({
        id: 'test-baseline',
        baselineStart: '2024-01-01',
        baselineFinish: '2024-01-05',
        baselineDuration: 5,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.baselineStart).toBe('2024-01-01');
      expect(hydratedTask.baselineFinish).toBe('2024-01-05');
      expect(hydratedTask.baselineDuration).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should preserve zero duration (milestone) in database row', async () => {
      const originalTask = createCompleteTask({
        id: 'test-milestone',
        duration: 0,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      // Database stores duration 0 correctly
      expect(capturedRow!.duration).toBe(0);

      // NOTE: rowToTask defaults falsy duration to 1 (DataLoader behavior)
      // This is intentional for backwards compatibility
      const hydratedTask = rowToTask(capturedRow!);
      expect(hydratedTask.duration).toBe(1); // DataLoader defaults 0 → 1
    });

    it('should preserve progress = 100', async () => {
      const originalTask = createCompleteTask({
        id: 'test-complete',
        progress: 100,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.progress).toBe(100);
    });

    it('should preserve _collapsed = true', async () => {
      const originalTask = createCompleteTask({
        id: 'test-collapsed',
        _collapsed: true,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      // is_collapsed stored as 1/0 in SQLite (truthy/falsy in JS)
      expect(capturedRow!.is_collapsed).toBeTruthy();

      const hydratedTask = rowToTask(capturedRow!);
      expect(hydratedTask._collapsed).toBe(true);
    });

    it('should preserve names with special characters', async () => {
      const specialName = 'Task with "quotes" and \'apostrophes\' & <special> chars';
      const originalTask = createCompleteTask({
        id: 'test-special-chars',
        name: specialName,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.name).toBe(specialName);
    });

    it('should preserve names with unicode characters', async () => {
      const unicodeName = 'タスク 日本語 🏗️ Construction';
      const originalTask = createCompleteTask({
        id: 'test-unicode',
        name: unicodeName,
      });

      const payload = taskToEventPayload(originalTask);
      persistenceService.queueEvent('TASK_CREATED', originalTask.id, payload);
      await persistenceService.flushNow();

      const capturedRow = capturedRows.get(originalTask.id);
      const hydratedTask = rowToTask(capturedRow!);

      expect(hydratedTask.name).toBe(unicodeName);
    });
  });

  describe('Full Round-Trip Test Suite', () => {
    it('should preserve all fields for a comprehensive set of test tasks', async () => {
      const testTasks = createRoundTripTestTasks();

      // Persist all tasks
      for (const task of testTasks) {
        const payload = taskToEventPayload(task);
        persistenceService.queueEvent('TASK_CREATED', task.id, payload);
      }
      await persistenceService.flushNow();

      // Verify each task
      for (const originalTask of testTasks) {
        const capturedRow = capturedRows.get(originalTask.id);
        expect(capturedRow).toBeDefined();

        const hydratedTask = rowToTask(capturedRow!);
        assertTaskInputFieldsEqual(originalTask, hydratedTask);
      }
    });
  });
});
