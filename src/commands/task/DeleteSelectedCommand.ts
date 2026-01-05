/**
 * @fileoverview Delete Selected Command
 * @module commands/task/DeleteSelectedCommand
 * 
 * Deletes all currently selected tasks.
 * Uses composite actions for proper undo/redo grouping.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Delete selected tasks command.
 * 
 * Behavior:
 * - Deletes all tasks in the current selection
 * - Groups deletions into a single undo action
 * - Clears selection after deletion
 * - Shows toast with count of deleted tasks
 */
export const DeleteSelectedCommand: Command = {
    id: 'task.delete',
    label: 'Delete Selected Tasks',
    category: 'task',
    shortcut: 'Delete',
    alternateShortcuts: ['Backspace'],
    icon: '🗑️',
    description: 'Delete all selected tasks',

    canExecute(ctx: CommandContext): boolean {
        return ctx.selection.getSelectionCount() > 0;
    },

    execute(ctx: CommandContext): CommandResult {
        const selectedIds = ctx.selection.getSelectedIds();

        if (selectedIds.length === 0) {
            return { success: false, message: 'No tasks selected' };
        }

        // Begin composite for single undo
        ctx.historyManager?.beginComposite(`Delete ${selectedIds.length} Task(s)`);

        try {
            // Delete each task through ProjectController
            // ProjectController handles optimistic updates + worker + persistence
            for (const id of selectedIds) {
                ctx.controller.deleteTask(id);
            }

            ctx.historyManager?.endComposite();

            // Clear selection and focus
            ctx.selection.clear();
            ctx.selection.setFocus(null);

            ctx.toastService?.success(`Deleted ${selectedIds.length} task(s)`);

            return { 
                success: true, 
                data: { deletedCount: selectedIds.length } 
            };
        } catch (error) {
            ctx.historyManager?.cancelComposite();
            throw error;
        }
    }
};
