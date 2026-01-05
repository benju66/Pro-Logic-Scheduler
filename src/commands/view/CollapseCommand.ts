/**
 * @fileoverview Collapse Command
 * @module commands/view/CollapseCommand
 * 
 * Collapses the focused parent task to hide its children.
 */

import type { Command, CommandContext, CommandResult } from '../types';

interface CollapseArgs {
    taskId?: string;
}

/**
 * Collapse command.
 * 
 * Behavior:
 * - Collapses the focused task if it's a parent
 * - Can optionally take a taskId to collapse a specific task
 * - Only works on parent tasks (tasks with children)
 */
export const CollapseCommand: Command<CollapseArgs> = {
    id: 'view.collapse',
    label: 'Collapse',
    category: 'view',
    shortcut: 'Ctrl+ArrowLeft',
    icon: '▶',
    description: 'Collapse the focused parent task',

    canExecute(ctx: CommandContext, args: CollapseArgs): boolean {
        const taskId = args?.taskId ?? ctx.selection.getFocusedId();
        if (!taskId) return false;

        const task = ctx.controller.getTaskById(taskId);
        if (!task) return false;

        // Must be a parent and currently expanded
        return ctx.controller.isParent(taskId) && !task._collapsed;
    },

    execute(ctx: CommandContext, args: CollapseArgs): CommandResult {
        const { controller, selection, toastService } = ctx;

        const taskId = args?.taskId ?? selection.getFocusedId();
        if (!taskId) {
            return { success: false, message: 'No task focused' };
        }

        const task = controller.getTaskById(taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }

        if (!controller.isParent(taskId)) {
            toastService?.info('Only parent tasks can be collapsed');
            return { success: false, message: 'Not a parent task' };
        }

        if (task._collapsed) {
            return { success: false, message: 'Already collapsed' };
        }

        controller.updateTask(taskId, { _collapsed: true });
        return { success: true };
    }
};
