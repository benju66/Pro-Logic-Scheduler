/**
 * @fileoverview Integration tests for EditingStateManager + KeyboardService
 * @module tests/integration/EditingStateManager-KeyboardService.test
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';
import { KeyboardService } from '../../src/ui/services/KeyboardService';
import type { KeyboardServiceOptions } from '../../src/ui/services/KeyboardService';

describe('EditingStateManager + KeyboardService Integration', () => {
    let editingManager: EditingStateManager;
    let keyboardService: KeyboardService;
    let options: KeyboardServiceOptions;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
        
        options = {
            isAppReady: () => true,
        };
        
        // Clean up previous service if exists
        if (keyboardService) {
            keyboardService.detach();
        }
    });

    afterEach(() => {
        if (keyboardService) {
            keyboardService.detach();
        }
    });

    describe('Keyboard shortcuts blocked when editing', () => {
        beforeEach(() => {
            options = {
                onArrowUp: vi.fn(),
                onArrowDown: vi.fn(),
                onArrowLeft: vi.fn(),
                onArrowRight: vi.fn(),
                onTab: vi.fn(),
                onShiftTab: vi.fn(),
                onDelete: vi.fn(),
                onEscape: vi.fn(),
                isAppReady: () => true,
            };
            keyboardService = new KeyboardService(options);
        });

        it('blocks arrow keys when editing', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const arrowUpEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
            document.dispatchEvent(arrowUpEvent);
            
            expect(options.onArrowUp).not.toHaveBeenCalled();
        });

        it('allows arrow keys when not editing', () => {
            const arrowUpEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
            document.dispatchEvent(arrowUpEvent);
            
            expect(options.onArrowUp).toHaveBeenCalled();
        });

        it('blocks Tab/Shift+Tab when editing', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
            document.dispatchEvent(tabEvent);
            
            expect(options.onTab).not.toHaveBeenCalled();
        });

        it('allows Tab/Shift+Tab when not editing', () => {
            const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
            document.dispatchEvent(tabEvent);
            
            expect(options.onTab).toHaveBeenCalled();
        });

        it('blocks Delete when editing', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const deleteEvent = new KeyboardEvent('keydown', { key: 'Delete' });
            document.dispatchEvent(deleteEvent);
            
            expect(options.onDelete).not.toHaveBeenCalled();
        });
    });

    describe('Ctrl+Enter and Insert exit edit mode', () => {
        beforeEach(() => {
            options = {
                onCtrlEnter: vi.fn(),
                onInsert: vi.fn(),
                onShiftInsert: vi.fn(),
                isAppReady: () => true,
            };
            keyboardService = new KeyboardService(options);
        });

        it('Ctrl+Enter exits edit mode before callback', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const ctrlEnterEvent = new KeyboardEvent('keydown', { 
                key: 'Enter', 
                ctrlKey: true 
            });
            document.dispatchEvent(ctrlEnterEvent);
            
            // Wait for setTimeout
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(editingManager.isEditing()).toBe(false);
                    expect(options.onCtrlEnter).toHaveBeenCalled();
                    resolve();
                }, 100);
            });
        });

        it('Insert exits edit mode before callback', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const insertEvent = new KeyboardEvent('keydown', { key: 'Insert' });
            document.dispatchEvent(insertEvent);
            
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(editingManager.isEditing()).toBe(false);
                    expect(options.onInsert).toHaveBeenCalled();
                    resolve();
                }, 100);
            });
        });

        it('Shift+Insert exits edit mode before callback', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const shiftInsertEvent = new KeyboardEvent('keydown', { 
                key: 'Insert', 
                shiftKey: true 
            });
            document.dispatchEvent(shiftInsertEvent);
            
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(editingManager.isEditing()).toBe(false);
                    expect(options.onShiftInsert).toHaveBeenCalled();
                    resolve();
                }, 100);
            });
        });
    });

    describe('Undo/Redo always active', () => {
        beforeEach(() => {
            options = {
                onUndo: vi.fn(),
                onRedo: vi.fn(),
                isAppReady: () => true,
            };
            keyboardService = new KeyboardService(options);
        });

        it('allows Undo when editing', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const undoEvent = new KeyboardEvent('keydown', { 
                key: 'z', 
                ctrlKey: true 
            });
            document.dispatchEvent(undoEvent);
            
            expect(options.onUndo).toHaveBeenCalled();
        });

        it('allows Redo when editing', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const redoEvent = new KeyboardEvent('keydown', { 
                key: 'y', 
                ctrlKey: true 
            });
            document.dispatchEvent(redoEvent);
            
            expect(options.onRedo).toHaveBeenCalled();
        });
    });

    describe('F2 enters edit mode', () => {
        beforeEach(() => {
            options = {
                onF2: vi.fn(),
                isAppReady: () => true,
            };
            keyboardService = new KeyboardService(options);
        });

        it('F2 triggers callback when not editing', () => {
            const f2Event = new KeyboardEvent('keydown', { key: 'F2' });
            document.dispatchEvent(f2Event);
            
            expect(options.onF2).toHaveBeenCalled();
        });
    });

    describe('Escape handling', () => {
        beforeEach(() => {
            options = {
                onEscape: vi.fn(),
                isAppReady: () => true,
            };
            keyboardService = new KeyboardService(options);
        });

        it('Escape triggers callback when NOT editing', () => {
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escapeEvent);
            
            expect(options.onEscape).toHaveBeenCalled();
        });

        it('Escape does NOT trigger callback when editing (grid handles it)', () => {
            editingManager.enterEditMode({ taskId: '1', field: 'name' }, 'f2');
            
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escapeEvent);
            
            // KeyboardService should not handle Escape when editing
            // (GridRenderer handles it)
            expect(options.onEscape).not.toHaveBeenCalled();
        });
    });
});

