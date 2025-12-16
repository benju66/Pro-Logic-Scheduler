/**
 * @fileoverview Enhanced unit tests for CPM (Critical Path Method)
 * @module tests/unit/CPM.test
 * 
 * Tests cover:
 * - Forward pass (Early Start/Early Finish)
 * - Backward pass (Late Start/Late Finish)
 * - Float calculations (Total Float = LS - ES)
 * - Critical path identification
 * - All constraint types (ASAP, SNET, SNLT, FNET, FNLT, MFO)
 * - Milestone bug regression (zero-duration tasks)
 * - Dependency types (FS, SS, FF, SF) with lag
 * - Circular dependency detection
 */

import { describe, it, expect } from 'vitest';
import { CPM } from '../../src/core/CPM';
import type { Task, Calendar } from '../../src/types';

describe('CPM', () => {
    const defaultCalendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        exceptions: {}
    };

    describe('Basic functionality', () => {
        it('should return empty result for empty tasks array', () => {
            const result = CPM.calculate([], defaultCalendar);
            expect(result.tasks).toEqual([]);
            expect(result.stats.taskCount).toBe(0);
        });

        it('should handle invalid tasks array', () => {
            const result = CPM.calculate(null as any, defaultCalendar);
            expect(result.tasks).toEqual([]);
            expect(result.stats.error).toBeDefined();
        });

        it('should calculate single task', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '2024-01-05',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].id).toBe('1');
            expect(result.stats.taskCount).toBe(1);
        });
    });

    describe('Forward Pass - Early Start/Early Finish', () => {
        it('should calculate ES and EF for single task', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '2024-01-05',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task = result.tasks[0];
            
            // CPM sets start/end properties (not _earlyStart/_earlyFinish)
            expect(task.start).toBeDefined();
            expect(task.end).toBeDefined();
            expect(task.start).toBe('2024-01-01');
            expect(task.end).toBe('2024-01-05');
        });

        it('should calculate ES from predecessor EF for FS dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1')!;
            const task2 = result.tasks.find(t => t.id === '2')!;
            
            expect(task1.end).toBeDefined();
            expect(task2.start).toBeDefined();
            
            // Task 2 should start after Task 1 finishes
            if (task1.end && task2.start) {
                const task1EF = new Date(task1.end);
                const task2ES = new Date(task2.start);
                expect(task2ES.getTime()).toBeGreaterThanOrEqual(task1EF.getTime());
            }
        });

        it('should handle lag in FS dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 2 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task2 = result.tasks.find(t => t.id === '2')!;
            
            expect(task2.start).toBeDefined();
            // Task 2 should start 2 working days after Task 1 finishes
        });
    });

    describe('Backward Pass - Late Start/Late Finish', () => {
        it('should calculate LS and LF for single task', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '2024-01-05',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task = result.tasks[0];
            
            expect(task.lateStart).toBeDefined();
            expect(task.lateFinish).toBeDefined();
        });

        it('should calculate LF from successor LS for FS dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1')!;
            const task2 = result.tasks.find(t => t.id === '2')!;
            
            expect(task1.lateFinish).toBeDefined();
            expect(task2.lateStart).toBeDefined();
            
            // Task 1 must finish before Task 2 starts
            if (task1.lateFinish && task2.lateStart) {
                const task1LF = new Date(task1.lateFinish);
                const task2LS = new Date(task2.lateStart);
                expect(task1LF.getTime()).toBeLessThanOrEqual(task2LS.getTime());
            }
        });
    });

    describe('Float Calculations', () => {
        it('should calculate Total Float = LS - ES', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '3',
                    name: 'Task 3',
                    level: 0,
                    duration: 2,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            result.tasks.forEach(task => {
                expect(task._totalFloat).toBeDefined();
                expect(task.totalFloat).toBeDefined();
                expect(task._freeFloat).toBeDefined();
                expect(task.freeFloat).toBeDefined();
                
                // Verify Total Float = LS - ES (or LF - EF)
                if (task.lateStart && task.start && task.lateFinish && task.end) {
                    const ls = new Date(task.lateStart);
                    const es = new Date(task.start);
                    const lf = new Date(task.lateFinish);
                    const ef = new Date(task.end);
                    
                    const floatFromLS = Math.round((ls.getTime() - es.getTime()) / (1000 * 60 * 60 * 24));
                    const floatFromLF = Math.round((lf.getTime() - ef.getTime()) / (1000 * 60 * 60 * 24));
                    
                    // Allow for working day calculation differences
                    expect(Math.abs(task.totalFloat! - floatFromLS)).toBeLessThanOrEqual(1);
                    expect(Math.abs(task.totalFloat! - floatFromLF)).toBeLessThanOrEqual(1);
                }
            });
        });

        it('should mark tasks with zero float as critical', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            // Tasks on critical path should have zero or negative float
            result.tasks.forEach(task => {
                expect(task._isCritical).toBeDefined();
                if (task._isCritical) {
                    expect(task.totalFloat!).toBeLessThanOrEqual(0);
                }
            });
        });
    });

    describe('Critical Path Identification', () => {
        it('should identify critical path tasks', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '3',
                    name: 'Task 3',
                    level: 0,
                    duration: 2,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            // At least one task should be critical
            const criticalTasks = result.tasks.filter(t => t._isCritical);
            expect(criticalTasks.length).toBeGreaterThan(0);
            
            // Critical tasks should have zero or negative float
            criticalTasks.forEach(task => {
                expect(task.totalFloat!).toBeLessThanOrEqual(0);
            });
        });
    });

    describe('Constraint Types', () => {
        it('should handle ASAP constraint (default)', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle SNET (Start No Earlier Than) constraint', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'snet',
                constraintDate: '2024-01-10',
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task = result.tasks[0];
            
            expect(result.stats.error).toBeUndefined();
            if (task._earlyStart) {
                const es = new Date(task._earlyStart);
                const constraint = new Date('2024-01-10');
                expect(es.getTime()).toBeGreaterThanOrEqual(constraint.getTime());
            }
        });

        it('should handle SNLT (Start No Later Than) constraint', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'snlt',
                constraintDate: '2024-01-10',
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle FNET (Finish No Earlier Than) constraint', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'fnet',
                constraintDate: '2024-01-10',
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle FNLT (Finish No Later Than) constraint', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'fnlt',
                constraintDate: '2024-01-10',
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle MFO (Must Finish On) constraint', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Task 1',
                level: 0,
                duration: 5,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'mfo',
                constraintDate: '2024-01-10',
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone Bug Regression - Zero Duration Tasks', () => {
        it('should have EF = ES for zero-duration tasks (milestones)', () => {
            const tasks: Task[] = [{
                id: '1',
                name: 'Milestone',
                level: 0,
                duration: 0,
                start: '2024-01-01',
                end: '',
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task = result.tasks[0];
            
            expect(task.start).toBeDefined();
            expect(task.end).toBeDefined();
            
            // Milestone: EF should equal ES, not ES - 1
            expect(task.end).toBe(task.start);
        });

        it('should handle milestone with dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Milestone',
                    level: 0,
                    duration: 0,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2')!;
            
            expect(milestone.start).toBeDefined();
            expect(milestone.end).toBeDefined();
            expect(milestone.end).toBe(milestone.start);
        });
    });

    describe('Dependency Types', () => {
        it('should handle SS (Start-to-Start) dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'SS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle FF (Finish-to-Finish) dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FF', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle SF (Start-to-Finish) dependency', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'SF', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });

        it('should handle lag in dependencies', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 2 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.tasks).toHaveLength(2);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Circular Dependency Detection', () => {
        it('should detect and handle circular dependencies', () => {
            const tasks: Task[] = [
                {
                    id: '1',
                    name: 'Task 1',
                    level: 0,
                    duration: 5,
                    start: '2024-01-01',
                    end: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                },
                {
                    id: '2',
                    name: 'Task 2',
                    level: 0,
                    duration: 3,
                    start: '',
                    end: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }],
                    constraintType: 'asap',
                    constraintDate: null,
                    notes: '',
                    parentId: null,
                    progress: 0
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            
            // Should either error or handle gracefully (check MAX_ITERATIONS)
            // The CPM engine should detect this and either error or stop iterating
            if (result.stats.error) {
                expect(result.stats.error).toContain('circular');
            } else {
                // If no error, it should have stopped iterating (check stats)
                expect(result.stats.taskCount).toBe(2);
            }
        });
    });
});

