/**
 * @fileoverview Select All Command
 * @module commands/selection/SelectAllCommand
 * 
 * Selects all visible tasks.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Select all visible tasks.
 * 
 * Behavior:
 * - Selects all tasks currently in the project
 * - Sets focus to the first task
 */
export const SelectAllCommand: Command = {
    id: 'selection.selectAll',
    label: 'Select All',
    category: 'selection',
    shortcut: 'Ctrl+A',
    icon: '☑️',
    description: 'Select all tasks',

    canExecute(ctx: CommandContext): boolean {
        return ctx.controller.getTasks().length > 0;
    },

    execute(ctx: CommandContext): CommandResult {
        const allTasks = ctx.controller.getTasks();
        
        if (allTasks.length === 0) {
            ctx.toastService?.info('No tasks to select');
            return { success: false, message: 'No tasks to select' };
        }

        const allIds = allTasks.map(t => t.id);
        ctx.selection.selectAll(allIds);

        // Set focus to first task
        if (allIds.length > 0) {
            ctx.selection.setFocus(allIds[0]);
        }

        ctx.toastService?.info(`Selected ${allIds.length} task(s)`);

        return { success: true, data: { selectedCount: allIds.length } };
    }
};
