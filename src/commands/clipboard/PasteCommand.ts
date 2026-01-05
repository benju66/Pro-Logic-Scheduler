/**
 * @fileoverview Paste Command
 * @module commands/clipboard/PasteCommand
 * 
 * Pastes tasks from the clipboard.
 * Handles ID remapping, parent relationships, and dependencies.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';

/**
 * Paste tasks command.
 * 
 * Behavior:
 * - Creates new tasks from clipboard with new IDs
 * - Inserts after the focused task (or at end if no focus)
 * - Remaps parent relationships and dependencies
 * - If from cut: deletes original tasks and clears clipboard
 * - Selects the newly pasted tasks
 */
export const PasteCommand: Command = {
    id: 'clipboard.paste',
    label: 'Paste',
    category: 'clipboard',
    shortcut: 'Ctrl+V',
    icon: '📥',
    description: 'Paste tasks from clipboard',

    canExecute(ctx: CommandContext): boolean {
        return ctx.clipboardManager.hasContent();
    },

    execute(ctx: CommandContext): CommandResult {
        if (!ctx.clipboardManager.hasContent()) {
            ctx.toastService?.info('Nothing to paste');
            return { success: false, message: 'Nothing to paste' };
        }

        const clipboardTasks = ctx.clipboardManager.getTasks();
        const isCut = ctx.clipboardManager.isCut();
        const originalIds = ctx.clipboardManager.getOriginalIds();

        // Determine target parent (same parent as focused task, or null)
        const focusedId = ctx.selection.getFocusedId();
        let targetParentId: string | null = null;
        if (focusedId) {
            const focusedTask = ctx.controller.getTaskById(focusedId);
            if (focusedTask) {
                targetParentId = focusedTask.parentId ?? null;
            }
        }

        // Create ID map: oldId → newId
        const idMap = new Map<string, string>();
        clipboardTasks.forEach(task => {
            const newId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            idMap.set(task.id, newId);
        });

        // Clone tasks with new IDs
        const newTasks: Task[] = clipboardTasks.map(task => {
            const cloned = JSON.parse(JSON.stringify(task)) as Task;
            cloned.id = idMap.get(task.id)!;
            return cloned;
        });

        // Remap parentId:
        // - If original parentId exists in idMap → use mapped ID (internal)
        // - Else → use targetParentId (external parent)
        newTasks.forEach(task => {
            if (task.parentId && idMap.has(task.parentId)) {
                task.parentId = idMap.get(task.parentId)!;
            } else {
                task.parentId = targetParentId;
            }
        });

        // Remap dependencies (only internal ones)
        newTasks.forEach(task => {
            task.dependencies = (task.dependencies || [])
                .filter(dep => idMap.has(dep.id))
                .map(dep => ({
                    ...dep,
                    id: idMap.get(dep.id)!
                }));
        });

        // Assign sortKeys
        const pastedTasksByParent = new Map<string | null, Task[]>();
        newTasks.forEach(task => {
            const parentId = task.parentId ?? null;
            if (!pastedTasksByParent.has(parentId)) {
                pastedTasksByParent.set(parentId, []);
            }
            pastedTasksByParent.get(parentId)!.push(task);
        });

        pastedTasksByParent.forEach((pastedSiblings, parentId) => {
            const isTargetLevel = parentId === targetParentId;

            if (isTargetLevel && focusedId) {
                // Insert after focused task
                const focusedTask = ctx.controller.getTaskById(focusedId);
                const siblings = ctx.controller.getChildren(parentId);
                const focusedIndex = siblings.findIndex(t => t.id === focusedId);

                const beforeKey = focusedTask?.sortKey ?? null;
                const afterKey = (focusedIndex >= 0 && focusedIndex < siblings.length - 1)
                    ? siblings[focusedIndex + 1].sortKey
                    : null;

                const sortKeys = ctx.orderingService.generateBulkKeys(
                    beforeKey,
                    afterKey,
                    pastedSiblings.length
                );

                pastedSiblings.forEach((task, index) => {
                    task.sortKey = sortKeys[index];
                });
            } else {
                // Append to end
                const existingLastKey = ctx.controller.getLastSortKey(parentId);
                const sortKeys = ctx.orderingService.generateBulkKeys(
                    existingLastKey,
                    null,
                    pastedSiblings.length
                );

                pastedSiblings.forEach((task, index) => {
                    task.sortKey = sortKeys[index];
                });
            }
        });

        // Add new tasks
        const allTasks = ctx.controller.getTasks();
        const finalTasks = [...allTasks, ...newTasks];
        ctx.controller.syncTasks(finalTasks);

        // If cut: delete originals and clear clipboard
        if (isCut) {
            originalIds.forEach(id => {
                ctx.controller.deleteTask(id);
            });
            ctx.clipboardManager.clear();
        }

        // Select pasted tasks
        const pastedIds = newTasks.map(t => t.id);
        const firstId = newTasks[0]?.id || null;
        ctx.selection.setSelection(new Set(pastedIds), firstId, pastedIds);

        const message = isCut
            ? `Moved ${newTasks.length} task(s)`
            : `Pasted ${newTasks.length} task(s)`;
        ctx.toastService?.success(message);

        return {
            success: true,
            data: { pastedCount: newTasks.length, wasCut: isCut }
        };
    }
};
