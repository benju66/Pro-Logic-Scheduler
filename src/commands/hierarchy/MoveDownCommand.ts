/**
 * @fileoverview Move Down Command
 * @module commands/hierarchy/MoveDownCommand
 * 
 * Moves the focused task down within its sibling group.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Move focused task down command.
 * 
 * Behavior:
 * - Moves the focused task down one position among its siblings
 * - Uses fractional indexing for efficient reordering
 * - Preserves task hierarchy (parent-child relationships)
 */
export const MoveDownCommand: Command = {
    id: 'hierarchy.moveDown',
    label: 'Move Task Down',
    category: 'hierarchy',
    shortcut: 'Ctrl+ArrowDown',
    icon: '⬇️',
    description: 'Move the focused task down within its sibling group',

    canExecute(ctx: CommandContext): boolean {
        const focusedId = ctx.selection.getFocusedId();
        if (!focusedId) return false;

        const task = ctx.controller.getTaskById(focusedId);
        if (!task) return false;

        const siblings = ctx.controller.getChildren(task.parentId ?? null);
        const currentIndex = siblings.findIndex(t => t.id === task.id);
        
        // Can't move down if already at bottom
        return currentIndex >= 0 && currentIndex < siblings.length - 1;
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

        if (currentIndex < 0 || currentIndex >= siblings.length - 1) {
            toastService?.info('Task is already at the bottom');
            return { success: false, message: 'Already at bottom' };
        }

        historyManager?.beginComposite('Move Task Down');

        try {
            const nextSibling = siblings[currentIndex + 1];
            const beforeKey = nextSibling.sortKey;
            const afterKey = currentIndex < siblings.length - 2 ? siblings[currentIndex + 2].sortKey : null;

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
