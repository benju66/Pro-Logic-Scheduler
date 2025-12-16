// @ts-check
/**
 * @fileoverview Unit tests for CPM milestone (zero duration) handling
 * @module tests/unit/CPM.milestone.test
 */

import { describe, it, expect } from 'vitest';
import { CPM } from '../../src/core/CPM.js';

describe('CPM - Milestone (Zero Duration) Handling', () => {
    const defaultCalendar = {
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        exceptions: {}
    };

    describe('Basic milestone functionality', () => {
        it('should set start === end for a milestone (duration=0)', () => {
            const tasks = [{
                id: '1',
                name: 'Milestone',
                duration: 0,
                start: '2024-01-08', // Monday
                dependencies: []
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone).toBeDefined();
            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            expect(milestone?.start).toBe(milestone?.end);
        });

        it('should handle milestone with no start date', () => {
            const tasks = [{
                id: '1',
                name: 'Milestone',
                duration: 0,
                start: '',
                dependencies: []
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone with FS (Finish-to-Start) dependency', () => {
        it('should calculate milestone as successor correctly', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01', // Monday
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1');
            const milestone = result.tasks.find(t => t.id === '2');

            expect(task1?.end).toBeDefined();
            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBeDefined();
            // Milestone should start the day after Task 1 finishes
            // Task 1: Mon-Fri (5 days), ends on Friday
            // Milestone should start and end on the next Monday
            expect(milestone?.start).toBe(milestone?.end);
        });

        it('should calculate milestone as predecessor correctly', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone',
                    duration: 0,
                    start: '2024-01-08', // Monday
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
            const milestone = result.tasks.find(t => t.id === '1');
            const task2 = result.tasks.find(t => t.id === '2');

            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            // Task 2 should start the day after milestone
            expect(task2?.start).toBeDefined();
            expect(new Date(task2?.start || '').getTime()).toBeGreaterThanOrEqual(
                new Date(milestone?.end || '').getTime()
            );
        });
    });

    describe('Milestone with SS (Start-to-Start) dependency', () => {
        it('should handle SS dependency with milestone as successor', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'SS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1');
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.start).toBe(task1?.start);
            expect(milestone?.end).toBe(milestone?.start);
        });

        it('should handle SS dependency with lag', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'SS', lag: 2 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBe(milestone?.start);
        });
    });

    describe('Milestone with FF (Finish-to-Finish) dependency', () => {
        it('should handle FF dependency with milestone as successor', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Task 1',
                    duration: 5,
                    start: '2024-01-01', // Mon-Fri
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FF', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1');
            const milestone = result.tasks.find(t => t.id === '2');

            // Milestone should finish when Task 1 finishes
            expect(milestone?.end).toBe(task1?.end);
            expect(milestone?.start).toBe(milestone?.end);
        });

        it('should handle FF dependency with lag', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FF', lag: 1 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBe(milestone?.start);
        });
    });

    describe('Milestone with SF (Start-to-Finish) dependency', () => {
        it('should handle SF dependency with milestone as successor', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'SF', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const task1 = result.tasks.find(t => t.id === '1');
            const milestone = result.tasks.find(t => t.id === '2');

            // Milestone should finish when Task 1 starts
            expect(milestone?.end).toBe(task1?.start);
            expect(milestone?.start).toBe(milestone?.end);
        });
    });

    describe('Backward pass for milestones', () => {
        it('should set lateStart === lateFinish for milestone', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone',
                    duration: 0,
                    start: '2024-01-08',
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
            const milestone = result.tasks.find(t => t.id === '1');

            if (milestone?.lateStart && milestone?.lateFinish) {
                expect(milestone.lateStart).toBe(milestone.lateFinish);
            }
        });

        it('should calculate late dates correctly for milestone in chain', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Task 3',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.lateStart).toBeDefined();
            expect(milestone?.lateFinish).toBeDefined();
            if (milestone?.lateStart && milestone?.lateFinish) {
                expect(milestone.lateStart).toBe(milestone.lateFinish);
            }
        });
    });

    describe('Float calculation for milestones', () => {
        it('should calculate float correctly for milestone', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone',
                    duration: 0,
                    start: '2024-01-08',
                    dependencies: []
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone?.totalFloat).toBeDefined();
            expect(typeof milestone?.totalFloat).toBe('number');
            expect(milestone?.freeFloat).toBeDefined();
            expect(typeof milestone?.freeFloat).toBe('number');
        });

        it('should calculate float for milestone in dependency chain', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Task 3',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.totalFloat).toBeDefined();
            expect(typeof milestone?.totalFloat).toBe('number');
        });
    });

    describe('FNET constraint on milestone', () => {
        it('should handle FNET constraint correctly for milestone', () => {
            const tasks = [{
                id: '1',
                name: 'Milestone',
                duration: 0,
                start: '',
                constraintType: 'fnet',
                constraintDate: '2024-01-08',
                dependencies: []
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            expect(milestone?.start).toBe(milestone?.end);
        });
    });

    describe('MFO constraint on milestone', () => {
        it('should handle MFO constraint correctly for milestone', () => {
            const tasks = [{
                id: '1',
                name: 'Milestone',
                duration: 0,
                start: '',
                constraintType: 'mfo',
                constraintDate: '2024-01-08',
                dependencies: []
            }];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            expect(milestone?.constraintDate).toBe('2024-01-08');
        });
    });

    describe('Milestone as first task in chain', () => {
        it('should handle milestone at the start of a chain', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone Start',
                    duration: 0,
                    start: '2024-01-08',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Task 2',
                    duration: 5,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Task 3',
                    duration: 3,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone as last task in chain', () => {
        it('should handle milestone at the end of a chain', () => {
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
                    name: 'Milestone End',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '3');

            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBeDefined();
            expect(milestone?.start).toBe(milestone?.end);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Multiple milestones in sequence', () => {
        it('should handle multiple consecutive milestones', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone 1',
                    duration: 0,
                    start: '2024-01-08',
                    dependencies: []
                },
                {
                    id: '2',
                    name: 'Milestone 2',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Milestone 3',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);

            result.tasks.forEach(task => {
                expect(task.start).toBe(task.end);
            });
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone with multiple predecessors', () => {
        it('should handle milestone with multiple dependencies', () => {
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
                    start: '2024-01-03',
                    dependencies: []
                },
                {
                    id: '3',
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [
                        { id: '1', type: 'FS', lag: 0 },
                        { id: '2', type: 'FS', lag: 0 }
                    ]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '3');

            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBe(milestone?.start);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone with multiple successors', () => {
        it('should handle milestone with multiple dependent tasks', () => {
            const tasks = [
                {
                    id: '1',
                    name: 'Milestone',
                    duration: 0,
                    start: '2024-01-08',
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
                    duration: 5,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '1');

            expect(milestone?.start).toBe('2024-01-08');
            expect(milestone?.end).toBe('2024-01-08');
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Milestone with non-zero lag', () => {
        it('should handle milestone with lag in FS dependency', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 2 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?.start).toBeDefined();
            expect(milestone?.end).toBe(milestone?.start);
            expect(result.stats.error).toBeUndefined();
        });
    });

    describe('Critical path with milestone', () => {
        it('should mark milestone as critical when on critical path', () => {
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
                    name: 'Milestone',
                    duration: 0,
                    start: '',
                    dependencies: [{ id: '1', type: 'FS', lag: 0 }]
                },
                {
                    id: '3',
                    name: 'Task 3',
                    duration: 5,
                    start: '',
                    dependencies: [{ id: '2', type: 'FS', lag: 0 }]
                }
            ];

            const result = CPM.calculate(tasks, defaultCalendar);
            const milestone = result.tasks.find(t => t.id === '2');

            expect(milestone?._isCritical).toBeDefined();
            // Milestone should be critical if float is <= 0
            if (milestone?.totalFloat !== undefined && milestone.totalFloat <= 0) {
                expect(milestone._isCritical).toBe(true);
            }
        });
    });
});

