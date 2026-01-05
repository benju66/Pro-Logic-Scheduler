import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectController } from '../../src/services/ProjectController';

// Mock the worker
vi.mock('../../src/workers/scheduler.worker?worker', () => ({
  default: class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  }
}));

describe('Task Name Trimming', () => {
  let controller: ProjectController;

  beforeEach(() => {
    // Reset singleton for clean test state
    (ProjectController as any).instance = null;
    controller = ProjectController.getInstance();
  });

  describe('updateTask name sanitization', () => {
    it('should trim leading and trailing whitespace from name', () => {
      // Add a task first
      const task = {
        id: 'test-task-1',
        name: 'Original Name',
        duration: 1,
        start: '2025-01-05',
        end: '2025-01-05',
        sortKey: 'a',
        parentId: null,
        dependencies: [],
      };
      controller.addTask(task as any);

      // Update with whitespace
      controller.updateTask('test-task-1', { name: '  Trimmed Name  ' });

      // Verify the name was trimmed
      const updated = controller.getTaskById('test-task-1');
      expect(updated?.name).toBe('Trimmed Name');
    });

    it('should reject empty name after trimming (only spaces)', () => {
      // Add a task first
      const task = {
        id: 'test-task-2',
        name: 'Original Name',
        duration: 1,
        start: '2025-01-05',
        end: '2025-01-05',
        sortKey: 'b',
        parentId: null,
        dependencies: [],
      };
      controller.addTask(task as any);

      // Try to update with only spaces
      controller.updateTask('test-task-2', { name: '   ' });

      // Verify the name was NOT changed
      const updated = controller.getTaskById('test-task-2');
      expect(updated?.name).toBe('Original Name');
    });

    it('should reject empty string name', () => {
      // Add a task first
      const task = {
        id: 'test-task-3',
        name: 'Original Name',
        duration: 1,
        start: '2025-01-05',
        end: '2025-01-05',
        sortKey: 'c',
        parentId: null,
        dependencies: [],
      };
      controller.addTask(task as any);

      // Try to update with empty string
      controller.updateTask('test-task-3', { name: '' });

      // Verify the name was NOT changed
      const updated = controller.getTaskById('test-task-3');
      expect(updated?.name).toBe('Original Name');
    });

    it('should preserve internal spaces in name', () => {
      // Add a task first
      const task = {
        id: 'test-task-4',
        name: 'Original Name',
        duration: 1,
        start: '2025-01-05',
        end: '2025-01-05',
        sortKey: 'd',
        parentId: null,
        dependencies: [],
      };
      controller.addTask(task as any);

      // Update with internal spaces
      controller.updateTask('test-task-4', { name: 'Name  With   Spaces' });

      // Verify internal spaces are preserved
      const updated = controller.getTaskById('test-task-4');
      expect(updated?.name).toBe('Name  With   Spaces');
    });

    it('should allow other updates when name is rejected', () => {
      // Add a task first
      const task = {
        id: 'test-task-5',
        name: 'Original Name',
        duration: 1,
        start: '2025-01-05',
        end: '2025-01-05',
        sortKey: 'e',
        parentId: null,
        dependencies: [],
      };
      controller.addTask(task as any);

      // Try to update with empty name AND duration
      controller.updateTask('test-task-5', { name: '   ', duration: 5 });

      // Verify name unchanged but duration updated
      const updated = controller.getTaskById('test-task-5');
      expect(updated?.name).toBe('Original Name');
      expect(updated?.duration).toBe(5);
    });
  });
});
