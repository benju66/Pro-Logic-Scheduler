/**
 * @fileoverview Unit tests for CommandService
 * Tests the command registry, execution, and shortcut handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandService } from '../../src/commands/CommandService';
import type { Command, CommandContext } from '../../src/commands/types';

// Import actual commands for integration tests
import { UndoCommand } from '../../src/commands/edit/UndoCommand';
import { RedoCommand } from '../../src/commands/edit/RedoCommand';
import { DeleteSelectedCommand } from '../../src/commands/task/DeleteSelectedCommand';
import { CopyCommand } from '../../src/commands/clipboard/CopyCommand';
import { CutCommand } from '../../src/commands/clipboard/CutCommand';
import { PasteCommand } from '../../src/commands/clipboard/PasteCommand';

// Mock context factory
function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
    return {
        controller: {
            getTasks: vi.fn().mockReturnValue([]),
            getTaskById: vi.fn(),
            getChildren: vi.fn().mockReturnValue([]),
            isParent: vi.fn().mockReturnValue(false),
            getDepth: vi.fn().mockReturnValue(0),
            addTask: vi.fn(),
            updateTask: vi.fn(),
            deleteTask: vi.fn(),
            updateSortKey: vi.fn(),
            getVisibleTasks: vi.fn().mockReturnValue([]),
            getLastSortKey: vi.fn().mockReturnValue(null),
            getAllDescendants: vi.fn().mockReturnValue(new Set()),
            applyEvents: vi.fn(),
            syncTasks: vi.fn(),
        } as any,
        selection: {
            getSelectedIds: vi.fn().mockReturnValue([]),
            getSelectionCount: vi.fn().mockReturnValue(0),
            getFocusedId: vi.fn().mockReturnValue(null),
            setSelection: vi.fn(),
            setFocus: vi.fn(),
            setAnchor: vi.fn(),
            clear: vi.fn(),
            getSelectionOrder: vi.fn().mockReturnValue([]),
        } as any,
        historyManager: {
            canUndo: vi.fn().mockReturnValue(false),
            canRedo: vi.fn().mockReturnValue(false),
            undo: vi.fn().mockReturnValue(null),
            redo: vi.fn().mockReturnValue(null),
            beginComposite: vi.fn(),
            endComposite: vi.fn(),
            cancelComposite: vi.fn(),
            getUndoLabel: vi.fn(),
            getRedoLabel: vi.fn(),
        } as any,
        toastService: {
            info: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as any,
        orderingService: {
            generateAppendKey: vi.fn().mockReturnValue('a0'),
            generatePrependKey: vi.fn().mockReturnValue('a0'),
            generateInsertKey: vi.fn().mockReturnValue('a0'),
            generateBulkKeys: vi.fn().mockReturnValue(['a0', 'a1']),
        } as any,
        tradePartnerStore: {
            getAll: vi.fn().mockReturnValue([]),
        } as any,
        clipboardManager: {
            getClipboard: vi.fn().mockReturnValue({ tasks: null, isCut: false, originalIds: [] }),
            setClipboard: vi.fn(),
            clearClipboard: vi.fn(),
            hasContent: vi.fn().mockReturnValue(false),
        } as any,
        getVisibleTasks: vi.fn().mockReturnValue([]),
        ...overrides,
    };
}

// Mock command factory
function createMockCommand(overrides: Partial<Command> = {}): Command {
    return {
        id: 'test.command',
        label: 'Test Command',
        category: 'debug',
        canExecute: vi.fn().mockReturnValue(true),
        execute: vi.fn().mockReturnValue({ success: true }),
        ...overrides,
    };
}

describe('CommandService', () => {
    beforeEach(() => {
        // Reset singleton between tests
        (CommandService as any).instance = null;
    });

    describe('singleton', () => {
        it('returns the same instance', () => {
            const a = CommandService.getInstance();
            const b = CommandService.getInstance();
            expect(a).toBe(b);
        });
    });

    describe('register', () => {
        it('registers a command', () => {
            const service = CommandService.getInstance();
            const command = createMockCommand({ id: 'test.register' });
            
            service.register(command);
            
            expect(service.getCommand('test.register')).toBe(command);
        });

        it('registers shortcut mapping', () => {
            const service = CommandService.getInstance();
            const command = createMockCommand({ 
                id: 'test.shortcut',
                shortcut: 'Ctrl+T'
            });
            
            service.register(command);
            
            expect(service.hasShortcut('Ctrl+T')).toBe(true);
        });

        it('registers alternate shortcuts', () => {
            const service = CommandService.getInstance();
            const command = createMockCommand({ 
                id: 'test.alt',
                shortcut: 'Ctrl+Y',
                alternateShortcuts: ['Ctrl+Shift+Z']
            });
            
            service.register(command);
            
            expect(service.hasShortcut('Ctrl+Y')).toBe(true);
            expect(service.hasShortcut('Ctrl+Shift+Z')).toBe(true);
        });

        it('warns on duplicate command ID', () => {
            const service = CommandService.getInstance();
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            service.register(createMockCommand({ id: 'test.dup' }));
            service.register(createMockCommand({ id: 'test.dup' }));
            
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('already registered')
            );
            consoleSpy.mockRestore();
        });
    });

    describe('setContext', () => {
        it('stores the context', () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            
            service.setContext(context);
            
            expect(service.getContext()).toBe(context);
        });
    });

    describe('execute', () => {
        it('executes a registered command', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({ id: 'test.exec' });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.execute('test.exec');
            
            expect(result.success).toBe(true);
            expect(command.execute).toHaveBeenCalledWith(context, undefined);
        });

        it('returns error for unregistered command', async () => {
            const service = CommandService.getInstance();
            service.setContext(createMockContext());
            
            const result = await service.execute('nonexistent');
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        it('returns error when context not set', async () => {
            const service = CommandService.getInstance();
            service.register(createMockCommand({ id: 'test.nocontext' }));
            
            const result = await service.execute('test.nocontext');
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('context not set');
        });

        it('checks canExecute before executing', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.canexec',
                canExecute: vi.fn().mockReturnValue(false),
            });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.execute('test.canexec');
            
            expect(result.success).toBe(false);
            expect(command.execute).not.toHaveBeenCalled();
        });

        it('skips canExecute check when force is true', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.force',
                canExecute: vi.fn().mockReturnValue(false),
            });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.execute('test.force', { force: true });
            
            expect(result.success).toBe(true);
            expect(command.execute).toHaveBeenCalled();
        });

        it('passes args to command', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({ id: 'test.args' });
            
            service.setContext(context);
            service.register(command);
            
            await service.execute('test.args', { args: { taskId: '123' } });
            
            expect(command.execute).toHaveBeenCalledWith(context, { taskId: '123' });
        });

        it('handles async commands', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.async',
                execute: vi.fn().mockResolvedValue({ success: true, message: 'async done' }),
            });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.execute('test.async');
            
            expect(result.success).toBe(true);
            expect(result.message).toBe('async done');
        });

        it('catches and reports errors', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.error',
                execute: vi.fn().mockImplementation(() => {
                    throw new Error('Test error');
                }),
            });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.execute('test.error');
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Test error');
        });
    });

    describe('executeShortcut', () => {
        it('executes command by shortcut', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.shortcut',
                shortcut: 'Ctrl+S',
            });
            
            service.setContext(context);
            service.register(command);
            
            const result = await service.executeShortcut('Ctrl+S');
            
            expect(result).not.toBeNull();
            expect(result!.success).toBe(true);
        });

        it('returns null for unregistered shortcut', async () => {
            const service = CommandService.getInstance();
            service.setContext(createMockContext());
            
            const result = await service.executeShortcut('Ctrl+Unknown');
            
            expect(result).toBeNull();
        });
    });

    describe('canExecute', () => {
        it('returns true when command can execute', () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.can',
                canExecute: vi.fn().mockReturnValue(true),
            });
            
            service.setContext(context);
            service.register(command);
            
            expect(service.canExecute('test.can')).toBe(true);
        });

        it('returns false when command cannot execute', () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.cannot',
                canExecute: vi.fn().mockReturnValue(false),
            });
            
            service.setContext(context);
            service.register(command);
            
            expect(service.canExecute('test.cannot')).toBe(false);
        });

        it('returns false for unregistered command', () => {
            const service = CommandService.getInstance();
            service.setContext(createMockContext());
            
            expect(service.canExecute('nonexistent')).toBe(false);
        });

        it('returns false when context not set', () => {
            const service = CommandService.getInstance();
            service.register(createMockCommand({ id: 'test.nocontext2' }));
            
            expect(service.canExecute('test.nocontext2')).toBe(false);
        });
    });

    describe('getAllCommands', () => {
        it('returns all registered commands', () => {
            const service = CommandService.getInstance();
            service.register(createMockCommand({ id: 'cmd1' }));
            service.register(createMockCommand({ id: 'cmd2' }));
            service.register(createMockCommand({ id: 'cmd3' }));
            
            const commands = service.getAllCommands();
            
            expect(commands).toHaveLength(3);
            expect(commands.map(c => c.id)).toContain('cmd1');
            expect(commands.map(c => c.id)).toContain('cmd2');
            expect(commands.map(c => c.id)).toContain('cmd3');
        });
    });

    describe('getCommandsByCategory', () => {
        it('filters commands by category', () => {
            const service = CommandService.getInstance();
            service.register(createMockCommand({ id: 'task1', category: 'task' }));
            service.register(createMockCommand({ id: 'task2', category: 'task' }));
            service.register(createMockCommand({ id: 'edit1', category: 'edit' }));
            
            const taskCommands = service.getCommandsByCategory('task');
            
            expect(taskCommands).toHaveLength(2);
            expect(taskCommands.every(c => c.category === 'task')).toBe(true);
        });
    });

    describe('getEnabledCommands', () => {
        it('returns only commands that can execute', () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            
            service.setContext(context);
            service.register(createMockCommand({ 
                id: 'enabled', 
                canExecute: () => true 
            }));
            service.register(createMockCommand({ 
                id: 'disabled', 
                canExecute: () => false 
            }));
            
            const enabled = service.getEnabledCommands();
            
            expect(enabled).toHaveLength(1);
            expect(enabled[0].id).toBe('enabled');
        });
    });

    describe('getStats', () => {
        it('returns correct statistics', () => {
            const service = CommandService.getInstance();
            service.register(createMockCommand({ id: 'task1', category: 'task', shortcut: 'Delete' }));
            service.register(createMockCommand({ id: 'task2', category: 'task', shortcut: 'Enter' }));
            service.register(createMockCommand({ id: 'edit1', category: 'edit', shortcut: 'Ctrl+Z' }));
            
            const stats = service.getStats();
            
            expect(stats.commandCount).toBe(3);
            expect(stats.shortcutCount).toBe(3);
            expect(stats.categories.task).toBe(2);
            expect(stats.categories.edit).toBe(1);
        });
    });

    describe('canExecute$', () => {
        it('emits initial canExecute state', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            const command = createMockCommand({
                id: 'test.observable',
                canExecute: vi.fn().mockReturnValue(true),
            });
            
            service.setContext(context);
            service.register(command);
            
            const values: boolean[] = [];
            const subscription = service.canExecute$('test.observable').subscribe(v => values.push(v));
            
            // Wait for initial emission
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(values).toContain(true);
            subscription.unsubscribe();
        });

        it('emits updated state on notifyStateChange', async () => {
            const service = CommandService.getInstance();
            const context = createMockContext();
            let canExec = false;
            const command = createMockCommand({
                id: 'test.reactive',
                canExecute: vi.fn().mockImplementation(() => canExec),
            });
            
            service.setContext(context);
            service.register(command);
            
            const values: boolean[] = [];
            const subscription = service.canExecute$('test.reactive').subscribe(v => values.push(v));
            
            // Wait for initial emission
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Change state and notify
            canExec = true;
            service.notifyStateChange();
            
            // Wait for emission
            await new Promise(resolve => setTimeout(resolve, 10));
            
            expect(values).toContain(false);
            expect(values).toContain(true);
            subscription.unsubscribe();
        });
    });
});

describe('Command Integration', () => {
    beforeEach(() => {
        (CommandService as any).instance = null;
    });

    describe('UndoCommand behavior', () => {
        it('cannot execute when nothing to undo', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                historyManager: {
                    canUndo: vi.fn().mockReturnValue(false),
                    canRedo: vi.fn().mockReturnValue(false),
                } as any,
            });
            
            service.setContext(context);
            service.register(UndoCommand);
            
            expect(service.canExecute('edit.undo')).toBe(false);
        });

        it('can execute when history has entries', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                historyManager: {
                    canUndo: vi.fn().mockReturnValue(true),
                    canRedo: vi.fn().mockReturnValue(false),
                } as any,
            });
            
            service.setContext(context);
            service.register(UndoCommand);
            
            expect(service.canExecute('edit.undo')).toBe(true);
        });
    });

    describe('DeleteSelectedCommand behavior', () => {
        it('cannot execute when nothing selected', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                selection: {
                    getSelectedIds: vi.fn().mockReturnValue([]),
                    getSelectionCount: vi.fn().mockReturnValue(0),
                } as any,
            });
            
            service.setContext(context);
            service.register(DeleteSelectedCommand);
            
            expect(service.canExecute('task.delete')).toBe(false);
        });

        it('can execute when tasks are selected', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                selection: {
                    getSelectedIds: vi.fn().mockReturnValue(['task1', 'task2']),
                    getSelectionCount: vi.fn().mockReturnValue(2),
                } as any,
            });
            
            service.setContext(context);
            service.register(DeleteSelectedCommand);
            
            expect(service.canExecute('task.delete')).toBe(true);
        });
    });

    describe('ClipboardCommands behavior', () => {
        it('copy cannot execute when nothing selected', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                selection: {
                    getSelectedIds: vi.fn().mockReturnValue([]),
                    getSelectionCount: vi.fn().mockReturnValue(0),
                } as any,
            });
            
            service.setContext(context);
            service.register(CopyCommand);
            
            expect(service.canExecute('clipboard.copy')).toBe(false);
        });

        it('paste cannot execute when clipboard is empty', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                clipboardManager: {
                    hasContent: vi.fn().mockReturnValue(false),
                } as any,
            });
            
            service.setContext(context);
            service.register(PasteCommand);
            
            expect(service.canExecute('clipboard.paste')).toBe(false);
        });

        it('paste can execute when clipboard has content', () => {
            const service = CommandService.getInstance();
            const context = createMockContext({
                clipboardManager: {
                    hasContent: vi.fn().mockReturnValue(true),
                    getClipboard: vi.fn().mockReturnValue({ tasks: [{}], isCut: false, originalIds: ['1'] }),
                } as any,
            });
            
            service.setContext(context);
            service.register(PasteCommand);
            
            expect(service.canExecute('clipboard.paste')).toBe(true);
        });
    });
});
