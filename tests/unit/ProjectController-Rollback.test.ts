/**
 * @fileoverview Unit tests for ProjectController rollback mechanism (Phase 2)
 * @module tests/unit/ProjectController-Rollback.test
 * @vitest-environment happy-dom
 * 
 * Tests that optimistic updates are rolled back when worker returns errors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectController } from '../../src/services/ProjectController';
import { HistoryManager } from '../../src/data/HistoryManager';
import { ToastService } from '../../src/ui/services/ToastService';
import type { Task, WorkerResponse } from '../../src/types';

// Mock the worker - must be defined before imports
vi.mock('../../src/workers/scheduler.worker?worker', () => ({
  default: class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  }
}));

// Mock Worker global for happy-dom environment
global.Worker = class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  
  constructor() {
    // Worker constructor
  }
} as any;

describe('ProjectController - Rollback Mechanism (Phase 2)', () => {
  let controller: ProjectController;
  let historyManager: HistoryManager;
  let toastService: ToastService;
  let mockToastError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset singleton
    (ProjectController as any).instance = null;
    
    // Create mock toast service
    mockToastError = vi.fn();
    toastService = {
      error: mockToastError,
      show: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    } as unknown as ToastService;
    
    // Create controller with toast service
    controller = new ProjectController({ toastService });
    
    // Create history manager
    historyManager = new HistoryManager({ maxHistory: 50 });
    controller.setHistoryManager(historyManager);
    
    // Initialize with empty state
    const initialTasks: Task[] = [
      {
        id: 'task1',
        name: 'Task 1',
        duration: 1,
        start: '2025-01-01',
        end: '2025-01-01',
        sortKey: 'a',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task
    ];
    
    // Simulate initialization
    controller.tasks$.next(initialTasks);
  });

  describe('Pending operation tracking', () => {
    it('should track pending operation on addTask', () => {
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      const snapshotBefore = [...controller.tasks$.value];
      controller.addTask(newTask);
      
      // Verify optimistic update happened
      expect(controller.tasks$.value).toHaveLength(2);
      expect(controller.tasks$.value.find(t => t.id === 'task2')).toBeDefined();
    });

    it('should track pending operation on updateTask', () => {
      const snapshotBefore = [...controller.tasks$.value];
      controller.updateTask('task1', { name: 'Updated Name' });
      
      // Verify optimistic update happened
      expect(controller.tasks$.value[0].name).toBe('Updated Name');
    });

    it('should track pending operation on deleteTask', () => {
      const snapshotBefore = [...controller.tasks$.value];
      controller.deleteTask('task1');
      
      // Verify optimistic update happened
      expect(controller.tasks$.value).toHaveLength(0);
    });
  });

  describe('Rollback on worker error', () => {
    it('should rollback addTask on ERROR response', () => {
      const initialTasks = [...controller.tasks$.value];
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      // Add task (optimistic update)
      controller.addTask(newTask);
      expect(controller.tasks$.value).toHaveLength(2);

      // Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'WASM engine error: Invalid task data'
      };
      
      // Access private method via type assertion for testing
      (controller as any).handleWorkerResponse(errorResponse);

      // Verify rollback - state should revert to initial
      expect(controller.tasks$.value).toHaveLength(initialTasks.length);
      expect(controller.tasks$.value.find(t => t.id === 'task2')).toBeUndefined();
      
      // Verify error toast was shown
      expect(mockToastError).toHaveBeenCalled();
      expect(mockToastError.mock.calls[0][0]).toContain('Adding task failed');
    });

    it('should rollback updateTask on ERROR response', () => {
      const initialTasks = [...controller.tasks$.value];
      const originalName = initialTasks[0].name;

      // Update task (optimistic update)
      controller.updateTask('task1', { name: 'Updated Name' });
      expect(controller.tasks$.value[0].name).toBe('Updated Name');

      // Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Task not found'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      // Verify rollback
      expect(controller.tasks$.value[0].name).toBe(originalName);
      expect(mockToastError).toHaveBeenCalled();
      expect(mockToastError.mock.calls[0][0]).toContain('Updating task failed');
    });

    it('should rollback deleteTask on ERROR response', () => {
      const initialTasks = [...controller.tasks$.value];
      expect(initialTasks).toHaveLength(1);

      // Delete task (optimistic update)
      controller.deleteTask('task1');
      expect(controller.tasks$.value).toHaveLength(0);

      // Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Task not found'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      // Verify rollback
      expect(controller.tasks$.value).toHaveLength(initialTasks.length);
      expect(controller.tasks$.value.find(t => t.id === 'task1')).toBeDefined();
      expect(mockToastError).toHaveBeenCalled();
      expect(mockToastError.mock.calls[0][0]).toContain('Deleting task failed');
    });
  });

  describe('History cancellation on rollback', () => {
    it('should cancel composite action on rollback if composite was active', () => {
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      // Start composite action
      historyManager.beginComposite('Test Composite');
      expect(historyManager.isInComposite()).toBe(true);

      // Add task (should track that composite was active)
      controller.addTask(newTask);

      // Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Error'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      // Verify composite was cancelled
      expect(historyManager.isInComposite()).toBe(false);
    });

    it('should undo last action on rollback if not composite', () => {
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      // Add task (not in composite)
      controller.addTask(newTask);
      expect(historyManager.canUndo()).toBe(true);

      // Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Error'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      // Verify undo was called (history should be cleared)
      // Note: The undo() call in rollback applies backward events, so history stack changes
      // We verify by checking that rollback happened (state reverted)
      expect(controller.tasks$.value.find(t => t.id === 'task2')).toBeUndefined();
    });
  });

  describe('Clear pending operation on success', () => {
    it('should clear pending operation on CALCULATION_RESULT', () => {
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      controller.addTask(newTask);
      
      // Verify pending operation exists (indirectly - by checking state)
      expect(controller.tasks$.value).toHaveLength(2);

      // Simulate successful calculation
      const successResponse: WorkerResponse = {
        type: 'CALCULATION_RESULT',
        payload: {
          tasks: controller.tasks$.value,
          stats: {
            taskCount: 2,
            criticalCount: 0,
            calcTime: 1.5
          }
        }
      };
      
      (controller as any).handleWorkerResponse(successResponse);

      // Verify no rollback happened (state still has new task)
      expect(controller.tasks$.value).toHaveLength(2);
      expect(mockToastError).not.toHaveBeenCalled();
    });
  });

  describe('Error message formatting', () => {
    it('should format WASM errors as user-friendly messages', () => {
      const newTask: Task = {
        id: 'task2',
        name: 'New Task',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      controller.addTask(newTask);

      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'WASM initialization failed: Panic at line 42'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      expect(mockToastError).toHaveBeenCalled();
      const errorMessage = mockToastError.mock.calls[0][0];
      expect(errorMessage).toContain('Calculation engine error');
      expect(errorMessage).not.toContain('WASM');
      expect(errorMessage).not.toContain('Panic');
    });

    it('should format dependency errors appropriately', () => {
      controller.updateTask('task1', { dependencies: [{ id: 'task1', type: 'FS', lag: 0 }] });

      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Circular dependency detected'
      };
      
      (controller as any).handleWorkerResponse(errorResponse);

      expect(mockToastError).toHaveBeenCalled();
      const errorMessage = mockToastError.mock.calls[0][0];
      expect(errorMessage).toContain('Invalid dependency detected');
    });
  });
});
