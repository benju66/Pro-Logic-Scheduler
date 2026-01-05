/**
 * @fileoverview Unlink Command
 * @module commands/dependency/UnlinkCommand
 * 
 * Removes all dependencies from the focused task.
 */

import type { Command, CommandContext, CommandResult } from '../types';

interface UnlinkArgs {
    taskId?: string;
    predecessorId?: string; // Optional: remove specific predecessor only
}

/**
 * Unlink command.
 * 
 * Behavior:
 * - Removes all dependencies from the focused task
 * - Can optionally take a taskId to unlink a specific task
 * - Can optionally remove only a specific predecessor
 */
export const UnlinkCommand: Command<UnlinkArgs> = {
    id: 'dependency.unlink',
    label: 'Remove Dependencies',
    category: 'dependency',
    icon: '🔓',
    description: 'Remove dependencies from the focused task',

    canExecute(ctx: CommandContext, args: UnlinkArgs): boolean {
        const taskId = args?.taskId ?? ctx.selection.getFocusedId();
        if (!taskId) return false;

        const task = ctx.controller.getTaskById(taskId);
        if (!task) return false;

        // Must have dependencies to remove
        return (task.dependencies?.length ?? 0) > 0;
    },

    execute(ctx: CommandContext, args: UnlinkArgs): CommandResult {
        const { controller, selection, historyManager, toastService } = ctx;

        const taskId = args?.taskId ?? selection.getFocusedId();
        if (!taskId) {
            return { success: false, message: 'No task focused' };
        }

        const task = controller.getTaskById(taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }

        const existingDeps = task.dependencies || [];
        if (existingDeps.length === 0) {
            toastService?.info('Task has no dependencies');
            return { success: false, message: 'No dependencies' };
        }

        historyManager?.beginComposite('Remove Dependencies');

        try {
            if (args?.predecessorId) {
                // Remove specific predecessor
                const newDeps = existingDeps.filter(d => d.id !== args.predecessorId);
                if (newDeps.length === existingDeps.length) {
                    toastService?.info('Dependency not found');
                    return { success: false, message: 'Dependency not found' };
                }
                controller.updateTask(taskId, { dependencies: newDeps });
                toastService?.success('Dependency removed');
            } else {
                // Remove all dependencies
                controller.updateTask(taskId, { dependencies: [] });
                toastService?.success(`Removed ${existingDeps.length} dependencies`);
            }

            return { success: true };
        } catch (error) {
            historyManager?.cancelComposite();
            const message = `Failed to unlink: ${error instanceof Error ? error.message : String(error)}`;
            toastService?.error(message);
            return { success: false, message };
        } finally {
            historyManager?.endComposite();
        }
    }
};
