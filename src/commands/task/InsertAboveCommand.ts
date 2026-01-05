/**
 * @fileoverview Insert Above Command
 * @module commands/task/InsertAboveCommand
 * 
 * Inserts a new task above the currently focused task.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';
import { DateUtils } from '../../core/DateUtils';

/**
 * Insert task above the focused task.
 * 
 * Behavior:
 * - Creates a new task as a sibling above the focused task
 * - Uses fractional indexing for sort key
 * - If no task focused, appends to end of root level
 */
export const InsertAboveCommand: Command = {
    id: 'task.insertAbove',
    label: 'Insert Task Above',
    category: 'task',
    shortcut: 'Shift+Enter',
    icon: '➕',
    description: 'Insert a new task above the focused task',

    canExecute(_ctx: CommandContext): boolean {
        // Can always insert a task
        return true;
    },

    execute(ctx: CommandContext): CommandResult {
        const controller = ctx.controller;
        const focusedId = ctx.selection.getFocusedId();

        // Determine insertion point
        let parentId: string | null = null;
        let sortKey: string;
        let level = 0;

        if (focusedId) {
            const focusedTask = controller.getTaskById(focusedId);
            if (focusedTask) {
                parentId = focusedTask.parentId ?? null;
                level = focusedTask.level || 0;

                // Get siblings and find insertion position
                const siblings = controller.getChildren(parentId);
                const focusedIndex = siblings.findIndex(t => t.id === focusedId);

                // Insert ABOVE: before focused task
                const beforeKey = focusedIndex > 0 ? siblings[focusedIndex - 1].sortKey : null;
                const afterKey = focusedTask.sortKey;

                sortKey = ctx.orderingService.generateInsertKey(beforeKey, afterKey);
            } else {
                // Focused task not found, append to root
                sortKey = ctx.orderingService.generateAppendKey(controller.getLastSortKey(null));
            }
        } else {
            // No focused task, append to root
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

        ctx.toastService?.success('Task added');

        return { success: true, data: { taskId: newTask.id } };
    }
};
