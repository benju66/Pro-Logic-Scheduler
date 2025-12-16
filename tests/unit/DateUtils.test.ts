/**
 * @fileoverview Enhanced unit tests for DateUtils
 * @module tests/unit/DateUtils.test
 * 
 * Tests cover:
 * - addWorkDays() skips weekends
 * - addWorkDays() skips calendar holidays
 * - calcWorkDays() counts correctly
 * - Edge cases: Friday + 1 day = Monday
 * - Edge cases: negative durations
 * - Edge cases: zero duration
 */

import { describe, it, expect } from 'vitest';
import { DateUtils } from '../../src/core/DateUtils';
import type { Calendar } from '../../src/types';

describe('DateUtils', () => {
    const defaultCalendar: Calendar = {
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
            const calendar: Calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { '2024-12-25': 'Christmas' }
            };
            const christmas = new Date('2024-12-25');
            expect(DateUtils.isWorkDay(christmas, calendar)).toBe(false);
        });

        it('should honor working exception on weekend', () => {
            const calendar: Calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { 
                    '2024-01-06': { date: '2024-01-06', working: true, description: 'Saturday Overtime' }
                }
            };
            const saturday = new Date('2024-01-06');
            expect(DateUtils.isWorkDay(saturday, calendar)).toBe(true);
        });
    });

    describe('addWorkDays - Skip weekends', () => {
        it('should skip weekends when adding working days', () => {
            // Start on Friday, add 1 working day -> should land on Monday
            const friday = '2024-01-05'; // Friday
            const result = DateUtils.addWorkDays(friday, 1, defaultCalendar);
            
            const resultDate = new Date(result);
            const monday = new Date('2024-01-08'); // Monday
            
            expect(resultDate.getTime()).toBe(monday.getTime());
        });

        it('should skip weekends when adding multiple days', () => {
            // Start on Friday, add 5 working days -> should skip weekend
            const friday = '2024-01-05'; // Friday
            const result = DateUtils.addWorkDays(friday, 5, defaultCalendar);
            
            // Should land on Friday of next week (skipped Sat/Sun)
            const expected = '2024-01-12'; // Friday
            expect(result).toBe(expected);
        });

        it('should handle adding days across multiple weekends', () => {
            // Start on Monday, add 10 working days -> should skip 2 weekends
            const monday = '2024-01-01'; // Monday
            const result = DateUtils.addWorkDays(monday, 10, defaultCalendar);
            
            // Should land on Monday 2 weeks later (10 working days = 2 weeks)
            const expected = '2024-01-15'; // Monday
            expect(result).toBe(expected);
        });
    });

    describe('addWorkDays - Skip holidays', () => {
        it('should skip holidays when adding working days', () => {
            const calendar: Calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { 
                    '2024-01-03': { date: '2024-01-03', working: false, description: 'Holiday' }
                }
            };
            
            // Start on Tuesday, add 1 working day -> should skip Wednesday holiday
            const tuesday = '2024-01-02'; // Tuesday
            const result = DateUtils.addWorkDays(tuesday, 1, calendar);
            
            // Should land on Thursday (skipped Wednesday holiday)
            const expected = '2024-01-04'; // Thursday
            expect(result).toBe(expected);
        });

        it('should skip multiple holidays', () => {
            const calendar: Calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { 
                    '2024-01-03': { date: '2024-01-03', working: false, description: 'Holiday 1' },
                    '2024-01-04': { date: '2024-01-04', working: false, description: 'Holiday 2' }
                }
            };
            
            // Start on Tuesday, add 1 working day -> should skip both holidays
            const tuesday = '2024-01-02'; // Tuesday
            const result = DateUtils.addWorkDays(tuesday, 1, calendar);
            
            // Should land on Friday (skipped Wed/Thu holidays)
            const expected = '2024-01-05'; // Friday
            expect(result).toBe(expected);
        });
    });

    describe('addWorkDays - Edge cases', () => {
        it('should handle Friday + 1 day = Monday', () => {
            const friday = '2024-01-05'; // Friday
            const result = DateUtils.addWorkDays(friday, 1, defaultCalendar);
            
            const resultDate = new Date(result);
            const monday = new Date('2024-01-08'); // Monday
            
            expect(resultDate.getTime()).toBe(monday.getTime());
        });

        it('should handle negative durations', () => {
            // Start on Monday, subtract 1 working day -> should go to Friday
            const monday = '2024-01-08'; // Monday
            const result = DateUtils.addWorkDays(monday, -1, defaultCalendar);
            
            const expected = '2024-01-05'; // Friday (previous week)
            expect(result).toBe(expected);
        });

        it('should handle zero duration', () => {
            // Zero days should adjust to next working day if current is non-working
            const saturday = '2024-01-06'; // Saturday
            const result = DateUtils.addWorkDays(saturday, 0, defaultCalendar);
            
            // Should land on Monday (next working day)
            const expected = '2024-01-08'; // Monday
            expect(result).toBe(expected);
        });

        it('should handle zero duration on working day', () => {
            // Zero days on working day should return same day
            const monday = '2024-01-01'; // Monday
            const result = DateUtils.addWorkDays(monday, 0, defaultCalendar);
            
            expect(result).toBe(monday);
        });

        it('should handle negative days across weekends', () => {
            // Start on Monday, subtract 1 working day -> should go to Friday
            const monday = '2024-01-08'; // Monday
            const result = DateUtils.addWorkDays(monday, -1, defaultCalendar);
            
            const expected = '2024-01-05'; // Friday
            expect(result).toBe(expected);
        });
    });

    describe('calcWorkDays - Count working days', () => {
        it('should count working days correctly', () => {
            // Monday to Friday = 5 working days
            const start = '2024-01-01'; // Monday
            const end = '2024-01-05'; // Friday
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            
            expect(result).toBe(5);
        });

        it('should count working days across weekends', () => {
            // Friday to next Friday (spans weekend) = 6 working days
            const start = '2024-01-05'; // Friday
            const end = '2024-01-12'; // Friday next week
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            
            expect(result).toBe(6);
        });

        it('should skip holidays in count', () => {
            const calendar: Calendar = {
                workingDays: [1, 2, 3, 4, 5],
                exceptions: { 
                    '2024-01-03': { date: '2024-01-03', working: false, description: 'Holiday' }
                }
            };
            
            // Monday to Friday with Wednesday holiday = 4 working days
            const start = '2024-01-01'; // Monday
            const end = '2024-01-05'; // Friday
            const result = DateUtils.calcWorkDays(start, end, calendar);
            
            expect(result).toBe(4);
        });

        it('should handle same start and end date', () => {
            const date = '2024-01-01'; // Monday
            const result = DateUtils.calcWorkDays(date, date, defaultCalendar);
            
            // Should return at least 1
            expect(result).toBeGreaterThanOrEqual(1);
        });

        it('should handle reversed date range', () => {
            // Should work the same regardless of order
            const start = '2024-01-01';
            const end = '2024-01-05';
            
            const result1 = DateUtils.calcWorkDays(start, end, defaultCalendar);
            const result2 = DateUtils.calcWorkDays(end, start, defaultCalendar);
            
            expect(result1).toBe(result2);
        });

        it('should return minimum of 1 working day', () => {
            // Even if both dates are non-working, should return at least 1
            const calendar: Calendar = {
                workingDays: [],
                exceptions: {}
            };
            
            const start = '2024-01-01';
            const end = '2024-01-02';
            const result = DateUtils.calcWorkDays(start, end, calendar);
            
            expect(result).toBeGreaterThanOrEqual(1);
        });
    });

    describe('calcWorkDays - Edge cases', () => {
        it('should handle single day duration', () => {
            const date = '2024-01-01'; // Monday
            const result = DateUtils.calcWorkDays(date, date, defaultCalendar);
            
            expect(result).toBe(1);
        });

        it('should handle weekend-only range', () => {
            // Saturday to Sunday = 0 working days, but should return at least 1
            const start = '2024-01-06'; // Saturday
            const end = '2024-01-07'; // Sunday
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            
            // Should return at least 1 (minimum enforced)
            expect(result).toBeGreaterThanOrEqual(1);
        });

        it('should handle long range with multiple weekends', () => {
            // Monday to Monday 2 weeks later = 11 working days (inclusive of both Mondays)
            // Jan 1 (Mon), 2 (Tue), 3 (Wed), 4 (Thu), 5 (Fri), 8 (Mon), 9 (Tue), 10 (Wed), 11 (Thu), 12 (Fri), 15 (Mon) = 11 days
            const start = '2024-01-01'; // Monday
            const end = '2024-01-15'; // Monday 2 weeks later
            const result = DateUtils.calcWorkDays(start, end, defaultCalendar);
            
            // calcWorkDays is inclusive, so both start and end are counted
            expect(result).toBe(11);
        });
    });
});

