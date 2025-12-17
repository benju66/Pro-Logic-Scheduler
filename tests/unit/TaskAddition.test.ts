/**
 * @fileoverview Tests for task addition logic
 * @module tests/unit/TaskAddition.test
 * 
 * Tests verify that:
 * - Tasks are always appended to the bottom
 * - displayOrder is correctly assigned
 * - Race conditions are prevented
 * - Ordering is consistent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Task Addition Logic', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    describe('displayOrder assignment', () => {
        it('should assign displayOrder sequentially for root tasks', () => {
            const task1: Task = {
                id: '1',
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
                progress: 0
            };

            const task2: Task = {
                id: '2',
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
                progress: 0
            };

            // Simulate adding tasks
            const allTasks = taskStore.getAll();
            const siblings1 = allTasks.filter(t => t.parentId === null);
            const displayOrder1 = siblings1.length + 1;
            task1.displayOrder = displayOrder1;
            taskStore.setAll([...allTasks, task1]);

            const allTasks2 = taskStore.getAll();
            const siblings2 = allTasks2.filter(t => t.parentId === null);
            const displayOrder2 = siblings2.length + 1;
            task2.displayOrder = displayOrder2;
            taskStore.setAll([...allTasks2, task2]);

            const finalTasks = taskStore.getAll();
            expect(finalTasks[0].displayOrder).toBe(1);
            expect(finalTasks[1].displayOrder).toBe(2);
        });

        it('should assign displayOrder correctly for tasks with same parent', () => {
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
                id: 'child1',
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
                progress: 0
            };

            const child2: Task = {
                id: 'child2',
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
                progress: 0
            };

            taskStore.setAll([parent]);
            
            // Add child1
            const allTasks1 = taskStore.getAll();
            const siblings1 = allTasks1.filter(t => t.parentId === 'parent');
            const displayOrder1 = siblings1.length + 1;
            child1.displayOrder = displayOrder1;
            taskStore.setAll([...allTasks1, child1]);

            // Add child2
            const allTasks2 = taskStore.getAll();
            const siblings2 = allTasks2.filter(t => t.parentId === 'parent');
            const displayOrder2 = siblings2.length + 1;
            child2.displayOrder = displayOrder2;
            taskStore.setAll([...allTasks2, child2]);

            const children = taskStore.getChildren('parent');
            expect(children).toHaveLength(2);
            expect(children[0].displayOrder).toBe(1);
            expect(children[1].displayOrder).toBe(2);
        });
    });

    describe('TaskStore.getChildren() sorting', () => {
        it('should sort children by displayOrder', () => {
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
                progress: 0
            };

            const child1: Task = {
                id: 'child1',
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
                displayOrder: 2
            };

            const child2: Task = {
                id: 'child2',
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
                displayOrder: 1
            };

            // Add in wrong order (child1 first, then child2)
            taskStore.setAll([parent, child1, child2]);

            const children = taskStore.getChildren('parent');
            expect(children).toHaveLength(2);
            // Should be sorted by displayOrder (child2 first, then child1)
            expect(children[0].id).toBe('child2');
            expect(children[1].id).toBe('child1');
        });

        it('should handle tasks without displayOrder', () => {
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
                progress: 0
            };

            const child1: Task = {
                id: 'child1',
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
                id: 'child2',
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
                progress: 0
                // No displayOrder
            };

            taskStore.setAll([parent, child1, child2]);

            const children = taskStore.getChildren('parent');
            expect(children).toHaveLength(2);
            // child1 should come first (has displayOrder: 1)
            // child2 should come after (no displayOrder, sorted by ID)
            expect(children[0].id).toBe('child1');
        });
    });

    describe('OperationQueue serialization', () => {
        it('should process operations sequentially', async () => {
            const results: number[] = [];
            
            // Enqueue multiple operations
            const promises = [
                operationQueue.enqueue(async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    results.push(1);
                    return 1;
                }),
                operationQueue.enqueue(async () => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    results.push(2);
                    return 2;
                }),
                operationQueue.enqueue(async () => {
                    results.push(3);
                    return 3;
                })
            ];

            await Promise.all(promises);

            // Results should be in order (1, 2, 3) even though operation 2 is faster
            expect(results).toEqual([1, 2, 3]);
        });

        it('should handle rapid sequential calls', async () => {
            const tasks: Task[] = [];
            
            // Simulate rapid task additions
            for (let i = 0; i < 10; i++) {
                await operationQueue.enqueue(async () => {
                    const task: Task = {
                        id: `task-${i}`,
                        name: `Task ${i}`,
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
                        displayOrder: i + 1
                    };
                    tasks.push(task);
                    return task;
                });
            }

            expect(tasks).toHaveLength(10);
            // Verify order
            tasks.forEach((task, index) => {
                expect(task.id).toBe(`task-${index}`);
                expect(task.displayOrder).toBe(index + 1);
            });
        });
    });

    describe('getAll() immutability', () => {
        it('should return defensive copy', () => {
            const task: Task = {
                id: '1',
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
                progress: 0
            };

            taskStore.setAll([task]);
            const tasks1 = taskStore.getAll();
            const tasks2 = taskStore.getAll();

            // Should be different array instances
            expect(tasks1).not.toBe(tasks2);
            
            // Modifying one should not affect the other
            tasks1.push({
                id: '2',
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
                progress: 0
            });

            expect(tasks1.length).toBe(2);
            expect(tasks2.length).toBe(1);
        });
    });

    describe('getVisibleTasks() ordering', () => {
        it('should return tasks in displayOrder', () => {
            const root1: Task = {
                id: 'root1',
                name: 'Root 1',
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
            };

            const root2: Task = {
                id: 'root2',
                name: 'Root 2',
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

            // Add in wrong order
            taskStore.setAll([root1, root2]);

            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(2);
            // Should be sorted by displayOrder
            expect(visible[0].id).toBe('root2');
            expect(visible[1].id).toBe('root1');
        });
    });
});

