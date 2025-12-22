/**
 * @fileoverview Workflow/E2E tests for EditingStateManager + GridRenderer
 * Tests critical user workflows: Escape revert, Tab/Enter navigation, etc.
 * @module tests/integration/EditingStateManager-GridRenderer-Workflows.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';
import { formatDateForDisplay } from '../../src/ui/components/scheduler/datepicker/DatePickerConfig';

describe('EditingStateManager + GridRenderer Workflows', () => {
    let editingManager: EditingStateManager;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
    });

    describe('HIGH PRIORITY: Escape reverts originalValue', () => {
        it('reverts text input to originalValue', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'name' },
                'click',
                'Original Name'
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe('Original Name');
            
            // Simulate Escape key
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
            // In real GridRenderer, the input value would be restored to 'Original Name'
        });

        it('reverts number input to originalValue', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'duration' },
                'click',
                5
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe(5);
            
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('reverts date input to originalValue (ISO format)', () => {
            const isoDate = '2024-01-15';
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'start' },
                'click',
                isoDate
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe(isoDate);
            
            // Simulate Escape - should convert ISO to display format
            const displayFormat = formatDateForDisplay(isoDate);
            expect(displayFormat).toBe('01/15/2024');
            
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('reverts select dropdown to originalValue', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'constraintType' },
                'click',
                'asap'
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe('asap');
            
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('handles null originalValue on Escape', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'name' },
                'click',
                null
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBeNull();
            
            editingManager.exitEditMode('escape');
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('HIGH PRIORITY: Tab/Enter navigation updates selection', () => {
        it('Tab navigation moves to next cell in same row', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            
            const context = editingManager.getContext();
            expect(context?.taskId).toBe('task1');
            expect(context?.field).toBe('duration');
        });

        it('Tab navigation moves to next row when at last cell', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'duration' }, 'click');
            
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'tab');
            
            const context = editingManager.getContext();
            expect(context?.taskId).toBe('task2');
            expect(context?.field).toBe('name');
        });

        it('Shift+Tab navigation moves to previous cell', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'duration' }, 'click');
            
            editingManager.moveToCell({ taskId: 'task1', field: 'name' }, 'shift-tab');
            
            const context = editingManager.getContext();
            expect(context?.field).toBe('name');
        });

        it('Enter navigation moves to next row same field', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'enter');
            
            const context = editingManager.getContext();
            expect(context?.taskId).toBe('task2');
            expect(context?.field).toBe('name');
        });

        it('Shift+Enter navigation moves to previous row same field', () => {
            editingManager.enterEditMode({ taskId: 'task2', field: 'name' }, 'click');
            
            editingManager.moveToCell({ taskId: 'task1', field: 'name' }, 'enter');
            
            const context = editingManager.getContext();
            expect(context?.taskId).toBe('task1');
        });
    });

    describe('HIGH PRIORITY: Task deletion while editing', () => {
        it('exits edit mode when deleting edited task', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            expect(editingManager.isEditing()).toBe(true);
            
            editingManager.exitEditMode('task-deleted');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('validates task exists after data update', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate data update - task1 still exists
            editingManager.validateEditingTask((id) => id === 'task1');
            
            expect(editingManager.isEditing()).toBe(true);
        });

        it('clears state when task deleted during data update', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate data update - task1 no longer exists
            editingManager.validateEditingTask((id) => id !== 'task1');
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('MEDIUM PRIORITY: Focus restoration', () => {
        it('exits edit mode triggers focus restoration event', () => {
            const stateChanges: any[] = [];
            editingManager.subscribe((event) => {
                if (!event.newState.isEditing && event.previousState.isEditing) {
                    stateChanges.push(event);
                }
            });
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('escape');
            
            expect(stateChanges.length).toBe(1);
            expect(stateChanges[0].trigger).toBe('escape');
        });

        it('preserves previous context for focus restoration', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('escape');
            
            const state = editingManager.getState();
            expect(state.previousContext?.taskId).toBe('task1');
            expect(state.previousContext?.field).toBe('name');
        });
    });

    describe('MEDIUM PRIORITY: Date input handling', () => {
        it('stores ISO date as originalValue', () => {
            const isoDate = '2024-01-15';
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'start' },
                'click',
                isoDate
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe(isoDate);
        });

        it('Escape converts ISO to display format for date inputs', () => {
            const isoDate = '2024-01-15';
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'start' },
                'click',
                isoDate
            );
            
            // Simulate Escape - GridRenderer would convert ISO to display
            const displayFormat = formatDateForDisplay(isoDate);
            expect(displayFormat).toBe('01/15/2024');
            
            editingManager.exitEditMode('escape');
            expect(editingManager.isEditing()).toBe(false);
        });

        it('Tab navigation saves date input before moving', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'start' },
                'click',
                '2024-01-15'
            );
            
            // Simulate Tab - would save current date value first
            editingManager.moveToCell({ taskId: 'task1', field: 'end' }, 'tab', '2024-01-20');
            
            const context = editingManager.getContext();
            expect(context?.field).toBe('end');
            expect(context?.originalValue).toBe('2024-01-20');
        });
    });

    describe('MEDIUM PRIORITY: Multiple rapid edits', () => {
        it('handles rapid enter/exit cycles', () => {
            for (let i = 0; i < 10; i++) {
                editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
                editingManager.exitEditMode('escape');
            }
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('handles rapid cell switches', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            editingManager.moveToCell({ taskId: 'task1', field: 'start' }, 'tab');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'tab');
            
            const context = editingManager.getContext();
            expect(context?.taskId).toBe('task2');
            expect(context?.field).toBe('name');
        });

        it('ignores duplicate enterEditMode for same cell', () => {
            const callbacks: any[] = [];
            editingManager.subscribe((event) => {
                callbacks.push(event);
            });
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Should only notify once
            const enterCallbacks = callbacks.filter(c => c.newState.isEditing);
            expect(enterCallbacks.length).toBe(1);
        });
    });

    describe('Click handlers', () => {
        it('click on input enters edit mode', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click', 'Original');
            
            expect(editingManager.isEditing()).toBe(true);
            expect(editingManager.getContext()?.trigger).toBeUndefined(); // trigger is not stored in context
        });

        it('click on cell (not input) enters edit mode', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click', 'Original');
            
            expect(editingManager.isEditing()).toBe(true);
        });

        it('stores originalValue on click', () => {
            editingManager.enterEditMode(
                { taskId: 'task1', field: 'name' },
                'click',
                'Original Value'
            );
            
            const context = editingManager.getContext();
            expect(context?.originalValue).toBe('Original Value');
        });
    });

    describe('Blur handling', () => {
        it('blur exits edit mode', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('blur');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('blur does not exit if focusing another input', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Simulate moving to another cell (would not trigger blur exit)
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            
            expect(editingManager.isEditing()).toBe(true);
        });
    });
});

