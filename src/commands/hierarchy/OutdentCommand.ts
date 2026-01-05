/**
 * @fileoverview Outdent Command
 * @module commands/hierarchy/OutdentCommand
 * 
 * Outdents selected tasks, moving them up one level in the hierarchy.
 */

import type { Command, CommandContext, CommandResult } from '../types';

/**
 * Outdent selected tasks command.
 * 
 * Behavior:
 * - Outdents all selected tasks one level
 * - Only processes top-level selections (children move with parents)
 * - Moves task to be a sibling of its former parent
 * - Cannot outdent tasks already at root level
 */
export const OutdentCommand: Command = {
    id: 'hierarchy.outdent',
    label: 'Outdent Selected Tasks',
    category: 'hierarchy',
    shortcut: 'Shift+Tab',
    icon: '←',
    description: 'Move selected tasks up one level in the hierarchy',

    canExecute(ctx: CommandContext): boolean {
        if (ctx.selection.getSelectionCount() === 0) return false;

        // Can't outdent root-level tasks
        const list = ctx.getVisibleTasks();
        const selectedIds = new Set(ctx.selection.getSelectedIds());
        const firstSelected = list.find(t => selectedIds.has(t.id));

        return !!firstSelected?.parentId;
    },

    execute(ctx: CommandContext): CommandResult {
        const list = ctx.getVisibleTasks();
        const selectedIds = new Set(ctx.selection.getSelectedIds());
        const allTasks = ctx.controller.getTasks();

        // Get top-level selected tasks (parent not in selection)
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );

        let outdentedCount = 0;

        for (const task of topLevelSelected) {
            if (!task.parentId) continue; // Already at root

            const currentParent = allTasks.find(t => t.id === task.parentId);
            const grandparentId = currentParent?.parentId ?? null;

            // Position after former parent among its siblings
            const auntsUncles = ctx.controller.getChildren(grandparentId);
            const formerParentIndex = auntsUncles.findIndex(t => t.id === currentParent?.id);

            const beforeKey = currentParent?.sortKey ?? null;
            const afterKey = formerParentIndex < auntsUncles.length - 1
                ? auntsUncles[formerParentIndex + 1].sortKey
                : null;

            const newSortKey = ctx.orderingService.generateInsertKey(beforeKey, afterKey);

            ctx.controller.updateTask(task.id, {
                parentId: grandparentId,
                sortKey: newSortKey
            });
            outdentedCount++;
        }

        if (outdentedCount > 0) {
            ctx.toastService?.success(`Outdented ${outdentedCount} task${outdentedCount > 1 ? 's' : ''}`);
        }

        return { success: true, data: { outdentedCount } };
    }
};
