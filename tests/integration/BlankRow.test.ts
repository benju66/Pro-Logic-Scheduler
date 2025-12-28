/**
 * @fileoverview Integration tests for blank rows and phantom rows
 * @module tests/integration/BlankRow.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { OrderingService } from '../../src/services/OrderingService';
import type { Task } from '../../src/types';

describe('Blank Row Integration Tests', () => {
    let taskStore: TaskStore;

    beforeEach(() => {
        taskStore = new TaskStore();
    });

    describe('TaskStore blank row operations', () => {
        it('should create a blank row', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            
            expect(blankRow.rowType).toBe('blank');
            expect(blankRow.name).toBe('');
            expect(blankRow.duration).toBe(0);
            expect(blankRow.dependencies).toEqual([]);
            expect(blankRow.id).toMatch(/^blank_/);
        });

        it('should check if a task is a blank row', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            
            expect(taskStore.isBlankRow(blankRow.id)).toBe(true);
            
            const regularTask: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a1',
            };
            taskStore.add(regularTask);
            
            expect(taskStore.isBlankRow(regularTask.id)).toBe(false);
        });

        it('should wake up a blank row to a task', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            const wokenTask = taskStore.wakeUpBlankRow(blankRow.id, 'New Task');
            
            expect(wokenTask).toBeDefined();
            expect(wokenTask?.rowType).toBe('task');
            expect(wokenTask?.name).toBe('New Task');
            expect(wokenTask?.duration).toBe(1);
            expect(wokenTask?.constraintType).toBe('asap');
        });

        it('should return undefined when waking up a non-blank row', () => {
            const regularTask: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a0',
            };
            taskStore.add(regularTask);
            
            const result = taskStore.wakeUpBlankRow(regularTask.id);
            expect(result).toBeUndefined();
        });

        it('should revert a task to blank row', () => {
            const regularTask: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'New Task',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a0',
            };
            taskStore.add(regularTask);
            
            const reverted = taskStore.revertToBlankRow(regularTask.id);
            
            expect(reverted).toBeDefined();
            expect(reverted?.rowType).toBe('blank');
            expect(reverted?.name).toBe('');
            expect(reverted?.duration).toBe(0);
            expect(reverted?.dependencies).toEqual([]);
        });

        it('should get only schedulable tasks', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            const regularTask: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a1',
            };
            taskStore.add(regularTask);
            
            const schedulable = taskStore.getSchedulableTasks();
            
            expect(schedulable).toHaveLength(1);
            expect(schedulable[0].id).toBe(regularTask.id);
            expect(schedulable.find(t => t.id === blankRow.id)).toBeUndefined();
        });
    });

    describe('Blank row ordering', () => {
        it('should maintain sortKey ordering with blank rows', () => {
            const task1: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a0',
            };
            taskStore.add(task1);
            
            // Insert blank row between task1 and task2
            const blankRow = taskStore.createBlankRow(
                OrderingService.generateInsertKey('a0', 'a1'),
                null
            );
            
            const task2: Task = {
                id: 'task2',
                rowType: 'task',
                name: 'Task 2',
                duration: 1,
                start: '',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a1',
            };
            taskStore.add(task2);
            
            const children = taskStore.getChildren(null);
            expect(children).toHaveLength(3);
            expect(children[0].id).toBe('task1');
            expect(children[1].id).toBe(blankRow.id);
            expect(children[2].id).toBe('task2');
        });
    });

    describe('Blank row persistence', () => {
        it('should include rowType in task created event', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            
            // Verify the task was created with rowType
            const storedTask = taskStore.getById(blankRow.id);
            expect(storedTask?.rowType).toBe('blank');
        });
    });
});

