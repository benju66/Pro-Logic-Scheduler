/**
 * @fileoverview Toggle Collapse Command
 * @module commands/view/ToggleCollapseCommand
 * 
 * Toggles the collapsed state of the focused parent task.
 */

import type { Command, CommandContext, CommandResult } from '../types';

interface ToggleCollapseArgs {
    taskId?: string;
}

/**
 * Toggle collapse command.
 * 
 * Behavior:
 * - Toggles collapse/expand state of the focused task
 * - Can optionally take a taskId to toggle a specific task
 * - Only works on parent tasks (tasks with children)
 */
export const ToggleCollapseCommand: Command<ToggleCollapseArgs> = {
    id: 'view.toggleCollapse',
    label: 'Toggle Collapse',
    category: 'view',
    shortcut: 'Space',
    icon: '▷',
    description: 'Toggle collapse state of the focused parent task',

    canExecute(ctx: CommandContext, args: ToggleCollapseArgs): boolean {
        const taskId = args?.taskId ?? ctx.selection.getFocusedId();
        if (!taskId) return false;

        // Must be a parent task
        return ctx.controller.isParent(taskId);
    },

    execute(ctx: CommandContext, args: ToggleCollapseArgs): CommandResult {
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
            toastService?.info('Only parent tasks can be collapsed/expanded');
            return { success: false, message: 'Not a parent task' };
        }

        controller.updateTask(taskId, { _collapsed: !task._collapsed });
        
        const action = task._collapsed ? 'expanded' : 'collapsed';
        return { success: true, message: `Task ${action}` };
    }
};
