/**
 * @fileoverview Unit tests for blank row helper functions
 * @module tests/unit/BlankRow.test
 */

import { describe, it, expect } from 'vitest';
import { isBlankRow, isPhantomRow, isSchedulableTask } from '../../src/types';
import type { Task } from '../../src/types';

describe('Blank Row Helper Functions', () => {
    describe('isBlankRow()', () => {
        it('should return true for blank rows', () => {
            const blankTask: Task = {
                id: 'blank1',
                rowType: 'blank',
                name: '',
                duration: 0,
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
            
            expect(isBlankRow(blankTask)).toBe(true);
        });

        it('should return false for regular tasks', () => {
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
            
            expect(isBlankRow(regularTask)).toBe(false);
        });

        it('should return false for tasks without rowType (backward compatibility)', () => {
            const legacyTask: Task = {
                id: 'task1',
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
            
            expect(isBlankRow(legacyTask)).toBe(false);
        });
    });

    describe('isPhantomRow()', () => {
        it('should return true for phantom rows', () => {
            const phantomTask: Task = {
                id: '__PHANTOM_ROW__',
                rowType: 'phantom',
                name: '',
                duration: 0,
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
            
            expect(isPhantomRow(phantomTask)).toBe(true);
        });

        it('should return false for regular tasks', () => {
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
            
            expect(isPhantomRow(regularTask)).toBe(false);
        });
    });

    describe('isSchedulableTask()', () => {
        it('should return true for regular tasks', () => {
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
            
            expect(isSchedulableTask(regularTask)).toBe(true);
        });

        it('should return true for tasks without rowType (backward compatibility)', () => {
            const legacyTask: Task = {
                id: 'task1',
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
            
            expect(isSchedulableTask(legacyTask)).toBe(true);
        });

        it('should return false for blank rows', () => {
            const blankTask: Task = {
                id: 'blank1',
                rowType: 'blank',
                name: '',
                duration: 0,
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
            
            expect(isSchedulableTask(blankTask)).toBe(false);
        });

        it('should return false for phantom rows', () => {
            const phantomTask: Task = {
                id: '__PHANTOM_ROW__',
                rowType: 'phantom',
                name: '',
                duration: 0,
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
            
            expect(isSchedulableTask(phantomTask)).toBe(false);
        });
    });
});

