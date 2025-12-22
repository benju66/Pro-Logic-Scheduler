/**
 * @fileoverview Integration test for Composite Actions
 * @module tests/integration/CompositeActions-test
 * 
 * Tests composite action support in HistoryManager and TaskStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { HistoryManager } from '../../src/data/HistoryManager';
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
    __mockDb: mockDb,
  };
});

describe('Composite Actions Integration Tests', () => {
  let taskStore: TaskStore;
  let historyManager: HistoryManager;
  let persistenceService: PersistenceService;
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;

    vi.clearAllMocks();
    mockDb.execute.mockReset();
    mockDb.select.mockReset();
    mockDb.close.mockReset();
    mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });

    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn(() => 123 as any),
      clearInterval: vi.fn(),
    };

    mockDb.execute.mockImplementation(async (query: string) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX') || query.includes('INSERT OR IGNORE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      return { lastInsertId: 1, rowsAffected: 1 };
    });

    persistenceService = new PersistenceService();
    await persistenceService.init();
    mockDb.execute.mockClear();

    historyManager = new HistoryManager({ maxHistory: 50 });
    taskStore = new TaskStore();
    taskStore.setPersistenceService(persistenceService);
    taskStore.setHistoryManager(historyManager);
  });

  describe('Composite Action Basics', () => {
    it('should begin and end composite actions', () => {
      expect(historyManager.isInComposite()).toBe(false);
      
      historyManager.beginComposite('Test Action');
      expect(historyManager.isInComposite()).toBe(true);
      
      historyManager.endComposite();
      expect(historyManager.isInComposite()).toBe(false);
    });

    it('should cancel composite actions', () => {
      historyManager.beginComposite('Test Action');
      expect(historyManager.isInComposite()).toBe(true);
      
      historyManager.cancelComposite();
      expect(historyManager.isInComposite()).toBe(false);
      expect(historyManager.canUndo()).toBe(false);
    });

    it('should group multiple events into single undoable action', () => {
      historyManager.beginComposite('Delete Multiple Tasks');
      
      const task1: Task = {
        id: 'task_1',
        name: 'Task 1',
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
      
      const task2: Task = {
        id: 'task_2',
        name: 'Task 2',
        parentId: null,
        sortKey: 'a1',
        duration: 3,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      };

      taskStore.add(task1);
      taskStore.add(task2);
      
      historyManager.endComposite();

      // Should have one undoable action
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.getUndoLabel()).toBe('Delete Multiple Tasks');
      
      // Undo should return multiple events
      const backwardEvents = historyManager.undo();
      expect(backwardEvents).not.toBeNull();
      expect(backwardEvents!.length).toBe(2);
      
      // Events should be in reverse order
      expect(backwardEvents![0].type).toBe('TASK_DELETED');
      expect(backwardEvents![0].targetId).toBe('task_2');
      expect(backwardEvents![1].type).toBe('TASK_DELETED');
      expect(backwardEvents![1].targetId).toBe('task_1');
    });
  });

  describe('Delete with Composite Actions', () => {
    it('should create composite action when deleting parent with children', () => {
      const parent: Task = {
        id: 'parent',
        name: 'Parent',
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

      const child: Task = {
        id: 'child',
        name: 'Child',
        parentId: 'parent',
        sortKey: 'a0V',
        duration: 3,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      };

      taskStore.add(parent);
      taskStore.add(child);

      // Clear history from adds
      historyManager.clear();

      // Delete parent (should delete child too and create composite)
      taskStore.delete('parent', true);

      // Should have one composite action
      expect(historyManager.canUndo()).toBe(true);
      const label = historyManager.getUndoLabel();
      expect(label).toContain('Delete');
      expect(label).toContain('Task(s)');

      // Undo should restore both tasks
      const backwardEvents = historyManager.undo();
      expect(backwardEvents).not.toBeNull();
      expect(backwardEvents!.length).toBeGreaterThanOrEqual(2);

      // Apply undo events
      taskStore.applyEvents(backwardEvents!);

      // Both tasks should be restored
      expect(taskStore.getById('parent')).toBeDefined();
      expect(taskStore.getById('child')).toBeDefined();
    });

    it('should handle ghost link cleanup in composite action', () => {
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

      const taskB: Task = {
        id: 'task_b',
        name: 'Task B',
        parentId: null,
        sortKey: 'a1',
        duration: 3,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [{ id: 'task_a', type: 'FS', lag: 0 }],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      };

      taskStore.add(taskA);
      taskStore.add(taskB);

      // Clear history from adds
      historyManager.clear();

      // Delete task A (should trigger ghost link cleanup)
      taskStore.delete('task_a', true);

      // Verify ghost link was cleaned
      expect(taskStore.getById('task_b')!.dependencies).toEqual([]);

      // Undo should restore both task and dependency
      const backwardEvents = historyManager.undo();
      taskStore.applyEvents(backwardEvents!);

      // Task A should be back
      expect(taskStore.getById('task_a')).toBeDefined();
      
      // Task B's dependency should be restored
      const taskBAfter = taskStore.getById('task_b');
      expect(taskBAfter!.dependencies).toEqual([{ id: 'task_a', type: 'FS', lag: 0 }]);
    });
  });

  describe('Undo/Redo with Composite Actions', () => {
    it('should undo composite action correctly', () => {
      historyManager.beginComposite('Multi Task Operation');
      
      const task1: Task = {
        id: 'task_1',
        name: 'Task 1',
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

      const task2: Task = {
        id: 'task_2',
        name: 'Task 2',
        parentId: null,
        sortKey: 'a1',
        duration: 3,
        constraintType: 'asap',
        constraintDate: null,
        dependencies: [],
        progress: 0,
        notes: '',
        level: 0,
        start: '',
        end: '',
      };

      taskStore.add(task1);
      taskStore.add(task2);
      historyManager.endComposite();

      expect(taskStore.getAll().length).toBe(2);

      // Undo
      const backwardEvents = historyManager.undo();
      expect(backwardEvents).not.toBeNull();
      expect(backwardEvents!.length).toBe(2);

      taskStore.applyEvents(backwardEvents!);

      // Both tasks should be gone
      expect(taskStore.getAll().length).toBe(0);
      expect(historyManager.canRedo()).toBe(true);
    });

    it('should redo composite action correctly', () => {
      historyManager.beginComposite('Multi Task Operation');
      
      const task1: Task = {
        id: 'task_1',
        name: 'Task 1',
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

      taskStore.add(task1);
      historyManager.endComposite();

      // Undo first
      const backwardEvents = historyManager.undo();
      taskStore.applyEvents(backwardEvents!);
      expect(taskStore.getAll().length).toBe(0);

      // Redo
      const forwardEvents = historyManager.redo();
      expect(forwardEvents).not.toBeNull();
      expect(forwardEvents!.length).toBe(1);

      taskStore.applyEvents(forwardEvents!);

      // Task should be back
      expect(taskStore.getAll().length).toBe(1);
      expect(taskStore.getById('task_1')).toBeDefined();
    });
  });
});

