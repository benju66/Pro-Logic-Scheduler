/**
 * @fileoverview Copy Command
 * @module commands/clipboard/CopyCommand
 * 
 * Copies selected tasks to the clipboard.
 * Includes all descendants of selected parent tasks.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';

/**
 * Copy selected tasks command.
 * 
 * Behavior:
 * - Copies all selected tasks to clipboard
 * - Automatically includes all descendants of parent tasks
 * - Does not modify the original tasks
 * - Can be pasted multiple times
 */
export const CopyCommand: Command = {
    id: 'clipboard.copy',
    label: 'Copy',
    category: 'clipboard',
    shortcut: 'Ctrl+C',
    icon: '📋',
    description: 'Copy selected tasks to clipboard',

    canExecute(ctx: CommandContext): boolean {
        return ctx.selection.getSelectionCount() > 0;
    },

    execute(ctx: CommandContext): CommandResult {
        const selectedIds = ctx.selection.getSelectedIds();
        
        if (selectedIds.length === 0) {
            ctx.toastService?.info('No tasks selected');
            return { success: false, message: 'No tasks selected' };
        }

        const allTasks = ctx.controller.getTasks();
        const selectedSet = new Set(selectedIds);
        const selected = allTasks.filter(t => selectedSet.has(t.id));

        // Include children - for each selected parent, auto-include ALL descendants
        const payload = new Set<Task>();
        
        const getDescendants = (parentId: string): void => {
            ctx.controller.getChildren(parentId).forEach(child => {
                payload.add(child);
                getDescendants(child.id);
            });
        };

        selected.forEach(task => {
            payload.add(task);
            if (ctx.controller.isParent(task.id)) {
                getDescendants(task.id);
            }
        });

        const payloadArray = Array.from(payload);
        const originalIds = payloadArray.map(t => t.id);

        // Store in clipboard
        ctx.clipboardManager.setCopy(payloadArray, originalIds);

        ctx.toastService?.success(`Copied ${payloadArray.length} task(s)`);

        return { 
            success: true, 
            data: { copiedCount: payloadArray.length } 
        };
    }
};
