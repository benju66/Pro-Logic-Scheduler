/**
 * @fileoverview Add Child Command
 * @module commands/task/AddChildCommand
 * 
 * Adds a new task as a child of the currently focused task.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';
import { DateUtils } from '../../core/DateUtils';

/**
 * Add child task to the focused task.
 * 
 * Behavior:
 * - Creates a new task as a child of the focused task
 * - Appends to end of existing children
 * - If no task focused, adds to root level
 */
export const AddChildCommand: Command = {
    id: 'task.addChild',
    label: 'Add Child Task',
    category: 'task',
    shortcut: 'Ctrl+Enter',
    icon: '📁',
    description: 'Add a new task as a child of the focused task',

    canExecute(_ctx: CommandContext): boolean {
        // Can always add a task
        return true;
    },

    execute(ctx: CommandContext): CommandResult {
        const controller = ctx.controller;
        const focusedId = ctx.selection.getFocusedId();

        let parentId: string | null = null;
        let sortKey: string;
        let level = 0;

        if (focusedId) {
            const parentTask = controller.getTaskById(focusedId);
            if (parentTask) {
                // The focused task becomes the parent
                parentId = focusedId;
                level = (parentTask.level || 0) + 1;

                // Get existing children and append after last
                const existingChildren = controller.getChildren(parentId);
                const lastChildKey = existingChildren.length > 0
                    ? existingChildren[existingChildren.length - 1].sortKey
                    : null;

                sortKey = ctx.orderingService.generateInsertKey(lastChildKey, null);
            } else {
                // Parent not found, add to root
                sortKey = ctx.orderingService.generateAppendKey(controller.getLastSortKey(null));
            }
        } else {
            // No focused task, add to root
            sortKey = ctx.orderingService.generateAppendKey(controller.getLastSortKey(null));
        }

        const today = DateUtils.today();

        const newTask: Task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: 'New Task',
            start: today,
            end: today,
            duration: 1,
            parentId,
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            level,
            sortKey,
            _collapsed: false,
        } as Task;

        controller.addTask(newTask);

        // Select and focus the new task
        ctx.selection.setSelection(new Set([newTask.id]), newTask.id, [newTask.id]);

        ctx.toastService?.success('Child task added');

        return { success: true, data: { taskId: newTask.id, parentId } };
    }
};
