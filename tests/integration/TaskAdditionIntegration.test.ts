/**
 * @fileoverview Integration tests for task addition - simulates full SchedulerService flow
 * @module tests/integration/TaskAdditionIntegration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Task Addition Integration Tests', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;
    let onChangeCallCount: number;
    let lastVisibleTasks: Task[];

    beforeEach(() => {
        taskStore = new TaskStore({
            onChange: (tasks) => {
                onChangeCallCount++;
                // Simulate what render() does - get visible tasks
                lastVisibleTasks = taskStore.getVisibleTasks();
            }
        });
        operationQueue = new OperationQueue();
        onChangeCallCount = 0;
        lastVisibleTasks = [];
    });

    describe('Full addTask simulation', () => {
        it('should maintain order through onChange callbacks', async () => {
            const addedTasks: Task[] = [];

            // Simulate rapid addTask calls (like rapid clicking)
            for (let i = 0; i < 5; i++) {
                await operationQueue.enqueue(async () => {
                    // Simulate full addTask logic
                    const allTasks = taskStore.getAll();
                    const parentId: string | null = null;
                    
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
                    
                    const updatedTasks = [...allTasks, task];
                    taskStore.setAll(updatedTasks); // This triggers onChange
                    
                    addedTasks.push(task);
                    return task;
                });
            }

            // Verify final state
            const finalTasks = taskStore.getAll();
            expect(finalTasks).toHaveLength(5);
            
            // Verify displayOrder
            finalTasks.forEach((task, index) => {
                expect(task.displayOrder).toBe(index + 1);
            });

            // Verify getVisibleTasks returns correct order
            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(5);
            visible.forEach((task, index) => {
                expect(task.id).toBe(`task-${index}`);
                expect(task.displayOrder).toBe(index + 1);
            });

            // Verify lastVisibleTasks (from onChange callback) is also correct
            expect(lastVisibleTasks).toHaveLength(5);
            lastVisibleTasks.forEach((task, index) => {
                expect(task.id).toBe(`task-${index}`);
            });
        });

        it('should handle concurrent rapid additions correctly', async () => {
            // Simulate multiple rapid clicks happening concurrently
            const promises = Array.from({ length: 10 }, (_, i) =>
                operationQueue.enqueue(async () => {
                    const allTasks = taskStore.getAll();
                    const parentId: string | null = null;
                    
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
                    
                    const updatedTasks = [...allTasks, task];
                    taskStore.setAll(updatedTasks);
                    return task;
                })
            );

            await Promise.all(promises);

            // Verify all tasks are present
            const finalTasks = taskStore.getAll();
            expect(finalTasks).toHaveLength(10);

            // Verify order is correct
            const visible = taskStore.getVisibleTasks();
            expect(visible).toHaveLength(10);
            
            // Check that tasks are in order by displayOrder
            for (let i = 0; i < visible.length; i++) {
                expect(visible[i].displayOrder).toBe(i + 1);
            }
        });
    });

    describe('Order stability after operations', () => {
        it('should maintain order after multiple setAll calls', () => {
            // Add tasks one by one
            for (let i = 0; i < 5; i++) {
                const allTasks = taskStore.getAll();
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
                taskStore.setAll([...allTasks, task]);
            }

            // Verify order
            const visible1 = taskStore.getVisibleTasks();
            expect(visible1.map(t => t.id)).toEqual(['task-0', 'task-1', 'task-2', 'task-3', 'task-4']);

            // Simulate CPM recalculation that might reorder the internal array
            const allTasks = taskStore.getAll();
            // Shuffle the array (simulating what might happen)
            const shuffled = [...allTasks].sort(() => Math.random() - 0.5);
            taskStore.setAll(shuffled);

            // Order should still be correct
            const visible2 = taskStore.getVisibleTasks();
            expect(visible2.map(t => t.id)).toEqual(['task-0', 'task-1', 'task-2', 'task-3', 'task-4']);
        });
    });
});

