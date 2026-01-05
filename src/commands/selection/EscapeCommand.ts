/**
 * @fileoverview Escape Command
 * @module commands/selection/EscapeCommand
 * 
 * Handles Escape key - clears selection or cancels pending operations.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Handle Escape key press.
 * 
 * Behavior (in priority order):
 * 1. If cut is pending, cancel it
 * 2. Otherwise, clear selection
 * 
 * Note: Drawer close is handled by UI layer before this command.
 */
export const EscapeCommand: Command = {
    id: 'selection.escape',
    label: 'Escape / Clear Selection',
    category: 'selection',
    shortcut: 'Escape',
    icon: '❌',
    description: 'Clear selection or cancel pending operation',

    canExecute(_ctx: CommandContext): boolean {
        // Escape can always be executed
        return true;
    },

    execute(ctx: CommandContext): CommandResult {
        // Check if cut is pending
        if (ctx.clipboardManager.isCut()) {
            ctx.clipboardManager.cancelCut();
            ctx.toastService?.info('Cut cancelled');
            return { success: true, message: 'Cut cancelled' };
        }

        // Clear selection but preserve focus for continued keyboard navigation
        const hadSelection = ctx.selection.getSelectionCount() > 0;
        ctx.selection.clearSelectionOnly();

        if (hadSelection) {
            return { success: true, message: 'Selection cleared' };
        }

        return { success: true, message: 'Nothing to clear' };
    }
};
