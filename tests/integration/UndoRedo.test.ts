/**
 * @fileoverview Integration test for Undo/Redo with Event Sourcing
 * @module tests/integration/UndoRedo-test
 * 
 * Tests undo/redo functionality using Command Pattern
 * 
 * NOTE: TaskStore was removed in the architecture migration.
 * History recording now happens in ProjectController.
 * These tests verify HistoryManager logic in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryManager, QueuedEvent } from '../../src/data/HistoryManager';

describe('Undo/Redo with HistoryManager', () => {
  let historyManager: HistoryManager;

  // Helper to create events
  const createEvent = (type: string, targetId: string | null, payload: Record<string, unknown>): QueuedEvent => ({
    type,
    targetId,
    payload,
    timestamp: new Date()
  });

  beforeEach(() => {
    historyManager = new HistoryManager({ maxHistory: 50 });
  });

  describe('Basic Operations', () => {
    it('should record action and enable undo', () => {
      const forwardEvent = createEvent('TASK_CREATED', 'task_1', { name: 'Test' });
      const backwardEvent = createEvent('TASK_DELETED', 'task_1', {});

      historyManager.recordAction(forwardEvent, backwardEvent, 'Add Task');

      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);
      expect(historyManager.getUndoLabel()).toBe('Add Task');
    });

    it('should return backward event on undo', () => {
      const forwardEvent = createEvent('TASK_CREATED', 'task_1', { name: 'Test' });
      const backwardEvent = createEvent('TASK_DELETED', 'task_1', {});

      historyManager.recordAction(forwardEvent, backwardEvent, 'Add Task');

      const events = historyManager.undo();
      expect(events).not.toBeNull();
      expect(events!.length).toBe(1);
      expect(events![0].type).toBe('TASK_DELETED');
      expect(events![0].targetId).toBe('task_1');
    });

    it('should return forward event on redo', () => {
      const forwardEvent = createEvent('TASK_CREATED', 'task_1', { name: 'Test' });
      const backwardEvent = createEvent('TASK_DELETED', 'task_1', {});

      historyManager.recordAction(forwardEvent, backwardEvent, 'Add Task');
      historyManager.undo();

      const events = historyManager.redo();
      expect(events).not.toBeNull();
      expect(events!.length).toBe(1);
      expect(events![0].type).toBe('TASK_CREATED');
      expect(events![0].targetId).toBe('task_1');
    });

    it('should return null on undo when no history', () => {
      const events = historyManager.undo();
      expect(events).toBeNull();
    });

    it('should return null on redo when no undone actions', () => {
      const events = historyManager.redo();
      expect(events).toBeNull();
    });

    it('should clear redo stack on new action', () => {
      const forwardEvent1 = createEvent('TASK_CREATED', 'task_1', { name: 'Task 1' });
      const backwardEvent1 = createEvent('TASK_DELETED', 'task_1', {});
      historyManager.recordAction(forwardEvent1, backwardEvent1);

      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);

      // New action should clear redo
      const forwardEvent2 = createEvent('TASK_CREATED', 'task_2', { name: 'Task 2' });
      const backwardEvent2 = createEvent('TASK_DELETED', 'task_2', {});
      historyManager.recordAction(forwardEvent2, backwardEvent2);

      expect(historyManager.canRedo()).toBe(false);
    });
  });

  describe('Composite Actions', () => {
    it('should group events in composite action', () => {
      historyManager.beginComposite('Delete Multiple');

      // Record multiple events
      historyManager.recordAction(
        createEvent('TASK_DELETED', 'task_1', {}),
        createEvent('TASK_CREATED', 'task_1', { name: 'Task 1' })
      );
      historyManager.recordAction(
        createEvent('TASK_DELETED', 'task_2', {}),
        createEvent('TASK_CREATED', 'task_2', { name: 'Task 2' })
      );
      historyManager.recordAction(
        createEvent('TASK_DELETED', 'task_3', {}),
        createEvent('TASK_CREATED', 'task_3', { name: 'Task 3' })
      );

      historyManager.endComposite();

      // Should only have 1 undo action
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.getUndoLabel()).toBe('Delete Multiple');

      // Undo should return all 3 backward events in reverse order
      const events = historyManager.undo();
      expect(events).not.toBeNull();
      expect(events!.length).toBe(3);
      
      // Events are reversed for undo
      expect(events![0].targetId).toBe('task_3');
      expect(events![1].targetId).toBe('task_2');
      expect(events![2].targetId).toBe('task_1');
    });

    it('should not record empty composite', () => {
      historyManager.beginComposite('Empty');
      historyManager.endComposite();

      expect(historyManager.canUndo()).toBe(false);
    });

    it('should cancel composite without recording', () => {
      historyManager.beginComposite('Cancelled');
      historyManager.recordAction(
        createEvent('TASK_DELETED', 'task_1', {}),
        createEvent('TASK_CREATED', 'task_1', { name: 'Task 1' })
      );
      historyManager.cancelComposite();

      expect(historyManager.canUndo()).toBe(false);
    });
  });

  describe('Update Operations', () => {
    it('should undo field update with old value', () => {
      const forwardEvent = createEvent('TASK_UPDATED', 'task_1', { 
        field: 'name', 
        new_value: 'Updated Name' 
      });
      const backwardEvent = createEvent('TASK_UPDATED', 'task_1', { 
        field: 'name', 
        new_value: 'Original Name' 
      });

      historyManager.recordAction(forwardEvent, backwardEvent, 'Update name');

      const events = historyManager.undo();
      expect(events![0].type).toBe('TASK_UPDATED');
      expect(events![0].payload.field).toBe('name');
      expect(events![0].payload.new_value).toBe('Original Name');
    });
  });

  describe('History Limits', () => {
    it('should limit history size', () => {
      const manager = new HistoryManager({ maxHistory: 3 });

      for (let i = 0; i < 5; i++) {
        manager.recordAction(
          createEvent('TASK_CREATED', `task_${i}`, {}),
          createEvent('TASK_DELETED', `task_${i}`, {})
        );
      }

      // Should only have 3 items (the last 3)
      let undoCount = 0;
      while (manager.canUndo()) {
        manager.undo();
        undoCount++;
      }
      expect(undoCount).toBe(3);
    });
  });

  describe('State Change Callback', () => {
    it('should call onStateChange when history changes', () => {
      let lastState: { canUndo: boolean; canRedo: boolean } | null = null;
      const manager = new HistoryManager({
        onStateChange: (state) => { lastState = state; }
      });

      // Record action
      manager.recordAction(
        createEvent('TASK_CREATED', 'task_1', {}),
        createEvent('TASK_DELETED', 'task_1', {})
      );
      expect(lastState?.canUndo).toBe(true);
      expect(lastState?.canRedo).toBe(false);

      // Undo
      manager.undo();
      expect(lastState?.canUndo).toBe(false);
      expect(lastState?.canRedo).toBe(true);

      // Redo
      manager.redo();
      expect(lastState?.canUndo).toBe(true);
      expect(lastState?.canRedo).toBe(false);
    });
  });
});
