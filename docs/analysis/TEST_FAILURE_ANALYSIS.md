# Test Failure Analysis

## Executive Summary
6 tests are failing across 2 test files:
- **DateUtils.test.js**: 4 failures related to `isWorkDay` method
- **CPM.test.js**: 2 failures related to float calculation and statistics

### Key Issues Identified

1. **Timezone Bug in `isWorkDay`** (3 failures)
   - `new Date('2024-01-01')` creates UTC midnight, which becomes previous day in PST/PDT
   - `getDay()` returns wrong day of week without time normalization
   - **Fix**: Normalize date to noon before calling `getDay()`

2. **Exception Format Handling** (1 failure)
   - Code expects `CalendarException` object but tests pass strings
   - `exception.working` fails when exception is a string
   - **Fix**: Handle both string and object exception formats

3. **Float Property Mismatch** (1 failure)
   - Code sets `totalFloat`/`freeFloat` but tests expect `_totalFloat`/`_freeFloat`
   - **Fix**: Set both property names for backward compatibility

4. **Missing Stats Field** (1 failure)
   - Test expects `stats.duration` but it's not in the interface
   - **Fix**: Add `duration` calculation to stats or update test

---

## Detailed Analysis

---

## 1. DateUtils.isWorkDay Failures (4 tests)

### Issue Overview
The `isWorkDay` method has problems handling:
1. Exception format (string vs object)
2. Default calendar fallback
3. Day-of-week calculation

### Root Causes

#### Failure 1: "should return true for a Monday"
**Expected**: `true` for `2024-01-01` (Monday)  
**Actual**: `false`

**Root Cause**: **Timezone Issue** - When `new Date('2024-01-01')` is created, JavaScript interprets it as UTC midnight. In timezones behind UTC (e.g., PST/PDT), this becomes the previous day locally, so `getDay()` returns `0` (Sunday) instead of `1` (Monday).

**Evidence**:
```javascript
new Date('2024-01-01').getDay()  // Returns 0 (Sunday) in PST timezone
new Date('2024-01-01T12:00:00').getDay()  // Returns 1 (Monday) correctly
```

**Problem**: The `isWorkDay` method uses `date.getDay()` directly without normalizing the time to noon, causing timezone-dependent behavior.

**Location**: `src/core/DateUtils.ts:44-56`

**Solution**: Normalize the date to noon before calling `getDay()`:
```typescript
static isWorkDay(date: Date, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): boolean {
    // Normalize to noon to avoid timezone issues
    const normalizedDate = new Date(date);
    normalizedDate.setHours(12, 0, 0, 0);
    
    const dateStr = normalizedDate.toISOString().split('T')[0];
    // ... rest of the code
    const dayOfWeek = normalizedDate.getDay();
    return calendar.workingDays.includes(dayOfWeek);
}
```

#### Failure 2: "should return false for a Saturday"
**Expected**: `false` for `2024-01-06` (Saturday)  
**Actual**: `true`

**Root Cause**: Same timezone issue as Failure 1. `new Date('2024-01-06')` at UTC midnight becomes `2024-01-05` (Friday) in PST, so `getDay()` returns `5` instead of `6`, making it appear as a working day.

**Solution**: Same fix as Failure 1 - normalize date to noon before checking day of week.

#### Failure 3: "should return false for a holiday"
**Expected**: `false` for `2024-12-25` with exception `'2024-12-25': 'Christmas'`  
**Actual**: `undefined`

**Problem**: The exception handling code at line 48-50 tries to access `exception.working`, but when the exception is a **string** (like `'Christmas'`), it doesn't have a `working` property.

**Code Issue**:
```typescript
const exception = calendar.exceptions[dateStr];
if (exception) {
    return exception.working;  // ❌ Fails when exception is a string
}
```

**Expected Behavior**: 
- If exception is a string → treat as non-working day (return `false`)
- If exception is an object → use `exception.working` property

**Type Mismatch**: The `Calendar` interface defines `exceptions: Record<string, CalendarException>`, but the test passes a string. The code should handle both formats for backward compatibility.

#### Failure 4: "should use default calendar if not provided"
**Expected**: `true` for Monday when no calendar provided  
**Actual**: `false`

**Problem**: Same as Failure 1 - the default calendar fallback isn't working correctly.

---

## 2. CPM Float Calculation Failures (2 tests)

### Issue Overview
The CPM calculation is not setting the expected float properties on tasks.

### Root Causes

#### Failure 1: "should calculate float values"
**Expected**: `task._totalFloat` and `task._freeFloat` to be defined  
**Actual**: `undefined`

**Problem**: The CPM code sets `task.totalFloat` and `task.freeFloat` (without underscore), but the test expects `task._totalFloat` and `task._freeFloat` (with underscore).

**Code Location**: `src/core/CPM.ts:674-746` (`_calculateFloat` method)

**Current Implementation**:
```typescript
// Line 696
task.totalFloat = DateUtils.calcWorkDaysDifference(task.start, task.lateStart, calendar);

// Line 706, 742
task.freeFloat = ...
```

**Expected by Test**:
```typescript
task._totalFloat  // with underscore
task._freeFloat   // with underscore
```

**Type Definition**: The `Task` interface has both:
- `_totalFloat?: number;` (line 106)
- `totalFloat?: number;` (line 120)

**Solution**: The CPM code should set **both** properties, or map `totalFloat` → `_totalFloat` and `freeFloat` → `_freeFloat` for backward compatibility.

#### Failure 2: "should return calculation statistics"
**Expected**: `result.stats.duration` to be a number  
**Actual**: `undefined`

**Problem**: The `CPMResult.stats` interface does **not** include a `duration` field.

**Type Definition** (`src/types/index.ts:177-188`):
```typescript
stats: {
    calcTime: number;
    taskCount: number;
    criticalCount: number;
    projectEnd: string;
    error?: string;
}
```

**Missing Field**: `duration` is not in the interface or implementation.

**Expected Behavior**: The test expects `stats.duration` to represent the project duration (likely `projectEnd - projectStart` in work days).

**Solution Options**:
1. Add `duration` field to `CPMResult.stats` interface
2. Calculate it as: `DateUtils.calcWorkDays(earliestStart, projectEnd, calendar)`
3. Update the test to not expect this field (if it's not needed)

---

## Recommended Fixes

### Priority 1: DateUtils.isWorkDay Exception Handling
```typescript
// Fix exception handling to support both string and object formats
const exception = calendar.exceptions[dateStr];
if (exception) {
    // Handle string format (backward compatibility)
    if (typeof exception === 'string') {
        return false; // String exceptions are non-working days
    }
    // Handle object format
    return exception.working;
}
```

### Priority 2: DateUtils.isWorkDay Timezone Fix
**Critical**: Normalize dates to noon before calling `getDay()` to avoid timezone issues:
```typescript
static isWorkDay(date: Date, calendar: Calendar = DateUtils.DEFAULT_CALENDAR): boolean {
    // Normalize to noon (same approach as other DateUtils methods)
    const normalizedDate = new Date(date);
    normalizedDate.setHours(12, 0, 0, 0);
    
    const dateStr = normalizedDate.toISOString().split('T')[0];
    
    // Check exceptions first
    const exception = calendar.exceptions[dateStr];
    if (exception) {
        if (typeof exception === 'string') {
            return false; // String exceptions are non-working days
        }
        return exception.working;
    }
    
    // Check working days
    const dayOfWeek = normalizedDate.getDay();
    return calendar.workingDays.includes(dayOfWeek);
}
```

### Priority 3: CPM Float Properties
```typescript
// In _calculateFloat method, set both properties:
task.totalFloat = ...;
task._totalFloat = task.totalFloat;  // Also set underscore version

task.freeFloat = ...;
task._freeFloat = task.freeFloat;    // Also set underscore version
```

### Priority 4: CPM Stats Duration
```typescript
// In calculate method, add duration calculation:
const earliestStart = tasksCopy
    .filter(t => t.start && !isParent(t.id))
    .map(t => t.start!)
    .sort()[0] || '';

const duration = earliestStart && projectEnd 
    ? DateUtils.calcWorkDays(earliestStart, projectEnd, calendar)
    : 0;

return {
    tasks: ctx.tasks,
    stats: {
        calcTime,
        taskCount: tasks.length,
        criticalCount: ...,
        projectEnd,
        duration,  // Add this
    },
};
```

---

## Additional Notes

1. **Type Safety**: The `Calendar.exceptions` type says it's `Record<string, CalendarException>`, but tests pass strings. Consider making it a union type or handling both formats.

2. **Backward Compatibility**: The underscore properties (`_totalFloat`, `_freeFloat`) seem to be legacy fields. Consider deprecating them or ensuring both are always set.

3. **Date Parsing**: Verify that `new Date('2024-01-01')` creates the correct date in the local timezone. The `toISOString()` method might shift dates due to UTC conversion.

4. **Test Expectations**: Some tests might be checking for fields that aren't part of the current design. Consider updating either the tests or the implementation to match the intended API.

