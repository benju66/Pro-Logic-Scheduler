/**
 * @fileoverview Move Up Command
 * @module commands/hierarchy/MoveUpCommand
 * 
 * Moves the focused task up within its sibling group.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Move focused task up command.
 * 
 * Behavior:
 * - Moves the focused task up one position among its siblings
 * - Uses fractional indexing for efficient reordering
 * - Preserves task hierarchy (parent-child relationships)
 */
export const MoveUpCommand: Command = {
    id: 'hierarchy.moveUp',
    label: 'Move Task Up',
    category: 'hierarchy',
    shortcut: 'Ctrl+ArrowUp',
    icon: '⬆️',
    description: 'Move the focused task up within its sibling group',

    canExecute(ctx: CommandContext): boolean {
        const focusedId = ctx.selection.getFocusedId();
        if (!focusedId) return false;

        const task = ctx.controller.getTaskById(focusedId);
        if (!task) return false;

        const siblings = ctx.controller.getChildren(task.parentId ?? null);
        const currentIndex = siblings.findIndex(t => t.id === task.id);
        
        // Can't move up if already at top
        return currentIndex > 0;
    },

    execute(ctx: CommandContext): CommandResult {
        const { controller, selection, historyManager, toastService, orderingService } = ctx;

        const focusedId = selection.getFocusedId();
        if (!focusedId) {
            return { success: false, message: 'No task focused' };
        }

        const task = controller.getTaskById(focusedId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }

        const siblings = controller.getChildren(task.parentId ?? null);
        const currentIndex = siblings.findIndex(t => t.id === task.id);

        if (currentIndex <= 0) {
            toastService?.info('Task is already at the top');
            return { success: false, message: 'Already at top' };
        }

        historyManager?.beginComposite('Move Task Up');

        try {
            const prevSibling = siblings[currentIndex - 1];
            const beforeKey = currentIndex > 1 ? siblings[currentIndex - 2].sortKey : null;
            const afterKey = prevSibling.sortKey;

            const newSortKey = orderingService.generateInsertKey(beforeKey, afterKey);
            controller.updateSortKey(task.id, newSortKey);

            return { success: true };
        } catch (error) {
            historyManager?.cancelComposite();
            const message = `Failed to move task: ${error instanceof Error ? error.message : String(error)}`;
            toastService?.error(message);
            return { success: false, message };
        } finally {
            historyManager?.endComposite();
        }
    }
};
