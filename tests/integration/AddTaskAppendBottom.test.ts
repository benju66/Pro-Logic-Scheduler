/**
 * @fileoverview Test for ensuring tasks always append to bottom
 * @module tests/integration/AddTaskAppendBottom.test
 * 
 * Simulates the exact user scenario: repeatedly clicking "Add Task"
 * and verifying tasks always appear at the bottom, even if displayOrder
 * values become out of sync
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Add Task Always Appends to Bottom', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    it('should always append to bottom even when displayOrder values are out of sync', async () => {
        // Simulate scenario where displayOrder values are out of sync with physical position
        // This can happen if tasks were reordered without updating displayOrder
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
                displayOrder: 1  // Correct
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
                displayOrder: 10  // WRONG - should be 2, but is 10
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
                displayOrder: 3  // Correct
            }
        ];

        taskStore.setAll(tasks);

        // Now add new tasks repeatedly (simulating rapid clicking)
        for (let i = 0; i < 5; i++) {
            await operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                // Simulate the fixed addTask logic
                const siblings = allTasks.filter(t => t.parentId === parentId);
                
                // Create task index map
                const taskIndexMap = new Map<string, number>();
                allTasks.forEach((task, index) => {
                    taskIndexMap.set(task.id, index);
                });
                
                // Sort siblings by physical position
                const siblingsByPosition = [...siblings].sort((a, b) => {
                    const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                    const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                    return indexA - indexB;
                });
                
                // Normalize displayOrder for siblings
                const normalizedTasks = allTasks.map(task => {
                    const siblingIndex = siblingsByPosition.findIndex(s => s.id === task.id);
                    if (siblingIndex >= 0) {
                        const expectedDisplayOrder = siblingIndex + 1;
                        if (task.displayOrder !== expectedDisplayOrder) {
                            return {
                                ...task,
                                displayOrder: expectedDisplayOrder
                            };
                        }
                    }
                    return task;
                });
                
                // Update if normalization needed
                let workingTasks = allTasks;
                const needsUpdate = normalizedTasks.some((t, idx) => t.displayOrder !== allTasks[idx].displayOrder);
                if (needsUpdate) {
                    taskStore.setAll(normalizedTasks);
                    workingTasks = normalizedTasks;
                }
                
                // Calculate displayOrder for new task
                const siblingCount = workingTasks.filter(t => t.parentId === parentId).length;
                const displayOrder = siblingCount + 1;
                
                const newTask: Task = {
                    id: `new-${i}`,
                    name: `New Task ${i}`,
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
                    displayOrder: displayOrder
                };
                
                taskStore.setAll([...workingTasks, newTask]);
                return newTask;
            });
        }

        // Verify all new tasks are at the bottom
        const visible = taskStore.getVisibleTasks();
        
        // Original tasks should be first (in correct order after normalization)
        expect(visible[0].id).toBe('task-1');
        expect(visible[1].id).toBe('task-2');  // Should be normalized to displayOrder: 2
        expect(visible[2].id).toBe('task-3');
        
        // New tasks should all be at the bottom
        expect(visible[3].id).toBe('new-0');
        expect(visible[4].id).toBe('new-1');
        expect(visible[5].id).toBe('new-2');
        expect(visible[6].id).toBe('new-3');
        expect(visible[7].id).toBe('new-4');
        
        // Verify displayOrder is sequential
        visible.forEach((task, index) => {
            expect(task.displayOrder).toBe(index + 1);
        });
    });

    it('should handle rapid additions with corrupted displayOrder values', async () => {
        // Create tasks with completely wrong displayOrder values
        const tasks: Task[] = Array.from({ length: 10 }, (_, i) => ({
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
            displayOrder: (i + 1) * 100  // Completely wrong values: 100, 200, 300...
        }));

        taskStore.setAll(tasks);

        // Rapidly add 10 new tasks
        const promises = Array.from({ length: 10 }, (_, i) =>
            operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                const siblings = allTasks.filter(t => t.parentId === parentId);
                const taskIndexMap = new Map<string, number>();
                allTasks.forEach((task, index) => {
                    taskIndexMap.set(task.id, index);
                });
                
                const siblingsByPosition = [...siblings].sort((a, b) => {
                    const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                    const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                    return indexA - indexB;
                });
                
                const normalizedTasks = allTasks.map(task => {
                    const siblingIndex = siblingsByPosition.findIndex(s => s.id === task.id);
                    if (siblingIndex >= 0) {
                        const expectedDisplayOrder = siblingIndex + 1;
                        if (task.displayOrder !== expectedDisplayOrder) {
                            return { ...task, displayOrder: expectedDisplayOrder };
                        }
                    }
                    return task;
                });
                
                const needsUpdate = normalizedTasks.some((t, idx) => t.displayOrder !== allTasks[idx].displayOrder);
                let workingTasks = allTasks;
                if (needsUpdate) {
                    taskStore.setAll(normalizedTasks);
                    workingTasks = normalizedTasks;
                }
                
                const siblingCount = workingTasks.filter(t => t.parentId === parentId).length;
                const displayOrder = siblingCount + 1;
                
                const newTask: Task = {
                    id: `new-${i}`,
                    name: `New ${i}`,
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
                    displayOrder: displayOrder
                };
                
                taskStore.setAll([...workingTasks, newTask]);
                return newTask;
            })
        );

        await Promise.all(promises);

        const visible = taskStore.getVisibleTasks();
        expect(visible).toHaveLength(20); // 10 original + 10 new

        // All original tasks should be first
        for (let i = 0; i < 10; i++) {
            expect(visible[i].id).toBe(`task-${i}`);
            expect(visible[i].displayOrder).toBe(i + 1); // Should be normalized
        }

        // All new tasks should be at the bottom
        for (let i = 0; i < 10; i++) {
            expect(visible[10 + i].id).toBe(`new-${i}`);
            expect(visible[10 + i].displayOrder).toBe(11 + i);
        }
    });
});

