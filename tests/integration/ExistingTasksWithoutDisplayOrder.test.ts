/**
 * @fileoverview Tests for handling existing tasks without displayOrder
 * @module tests/integration/ExistingTasksWithoutDisplayOrder.test
 * 
 * This tests the scenario where existing tasks don't have displayOrder
 * and new tasks are added - they should still appear at the bottom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OperationQueue } from '../../src/core/OperationQueue';
import type { Task } from '../../src/types';

describe('Existing Tasks Without displayOrder', () => {
    let taskStore: TaskStore;
    let operationQueue: OperationQueue;

    beforeEach(() => {
        taskStore = new TaskStore();
        operationQueue = new OperationQueue();
    });

    it('should assign displayOrder to new tasks even when existing tasks lack it', async () => {
        // Create existing tasks WITHOUT displayOrder (simulating old data)
        const existingTasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
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
            // No displayOrder!
        }));

        taskStore.setAll(existingTasks);

        // Now add new tasks (simulating addTask calls with migration logic)
        for (let i = 0; i < 3; i++) {
            await operationQueue.enqueue(async () => {
                const allTasks = taskStore.getAll();
                const parentId: string | null = null;
                
                const siblings = allTasks.filter(t => t.parentId === parentId);
                
                // Check if any siblings need displayOrder assigned (migration)
                const siblingsNeedingOrder = siblings.filter(t => t.displayOrder === undefined || t.displayOrder === 0);
                let workingTasks = allTasks;
                
                if (siblingsNeedingOrder.length > 0) {
                    // Get max displayOrder from siblings that already have it
                    const existingMaxOrder = siblings
                        .map(t => t.displayOrder ?? 0)
                        .filter(order => order > 0)
                        .reduce((max, order) => Math.max(max, order), 0);
                    
                    // Assign sequential displayOrder to tasks that need it
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
                    
                    // Update store with migrated displayOrder values
                    taskStore.setAll(workingTasks);
                }
                
                // Calculate displayOrder for new task
                const migratedSiblings = workingTasks.filter(t => t.parentId === parentId);
                const maxDisplayOrder = migratedSiblings.length > 0
                    ? Math.max(...migratedSiblings.map(t => t.displayOrder ?? 0))
                    : 0;
                const displayOrder = maxDisplayOrder + 1;
                
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
            });
        }

        // Check visible tasks
        const visible = taskStore.getVisibleTasks();
        
        console.log('Visible tasks:', visible.map(t => ({ id: t.id, displayOrder: t.displayOrder })));
        
        // After migration, existing tasks should have displayOrder 1-5
        // New tasks should have displayOrder 6, 7, 8
        // So new tasks should be at the bottom
        const lastThree = visible.slice(-3);
        expect(lastThree.map(t => t.id)).toEqual(['new-0', 'new-1', 'new-2']);
        expect(lastThree[0].displayOrder).toBe(6);
        expect(lastThree[1].displayOrder).toBe(7);
        expect(lastThree[2].displayOrder).toBe(8);
    });

    it('should handle mixed displayOrder correctly', () => {
        // Some tasks have displayOrder, some don't
        const tasks: Task[] = [
            {
                id: 'no-order-1',
                name: 'No Order 1',
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
            },
            {
                id: 'with-order-1',
                name: 'With Order 1',
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
                id: 'no-order-2',
                name: 'No Order 2',
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
            }
        ];

        taskStore.setAll(tasks);

        const visible = taskStore.getVisibleTasks();
        console.log('Mixed order:', visible.map(t => ({ id: t.id, displayOrder: t.displayOrder })));
        
        // Task with displayOrder: 1 should come first
        expect(visible[0].id).toBe('with-order-1');
    });
});

