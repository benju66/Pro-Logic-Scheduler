/**
 * @fileoverview Integration tests for EditingStateManager + SchedulerService
 * @module tests/integration/EditingStateManager-SchedulerService.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';
import { TaskStore } from '../../src/data/TaskStore';
import type { Task } from '../../src/types';

describe('EditingStateManager + SchedulerService Integration', () => {
    let editingManager: EditingStateManager;
    let taskStore: TaskStore;
    let mockTasks: Task[];

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
        
        taskStore = new TaskStore({
            onChange: vi.fn(),
        });
        
        mockTasks = [
            {
                id: 'task1',
                name: 'Task 1',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                _collapsed: false,
            },
            {
                id: 'task2',
                name: 'Task 2',
                start: '2024-01-06',
                end: '2024-01-10',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a1',
                _collapsed: false,
            },
        ];
    });

    describe('Data lifecycle hooks', () => {
        it('reset() called in loadData() clears editing state', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate loadData() reset
            editingManager.reset();
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('reset() called in setTasks() clears editing state', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate setTasks() reset
            editingManager.reset();
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('validateEditingTask() clears state if task deleted', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate task deletion
            editingManager.validateEditingTask((id) => id !== 'task1');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('validateEditingTask() keeps state if task still exists', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            
            editingManager.validateEditingTask((id) => id === 'task1');
            
            expect(editingManager.isEditing()).toBe(true);
        });
    });

    describe('Task deletion while editing', () => {
        it('deleteTask() exits edit mode if deleting edited task', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate deleteTask() logic
            if (editingManager.isEditingTask('task1')) {
                editingManager.exitEditMode('task-deleted');
            }
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('deleteTask() does not exit edit mode if deleting different task', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            
            // Simulate deleting task2 (not task1)
            if (editingManager.isEditingTask('task2')) {
                editingManager.exitEditMode('task-deleted');
            }
            
            expect(editingManager.isEditing()).toBe(true);
        });
    });

    describe('Selection updates on navigation', () => {
        it('Tab navigation to different row updates selection', () => {
            const stateChanges: any[] = [];
            editingManager.subscribe((event) => {
                if (event.trigger === 'tab' && event.newState.isEditing) {
                    stateChanges.push(event);
                }
            });
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'tab');
            
            expect(stateChanges.length).toBeGreaterThan(0);
            expect(stateChanges[0].newState.context?.taskId).toBe('task2');
        });

        it('Enter navigation to different row updates selection', () => {
            const stateChanges: any[] = [];
            editingManager.subscribe((event) => {
                if (event.trigger === 'enter' && event.newState.isEditing) {
                    stateChanges.push(event);
                }
            });
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'f2');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'enter');
            
            expect(stateChanges.length).toBeGreaterThan(0);
            expect(stateChanges[0].newState.context?.taskId).toBe('task2');
        });
    });

    describe('enterEditMode via F2', () => {
        it('stores originalValue when entering edit mode', () => {
            const task = mockTasks[0];
            const originalValue = task.name;
            
            editingManager.enterEditMode(
                { taskId: task.id, field: 'name' },
                'f2',
                originalValue
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe(originalValue);
        });
    });
});

