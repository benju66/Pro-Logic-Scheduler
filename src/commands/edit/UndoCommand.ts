/**
 * @fileoverview Undo Command
 * @module commands/edit/UndoCommand
 * 
 * Undoes the last action using the HistoryManager.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Undo command.
 * 
 * Behavior:
 * - Reverts the most recent action
 * - Uses HistoryManager's event sourcing for proper undo
 * - Shows toast with description of undone action
 */
export const UndoCommand: Command = {
    id: 'edit.undo',
    label: 'Undo',
    category: 'edit',
    shortcut: 'Ctrl+Z',
    icon: '↩️',
    description: 'Undo the last action',

    canExecute(ctx: CommandContext): boolean {
        return ctx.historyManager?.canUndo() ?? false;
    },

    execute(ctx: CommandContext): CommandResult {
        if (!ctx.historyManager) {
            ctx.toastService?.info('History manager not available');
            return { success: false, message: 'History manager not available' };
        }

        const backwardEvents = ctx.historyManager.undo();
        if (!backwardEvents || backwardEvents.length === 0) {
            ctx.toastService?.info('Nothing to undo');
            return { success: false, message: 'Nothing to undo' };
        }

        // Apply backward events through ProjectController
        // ProjectController handles optimistic updates and worker sync
        ctx.controller.applyEvents(backwardEvents);

        const label = ctx.historyManager.getRedoLabel();
        ctx.toastService?.info(label ? `Undone: ${label}` : 'Undone');

        return { success: true };
    }
};
