/**
 * @fileoverview Integration tests for Driver Mode Statusing Logic
 * @module tests/integration/DriverModeStatusing.test
 * 
 * Tests cover:
 * - actualStart setting and clearing (Driver Mode + Anchor)
 * - actualFinish setting and clearing (Driver Mode + Completion)
 * - SNET constraint application
 * - Duration recalculation
 * - Remaining duration handling
 * - Edge cases (missing start date, finish before start, etc.)
 * - Engine synchronization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchedulerService } from '../../src/services/SchedulerService';
import { TaskStore } from '../../src/data/TaskStore';
import { CalendarStore } from '../../src/data/CalendarStore';
import { HistoryManager } from '../../src/data/HistoryManager';
import { ToastService } from '../../src/ui/services/ToastService';
import { DateUtils } from '../../src/core/DateUtils';
import type { Task, Calendar } from '../../src/types';

describe('Driver Mode Statusing Logic', () => {
    let scheduler: SchedulerService;
    let taskStore: TaskStore;
    let calendarStore: CalendarStore;
    let toastService: ToastService;
    let mockEngine: any;
    let toastMessages: string[] = [];

    const defaultCalendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        exceptions: {}
    };

    beforeEach(async () => {
        // Reset toast messages
        toastMessages = [];

        // Create mock container for toast service
        // happy-dom environment should provide document, but ensure body exists
        let container: HTMLElement;
        if (typeof document !== 'undefined' && document.body) {
            container = document.body;
        } else {
            // Fallback: create a mock container
            container = document?.createElement?.('div') || ({} as HTMLElement);
            if (typeof document !== 'undefined' && !document.body) {
                (document as any).body = container;
            }
        }

        // Create mock toast service
        toastService = new ToastService({
            container: container
        });
        
        // Override toast methods to capture messages
        const originalInfo = toastService.info.bind(toastService);
        const originalSuccess = toastService.success.bind(toastService);
        const originalWarning = toastService.warning.bind(toastService);
        
        toastService.info = vi.fn((msg: string) => {
            toastMessages.push(`info: ${msg}`);
            return originalInfo(msg);
        });
        
        toastService.success = vi.fn((msg: string) => {
            toastMessages.push(`success: ${msg}`);
            return originalSuccess(msg);
        });
        
        toastService.warning = vi.fn((msg: string) => {
            toastMessages.push(`warning: ${msg}`);
            return originalWarning(msg);
        });

        // Create stores
        taskStore = new TaskStore({
            onChange: vi.fn()
        });

        calendarStore = new CalendarStore({
            onChange: vi.fn()
        });
        calendarStore.set(defaultCalendar);

        // Create history manager
        const historyManager = new HistoryManager({
            maxHistory: 50
        });
        taskStore.setHistoryManager(historyManager);
        calendarStore.setHistoryManager(historyManager);

        // Create mock engine
        mockEngine = {
            updateTask: vi.fn().mockResolvedValue(undefined),
            calculate: vi.fn().mockResolvedValue({ tasks: [], stats: {} })
        };

        // Create scheduler service with minimal options
        scheduler = new SchedulerService({
            isTauri: false
        } as any);

        // Inject dependencies directly (for testing)
        (scheduler as any).taskStore = taskStore;
        (scheduler as any).calendarStore = calendarStore;
        (scheduler as any).toastService = toastService;
        (scheduler as any).engine = mockEngine;
        (scheduler as any).isInitialized = true;
    });

    describe('actualStart - Driver Mode + Anchor', () => {
        it('should set actualStart and apply SNET constraint', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualStart', '2024-01-03');

            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);

            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBe('2024-01-03');
            expect(updated?.start).toBe('2024-01-03');
            expect(updated?.constraintType).toBe('snet');
            expect(updated?.constraintDate).toBe('2024-01-03');

            // Check toast message
            expect(toastMessages.some(msg => msg.includes('Task started - schedule locked with SNET constraint'))).toBe(true);

            // Check engine sync
            expect(mockEngine.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualStart: '2024-01-03',
                start: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03'
            }));
        });

        it('should recalculate duration when actualStart is set after actualFinish', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-10',
                duration: 10,
                actualFinish: '2024-01-10',
                parentId: null,
                dependencies: [],
                progress: 100,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualStart', '2024-01-05');

            expect(result.success).toBe(true);

            const updated = taskStore.getById('task1');
            // Should recalculate duration: Jan 5 (Mon) to Jan 10 (Wed) = 4 working days
            const expectedDuration = DateUtils.calcWorkDays('2024-01-05', '2024-01-10', defaultCalendar);
            expect(updated?.duration).toBe(expectedDuration);
        });

        it('should clear actualStart but preserve constraint', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-03',
                end: '2024-01-05',
                duration: 5,
                actualStart: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03',
                parentId: null,
                dependencies: [],
                progress: 0,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualStart', null);

            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);

            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBeNull();
            // Constraint should be preserved
            expect(updated?.constraintType).toBe('snet');
            expect(updated?.constraintDate).toBe('2024-01-03');

            // Check toast message
            expect(toastMessages.some(msg => msg.includes('Actual start cleared. Start constraint preserved.'))).toBe(true);
        });

        it('should reject invalid date format', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualStart', 'invalid-date');

            expect(result.success).toBe(false);
            expect(result.needsRecalc).toBe(false);

            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBeUndefined();
        });

        it('should skip parent tasks', () => {
            const parent: Task = {
                id: 'parent1',
                name: 'Parent Task',
                start: '2024-01-01',
                end: '2024-01-10',
                duration: 10,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            const child: Task = {
                id: 'child1',
                name: 'Child Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: 'parent1',
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 1,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(parent);
            taskStore.add(child);

            // Mock isParent to return true for parent1
            vi.spyOn(taskStore, 'isParent').mockImplementation((id) => id === 'parent1');

            const result = (scheduler as any)._applyTaskEdit('parent1', 'actualStart', '2024-01-03');

            // Should not update parent task
            const updated = taskStore.getById('parent1');
            expect(updated?.actualStart).toBeUndefined();
        });
    });

    describe('actualFinish - Driver Mode + Completion', () => {
        it('should set actualFinish and complete the task', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBe('2024-01-05');
            expect(updated?.end).toBe('2024-01-05');
            expect(updated?.progress).toBe(100);
            expect(updated?.remainingDuration).toBe(0);

            // Check toast message (should show "on schedule" since duration matches)
            expect(toastMessages.some(msg => msg.includes('Task complete'))).toBe(true);
        });

        it('should auto-populate actualStart with SNET when setting actualFinish', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            expect(result.success).toBe(true);

            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBe('2024-01-01');
            expect(updated?.start).toBe('2024-01-01');
            expect(updated?.constraintType).toBe('snet');
            expect(updated?.constraintDate).toBe('2024-01-01');
        });

        it('should reject actualFinish when task has no start date', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '',
                end: '',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            expect(result.success).toBe(false);
            expect(result.needsRecalc).toBe(false);

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeUndefined();

            // Check warning toast
            expect(toastMessages.some(msg => msg.includes('Cannot mark finished: Task has no Start Date.'))).toBe(true);
        });

        it('should reject actualFinish before start date', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-05',
                end: '2024-01-10',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-01');

            expect(result.success).toBe(false);
            expect(result.needsRecalc).toBe(false);

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeUndefined();

            // Check warning toast
            expect(toastMessages.some(msg => msg.includes('Actual finish cannot be before start date'))).toBe(true);
        });

        it('should recalculate duration based on actual dates', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                actualStart: '2024-01-02',
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'snet',
                constraintDate: '2024-01-02',
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-08');

            expect(result.success).toBe(true);

            const updated = taskStore.getById('task1');
            // Jan 2 (Tue) to Jan 8 (Mon) = 5 working days
            const expectedDuration = DateUtils.calcWorkDays('2024-01-02', '2024-01-08', defaultCalendar);
            expect(updated?.duration).toBe(expectedDuration);
        });

        it('should show variance message when task takes longer than planned', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-10');

            // Should show variance message (5 days planned, 7 days actual = 2 days longer)
            expect(toastMessages.some(msg => msg.includes('longer than planned'))).toBe(true);
        });

        it('should show success message when task finishes early', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-10',
                duration: 10,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            // Should show early completion message
            expect(toastMessages.some(msg => msg.includes('early'))).toBe(true);
        });

        it('should clear actualFinish and reopen task', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                actualFinish: '2024-01-05',
                remainingDuration: 0,
                parentId: null,
                dependencies: [],
                progress: 100,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', null);

            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeNull();
            expect(updated?.progress).toBe(0);
            expect(updated?.remainingDuration).toBe(5); // Should reset to duration

            // Check toast message
            expect(toastMessages.some(msg => msg.includes('Task reopened'))).toBe(true);
        });

        it('should reject invalid date format', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', 'invalid-date');

            expect(result.success).toBe(false);
            expect(result.needsRecalc).toBe(false);

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeUndefined();
        });
    });

    describe('_applyDateChangeImmediate - Driver Mode', () => {
        it('should apply Driver Mode logic for actualStart', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            // Mock recalculateAll and render
            const recalcSpy1 = vi.spyOn(scheduler, 'recalculateAll').mockImplementation(() => {});
            const renderSpy1 = vi.spyOn(scheduler, 'render').mockImplementation(() => {});

            (scheduler as any)._applyDateChangeImmediate('task1', 'actualStart', '2024-01-03');

            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBe('2024-01-03');
            expect(updated?.start).toBe('2024-01-03');
            expect(updated?.constraintType).toBe('snet');
            expect(updated?.constraintDate).toBe('2024-01-03');

            expect(recalcSpy1).toHaveBeenCalled();
        });

        it('should apply Driver Mode logic for actualFinish', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            // Mock recalculateAll and render
            const recalcSpy2 = vi.spyOn(scheduler, 'recalculateAll').mockImplementation(() => {});
            const renderSpy2 = vi.spyOn(scheduler, 'render').mockImplementation(() => {});

            (scheduler as any)._applyDateChangeImmediate('task1', 'actualFinish', '2024-01-05');

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBe('2024-01-05');
            expect(updated?.end).toBe('2024-01-05');
            expect(updated?.progress).toBe(100);
            expect(updated?.remainingDuration).toBe(0);

            expect(recalcSpy2).toHaveBeenCalled();
        });

        it('should reject actualFinish before start in _applyDateChangeImmediate', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-05',
                end: '2024-01-10',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyDateChangeImmediate('task1', 'actualFinish', '2024-01-01');

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeUndefined();

            expect(toastMessages.some(msg => msg.includes('Actual finish cannot be before start date'))).toBe(true);
        });

        it('should reject actualFinish without start date in _applyDateChangeImmediate', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '',
                end: '',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyDateChangeImmediate('task1', 'actualFinish', '2024-01-05');

            const updated = taskStore.getById('task1');
            expect(updated?.actualFinish).toBeUndefined();

            expect(toastMessages.some(msg => msg.includes('Cannot mark finished: Task has no Start Date.'))).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle actualFinish with existing actualStart', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-10',
                duration: 10,
                actualStart: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03',
                parentId: null,
                dependencies: [],
                progress: 0,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-08');

            expect(result.success).toBe(true);

            const updated = taskStore.getById('task1');
            // Should use actualStart (2024-01-03) not planned start (2024-01-01)
            const expectedDuration = DateUtils.calcWorkDays('2024-01-03', '2024-01-08', defaultCalendar);
            expect(updated?.duration).toBe(expectedDuration);
        });

        it('should handle task with no duration gracefully', () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 0,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            const result = (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            expect(result.success).toBe(true);

            const updated = taskStore.getById('task1');
            // Should calculate duration from dates
            const expectedDuration = DateUtils.calcWorkDays('2024-01-01', '2024-01-05', defaultCalendar);
            expect(updated?.duration).toBe(expectedDuration);
        });
    });

    describe('Engine Synchronization', () => {
        it('should sync actualStart changes to engine', async () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyTaskEdit('task1', 'actualStart', '2024-01-03');

            // Wait for async engine update
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockEngine.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualStart: '2024-01-03',
                start: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03'
            }));
        });

        it('should sync actualFinish changes to engine', async () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            (scheduler as any)._applyTaskEdit('task1', 'actualFinish', '2024-01-05');

            // Wait for async engine update
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockEngine.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualFinish: '2024-01-05',
                end: '2024-01-05',
                progress: 100,
                remainingDuration: 0
            }));
        });

        it('should handle engine sync errors gracefully', async () => {
            const task: Task = {
                id: 'task1',
                name: 'Test Task',
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                level: 0,
                sortKey: 'a0',
                notes: ''
            };

            taskStore.add(task);

            // Make engine throw error
            mockEngine.updateTask.mockRejectedValueOnce(new Error('Engine sync failed'));

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            (scheduler as any)._applyTaskEdit('task1', 'actualStart', '2024-01-03');

            // Wait for async engine update
            await new Promise(resolve => setTimeout(resolve, 10));

            // Should log warning but not throw
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to sync actualStart to engine'),
                expect.any(Error)
            );

            // Task should still be updated
            const updated = taskStore.getById('task1');
            expect(updated?.actualStart).toBe('2024-01-03');

            consoleSpy.mockRestore();
        });
    });
});

