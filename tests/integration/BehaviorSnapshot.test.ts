/**
 * @fileoverview Behavior Snapshot Tests
 * @module tests/integration/BehaviorSnapshot.test
 * 
 * Captures the current behavior of SchedulerService methods as "snapshots"
 * that can be used to verify the new services produce identical results.
 * 
 * PURPOSE:
 * - Document expected behavior before migration
 * - Provide regression tests during migration
 * - Serve as specification for new implementations
 * 
 * USAGE:
 * Run these tests with --update-snapshots after confirming current behavior is correct.
 * During migration, any deviation from snapshots indicates a regression.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateUtils } from '../../src/core/DateUtils';
import type { Task, Calendar, ConstraintType } from '../../src/types';

/**
 * Simulates the business logic from SchedulerService._applyTaskEdit()
 * This is extracted to enable snapshot testing of behavior.
 */
function simulateApplyTaskEdit(
    task: Task,
    field: string,
    value: unknown,
    calendar: Calendar,
    isParent: boolean
): {
    updates: Partial<Task>;
    needsRecalc: boolean;
    needsRender: boolean;
    success: boolean;
    message?: string;
} {
    const updates: Partial<Task> = {};
    let needsRecalc = false;
    let needsRender = false;
    let success = true;
    let message: string | undefined;
    
    switch (field) {
        case 'duration':
            const parsedDuration = parseInt(String(value));
            if (!isNaN(parsedDuration) && parsedDuration >= 1) {
                updates.duration = parsedDuration;
                needsRecalc = true;
            }
            break;
            
        case 'start':
            if (value && !isParent) {
                const startValue = String(value);
                if (/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
                    updates.start = startValue;
                    updates.constraintType = 'snet' as ConstraintType;
                    updates.constraintDate = startValue;
                    needsRecalc = true;
                } else {
                    success = false;
                }
            }
            break;
            
        case 'actualStart':
            if (value && !isParent) {
                const actualStartValue = String(value);
                if (/^\d{4}-\d{2}-\d{2}$/.test(actualStartValue)) {
                    updates.actualStart = actualStartValue;
                    updates.start = actualStartValue;
                    updates.constraintType = 'snet' as ConstraintType;
                    updates.constraintDate = actualStartValue;
                    
                    if (task.actualFinish) {
                        updates.duration = DateUtils.calcWorkDays(
                            actualStartValue,
                            task.actualFinish,
                            calendar
                        );
                    }
                    
                    message = 'Task started - schedule locked with SNET constraint';
                    needsRecalc = true;
                } else {
                    success = false;
                }
            } else if (!value && !isParent) {
                updates.actualStart = null;
                message = 'Actual start cleared. Start constraint preserved.';
                needsRecalc = true;
            }
            break;
            
        case 'actualFinish':
            if (value && !isParent) {
                const actualFinishValue = String(value);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFinishValue)) {
                    success = false;
                    break;
                }
                
                const effectiveStart = task.actualStart || task.start;
                
                if (!effectiveStart) {
                    success = false;
                    message = 'Cannot mark finished: Task has no Start Date.';
                    break;
                }
                
                if (actualFinishValue < effectiveStart) {
                    success = false;
                    message = 'Actual finish cannot be before start date';
                    break;
                }
                
                const actualDuration = DateUtils.calcWorkDays(
                    effectiveStart,
                    actualFinishValue,
                    calendar
                );
                
                updates.actualFinish = actualFinishValue;
                updates.end = actualFinishValue;
                updates.progress = 100;
                updates.remainingDuration = 0;
                updates.duration = actualDuration;
                
                if (!task.actualStart && task.start) {
                    updates.actualStart = task.start;
                    updates.start = task.start;
                    updates.constraintType = 'snet' as ConstraintType;
                    updates.constraintDate = task.start;
                }
                
                const plannedDuration = task.duration || 0;
                const variance = actualDuration - plannedDuration;
                
                if (variance > 0) {
                    message = `Task complete - took ${variance} day${variance !== 1 ? 's' : ''} longer than planned`;
                } else if (variance < 0) {
                    message = `Task complete - finished ${Math.abs(variance)} day${Math.abs(variance) !== 1 ? 's' : ''} early!`;
                } else {
                    message = 'Task complete - on schedule';
                }
                
                needsRecalc = true;
            } else if (!value && !isParent) {
                updates.actualFinish = null;
                updates.progress = 0;
                updates.remainingDuration = task.duration;
                message = 'Task reopened';
                needsRecalc = true;
            }
            break;
            
        case 'constraintType':
            const constraintValue = String(value);
            if (constraintValue === 'asap') {
                updates.constraintType = 'asap';
                updates.constraintDate = null;
                message = 'Constraint removed - task will schedule based on dependencies';
            } else {
                updates.constraintType = constraintValue as ConstraintType;
            }
            needsRecalc = true;
            break;
            
        case 'schedulingMode':
            const newMode = String(value) as 'Auto' | 'Manual';
            if (newMode !== 'Auto' && newMode !== 'Manual') {
                success = false;
                break;
            }
            if (isParent && newMode === 'Manual') {
                success = false;
                message = 'Parent tasks cannot be manually scheduled';
                break;
            }
            if (task.schedulingMode === newMode) {
                break;
            }
            if (newMode === 'Auto' && task.schedulingMode === 'Manual') {
                updates.schedulingMode = 'Auto';
                updates.constraintType = 'snet' as ConstraintType;
                updates.constraintDate = task.start || null;
                message = 'Task is now auto-scheduled with SNET constraint';
            } else {
                updates.schedulingMode = newMode;
                message = 'Task is now manually scheduled - dates are fixed';
            }
            needsRecalc = true;
            break;
            
        default:
            updates[field as keyof Task] = value as any;
            needsRender = true;
    }
    
    return { updates, needsRecalc, needsRender, success, message };
}

describe('Behavior Snapshots: Task Edit Operations', () => {
    const calendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {}
    };
    
    const createTask = (overrides: Partial<Task> = {}): Task => ({
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
        notes: '',
        ...overrides
    });
    
    describe('Duration Edit Snapshots', () => {
        it('SNAPSHOT: valid duration → updates and recalc', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'duration', '10', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: invalid duration → no update', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'duration', 'abc', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: zero duration → no update', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'duration', '0', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('Start Date Edit Snapshots', () => {
        it('SNAPSHOT: valid start → SNET constraint', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'start', '2024-01-15', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: invalid date format → failure', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'start', '01/15/2024', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: parent task → no update', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'start', '2024-01-15', calendar, true);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('ActualStart Edit Snapshots (Driver Mode)', () => {
        it('SNAPSHOT: set actualStart → SNET + anchor', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'actualStart', '2024-01-03', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: set actualStart with existing actualFinish → recalc duration', () => {
            const task = createTask({ actualFinish: '2024-01-10' });
            const result = simulateApplyTaskEdit(task, 'actualStart', '2024-01-03', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: clear actualStart → preserve constraint', () => {
            const task = createTask({
                actualStart: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03'
            });
            const result = simulateApplyTaskEdit(task, 'actualStart', null, calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('ActualFinish Edit Snapshots (Completion Mode)', () => {
        it('SNAPSHOT: set actualFinish → complete task', () => {
            const task = createTask({ start: '2024-01-01' });
            const result = simulateApplyTaskEdit(task, 'actualFinish', '2024-01-05', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: actualFinish without start → failure', () => {
            const task = createTask({ start: '' });
            const result = simulateApplyTaskEdit(task, 'actualFinish', '2024-01-05', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: actualFinish before start → failure', () => {
            const task = createTask({ start: '2024-01-05' });
            const result = simulateApplyTaskEdit(task, 'actualFinish', '2024-01-01', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: clear actualFinish → reopen task', () => {
            const task = createTask({
                actualFinish: '2024-01-05',
                progress: 100,
                remainingDuration: 0
            });
            const result = simulateApplyTaskEdit(task, 'actualFinish', null, calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: finish early → success message', () => {
            const task = createTask({ start: '2024-01-01', duration: 10 });
            const result = simulateApplyTaskEdit(task, 'actualFinish', '2024-01-05', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: finish late → warning message', () => {
            const task = createTask({ start: '2024-01-01', duration: 3 });
            const result = simulateApplyTaskEdit(task, 'actualFinish', '2024-01-10', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('ConstraintType Edit Snapshots', () => {
        it('SNAPSHOT: set to ASAP → clear constraintDate', () => {
            const task = createTask({
                constraintType: 'snet',
                constraintDate: '2024-01-15'
            });
            const result = simulateApplyTaskEdit(task, 'constraintType', 'asap', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: set to SNET → keep constraintDate', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'constraintType', 'snet', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('SchedulingMode Edit Snapshots', () => {
        it('SNAPSHOT: Manual → Auto → SNET constraint', () => {
            const task = createTask({
                schedulingMode: 'Manual',
                start: '2024-01-15'
            });
            const result = simulateApplyTaskEdit(task, 'schedulingMode', 'Auto', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: Auto → Manual → pin dates', () => {
            const task = createTask({ schedulingMode: 'Auto' });
            const result = simulateApplyTaskEdit(task, 'schedulingMode', 'Manual', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: parent task Manual → failure', () => {
            const task = createTask({ schedulingMode: 'Auto' });
            const result = simulateApplyTaskEdit(task, 'schedulingMode', 'Manual', calendar, true);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: same mode → no change', () => {
            const task = createTask({ schedulingMode: 'Auto' });
            const result = simulateApplyTaskEdit(task, 'schedulingMode', 'Auto', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
    
    describe('Simple Field Edit Snapshots', () => {
        it('SNAPSHOT: name edit → render only', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'name', 'New Name', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
        
        it('SNAPSHOT: notes edit → render only', () => {
            const task = createTask();
            const result = simulateApplyTaskEdit(task, 'notes', 'Some notes', calendar, false);
            
            expect(result).toMatchSnapshot();
        });
    });
});

describe('Behavior Snapshots: DateUtils Integration', () => {
    const calendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {}
    };
    
    it('SNAPSHOT: calcWorkDays Mon-Fri', () => {
        const result = DateUtils.calcWorkDays('2024-01-01', '2024-01-05', calendar);
        expect(result).toMatchSnapshot();
    });
    
    it('SNAPSHOT: calcWorkDays across weekend', () => {
        const result = DateUtils.calcWorkDays('2024-01-01', '2024-01-08', calendar);
        expect(result).toMatchSnapshot();
    });
    
    it('SNAPSHOT: calcWorkDays same day', () => {
        const result = DateUtils.calcWorkDays('2024-01-01', '2024-01-01', calendar);
        expect(result).toMatchSnapshot();
    });
});
