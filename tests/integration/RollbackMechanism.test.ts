/**
 * @fileoverview Integration test for rollback mechanism (Phase 2)
 * @module tests/integration/RollbackMechanism.test
 * @vitest-environment happy-dom
 * 
 * Integration tests for optimistic update rollback when worker errors occur.
 * Tests the full flow including state reversion, history cancellation, and error notifications.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
let mockWorkerInstance: {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} | null = null;

global.Worker = class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  
  constructor() {
    mockWorkerInstance = this as any;
  }
} as any;

describe('Rollback Mechanism Integration (Phase 2)', () => {
  let controller: ProjectController;
  let historyManager: HistoryManager;
  let toastService: ToastService;
  let toastErrorSpy: ReturnType<typeof vi.fn>;
  let tasksHistory: Task[][];

  beforeEach(() => {
    // Reset singleton
    (ProjectController as any).instance = null;
    mockWorkerInstance = null;
    
    // Create toast service with spy
    toastErrorSpy = vi.fn();
    toastService = {
      error: toastErrorSpy,
      show: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    } as unknown as ToastService;
    
    // Create controller
    controller = new ProjectController({ toastService });
    
    // Create history manager
    historyManager = new HistoryManager({ maxHistory: 50 });
    controller.setHistoryManager(historyManager);
    
    // Track task state changes
    tasksHistory = [];
    controller.tasks$.subscribe(tasks => {
      tasksHistory.push([...tasks]);
    });
    
    // Initialize with test tasks
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
      } as Task,
      {
        id: 'task2',
        name: 'Task 2',
        duration: 2,
        start: '2025-01-02',
        end: '2025-01-03',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task
    ];
    
    controller.tasks$.next(initialTasks);
    tasksHistory = []; // Reset after initial state
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Full rollback flow', () => {
    it('should complete rollback flow for failed addTask', () => {
      const initialState = [...controller.tasks$.value];
      expect(initialState).toHaveLength(2);

      const newTask: Task = {
        id: 'task3',
        name: 'Task 3',
        duration: 1,
        start: '2025-01-04',
        end: '2025-01-04',
        sortKey: 'c',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      // 1. Add task (optimistic update)
      controller.addTask(newTask);
      const afterAdd = controller.tasks$.value;
      expect(afterAdd).toHaveLength(3);
      expect(afterAdd.find(t => t.id === 'task3')).toBeDefined();
      expect(historyManager.canUndo()).toBe(true);

      // 2. Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'WASM engine error: Invalid task data'
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: errorResponse } as MessageEvent);
      } else {
        // Fallback: call handler directly
        (controller as any).handleWorkerResponse(errorResponse);
      }

      // 3. Verify rollback
      const afterRollback = controller.tasks$.value;
      expect(afterRollback).toHaveLength(initialState.length);
      expect(afterRollback.find(t => t.id === 'task3')).toBeUndefined();
      
      // 4. Verify error notification
      expect(toastErrorSpy).toHaveBeenCalledTimes(1);
      expect(toastErrorSpy.mock.calls[0][0]).toContain('Adding task failed');
      
      // 5. Verify history was cancelled
      // After rollback, the failed operation should not be in undo stack
      // (either cancelled if composite, or undone if standalone)
      // We verify by checking that state matches initial state
      expect(afterRollback).toEqual(initialState);
    });

    it('should complete rollback flow for failed updateTask', () => {
      const initialState = [...controller.tasks$.value];
      const originalName = initialState[0].name;

      // 1. Update task
      controller.updateTask('task1', { name: 'Updated Name', duration: 5 });
      const afterUpdate = controller.tasks$.value;
      expect(afterUpdate[0].name).toBe('Updated Name');
      expect(afterUpdate[0].duration).toBe(5);

      // 2. Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Task not found: task1'
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: errorResponse } as MessageEvent);
      } else {
        (controller as any).handleWorkerResponse(errorResponse);
      }

      // 3. Verify rollback
      const afterRollback = controller.tasks$.value;
      expect(afterRollback[0].name).toBe(originalName);
      expect(toastErrorSpy).toHaveBeenCalled();
    });

    it('should complete rollback flow for failed deleteTask', () => {
      const initialState = [...controller.tasks$.value];
      expect(initialState).toHaveLength(2);

      // 1. Delete task
      controller.deleteTask('task1');
      const afterDelete = controller.tasks$.value;
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete.find(t => t.id === 'task1')).toBeUndefined();

      // 2. Simulate worker error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Cannot delete task: has dependencies'
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: errorResponse } as MessageEvent);
      } else {
        (controller as any).handleWorkerResponse(errorResponse);
      }

      // 3. Verify rollback
      const afterRollback = controller.tasks$.value;
      expect(afterRollback).toHaveLength(initialState.length);
      expect(afterRollback.find(t => t.id === 'task1')).toBeDefined();
      expect(toastErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Composite action rollback', () => {
    it('should cancel composite action on rollback', () => {
      const initialState = [...controller.tasks$.value];
      const originalName = initialState[0].name;
      const originalDuration = initialState[0].duration;

      // Start composite action
      historyManager.beginComposite('Multi-field Update');
      expect(historyManager.isInComposite()).toBe(true);

      // Update single field (composite will be tracked)
      controller.updateTask('task1', { name: 'New Name' });

      // Simulate worker error (only one update was made, so rollback should revert it)
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Error'
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: errorResponse } as MessageEvent);
      } else {
        (controller as any).handleWorkerResponse(errorResponse);
      }

      // Verify composite was cancelled
      expect(historyManager.isInComposite()).toBe(false);
      
      // Verify state rolled back to original
      const finalState = controller.tasks$.value;
      expect(finalState[0].name).toBe(originalName);
      expect(finalState[0].duration).toBe(originalDuration);
    });
  });

  describe('Sequential operations', () => {
    it('should handle rollback correctly when operations are sequential', async () => {
      const initialState = [...controller.tasks$.value];

      // Operation 1: Add task
      const task3: Task = {
        id: 'task3',
        name: 'Task 3',
        duration: 1,
        start: '2025-01-04',
        end: '2025-01-04',
        sortKey: 'c',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      controller.addTask(task3);
      
      // Simulate success
      const successResponse1: WorkerResponse = {
        type: 'CALCULATION_RESULT',
        payload: {
          tasks: controller.tasks$.value,
          stats: { taskCount: 3, criticalCount: 0, calcTime: 1.0 }
        }
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: successResponse1 } as MessageEvent);
      } else {
        (controller as any).handleWorkerResponse(successResponse1);
      }

      // Operation 2: Update task (should fail)
      controller.updateTask('task3', { name: 'Updated Task 3' });
      
      // Simulate error
      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Error'
      };
      
      if (mockWorkerInstance?.onmessage) {
        mockWorkerInstance.onmessage({ data: errorResponse } as MessageEvent);
      } else {
        (controller as any).handleWorkerResponse(errorResponse);
      }

      // Verify: task3 should still exist (from successful add)
      // but name should be original (rollback of failed update)
      const finalState = controller.tasks$.value;
      const task3Final = finalState.find(t => t.id === 'task3');
      expect(task3Final).toBeDefined();
      expect(task3Final?.name).toBe('Task 3'); // Original name, not updated
    });
  });

  describe('Error notification', () => {
    it('should show error toast even if toastService not injected', () => {
      // Create controller without toast service
      const controllerNoToast = new ProjectController();
      const historyNoToast = new HistoryManager();
      controllerNoToast.setHistoryManager(historyNoToast);
      
      controllerNoToast.tasks$.next([{
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
      } as Task]);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const newTask: Task = {
        id: 'task2',
        name: 'Task 2',
        duration: 1,
        start: '2025-01-02',
        end: '2025-01-02',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
        level: 0,
        rowType: 'task',
      } as Task;

      controllerNoToast.addTask(newTask);

      const errorResponse: WorkerResponse = {
        type: 'ERROR',
        message: 'Error'
      };
      
      (controllerNoToast as any).handleWorkerResponse(errorResponse);

      // Should log to console instead
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls.some(call => 
        String(call[0]).includes('Adding task failed')
      )).toBe(true);

      consoleErrorSpy.mockRestore();
    });
  });
});
