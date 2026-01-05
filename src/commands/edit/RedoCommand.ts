/**
 * @fileoverview Redo Command
 * @module commands/edit/RedoCommand
 * 
 * Redoes the last undone action using the HistoryManager.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Redo command.
 * 
 * Behavior:
 * - Re-applies the most recently undone action
 * - Uses HistoryManager's event sourcing for proper redo
 * - Shows toast with description of redone action
 */
export const RedoCommand: Command = {
    id: 'edit.redo',
    label: 'Redo',
    category: 'edit',
    shortcut: 'Ctrl+Y',
    alternateShortcuts: ['Ctrl+Shift+Z'],
    icon: '↪️',
    description: 'Redo the last undone action',

    canExecute(ctx: CommandContext): boolean {
        return ctx.historyManager?.canRedo() ?? false;
    },

    execute(ctx: CommandContext): CommandResult {
        if (!ctx.historyManager) {
            ctx.toastService?.info('History manager not available');
            return { success: false, message: 'History manager not available' };
        }

        const forwardEvents = ctx.historyManager.redo();
        if (!forwardEvents || forwardEvents.length === 0) {
            ctx.toastService?.info('Nothing to redo');
            return { success: false, message: 'Nothing to redo' };
        }

        // Apply forward events through ProjectController
        // ProjectController handles optimistic updates and worker sync
        ctx.controller.applyEvents(forwardEvents);

        const label = ctx.historyManager.getUndoLabel();
        ctx.toastService?.info(label ? `Redone: ${label}` : 'Redone');

        return { success: true };
    }
};
