/**
 * @fileoverview Tests for race conditions in task addition
 * @module tests/unit/TaskAdditionRaceCondition.test
 * 
 * Simulates the real-world scenario of rapid task additions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Task Addition Race Condition Tests', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    describe('Rapid task additions', () => {
        it('should always append tasks to bottom with correct displayOrder', async () => {
            const addedTasks: Task[] = [];
            
            // Simulate rapid clicking "Add Task" 10 times
            const promises = Array.from({ length: 10 }, (_, i) => 
                operationQueue.enqueue(async () => {
                    // Simulate the addTask logic
                    const allTasks = taskStore.getAll();
                    
                    // Determine parentId (null for root tasks)
                    const parentId: string | null = null;
                    
                    // Calculate displayOrder
                    const siblings = allTasks.filter(t => t.parentId === parentId);
                    let maxDisplayOrder = 0;
                    if (siblings.length > 0) {
                        const displayOrders = siblings
                            .map(t => t.displayOrder ?? 0)
                            .filter(order => order > 0);
                        maxDisplayOrder = displayOrders.length > 0 
                            ? Math.max(...displayOrders) 
                            : siblings.length;
                    }
                    const displayOrder = maxDisplayOrder + 1;
                    
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
                        displayOrder: displayOrder
                    };
                    
                    // Append to bottom
                    const updatedTasks = [...allTasks, task];
                    taskStore.setAll(updatedTasks);
                    
                    addedTasks.push(task);
                    return task;
                })
            );

            await Promise.all(promises);

            // Verify all tasks were added
            const finalTasks = taskStore.getAll();
            expect(finalTasks).toHaveLength(10);

            // Verify they're in the correct order
            finalTasks.forEach((task, index) => {
                expect(task.id).toBe(`task-${index}`);
                expect(task.displayOrder).toBe(index + 1);
            });

            // Verify getVisibleTasks returns them in correct order
            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(10);
            visible.forEach((task, index) => {
                expect(task.id).toBe(`task-${index}`);
                expect(task.displayOrder).toBe(index + 1);
            });
        });

        it('should handle rapid additions with different parentIds', async () => {
            // Create a parent task first
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
            taskStore.setAll([parent]);

            const rootTasks: Task[] = [];
            const childTasks: Task[] = [];

            // Rapidly add 5 root tasks and 5 child tasks
            const promises = [
                // Add root tasks
                ...Array.from({ length: 5 }, (_, i) =>
                    operationQueue.enqueue(async () => {
                        const allTasks = taskStore.getAll();
                        const siblings = allTasks.filter(t => t.parentId === null);
                        const maxDisplayOrder = siblings.length;
                        const displayOrder = maxDisplayOrder + 1;
                        
                        const task: Task = {
                            id: `root-${i}`,
                            name: `Root ${i}`,
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
                        
                        taskStore.setAll([...allTasks, task]);
                        rootTasks.push(task);
                        return task;
                    })
                ),
                // Add child tasks
                ...Array.from({ length: 5 }, (_, i) =>
                    operationQueue.enqueue(async () => {
                        const allTasks = taskStore.getAll();
                        const siblings = allTasks.filter(t => t.parentId === 'parent');
                        const maxDisplayOrder = siblings.length;
                        const displayOrder = maxDisplayOrder + 1;
                        
                        const task: Task = {
                            id: `child-${i}`,
                            name: `Child ${i}`,
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
                            displayOrder: displayOrder
                        };
                        
                        taskStore.setAll([...allTasks, task]);
                        childTasks.push(task);
                        return task;
                    })
                )
            ];

            await Promise.all(promises);

            // Verify root tasks
            const rootChildren = taskStore.getChildren(null);
            const rootTasksInStore = rootChildren.filter(t => t.id !== 'parent');
            expect(rootTasksInStore).toHaveLength(5);
            rootTasksInStore.forEach((task, index) => {
                expect(task.displayOrder).toBe(index + 2); // +2 because parent is 1
            });

            // Verify child tasks
            const children = taskStore.getChildren('parent');
            expect(children).toHaveLength(5);
            children.forEach((task, index) => {
                expect(task.displayOrder).toBe(index + 1);
            });
        });
    });

    describe('Display order consistency', () => {
        it('should maintain order even when tasks are recalculated', () => {
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
                displayOrder: i + 1
            }));

            taskStore.setAll(tasks);

            // Simulate CPM recalculation (which might reorder the array)
            const recalculatedTasks = taskStore.getAll();
            // Shuffle to simulate what might happen
            recalculatedTasks.sort(() => Math.random() - 0.5);
            taskStore.setAll(recalculatedTasks);

            // getVisibleTasks should still return in displayOrder
            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(10);
            visible.forEach((task, index) => {
                expect(task.displayOrder).toBe(index + 1);
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle adding task when no tasks exist', async () => {
            await operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                const siblings = allTasks.filter(t => t.parentId === parentId);
                const displayOrder = siblings.length + 1;
                
                const task: Task = {
                    id: 'first',
                    name: 'First Task',
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
                
                taskStore.setAll([...allTasks, task]);
                return task;
            });

            const tasks = taskStore.getAll();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].displayOrder).toBe(1);
        });

        it('should handle tasks without displayOrder gracefully', () => {
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
                progress: 0,
                displayOrder: 1
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
                // No displayOrder
            };

            taskStore.setAll([task1, task2]);

            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(2);
            // Task with displayOrder should come first
            expect(visible[0].id).toBe('1');
        });
    });
});

