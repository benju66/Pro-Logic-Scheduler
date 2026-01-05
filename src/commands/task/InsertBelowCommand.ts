/**
 * @fileoverview Insert Below Command
 * @module commands/task/InsertBelowCommand
 * 
 * Inserts a new task below the currently focused task.
 */

import type { Command, CommandContext, CommandResult } from '../types';
import type { Task } from '../../types';
import { DateUtils } from '../../core/DateUtils';

/**
 * Insert task below the focused task.
 * 
 * Behavior:
 * - Creates a new task as a sibling below the focused task
 * - Uses fractional indexing for sort key
 * - If no task focused, appends to end of root level
 */
export const InsertBelowCommand: Command = {
    id: 'task.insertBelow',
    label: 'Insert Task Below',
    category: 'task',
    shortcut: 'Enter',
    icon: '➕',
    description: 'Insert a new task below the focused task',

    canExecute(_ctx: CommandContext): boolean {
        // Can always insert a task (even if nothing focused, adds to end)
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

                const beforeKey = focusedTask.sortKey;
                const afterKey = (focusedIndex >= 0 && focusedIndex < siblings.length - 1)
                    ? siblings[focusedIndex + 1].sortKey
                    : null;

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
