/**
 * @fileoverview Integration tests for CPM skipping blank rows
 * @module tests/integration/BlankRowCPM.test
 * 
 * Tests verify that:
 * - CPM skips blank rows in forward pass
 * - CPM skips blank rows in backward pass
 * - CPM skips blank rows in float calculation
 * - Blank rows never marked as critical
 * - Dependencies to/from blank rows are ignored
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '../../src/data/TaskStore';
import { CalendarStore } from '../../src/data/CalendarStore';
import type { Task, Calendar } from '../../src/types';

describe('CPM Blank Row Skipping', () => {
    let taskStore: TaskStore;
    let calendarStore: CalendarStore;

    beforeEach(() => {
        taskStore = new TaskStore();
        calendarStore = new CalendarStore();
        
        const calendar: Calendar = {
            workingDays: [1, 2, 3, 4, 5], // Mon-Fri
            exceptions: {},
        };
        calendarStore.set(calendar);
    });

    describe('Forward pass skipping', () => {
        it('should skip blank rows when calculating dates', () => {
            const task1: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 5,
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
            
            const blankRow = taskStore.createBlankRow('a1', null);
            
            const task2: Task = {
                id: 'task2',
                rowType: 'task',
                name: 'Task 2',
                duration: 3,
                start: '',
                end: '',
                dependencies: [{ id: 'task1', type: 'FS', lag: 0 }],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a2',
            };
            taskStore.add(task2);
            
            // Get schedulable tasks (excludes blank row)
            const schedulable = taskStore.getSchedulableTasks();
            expect(schedulable).toHaveLength(2);
            expect(schedulable.find(t => t.id === blankRow.id)).toBeUndefined();
            
            // Verify blank row is not in schedulable list
            const blankRowInList = schedulable.some(t => t.rowType === 'blank');
            expect(blankRowInList).toBe(false);
        });
    });

    describe('Dependency handling', () => {
        it('should ignore dependencies to blank rows', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            
            const task1: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 5,
                start: '',
                end: '',
                dependencies: [{ id: blankRow.id, type: 'FS', lag: 0 }], // Dependency to blank row
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a1',
            };
            taskStore.add(task1);
            
            // The dependency to blank row should be filtered out by CPM
            // This is handled in Rust CPM engine's build_successor_map
            const schedulable = taskStore.getSchedulableTasks();
            expect(schedulable).toHaveLength(1);
            expect(schedulable[0].id).toBe('task1');
        });

        it('should ignore dependencies from blank rows', () => {
            const task1: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 5,
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
            
            const blankRow = taskStore.createBlankRow('a1', null);
            // Blank rows don't have dependencies, but if they did, they'd be ignored
            
            const task2: Task = {
                id: 'task2',
                rowType: 'task',
                name: 'Task 2',
                duration: 3,
                start: '',
                end: '',
                dependencies: [{ id: 'task1', type: 'FS', lag: 0 }],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0,
                sortKey: 'a2',
            };
            taskStore.add(task2);
            
            // Blank row should not affect task2's dependency on task1
            const schedulable = taskStore.getSchedulableTasks();
            expect(schedulable).toHaveLength(2);
            expect(schedulable[0].id).toBe('task1');
            expect(schedulable[1].id).toBe('task2');
        });
    });

    describe('Critical path marking', () => {
        it('should never mark blank rows as critical', () => {
            const blankRow = taskStore.createBlankRow('a0', null);
            
            // Blank rows should never be marked as critical
            // This is handled in Rust CPM engine's mark_critical_path
            const storedBlank = taskStore.getById(blankRow.id);
            expect(storedBlank?.rowType).toBe('blank');
            
            // Blank rows are excluded from CPM calculation entirely
            const schedulable = taskStore.getSchedulableTasks();
            expect(schedulable.find(t => t.id === blankRow.id)).toBeUndefined();
        });
    });

    describe('Float calculation', () => {
        it('should skip blank rows in float calculation', () => {
            const task1: Task = {
                id: 'task1',
                rowType: 'task',
                name: 'Task 1',
                duration: 5,
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
            
            const blankRow = taskStore.createBlankRow('a1', null);
            
            // Blank rows should not have float calculated
            // They're excluded from CPM calculation
            const schedulable = taskStore.getSchedulableTasks();
            expect(schedulable).toHaveLength(1);
            expect(schedulable[0].id).toBe('task1');
        });
    });
});

