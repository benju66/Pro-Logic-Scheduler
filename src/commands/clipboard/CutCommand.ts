/**
 * @fileoverview Cut Command
 * @module commands/clipboard/CutCommand
 * 
 * Cuts selected tasks to the clipboard.
 * Original tasks are deleted upon paste (one-time operation).
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';

/**
 * Cut selected tasks command.
 * 
 * Behavior:
 * - Copies selected tasks to clipboard with "cut" flag
 * - Automatically includes all descendants of parent tasks
 * - Original tasks are NOT deleted until paste
 * - Cut can only be pasted once (then clipboard clears)
 */
export const CutCommand: Command = {
    id: 'clipboard.cut',
    label: 'Cut',
    category: 'clipboard',
    shortcut: 'Ctrl+X',
    icon: '✂️',
    description: 'Cut selected tasks (move on paste)',

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

        // Store in clipboard with cut flag
        ctx.clipboardManager.setCut(payloadArray, originalIds);

        ctx.toastService?.success(`Cut ${payloadArray.length} task(s)`);

        return { 
            success: true, 
            data: { cutCount: payloadArray.length } 
        };
    }
};
