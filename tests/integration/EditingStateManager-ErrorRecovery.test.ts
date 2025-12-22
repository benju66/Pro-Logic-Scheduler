/**
 * @fileoverview Error recovery and edge case tests for EditingStateManager
 * Tests error scenarios, invalid inputs, and recovery mechanisms
 * @module tests/integration/EditingStateManager-ErrorRecovery.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';

describe('EditingStateManager - Error Recovery', () => {
    let editingManager: EditingStateManager;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
    });

    describe('Invalid state transitions', () => {
        it('exitEditMode when not editing is safe (no-op)', () => {
            const callback = vi.fn();
            editingManager.subscribe(callback);
            
            editingManager.exitEditMode('escape');
            
            // Should not notify subscribers
            expect(callback).not.toHaveBeenCalled();
        });

        it('enterEditMode with same cell is safe (no-op)', () => {
            const callback = vi.fn();
            editingManager.subscribe(callback);
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Should only notify once
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('moveToCell when not editing creates new edit session', () => {
            editingManager.moveToCell({ taskId: 'task1', field: 'name' }, 'tab');
            
            expect(editingManager.isEditing()).toBe(true);
            expect(editingManager.getContext()?.taskId).toBe('task1');
        });
    });

    describe('Invalid inputs', () => {
        it('handles empty taskId gracefully', () => {
            expect(() => {
                editingManager.enterEditMode({ taskId: '', field: 'name' }, 'click');
            }).not.toThrow();
            
            expect(editingManager.isEditing()).toBe(true);
        });

        it('handles empty field gracefully', () => {
            expect(() => {
                editingManager.enterEditMode({ taskId: 'task1', field: '' }, 'click');
            }).not.toThrow();
            
            expect(editingManager.isEditing()).toBe(true);
        });

        it('handles very long taskId', () => {
            const longTaskId = 'a'.repeat(1000);
            editingManager.enterEditMode({ taskId: longTaskId, field: 'name' }, 'click');
            
            expect(editingManager.isEditingCell(longTaskId)).toBe(true);
        });

        it('handles special characters in taskId', () => {
            const specialTaskId = 'task-1_2.3@4#5$6%7^8&9*0';
            editingManager.enterEditMode({ taskId: specialTaskId, field: 'name' }, 'click');
            
            expect(editingManager.isEditingCell(specialTaskId)).toBe(true);
        });
    });

    describe('Concurrent operations', () => {
        it('handles rapid state changes', () => {
            const stateChanges: string[] = [];
            editingManager.subscribe((event) => {
                stateChanges.push(event.trigger);
            });
            
            // Rapid operations
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            editingManager.moveToCell({ taskId: 'task2', field: 'name' }, 'tab');
            editingManager.exitEditMode('escape');
            
            expect(stateChanges).toEqual(['click', 'tab', 'tab', 'escape']);
        });

        it('maintains consistency during rapid operations', () => {
            for (let i = 0; i < 50; i++) {
                editingManager.enterEditMode({ taskId: `task${i}`, field: 'name' }, 'click');
                editingManager.exitEditMode('escape');
            }
            
            expect(editingManager.isEditing()).toBe(false);
        });
    });

    describe('validateEditingTask edge cases', () => {
        it('handles validateEditingTask when not editing', () => {
            expect(() => {
                editingManager.validateEditingTask(() => false);
            }).not.toThrow();
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('handles validateEditingTask with always-true predicate', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            editingManager.validateEditingTask(() => true);
            
            expect(editingManager.isEditing()).toBe(true);
        });

        it('handles validateEditingTask with always-false predicate', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            editingManager.validateEditingTask(() => false);
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('handles validateEditingTask throwing error', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            expect(() => {
                editingManager.validateEditingTask(() => {
                    throw new Error('Validation error');
                });
            }).toThrow();
            
            // State should remain unchanged if validation throws
            expect(editingManager.isEditing()).toBe(true);
        });
    });

    describe('Subscription edge cases', () => {
        it('handles subscription during state change', () => {
            const callback1 = vi.fn();
            editingManager.subscribe(callback1);
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Subscribe during edit
            const callback2 = vi.fn();
            editingManager.subscribe(callback2);
            
            editingManager.exitEditMode('escape');
            
            expect(callback1).toHaveBeenCalledTimes(2);
            expect(callback2).toHaveBeenCalledTimes(1); // Only exit
        });

        it('handles unsubscribe during state change', () => {
            const callback = vi.fn();
            const unsubscribe = editingManager.subscribe(callback);
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // Unsubscribe during edit
            unsubscribe();
            
            editingManager.exitEditMode('escape');
            
            // Should only have been called once (before unsubscribe)
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('Reset edge cases', () => {
        it('reset when not editing is safe', () => {
            const callback = vi.fn();
            editingManager.subscribe(callback);
            
            editingManager.reset();
            
            // Should not notify if no state change
            expect(callback).toHaveBeenCalledTimes(1); // Actually, reset always notifies
            expect(editingManager.isEditing()).toBe(false);
        });

        it('reset clears previousContext', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('escape');
            
            const stateBefore = editingManager.getState();
            expect(stateBefore.previousContext).not.toBeNull();
            
            editingManager.reset();
            
            const stateAfter = editingManager.getState();
            expect(stateAfter.previousContext).toBeNull();
        });
    });
});

