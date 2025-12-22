/**
 * @fileoverview Complete workflow tests for EditingStateManager
 * Tests realistic user workflows end-to-end
 * @module tests/integration/EditingStateManager-CompleteWorkflows.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';

describe('EditingStateManager - Complete Workflows', () => {
    let editingManager: EditingStateManager;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
    });

    describe('Workflow: F2 → Edit → Escape → Revert', () => {
        it('complete F2 edit workflow', () => {
            const originalValue = 'Original Task Name';
            
            // F2 enters edit mode
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'name' },
                'f2',
                originalValue
            );
            
            expect(editingManager.isEditing()).toBe(true);
            expect(editingManager.getContext()?.originalValue).toBe(originalValue);
            
            // Escape reverts
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
            const state = editingManager.getState();
            expect(state.previousContext?.originalValue).toBe(originalValue);
        });
    });

    describe('Workflow: Click → Edit → Tab → Navigate → Save', () => {
        it('complete tab navigation workflow', () => {
            const workflow: string[] = [];
            editingManager.subscribe((event) => {
                workflow.push(`${event.trigger}:${event.newState.context?.field || 'none'}`);
            });
            
            // Click enters edit mode
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click', 'Task 1');
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab', 5);
            editingManager.moveToCell({ taskId: 'task1', field: 'start' }, 'tab', '2024-01-01');
            editingManager.exitEditMode('blur');
            
            expect(workflow).toContain('click:name');
            expect(workflow).toContain('tab:duration');
            expect(workflow).toContain('tab:start');
            expect(workflow).toContain('blur:none');
        });
    });

    describe('Workflow: Click → Edit → Enter → Next Row → Edit', () => {
        it('complete enter navigation workflow', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click', 'Task 1');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'enter', 'Task 2');
            editingManager.moveToCell({ taskId: 'task3', field: 'name' }, 'enter', 'Task 3');
            editingManager.exitEditMode('enter');
            
            expect(editingManager.isEditing()).toBe(false);
            const state = editingManager.getState();
            expect(state.previousContext?.taskId).toBe('task3');
        });
    });

    describe('Workflow: Edit → Ctrl+Enter → Add Child', () => {
        it('Ctrl+Enter exits edit mode', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate Ctrl+Enter (programmatic exit)
            editingManager.exitEditMode('programmatic');
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('Workflow: Edit → Delete Task → State Cleared', () => {
        it('task deletion clears editing state', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate task deletion
            if (editingManager.isEditingTask('task1')) {
                editingManager.exitEditMode('task-deleted');
            }
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('Workflow: Edit → Load New Project → State Reset', () => {
        it('loadData resets editing state', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate loadData() reset
            editingManager.reset();
            
            expect(editingManager.isEditing()).toBe(false);
            expect(editingManager.getContext()).toBeNull();
        });
    });

    describe('Workflow: Multiple Rapid Edits', () => {
        it('handles rapid edit cycles', () => {
            const stateChanges: string[] = [];
            editingManager.subscribe((event) => {
                stateChanges.push(event.trigger);
            });
            
            // Rapid edit cycles
            for (let i = 0; i < 10; i++) {
                editingManager.enterEditMode({ taskId: `task${i}`, field: 'name' }, 'click');
                editingManager.exitEditMode('escape');
            }
            
            expect(stateChanges.length).toBe(20); // 10 enters + 10 exits
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('Workflow: Edit → Scroll → Value Preserved', () => {
        it('state persists during scroll simulation', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click', 'Original');
            
            // Simulate scroll (state should persist)
            const contextBefore = editingManager.getContext();
            expect(contextBefore?.taskId).toBe('task1');
            expect(contextBefore?.originalValue).toBe('Original');
            
            // State should still be valid after "scroll"
            expect(editingManager.isEditingCell('task1', 'name')).toBe(true);
        });
    });

    describe('Workflow: Complex Navigation Chain', () => {
        it('handles complex navigation sequence', () => {
            const navigation: string[] = [];
            editingManager.subscribe((event) => {
                if (event.newState.isEditing && event.newState.context) {
                    navigation.push(`${event.newState.context.taskId}:${event.newState.context.field}`);
                }
            });
            
            // Complex navigation
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'tab');
            editingManager.moveToCell({ taskId: 'task2', field: 'duration' }, 'enter');
            editingManager.moveToCell({ taskId: 'task3', field: 'duration' }, 'enter');
            
            expect(navigation).toEqual([
                'task1:name',
                'task1:duration',
                'task2:name',
                'task2:duration',
                'task3:duration'
            ]);
        });
    });

    describe('Workflow: Edit → Data Update → Validation', () => {
        it('validates task exists after data update', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate data update - task still exists
            editingManager.validateEditingTask((id) => id === 'task1');
            
            expect(editingManager.isEditing()).toBe(true);
            
            // Simulate data update - task deleted
            editingManager.validateEditingTask((id) => id !== 'task1');
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('Workflow: Component Destroy While Editing', () => {
        it('destroy exits edit mode cleanly', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate component destroy
            editingManager.exitEditMode('destroy');
            
            expect(editingManager.isEditing()).toBe(false);
            expect(editingManager.getContext()).toBeNull();
        });
    });
});

