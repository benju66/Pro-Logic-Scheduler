/**
 * @fileoverview Tests to verify displayOrder is preserved through CPM recalculation
 * @module tests/integration/CPMRecalculationOrder.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { CPM } from '../../src/core/CPM';
import type { Task, Calendar } from '../../src/types';

describe('CPM Recalculation Order Preservation', () => {
    let taskStore: TaskStore;
    const calendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {}
    };

    beforeEach(() => {
        taskStore = new TaskStore();
    });

    it('should preserve displayOrder after CPM recalculation', () => {
        // Create tasks with displayOrder
        const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
            id: `task-${i}`,
            name: `Task ${i}`,
            level: 0,
            duration: i + 1,
            start: '2024-01-01',
            end: '2024-01-01',
            dependencies: [],
            constraintType: 'asap' as const,
            constraintDate: null,
            notes: '',
            parentId: null,
            progress: 0,
            displayOrder: i + 1
        }));

        taskStore.setAll(tasks);

        // Verify initial order
        const visibleBefore = taskStore.getVisibleTasks();
        expect(visibleBefore.map(t => t.id)).toEqual(['task-0', 'task-1', 'task-2', 'task-3', 'task-4']);

        // Simulate CPM recalculation
        const allTasks = taskStore.getAll();
        const result = CPM.calculate(allTasks, calendar, {
            isParent: (id) => taskStore.isParent(id),
            getDepth: (id) => taskStore.getDepth(id)
        });

        // CPM returns tasks with calculated fields - check if displayOrder is preserved
        result.tasks.forEach((task, index) => {
            const original = allTasks.find(t => t.id === task.id);
            expect(task.displayOrder).toBe(original?.displayOrder);
        });

        // Update tasks with CPM results (simulating recalculateAll)
        const updatedTasks = allTasks.map(task => {
            const calculated = result.tasks.find(t => t.id === task.id);
            if (calculated) {
                // Merge calculated fields but preserve displayOrder
                return {
                    ...task,
                    ...calculated,
                    displayOrder: task.displayOrder // Explicitly preserve
                };
            }
            return task;
        });

        taskStore.setAll(updatedTasks);

        // Verify order is still correct
        const visibleAfter = taskStore.getVisibleTasks();
        expect(visibleAfter.map(t => t.id)).toEqual(['task-0', 'task-1', 'task-2', 'task-3', 'task-4']);
    });

    it('should handle tasks added after CPM calculation', () => {
        // Create initial tasks
        const initialTasks: Task[] = Array.from({ length: 3 }, (_, i) => ({
            id: `task-${i}`,
            name: `Task ${i}`,
            level: 0,
            duration: 1,
            start: '2024-01-01',
            end: '2024-01-01',
            dependencies: [],
            constraintType: 'asap' as const,
            constraintDate: null,
            notes: '',
            parentId: null,
            progress: 0,
            displayOrder: i + 1
        }));

        taskStore.setAll(initialTasks);

        // Run CPM calculation
        const allTasks1 = taskStore.getAll();
        const result1 = CPM.calculate(allTasks1, calendar);
        const updatedTasks1 = allTasks1.map(task => {
            const calculated = result1.tasks.find(t => t.id === task.id);
            return calculated ? { ...task, ...calculated, displayOrder: task.displayOrder } : task;
        });
        taskStore.setAll(updatedTasks1);

        // Add new task (simulating addTask)
        const allTasks2 = taskStore.getAll();
        const newTask: Task = {
            id: 'task-new',
            name: 'New Task',
            level: 0,
            duration: 1,
            start: '2024-01-01',
            end: '2024-01-01',
            dependencies: [],
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            parentId: null,
            progress: 0,
            displayOrder: allTasks2.length + 1
        };

        taskStore.setAll([...allTasks2, newTask]);

        // Verify new task is at the end
        const visible = taskStore.getVisibleTasks();
        expect(visible[visible.length - 1].id).toBe('task-new');
        expect(visible[visible.length - 1].displayOrder).toBe(4);
    });
});

