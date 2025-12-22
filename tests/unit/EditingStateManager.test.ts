import { EditingStateManager, getEditingStateManager, isProgrammaticTrigger, isUserTrigger } from '../../src/services/EditingStateManager';

describe('EditingStateManager', () => {
    beforeEach(() => {
        EditingStateManager.resetInstance();
    });

    describe('singleton', () => {
        it('returns same instance', () => {
            const a = getEditingStateManager();
            const b = getEditingStateManager();
            expect(a).toBe(b);
        });
    });

    describe('enterEditMode', () => {
        it('sets isEditing to true', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            expect(manager.isEditing()).toBe(true);
        });

        it('stores context', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2', 'original');
            const ctx = manager.getContext();
            expect(ctx?.taskId).toBe('1');
            expect(ctx?.field).toBe('name');
            expect(ctx?.originalValue).toBe('original');
        });

        it('ignores duplicate calls for same cell', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'click');
            
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('exitEditMode', () => {
        it('sets isEditing to false', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.exitEditMode('escape');
            expect(manager.isEditing()).toBe(false);
        });

        it('clears context', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.exitEditMode('escape');
            expect(manager.getContext()).toBeNull();
        });

        it('stores previous context', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.exitEditMode('escape');
            const state = manager.getState();
            expect(state.previousContext?.taskId).toBe('1');
        });
    });

    describe('subscriptions', () => {
        it('notifies subscribers on enter', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({
                    newState: expect.objectContaining({ isEditing: true }),
                    trigger: 'f2',
                })
            );
        });

        it('unsubscribe stops notifications', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            const unsubscribe = manager.subscribe(callback);
            
            unsubscribe();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            expect(callback).not.toHaveBeenCalled();
        });

        it('filters by trigger', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback, { triggers: ['f2'] });
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'click');
            expect(callback).not.toHaveBeenCalled();
            
            manager.exitEditMode('escape');
            manager.enterEditMode({ taskId: '2', field: 'name' }, 'f2');
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('isEditingCell', () => {
        it('returns true for matching task', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            expect(manager.isEditingCell('1')).toBe(true);
            expect(manager.isEditingCell('2')).toBe(false);
        });

        it('returns true for matching task and field', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            expect(manager.isEditingCell('1', 'name')).toBe(true);
            expect(manager.isEditingCell('1', 'duration')).toBe(false);
        });
    });

    describe('validateEditingTask', () => {
        it('resets state if task no longer exists', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            manager.validateEditingTask((id) => id !== '1');
            
            expect(manager.isEditing()).toBe(false);
        });

        it('keeps state if task still exists', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            manager.validateEditingTask((id) => id === '1');
            
            expect(manager.isEditing()).toBe(true);
        });
    });

    describe('moveToCell', () => {
        it('moves from one cell to another', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.moveToCell({ taskId: '1', field: 'duration' }, 'tab', '5');
            
            expect(manager.isEditing()).toBe(true);
            expect(manager.getContext()?.field).toBe('duration');
            expect(manager.getContext()?.originalValue).toBe('5');
            expect(callback).toHaveBeenCalledTimes(2); // enter + move
        });

        it('preserves previous context when moving', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.moveToCell({ taskId: '1', field: 'duration' }, 'tab');
            
            const state = manager.getState();
            expect(state.previousContext?.field).toBe('name');
        });
    });

    describe('reset', () => {
        it('clears all state', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.reset();
            
            expect(manager.isEditing()).toBe(false);
            expect(manager.getContext()).toBeNull();
            expect(callback).toHaveBeenCalledTimes(2); // enter + reset
        });

        it('notifies subscribers with external trigger', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.reset();
            
            const resetCall = callback.mock.calls.find(call => call[0].trigger === 'external');
            expect(resetCall).toBeDefined();
        });
    });

    describe('isEditingTask', () => {
        it('returns true for editing task', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            expect(manager.isEditingTask('1')).toBe(true);
            expect(manager.isEditingTask('2')).toBe(false);
        });

        it('returns false when not editing', () => {
            const manager = getEditingStateManager();
            expect(manager.isEditingTask('1')).toBe(false);
        });
    });

    describe('subscription options', () => {
        it('filters by onEnterOnly', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback, { onEnterOnly: true });
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.exitEditMode('escape');
            
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0].newState.isEditing).toBe(true);
        });

        it('filters by onExitOnly', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback, { onExitOnly: true });
            
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.exitEditMode('escape');
            
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0].newState.isEditing).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('handles null originalValue', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2', null);
            const ctx = manager.getContext();
            expect(ctx?.originalValue).toBeNull();
        });

        it('handles undefined originalValue', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2', undefined);
            const ctx = manager.getContext();
            expect(ctx?.originalValue).toBeUndefined();
        });

        it('handles empty string originalValue', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2', '');
            const ctx = manager.getContext();
            expect(ctx?.originalValue).toBe('');
        });

        it('handles exit when not editing (no-op)', () => {
            const manager = getEditingStateManager();
            const callback = vi.fn();
            manager.subscribe(callback);
            
            manager.exitEditMode('escape');
            
            expect(callback).not.toHaveBeenCalled();
        });

        it('handles moving to different task', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            manager.moveToCell({ taskId: '2', field: 'name' }, 'enter');
            
            expect(manager.getContext()?.taskId).toBe('2');
        });
    });

    describe('type guards', () => {
        it('isProgrammaticTrigger identifies programmatic triggers', () => {
            expect(isProgrammaticTrigger('programmatic')).toBe(true);
            expect(isProgrammaticTrigger('task-deleted')).toBe(true);
            expect(isProgrammaticTrigger('data-updated')).toBe(true);
            expect(isProgrammaticTrigger('destroy')).toBe(true);
            expect(isProgrammaticTrigger('external')).toBe(true);
            expect(isProgrammaticTrigger('f2')).toBe(false);
            expect(isProgrammaticTrigger('click')).toBe(false);
        });

        it('isUserTrigger identifies user triggers', () => {
            expect(isUserTrigger('f2')).toBe(true);
            expect(isUserTrigger('click')).toBe(true);
            expect(isUserTrigger('escape')).toBe(true);
            expect(isUserTrigger('programmatic')).toBe(false);
            expect(isUserTrigger('task-deleted')).toBe(false);
        });
    });

    describe('debug mode', () => {
        it('enables debug logging', () => {
            const manager = getEditingStateManager();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            
            manager.setDebugMode(true);
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('disables debug logging', () => {
            const manager = getEditingStateManager();
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            
            manager.setDebugMode(false);
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('getState', () => {
        it('returns immutable copy', () => {
            const manager = getEditingStateManager();
            manager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const state1 = manager.getState();
            const state2 = manager.getState();
            
            expect(state1).not.toBe(state2);
            expect(state1).toEqual(state2);
        });
    });
});

