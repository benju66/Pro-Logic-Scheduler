/**
 * @fileoverview Indent Command
 * @module commands/hierarchy/IndentCommand
 * 
 * Indents selected tasks, making them children of the task above.
 * Uses getVisibleTasks() to respect collapse state.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Indent selected tasks command.
 * 
 * Behavior:
 * - Indents all selected tasks one level deeper
 * - Only processes top-level selections (children move with parents)
 * - Uses the task directly above as the new parent
 * - Cannot indent if no suitable parent exists above
 */
export const IndentCommand: Command = {
    id: 'hierarchy.indent',
    label: 'Indent Selected Tasks',
    category: 'hierarchy',
    shortcut: 'Tab',
    icon: '→',
    description: 'Make selected tasks children of the task above',

    canExecute(ctx: CommandContext): boolean {
        if (ctx.selection.getSelectionCount() === 0) return false;

        // Check if at least one task can be indented
        const list = ctx.getVisibleTasks();
        const selectedIds = new Set(ctx.selection.getSelectedIds());

        // Find first selected task in visual order
        const firstSelected = list.find(t => selectedIds.has(t.id));
        if (!firstSelected) return false;

        const idx = list.findIndex(t => t.id === firstSelected.id);
        if (idx <= 0) return false; // Can't indent first task

        // Check if previous task can be parent
        const prev = list[idx - 1];
        const taskDepth = ctx.controller.getDepth(firstSelected.id);
        const prevDepth = ctx.controller.getDepth(prev.id);

        // Can only indent if prev is at same or higher depth
        return prevDepth >= taskDepth;
    },

    execute(ctx: CommandContext): CommandResult {
        const list = ctx.getVisibleTasks();
        const selectedIds = new Set(ctx.selection.getSelectedIds());

        // Get top-level selected tasks (parent not in selection)
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );

        let indentedCount = 0;

        for (const task of topLevelSelected) {
            const idx = list.findIndex(t => t.id === task.id);
            if (idx <= 0) continue;

            const prev = list[idx - 1];
            const taskDepth = ctx.controller.getDepth(task.id);
            const prevDepth = ctx.controller.getDepth(prev.id);

            // Can only indent if prev is at same or higher depth
            if (prevDepth < taskDepth) continue;

            let newParentId: string | null = null;
            if (prevDepth === taskDepth) {
                // Prev becomes the new parent
                newParentId = prev.id;
            } else {
                // Walk up to find appropriate parent at same depth
                let curr = prev;
                while (curr && ctx.controller.getDepth(curr.id) > taskDepth) {
                    const parentId = curr.parentId;
                    if (!parentId) break;
                    const parent = ctx.controller.getTaskById(parentId);
                    if (!parent) break;
                    curr = parent;
                }
                if (curr) newParentId = curr.id;
            }

            if (newParentId !== null) {
                const newSortKey = ctx.orderingService.generateAppendKey(
                    ctx.controller.getLastSortKey(newParentId)
                );
                ctx.controller.moveTask(task.id, newParentId, newSortKey);
                indentedCount++;
            }
        }

        if (indentedCount > 0) {
            ctx.toastService?.success(`Indented ${indentedCount} task${indentedCount > 1 ? 's' : ''}`);
        }

        return { success: true, data: { indentedCount } };
    }
};
