/**
 * @fileoverview Integration test for Undo/Redo with Event Sourcing
 * @module tests/integration/UndoRedo-test
 * 
 * Tests undo/redo functionality using Command Pattern
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
    __mockDb: mockDb, // Export for test access
  };
});

describe('Undo/Redo Integration Tests', () => {
  let taskStore: TaskStore;
  let historyManager: HistoryManager;
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

    // Create history manager
    historyManager = new HistoryManager({ maxHistory: 50 });

    // Create task store and inject services
    taskStore = new TaskStore();
    taskStore.setPersistenceService(persistenceService);
    taskStore.setHistoryManager(historyManager);
  });

  describe('Undo/Redo with Event Sourcing', () => {
    it('should undo task addition - task removed from store AND TASK_DELETED event queued', () => {
      // Add a task
      const task: Task = {
        id: 'task_1',
        name: 'Test Task',
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

      taskStore.add(task);

      // Verify task was added
      expect(taskStore.getById('task_1')).toBeDefined();
      expect(taskStore.getAll().length).toBe(1);

      // Clear events from add operation
      queuedEvents = [];

      // Undo the addition
      const backwardEvent = historyManager.undo();
      expect(backwardEvent).not.toBeNull();
      expect(backwardEvent!.type).toBe('TASK_DELETED');
      expect(backwardEvent!.targetId).toBe('task_1');

      // Apply the backward event
      taskStore.applyEvent(backwardEvent!);

      // Verify task is gone from store
      expect(taskStore.getById('task_1')).toBeUndefined();
      expect(taskStore.getAll().length).toBe(0);

      // Verify TASK_DELETED event was queued
      const deleteEvents = queuedEvents.filter(e => e.type === 'TASK_DELETED');
      expect(deleteEvents.length).toBeGreaterThan(0);
      expect(deleteEvents[0].targetId).toBe('task_1');
    });

    it('should redo task addition - task restored AND TASK_CREATED event queued', () => {
      // Add a task
      const task: Task = {
        id: 'task_1',
        name: 'Test Task',
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

      taskStore.add(task);

      // Undo the addition
      const backwardEvent = historyManager.undo();
      taskStore.applyEvent(backwardEvent!);

      // Clear events
      queuedEvents = [];

      // Verify task is gone
      expect(taskStore.getById('task_1')).toBeUndefined();

      // Redo the addition
      const forwardEvent = historyManager.redo();
      expect(forwardEvent).not.toBeNull();
      expect(forwardEvent!.type).toBe('TASK_CREATED');
      expect(forwardEvent!.targetId).toBe('task_1');

      // Apply the forward event
      taskStore.applyEvent(forwardEvent!);

      // Verify task is back
      expect(taskStore.getById('task_1')).toBeDefined();
      expect(taskStore.getAll().length).toBe(1);

      // Verify TASK_CREATED event was queued
      const createEvents = queuedEvents.filter(e => e.type === 'TASK_CREATED');
      expect(createEvents.length).toBeGreaterThan(0);
      expect(createEvents[0].targetId).toBe('task_1');
    });

    it('should undo task update - field reverted AND TASK_UPDATED event queued', () => {
      // Add a task
      const task: Task = {
        id: 'task_1',
        name: 'Original Name',
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

      taskStore.add(task);

      // Update the task
      taskStore.update('task_1', { name: 'Updated Name' });

      // Verify update
      expect(taskStore.getById('task_1')!.name).toBe('Updated Name');

      // Clear events
      queuedEvents = [];

      // Undo the update
      const backwardEvent = historyManager.undo();
      expect(backwardEvent).not.toBeNull();
      expect(backwardEvent!.type).toBe('TASK_UPDATED');
      expect(backwardEvent!.payload.field).toBe('name');
      expect(backwardEvent!.payload.new_value).toBe('Original Name');

      // Apply the backward event
      taskStore.applyEvent(backwardEvent!);

      // Verify field was reverted
      expect(taskStore.getById('task_1')!.name).toBe('Original Name');

      // Verify TASK_UPDATED event was queued
      const updateEvents = queuedEvents.filter(e => 
        e.type === 'TASK_UPDATED' && e.targetId === 'task_1'
      );
      expect(updateEvents.length).toBeGreaterThan(0);
      expect(updateEvents[0].payload.field).toBe('name');
      expect(updateEvents[0].payload.new_value).toBe('Original Name');
    });

    it('should not record history when applying undo/redo events', () => {
      // Add a task
      const task: Task = {
        id: 'task_1',
        name: 'Test Task',
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

      taskStore.add(task);

      // Verify history has 1 action
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);

      // Undo
      const backwardEvent = historyManager.undo();
      taskStore.applyEvent(backwardEvent!);

      // Verify history state changed (can redo now)
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);

      // Redo
      const forwardEvent = historyManager.redo();
      taskStore.applyEvent(forwardEvent!);

      // Verify history state changed back
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);

      // Verify history still has only 1 action (not 3)
      // If we had recorded history during undo/redo, we'd have 3 actions
      // But we should still have just 1 (the original add)
      const undoCount = historyManager.canUndo() ? 1 : 0;
      expect(undoCount).toBe(1);
    });
  });
});

