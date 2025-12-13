// @ts-check
/**
 * @fileoverview Unit tests for CPM (Critical Path Method)
 * @module tests/unit/CPM.test
 */

import { describe, it, expect } from 'vitest';
import { CPM } from '../../src/core/CPM.js';

describe('CPM', () => {
    const defaultCalendar = {
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        exceptions: {}
    };

    describe('calculate - Basic functionality', () => {
        it('should return empty result for empty tasks array', () => {
            const result = CPM.calculate([], defaultCalendar);
            expect(result.tasks).toEqual([]);
            expect(result.stats.taskCount).toBe(0);
        });

        it('should handle invalid tasks array', () => {
            const result = CPM.calculate(null, defaultCalendar);
            expect(result.tasks).toEqual([]);
            expect(result.stats.error).toBeDefined();
        });

        it('should calculate single task', () => {
            const tasks = [{
                id: '1',
                name: 'Task 1',
                duration: 5,
                start: '2024-01-01',
                dependencies: []
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].id).toBe('1');
            expect(result.stats.taskCount).toBe(1);
        });
    });

    describe('calculate - Simple dependency chain', () => {
        it('should calculate FS (Finish-to-Start) dependency', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            
            const task1 = result.tasks.find(t => t.id === '1');
            const task2 = result.tasks.find(t => t.id === '2');
            
            expect(task1).toBeDefined();
            expect(task2).toBeDefined();
            
            // Task 2 should start after Task 1 finishes
            if (task1 && task2 && task1.end && task2.start) {
                const task1End = new Date(task1.end);
                const task2Start = new Date(task2.start);
                expect(task2Start.getTime()).toBeGreaterThanOrEqual(task1End.getTime());
            }
        });

        it('should handle lag in dependencies', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 2 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task2 = result.tasks.find(t => t.id === '2');
            expect(task2).toBeDefined();
        });
    });

    describe('calculate - Critical path', () => {
        it('should mark critical tasks', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            // Both tasks should be critical (no float)
            result.tasks.forEach(task => {
                expect(task._isCritical).toBeDefined();
                expect(typeof task._isCritical).toBe('boolean');
            });
        });

        it('should calculate float values', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Task 3',
                    duration: 2,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            result.tasks.forEach(task => {
                expect(task._totalFloat).toBeDefined();
                expect(typeof task._totalFloat).toBe('number');
                expect(task._freeFloat).toBeDefined();
                expect(typeof task._freeFloat).toBe('number');
            });
        });
    });

    describe('calculate - Different link types', () => {
        it('should handle SS (Start-to-Start) dependency', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'SS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle FF (Finish-to-Finish) dependency', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'FF', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle SF (Start-to-Finish) dependency', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '1', type: 'SF', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('calculate - Statistics', () => {
        it('should return calculation statistics', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats).toBeDefined();
            expect(result.stats.taskCount).toBe(1);
            expect(typeof result.stats.duration).toBe('number');
        });
    });

    describe('calculate - Edge cases', () => {
        it('should handle tasks without dependencies', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 3,
                    start: '2024-01-10',
                    dependencies: []
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle tasks with missing start dates', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '',
                    dependencies: []
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(1);
        });
    });
});

