// @ts-check
/**
 * @fileoverview Unit tests for DateUtils
 * @module tests/unit/DateUtils.test
 */

import { describe, it, expect } from 'vitest';
import { DateUtils } from '../../src/core/DateUtils.js';

describe('DateUtils', () => {
    const defaultCalendar = {
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        exceptions: {}
    };

    describe('isWorkDay', () => {
        it('should return true for a Monday', () => {
            const monday = new Date('2024-01-01'); // Monday
            expect(DateUtils.isWorkDay(monday, defaultCalendar)).toBe(true);
        });

        it('should return false for a Sunday', () => {
            const sunday = new Date('2024-01-07'); // Sunday
            expect(DateUtils.isWorkDay(sunday, defaultCalendar)).toBe(false);
        });

        it('should return false for a Saturday', () => {
            const saturday = new Date('2024-01-06'); // Saturday
            expect(DateUtils.isWorkDay(saturday, defaultCalendar)).toBe(false);
        });

        it('should return false for a holiday', () => {
            const calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { '2024-12-25': 'Christmas' }
            };
            const christmas = new Date('2024-12-25');
            expect(DateUtils.isWorkDay(christmas, calendar)).toBe(false);
        });

        it('should use default calendar if not provided', () => {
            const monday = new Date('2024-01-01');
            expect(DateUtils.isWorkDay(monday)).toBe(true);
        });
    });

    describe('addWorkDays', () => {
        it('should add workdays correctly', () => {
            const start = '2024-01-01'; // Monday
            const result = DateUtils.addWorkDays(start, 5, defaultCalendar);
            expect(result).toBe('2024-01-08'); // Next Monday (5 workdays)
        });

        it('should skip weekends', () => {
            const start = '2024-01-05'; // Friday
            const result = DateUtils.addWorkDays(start, 1, defaultCalendar);
            expect(result).toBe('2024-01-08'); // Monday (skips weekend)
        });

        it('should handle zero days', () => {
            const start = '2024-01-01';
            const result = DateUtils.addWorkDays(start, 0, defaultCalendar);
            expect(result).toBe(start);
        });

        it('should handle negative days (subtract)', () => {
            const start = '2024-01-08'; // Monday
            const result = DateUtils.addWorkDays(start, -5, defaultCalendar);
            expect(result).toBe('2024-01-01'); // Previous Monday
        });

        it('should skip holidays', () => {
            const calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { '2024-01-02': 'Holiday' }
            };
            const start = '2024-01-01'; // Monday
            const result = DateUtils.addWorkDays(start, 1, calendar);
            expect(result).toBe('2024-01-03'); // Wednesday (skips Tuesday holiday)
        });
    });

    describe('calcWorkDays', () => {
        it('should calculate workdays between dates', () => {
            const start = '2024-01-01'; // Monday
            const end = '2024-01-05'; // Friday
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            expect(result).toBe(5); // Mon-Fri = 5 days
        });

        it('should return 0 for same day', () => {
            const date = '2024-01-01';
            const result = DateUtils.calcWorkDays(date, date, defaultCalendar);
            expect(result).toBe(0);
        });

        it('should handle reversed dates', () => {
            const start = '2024-01-05';
            const end = '2024-01-01';
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            expect(result).toBe(5); // Should handle reversal
        });

        it('should exclude weekends', () => {
            const start = '2024-01-01'; // Monday
            const end = '2024-01-07'; // Sunday
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            expect(result).toBe(5); // Mon-Fri only
        });

        it('should exclude holidays', () => {
            const calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { '2024-01-02': 'Holiday' }
            };
            const start = '2024-01-01'; // Monday
            const end = '2024-01-05'; // Friday
            const result = DateUtils.calcWorkDays(start, end, calendar);
            expect(result).toBe(4); // Mon, Wed, Thu, Fri (Tue is holiday)
        });
    });

    describe('calcWorkDaysDifference', () => {
        it('should calculate difference between dates', () => {
            const date1 = '2024-01-01';
            const date2 = '2024-01-05';
            const result = DateUtils.calcWorkDaysDifference(date1, date2, defaultCalendar);
            expect(result).toBe(4); // Difference is 4 workdays
        });

        it('should handle negative differences', () => {
            const date1 = '2024-01-05';
            const date2 = '2024-01-01';
            const result = DateUtils.calcWorkDaysDifference(date1, date2, defaultCalendar);
            expect(result).toBe(-4);
        });
    });
});

