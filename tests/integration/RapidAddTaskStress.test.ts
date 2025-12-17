/**
 * @fileoverview Stress test for rapid task additions
 * @module tests/integration/RapidAddTaskStress.test
 * 
 * Simulates the exact user scenario: rapid clicking "Add Task"
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Rapid Add Task Stress Test', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    it('should handle 50 rapid task additions correctly', async () => {
        const addedTaskIds: string[] = [];

        // Simulate rapid clicking - fire all requests at once
        const promises = Array.from({ length: 50 }, (_, i) =>
            operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                const siblings = allTasks.filter(t => t.parentId === parentId);
                
                // Migration logic
                const siblingsNeedingOrder = siblings.filter(t => t.displayOrder === undefined || t.displayOrder === 0);
                let workingTasks = allTasks;
                
                if (siblingsNeedingOrder.length > 0) {
                    const existingMaxOrder = siblings
                        .map(t => t.displayOrder ?? 0)
                        .filter(order => order > 0)
                        .reduce((max, order) => Math.max(max, order), 0);
                    
                    workingTasks = allTasks.map(task => {
                        if (siblingsNeedingOrder.some(t => t.id === task.id)) {
                            const index = siblingsNeedingOrder.findIndex(t => t.id === task.id);
                            return {
                                ...task,
                                displayOrder: existingMaxOrder + index + 1
                            };
                        }
                        return task;
                    });
                    
                    taskStore.setAll(workingTasks);
                }
                
                const migratedSiblings = workingTasks.filter(t => t.parentId === parentId);
                const maxDisplayOrder = migratedSiblings.length > 0
                    ? Math.max(...migratedSiblings.map(t => t.displayOrder ?? 0))
                    : 0;
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
                
                taskStore.setAll([...workingTasks, task]);
                addedTaskIds.push(task.id);
                return task;
            })
        );

        await Promise.all(promises);

        // Verify all tasks were added
        const finalTasks = taskStore.getAll();
        expect(finalTasks).toHaveLength(50);

        // Verify order is correct
        const visible = taskStore.getVisibleTasks();
        expect(visible).toHaveLength(50);
        
        // All tasks should be in order by displayOrder
        for (let i = 0; i < visible.length; i++) {
            expect(visible[i].displayOrder).toBe(i + 1);
        }

        // Verify no duplicates
        const ids = visible.map(t => t.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(50);
    });

    it('should handle rapid additions with existing tasks', async () => {
        // Create 10 existing tasks without displayOrder
        const existingTasks: Task[] = Array.from({ length: 10 }, (_, i) => ({
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
            progress: 0
        }));

        taskStore.setAll(existingTasks);

        // Rapidly add 20 new tasks
        const promises = Array.from({ length: 20 }, (_, i) =>
            operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                const siblings = allTasks.filter(t => t.parentId === parentId);
                const siblingsNeedingOrder = siblings.filter(t => t.displayOrder === undefined || t.displayOrder === 0);
                let workingTasks = allTasks;
                
                if (siblingsNeedingOrder.length > 0) {
                    const existingMaxOrder = siblings
                        .map(t => t.displayOrder ?? 0)
                        .filter(order => order > 0)
                        .reduce((max, order) => Math.max(max, order), 0);
                    
                    workingTasks = allTasks.map(task => {
                        if (siblingsNeedingOrder.some(t => t.id === task.id)) {
                            const index = siblingsNeedingOrder.findIndex(t => t.id === task.id);
                            return {
                                ...task,
                                displayOrder: existingMaxOrder + index + 1
                            };
                        }
                        return task;
                    });
                    
                    taskStore.setAll(workingTasks);
                }
                
                const migratedSiblings = workingTasks.filter(t => t.parentId === parentId);
                const maxDisplayOrder = migratedSiblings.length > 0
                    ? Math.max(...migratedSiblings.map(t => t.displayOrder ?? 0))
                    : 0;
                const displayOrder = maxDisplayOrder + 1;
                
                const task: Task = {
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
                
                taskStore.setAll([...workingTasks, task]);
                return task;
            })
        );

        await Promise.all(promises);

        const visible = taskStore.getVisibleTasks();
        expect(visible).toHaveLength(30); // 10 existing + 20 new

        // First 10 should be existing tasks (displayOrder 1-10)
        // Last 20 should be new tasks (displayOrder 11-30)
        const firstTen = visible.slice(0, 10);
        const lastTwenty = visible.slice(10);

        expect(firstTen.every(t => t.id.startsWith('existing-'))).toBe(true);
        expect(lastTwenty.every(t => t.id.startsWith('new-'))).toBe(true);
        expect(lastTwenty[0].displayOrder).toBe(11);
        expect(lastTwenty[19].displayOrder).toBe(30);
    });
});

