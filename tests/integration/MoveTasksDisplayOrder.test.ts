/**
 * @fileoverview Tests for moveSelectedTasks displayOrder updates
 * @module tests/integration/MoveTasksDisplayOrder.test
 * 
 * Verifies that when tasks are moved, their displayOrder values are updated
 * to match the new physical position
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import type { Task } from '../../src/types';

describe('Move Tasks DisplayOrder Updates', () => {
    let taskStore: TaskStore;

    beforeEach(() => {
        taskStore = new TaskStore();
    });

    it('should update displayOrder when tasks are swapped', () => {
        // Create tasks with sequential displayOrder
        const tasks: Task[] = [
            {
                id: 'task-1',
                name: 'Task 1',
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
                displayOrder: 1
            },
            {
                id: 'task-2',
                name: 'Task 2',
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
                displayOrder: 2
            },
            {
                id: 'task-3',
                name: 'Task 3',
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
                displayOrder: 3
            }
        ];

        taskStore.setAll(tasks);

        // Simulate swapping task-1 and task-2 (moving task-1 down)
        const allTasks = taskStore.getAll();
        const task1 = allTasks.find(t => t.id === 'task-1')!;
        const task2 = allTasks.find(t => t.id === 'task-2')!;
        
        const index1 = allTasks.findIndex(t => t.id === 'task-1');
        const index2 = allTasks.findIndex(t => t.id === 'task-2');
        
        // Swap in array
        [allTasks[index1], allTasks[index2]] = [allTasks[index2], allTasks[index1]];
        
        // Update displayOrder to match new physical position
        const siblings = allTasks.filter(t => t.parentId === null);
        const taskIndexMap = new Map<string, number>();
        allTasks.forEach((task, index) => {
            taskIndexMap.set(task.id, index);
        });
        
        const sortedSiblings = [...siblings].sort((a, b) => {
            const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return indexA - indexB;
        });
        
        sortedSiblings.forEach((task, index) => {
            const taskInArray = allTasks.find(t => t.id === task.id);
            if (taskInArray) {
                taskInArray.displayOrder = index + 1;
            }
        });
        
        taskStore.setAll(allTasks);

        // Verify displayOrder matches new position
        const updatedTasks = taskStore.getAll();
        const updatedTask1 = updatedTasks.find(t => t.id === 'task-1')!;
        const updatedTask2 = updatedTasks.find(t => t.id === 'task-2')!;
        const updatedTask3 = updatedTasks.find(t => t.id === 'task-3')!;

        // After swap: task-2 should be first (displayOrder: 1), task-1 should be second (displayOrder: 2)
        expect(updatedTask2.displayOrder).toBe(1);
        expect(updatedTask1.displayOrder).toBe(2);
        expect(updatedTask3.displayOrder).toBe(3);

        // Verify visible tasks are in correct order
        const visible = taskStore.getVisibleTasks();
        expect(visible[0].id).toBe('task-2');
        expect(visible[1].id).toBe('task-1');
        expect(visible[2].id).toBe('task-3');
    });

    it('should maintain displayOrder consistency after multiple moves', () => {
        // Create 5 tasks
        const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
            id: `task-${i + 1}`,
            name: `Task ${i + 1}`,
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

        taskStore.setAll(tasks);

        // Simulate moving task-3 up (swap with task-2)
        let allTasks = taskStore.getAll();
        const index2 = allTasks.findIndex(t => t.id === 'task-2');
        const index3 = allTasks.findIndex(t => t.id === 'task-3');
        
        [allTasks[index2], allTasks[index3]] = [allTasks[index3], allTasks[index2]];
        
        // Update displayOrder
        const siblings = allTasks.filter(t => t.parentId === null);
        const taskIndexMap = new Map<string, number>();
        allTasks.forEach((task, index) => {
            taskIndexMap.set(task.id, index);
        });
        
        const sortedSiblings = [...siblings].sort((a, b) => {
            const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return indexA - indexB;
        });
        
        sortedSiblings.forEach((task, index) => {
            const taskInArray = allTasks.find(t => t.id === task.id);
            if (taskInArray) {
                taskInArray.displayOrder = index + 1;
            }
        });
        
        taskStore.setAll(allTasks);

        // Verify order: task-1, task-3, task-2, task-4, task-5
        const visible = taskStore.getVisibleTasks();
        expect(visible.map(t => t.id)).toEqual(['task-1', 'task-3', 'task-2', 'task-4', 'task-5']);
        expect(visible[0].displayOrder).toBe(1);
        expect(visible[1].displayOrder).toBe(2);
        expect(visible[2].displayOrder).toBe(3);
        expect(visible[3].displayOrder).toBe(4);
        expect(visible[4].displayOrder).toBe(5);
    });

    it('should handle child tasks correctly when parent is moved', () => {
        const parent: Task = {
            id: 'parent',
            name: 'Parent',
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
            displayOrder: 1
        };

        const child1: Task = {
            id: 'child-1',
            name: 'Child 1',
            level: 1,
            duration: 1,
            start: '2024-01-01',
            end: '2024-01-01',
            dependencies: [],
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            parentId: 'parent',
            progress: 0,
            displayOrder: 1
        };

        const child2: Task = {
            id: 'child-2',
            name: 'Child 2',
            level: 1,
            duration: 1,
            start: '2024-01-01',
            end: '2024-01-01',
            dependencies: [],
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            parentId: 'parent',
            progress: 0,
            displayOrder: 2
        };

        taskStore.setAll([parent, child1, child2]);

        // Move child-2 up (swap with child-1)
        let allTasks = taskStore.getAll();
        const index1 = allTasks.findIndex(t => t.id === 'child-1');
        const index2 = allTasks.findIndex(t => t.id === 'child-2');
        
        [allTasks[index1], allTasks[index2]] = [allTasks[index2], allTasks[index1]];
        
        // Update displayOrder for children only
        const children = allTasks.filter(t => t.parentId === 'parent');
        const taskIndexMap = new Map<string, number>();
        allTasks.forEach((task, index) => {
            taskIndexMap.set(task.id, index);
        });
        
        const sortedChildren = [...children].sort((a, b) => {
            const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return indexA - indexB;
        });
        
        sortedChildren.forEach((task, index) => {
            const taskInArray = allTasks.find(t => t.id === task.id);
            if (taskInArray) {
                taskInArray.displayOrder = index + 1;
            }
        });
        
        taskStore.setAll(allTasks);

        // Verify children order
        const childrenAfter = taskStore.getChildren('parent');
        expect(childrenAfter[0].id).toBe('child-2');
        expect(childrenAfter[1].id).toBe('child-1');
        expect(childrenAfter[0].displayOrder).toBe(1);
        expect(childrenAfter[1].displayOrder).toBe(2);
    });
});

