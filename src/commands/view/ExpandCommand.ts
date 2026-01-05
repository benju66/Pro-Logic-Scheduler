/**
 * @fileoverview Expand Command
 * @module commands/view/ExpandCommand
 * 
 * Expands the focused parent task to show its children.
 */

import type { Command, CommandContext, CommandResult } from '../types';

interface ExpandArgs {
    taskId?: string;
}

/**
 * Expand command.
 * 
 * Behavior:
 * - Expands the focused task if it's a collapsed parent
 * - Can optionally take a taskId to expand a specific task
 * - Only works on parent tasks (tasks with children)
 */
export const ExpandCommand: Command<ExpandArgs> = {
    id: 'view.expand',
    label: 'Expand',
    category: 'view',
    shortcut: 'Ctrl+ArrowRight',
    icon: '▼',
    description: 'Expand the focused parent task',

    canExecute(ctx: CommandContext, args: ExpandArgs): boolean {
        const taskId = args?.taskId ?? ctx.selection.getFocusedId();
        if (!taskId) return false;

        const task = ctx.controller.getTaskById(taskId);
        if (!task) return false;

        // Must be a parent and currently collapsed
        return ctx.controller.isParent(taskId) && task._collapsed === true;
    },

    execute(ctx: CommandContext, args: ExpandArgs): CommandResult {
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
            toastService?.info('Only parent tasks can be expanded');
            return { success: false, message: 'Not a parent task' };
        }

        if (!task._collapsed) {
            return { success: false, message: 'Already expanded' };
        }

        controller.updateTask(taskId, { _collapsed: false });
        return { success: true };
    }
};
