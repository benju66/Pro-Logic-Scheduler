/**
 * @fileoverview Standalone variance calculation module
 * @module core/calculations/VarianceCalculator
 * 
 * Extracted from SchedulerService to enable Pure DI pattern.
 * This module can be instantiated before SchedulerService and injected
 * into ServiceContainer, breaking the circular dependency.
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md - Phase 0
 */

import type { Task, Calendar } from '../../types';
import { DateUtils } from '../DateUtils';

/**
 * Variance result structure
 */
export interface VarianceResult {
    /** Start date variance in work days (positive = ahead, negative = behind) */
    start: number | null;
    /** Finish date variance in work days (positive = ahead, negative = behind) */
    finish: number | null;
}

/**
 * Function signature for variance calculation
 */
export type VarianceCalculatorFn = (task: Task) => VarianceResult;

/**
 * Calculate variance between baseline and actual/planned dates for a task.
 * 
 * Variance sign convention:
 * - Positive = ahead of schedule (actual/current is earlier than baseline)
 * - Negative = behind schedule (actual/current is later than baseline)
 * 
 * @param task - Task to calculate variance for
 * @param calendar - Calendar for work day calculations
 * @returns Variance object with start and finish variances in work days
 * 
 * @example
 * const calendar = { workingDays: [1,2,3,4,5], exceptions: {} };
 * const task = {
 *   start: '2025-01-10',
 *   end: '2025-01-20',
 *   baselineStart: '2025-01-08',
 *   baselineFinish: '2025-01-22'
 * };
 * const variance = calculateVariance(task, calendar);
 * // variance.start < 0 (behind - started later than baseline)
 * // variance.finish > 0 (ahead - finishing earlier than baseline)
 */
export function calculateVariance(task: Task, calendar: Calendar): VarianceResult {
    let startVariance: number | null = null;
    let finishVariance: number | null = null;
    
    // Calculate start variance: compareStart - baselineStart (or current start if no actual)
    // Positive = ahead of baseline, Negative = behind baseline
    if (task.baselineStart) {
        const compareStart = task.actualStart || task.start;
        if (compareStart) {
            // calcWorkDaysDifference(compareStart, baselineStart) returns:
            // - Positive if compareStart < baselineStart (ahead of schedule)
            // - Negative if compareStart > baselineStart (behind schedule)
            // This matches the desired sign convention
            startVariance = DateUtils.calcWorkDaysDifference(compareStart, task.baselineStart, calendar);
        }
    }
    
    // Calculate finish variance: compareFinish - baselineFinish (or current end if no actual)
    // Positive = ahead of baseline, Negative = behind baseline
    if (task.baselineFinish) {
        const compareFinish = task.actualFinish || task.end;
        if (compareFinish) {
            // calcWorkDaysDifference(compareFinish, baselineFinish) returns:
            // - Positive if compareFinish < baselineFinish (ahead of schedule)
            // - Negative if compareFinish > baselineFinish (behind schedule)
            // This matches the desired sign convention
            finishVariance = DateUtils.calcWorkDaysDifference(compareFinish, task.baselineFinish, calendar);
        }
    }
    
    return { start: startVariance, finish: finishVariance };
}

/**
 * Create a bound variance calculator function.
 * This creates a closure over the calendar getter, allowing the calendar
 * to change at runtime while maintaining a stable function reference.
 * 
 * @param getCalendar - Function to get the current calendar
 * @returns A variance calculator function bound to the calendar getter
 * 
 * @example
 * // In main.ts (Composition Root):
 * const calculateVarianceFn = createVarianceCalculator(
 *   () => projectController.getCalendar()
 * );
 * serviceContainer.registerVarianceService(calculateVarianceFn);
 */
export function createVarianceCalculator(
    getCalendar: () => Calendar
): VarianceCalculatorFn {
    return (task: Task): VarianceResult => {
        return calculateVariance(task, getCalendar());
    };
}
