/**
 * @fileoverview Bulletproof test for addTask - simulates exact user scenario
 * @module tests/integration/AddTaskBulletproof.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Bulletproof AddTask - Repeated Clicks', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    it('should ALWAYS append to bottom with 100 rapid clicks', async () => {
        const addedTaskIds: string[] = [];

        // Simulate 100 rapid "Add Task" clicks
        const promises = Array.from({ length: 100 }, (_, i) =>
            operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                // Simulate the bulletproof addTask logic
                const tasksByParent = new Map<string | null, Task[]>();
                allTasks.forEach(task => {
                    const pid = task.parentId ?? null;
                    if (!tasksByParent.has(pid)) {
                        tasksByParent.set(pid, []);
                    }
                    tasksByParent.get(pid)!.push(task);
                });
                
                const taskIndexMap = new Map<string, number>();
                allTasks.forEach((task, index) => {
                    taskIndexMap.set(task.id, index);
                });
                
                const normalizedTasks = allTasks.map(task => {
                    const pid = task.parentId ?? null;
                    const siblings = tasksByParent.get(pid) || [];
                    const sortedSiblings = [...siblings].sort((a, b) => {
                        const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                        const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                        return indexA - indexB;
                    });
                    
                    const position = sortedSiblings.findIndex(s => s.id === task.id);
                    if (position >= 0) {
                        return {
                            ...task,
                            displayOrder: position + 1
                        };
                    }
                    return task;
                });
                
                const siblings = normalizedTasks.filter(t => t.parentId === parentId);
                const displayOrder = siblings.length + 1;
                
                const newTask: Task = {
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
                
                const finalTasks = [...normalizedTasks, newTask];
                taskStore.setAll(finalTasks);
                
                addedTaskIds.push(newTask.id);
                return newTask;
            })
        );

        await Promise.all(promises);

        // Verify all tasks are present
        const finalTasks = taskStore.getAll();
        expect(finalTasks).toHaveLength(100);

        // Verify order - ALL tasks should be in sequential order
        const visible = taskStore.getVisibleTasks();
        expect(visible).toHaveLength(100);
        
        // Verify displayOrder is sequential (1, 2, 3... 100)
        visible.forEach((task, index) => {
            expect(task.displayOrder).toBe(index + 1);
            expect(task.id).toBe(`task-${index}`);
        });
        
        // Verify no duplicates
        const ids = visible.map(t => t.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(100);
    });

    it('should handle worst-case scenario: tasks with completely wrong displayOrder', async () => {
        // Create 20 tasks with completely wrong displayOrder values
        const tasks: Task[] = Array.from({ length: 20 }, (_, i) => ({
            id: `existing-${i}`,
            name: `Existing ${i}`,
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
            displayOrder: (i + 1) * 1000  // Completely wrong: 1000, 2000, 3000...
        }));

        taskStore.setAll(tasks);

        // Add 10 new tasks
        for (let i = 0; i < 10; i++) {
            await operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                const tasksByParent = new Map<string | null, Task[]>();
                allTasks.forEach(task => {
                    const pid = task.parentId ?? null;
                    if (!tasksByParent.has(pid)) {
                        tasksByParent.set(pid, []);
                    }
                    tasksByParent.get(pid)!.push(task);
                });
                
                const taskIndexMap = new Map<string, number>();
                allTasks.forEach((task, index) => {
                    taskIndexMap.set(task.id, index);
                });
                
                const normalizedTasks = allTasks.map(task => {
                    const pid = task.parentId ?? null;
                    const siblings = tasksByParent.get(pid) || [];
                    const sortedSiblings = [...siblings].sort((a, b) => {
                        const indexA = taskIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                        const indexB = taskIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                        return indexA - indexB;
                    });
                    
                    const position = sortedSiblings.findIndex(s => s.id === task.id);
                    if (position >= 0) {
                        return {
                            ...task,
                            displayOrder: position + 1
                        };
                    }
                    return task;
                });
                
                const siblings = normalizedTasks.filter(t => t.parentId === parentId);
                const displayOrder = siblings.length + 1;
                
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
                
                const finalTasks = [...normalizedTasks, newTask];
                taskStore.setAll(finalTasks);
                return newTask;
            });
        }

        const visible = taskStore.getVisibleTasks();
        expect(visible).toHaveLength(30); // 20 existing + 10 new

        // All existing tasks should be first (normalized to 1-20)
        for (let i = 0; i < 20; i++) {
            expect(visible[i].id).toBe(`existing-${i}`);
            expect(visible[i].displayOrder).toBe(i + 1);
        }

        // All new tasks should be at bottom (21-30)
        for (let i = 0; i < 10; i++) {
            expect(visible[20 + i].id).toBe(`new-${i}`);
            expect(visible[20 + i].displayOrder).toBe(21 + i);
        }
    });
});

