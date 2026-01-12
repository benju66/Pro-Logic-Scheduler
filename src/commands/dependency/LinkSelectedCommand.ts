/**
 * @fileoverview Link Selected Command
 * @module commands/dependency/LinkSelectedCommand
 * 
 * Creates Finish-to-Start dependencies between selected tasks in order.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Dependency, LinkType } from '../../types';

/**
 * Link selected tasks command.
 * 
 * Behavior:
 * - Creates FS (Finish-to-Start) links between selected tasks
 * - Links are created in selection order: task[0] → task[1] → task[2] → ...
 * - Skips parent/summary tasks (can't link them)
 * - Skips if link already exists
 */
export const LinkSelectedCommand: Command = {
    id: 'dependency.linkSelected',
    label: 'Link Selected Tasks',
    category: 'dependency',
    shortcut: 'Ctrl+L',
    icon: '🔗',
    description: 'Create dependencies between selected tasks in order',

    canExecute(ctx: CommandContext): boolean {
        const selectedIds = ctx.selection.getSelectedIds();
        if (selectedIds.length < 2) return false;

        // Need at least 2 non-parent tasks
        const linkable = selectedIds.filter(id => !ctx.controller.isParent(id));
        return linkable.length >= 2;
    },

    execute(ctx: CommandContext): CommandResult {
        const { controller, selection, historyManager, toastService } = ctx;

        // Get selection in order (using selectionOrder from SelectionModel)
        const selectedIds = selection.getSelectionInOrder?.() ?? selection.getSelectedIds();

        if (selectedIds.length < 2) {
            toastService?.warning('Select 2 or more tasks to link');
            return { success: false, message: 'Need 2+ tasks selected' };
        }

        // Filter out parent/summary tasks
        const linkable = selectedIds.filter((id: string) => !controller.isParent(id));

        if (linkable.length < 2) {
            toastService?.warning('Need 2+ non-summary tasks to link');
            return { success: false, message: 'Need 2+ non-summary tasks' };
        }

        historyManager?.beginComposite(`Link ${linkable.length} Tasks`);

        try {
            let linksCreated = 0;

            // Create links: task[0] → task[1] → task[2] → ...
            for (let i = 0; i < linkable.length - 1; i++) {
                const predecessorId = linkable[i];
                const successorId = linkable[i + 1];
                const successor = controller.getTaskById(successorId);

                if (!successor) continue;

                // Skip if link already exists
                const existingDeps = successor.dependencies || [];
                if (existingDeps.some(d => d.id === predecessorId)) {
                    continue;
                }

                // Create new FS dependency
                const newDep: Dependency = {
                    id: predecessorId,
                    type: 'FS' as LinkType,
                    lag: 0
                };

                const newDeps = [...existingDeps, newDep];
                controller.updateTask(successorId, { dependencies: newDeps });
                linksCreated++;
            }

            if (linksCreated === 0) {
                toastService?.info('Tasks are already linked');
                return { success: false, message: 'Already linked' };
            }

            toastService?.success(`Linked ${linkable.length} tasks in sequence`);
            return { success: true, data: { linksCreated } };
        } catch (error) {
            historyManager?.cancelComposite();
            const message = `Failed to link tasks: ${error instanceof Error ? error.message : String(error)}`;
            toastService?.error(message);
            return { success: false, message };
        } finally {
            historyManager?.endComposite();
        }
    }
};
