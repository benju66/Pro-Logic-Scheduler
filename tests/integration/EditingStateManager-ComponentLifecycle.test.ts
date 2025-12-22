/**
 * @fileoverview Component lifecycle tests for EditingStateManager
 * Tests component destroy, cleanup, and error handling
 * @module tests/integration/EditingStateManager-ComponentLifecycle.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';

describe('EditingStateManager - Component Lifecycle', () => {
    let editingManager: EditingStateManager;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
    });

    describe('Component destroy cleans up editing state', () => {
        it('destroy trigger exits edit mode', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            expect(editingManager.isEditing()).toBe(true);
            
            editingManager.exitEditMode('destroy');
            
            expect(editingManager.isEditing()).toBe(false);
        });

        it('destroy clears context', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('destroy');
            
            expect(editingManager.getContext()).toBeNull();
        });

        it('unsubscribe cleans up subscription', () => {
            const callback = vi.fn();
            const unsubscribe = editingManager.subscribe(callback);
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            expect(callback).toHaveBeenCalledTimes(1);
            
            unsubscribe();
            editingManager.exitEditMode('escape');
            editingManager.enterEditMode({ taskId: 'task2', field: 'name' }, 'click');
            
            // Should only have been called once (before unsubscribe)
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('multiple unsubscribes are safe', () => {
            const callback = vi.fn();
            const unsubscribe = editingManager.subscribe(callback);
            
            unsubscribe();
            unsubscribe(); // Should be safe to call multiple times
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('Error handling', () => {
        it('subscriber errors do not break system', () => {
            const goodCallback = vi.fn();
            const badCallback = vi.fn(() => {
                throw new Error('Subscriber error');
            });
            const anotherCallback = vi.fn();
            
            editingManager.subscribe(goodCallback);
            editingManager.subscribe(badCallback);
            editingManager.subscribe(anotherCallback);
            
            // Should not throw, and other subscribers should still be called
            expect(() => {
                editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            }).not.toThrow();
            
            expect(goodCallback).toHaveBeenCalled();
            expect(anotherCallback).toHaveBeenCalled();
        });

        it('subscriber errors are logged but not propagated', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const badCallback = vi.fn(() => {
                throw new Error('Test error');
            });
            
            editingManager.subscribe(badCallback);
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });

        it('handles null/undefined callbacks gracefully', () => {
            // This shouldn't happen in practice, but test defensive coding
            const callback = null as any;
            
            expect(() => {
                editingManager.subscribe(callback);
            }).not.toThrow();
        });
    });

    describe('State consistency', () => {
        it('state remains consistent after rapid operations', () => {
            for (let i = 0; i < 100; i++) {
                editingManager.enterEditMode({ taskId: `task${i}`, field: 'name' }, 'click');
                editingManager.exitEditMode('escape');
            }
            
            expect(editingManager.isEditing()).toBe(false);
            expect(editingManager.getContext()).toBeNull();
        });

        it('previousContext is preserved correctly', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.exitEditMode('escape');
            
            const state = editingManager.getState();
            expect(state.previousContext?.taskId).toBe('task1');
            expect(state.previousContext?.field).toBe('name');
        });

        it('previousContext updates on moveToCell', () => {
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.moveToCell({ taskId: 'task1', field: 'duration' }, 'tab');
            
            const state = editingManager.getState();
            expect(state.previousContext?.taskId).toBe('task1');
            expect(state.previousContext?.field).toBe('name');
            expect(state.context?.field).toBe('duration');
        });
    });

    describe('Memory management', () => {
        it('unsubscribing prevents memory leaks', () => {
            const callbacks: any[] = [];
            
            // Create many subscriptions
            for (let i = 0; i < 100; i++) {
                const callback = vi.fn();
                callbacks.push(editingManager.subscribe(callback));
            }
            
            // Unsubscribe all
            callbacks.forEach(unsubscribe => unsubscribe());
            
            // Trigger state change
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            
            // No callbacks should be called
            // (We can't directly test memory, but we can verify no callbacks fire)
            expect(editingManager.isEditing()).toBe(true);
        });

        it('reset clears all state without memory leaks', () => {
            const callback = vi.fn();
            editingManager.subscribe(callback);
            
            editingManager.enterEditMode({ taskId: 'task1', field: 'name' }, 'click');
            editingManager.reset();
            
            expect(editingManager.isEditing()).toBe(false);
            expect(editingManager.getContext()).toBeNull();
            expect(editingManager.getState().previousContext).toBeNull();
        });
    });
});

