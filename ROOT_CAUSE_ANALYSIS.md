# Root Cause Analysis: Date Double-Entry Bug

## Critical Finding from Console Logs

### The Smoking Gun (Lines 434-446)

```
434: [GridRenderer] Enter handler - BEFORE clear: {wasEditing: true, inputValue: '12/30/2025', ...}
435: [GridRenderer] Enter handler - AFTER clear: {isEditingAfterClear: false, ...} ✅
436: [GridRenderer] _saveDateInput called: {storedIso: '2025-12-29', ...} ⚠️ OLD VALUE
437: [GridRenderer] _saveDateInput - calling onCellChange: {isoValue: '2025-12-30', ...} ✅ NEW VALUE
438: [GridRenderer] _saveDateInput - onCellChange completed
439: [GridRenderer] Enter handler - AFTER save: {isoValue: '2025-12-30'} ✅
440: [GridRenderer] Enter handler - calling blur()
441: [GridRenderer] _onBlur date input: {wasEditing: false, saveInProgress: true} ✅
442-443: Blur handler skips save (correct)
445: [BindingSystem] _bindCell date input: {storedValue: '2025-12-29', ...} ⚠️⚠️⚠️ OLD VALUE!
446: [BindingSystem] _bindCell - UPDATED DOM: {newInputValue: '12/29/2025', ...} ⚠️ REVERTS!
```

## Root Cause Identified

### The Problem: Asynchronous Render with Stale Data

**The Issue:**
1. ✅ Editing state is cleared correctly (line 435)
2. ✅ Save is called with correct value (line 437: `isoValue: '2025-12-30'`)
3. ✅ TaskStore is updated synchronously
4. ❌ **BUT**: `render()` uses `requestAnimationFrame` (ASYNC) - see `SchedulerService.ts` line 5571
5. ❌ **GridRenderer.data** is updated ASYNCHRONOUSLY in the next animation frame
6. ❌ **BindingSystem._bindCell()** runs SYNCHRONOUSLY during a render cycle BEFORE `GridRenderer.data` is updated
7. ❌ **Result**: `_bindCell()` reads OLD value (`'2025-12-29'`) from `GridRenderer.data` and overwrites DOM

### The Code Flow

```typescript
// SchedulerService.ts line 5566-5595
render(): void {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {  // ⚠️ ASYNCHRONOUS!
        const tasks = this.taskStore.getVisibleTasks(...);
        if (this.grid) {
            this.grid.setData(tasks);  // Updates GridRenderer.data HERE (async)
        }
    });
}
```

**What happens:**
1. `_applyDateChangeImmediate()` calls `taskStore.update()` → triggers `onChange` → `_onTasksChanged()` (SYNCHRONOUS)
2. `_onTasksChanged()` calls `render()` → schedules `setData()` for next frame (ASYNC)
3. `_applyDateChangeImmediate()` ALSO calls `render()` directly (line 1900) → also async
4. **BUT**: `SchedulerViewport` has a RAF loop that calls `grid.render(state)` SYNCHRONOUSLY (line 413)
5. `grid.render()` calls `BindingSystem._bindCell()` SYNCHRONOUSLY during the render cycle
6. `_bindCell()` reads from `GridRenderer.data` (still has OLD value because `setData()` is async)
7. `_bindCell()` overwrites DOM with old value → **REVERSION!**

### Why It Works on Second Attempt

- First attempt: Store updated, but `GridRenderer.data` not updated yet → DOM reverted
- Second attempt: `GridRenderer.data` now has correct value from first attempt → DOM updates correctly

## Impact Assessment of Listed Issues

### 1. Duplicate Method Definitions ⚠️ MEDIUM IMPACT

**Issue:**
- `_getFlatList()` defined at lines 3074 and 4253
- `_getAllDescendants()` defined at lines 3057 and 4264

**Impact on Date Bug:** 
- **LOW** - Not directly related to date double-entry
- **BUT**: Could cause inconsistent behavior elsewhere
- One implementation will override the other (last one wins)
- May cause bugs in hierarchy calculations

**Recommendation:** 
- Remove duplicate definitions
- Keep the implementation that uses `taskStore.getVisibleTasks()` (line 4253) as it's more efficient

### 2. Date Parsing/Formatting ⚠️ LOW-MEDIUM IMPACT

**Issue:**
- Multiple date utilities: `DateUtils.ts`, `CanvasGantt._parseDate()`, string manipulations

**Impact on Date Bug:**
- **LOW** - Date parsing works correctly (logs show correct ISO conversion)
- **BUT**: Could cause inconsistencies if different code paths use different utilities
- Risk of timezone/format bugs

**Recommendation:**
- Standardize on `DateUtils.ts` for all date operations
- Remove `CanvasGantt._parseDate()` if redundant
- Document date format conventions (ISO for storage, MM/DD/YYYY for display)

### 3. Event Handler Patterns ⚠️ LOW IMPACT

**Issue:**
- Multiple delegation patterns: `UIEventManager`, `GridRenderer`, `SchedulerViewport`

**Impact on Date Bug:**
- **LOW** - Event handlers work correctly
- **BUT**: Could cause event conflicts or missed handlers
- Makes debugging harder

**Recommendation:**
- Document event delegation hierarchy
- Ensure clear separation of concerns
- Consider consolidating if patterns overlap

### 4. Selection State Management ⚠️ LOW IMPACT

**Issue:**
- Selection managed in multiple places: `SchedulerService`, `GridRenderer`, `SchedulerViewport`

**Impact on Date Bug:**
- **NONE** - Selection state not involved in date editing
- **BUT**: Could cause selection bugs elsewhere

**Recommendation:**
- Extract to `SelectionService` as single source of truth (good architectural improvement)
- Not urgent for date bug fix

### 5. Editing State Management ✅ CORRECTLY IMPLEMENTED

**Issue:**
- `EditingStateManager` singleton + `GridRenderer` internal tracking

**Impact on Date Bug:**
- **NONE** - This is correctly implemented
- `GridRenderer.editingCell` is for scroll preservation only
- `EditingStateManager` is the single source of truth (as designed)
- Logs confirm editing state is cleared correctly

**Recommendation:**
- Keep as-is - architecture is sound

## Primary Root Cause: Async Render with Stale Data

### The Real Problem

**`SchedulerService.render()` uses `requestAnimationFrame` (async), but `BindingSystem._bindCell()` runs synchronously during render cycles before `GridRenderer.data` is updated.**

### Why This Happens

1. **TaskStore.update()** triggers `onChange` callback → `_onTasksChanged()`
2. **`_onTasksChanged()`** calls `render()` → schedules `setData()` for next frame
3. **`_applyDateChangeImmediate()`** ALSO calls `render()` directly
4. **BUT**: `render()` batches with `requestAnimationFrame`, so `GridRenderer.data` update is deferred
5. **Meanwhile**: Some synchronous render cycle runs `BindingSystem._bindCell()`
6. **`_bindCell()`** reads stale data from `GridRenderer.data` and overwrites DOM

### The Complete Execution Flow

```
1. User presses Enter on date input
2. Enter handler clears editing state ✅
3. _saveDateInput() → onCellChange('2025-12-30')
4. _handleCellChange() → _applyTaskEdit() → _applyDateChangeImmediate()
5. taskStore.update() → _notifyChange() → onChange() → _onTasksChanged() [SYNCHRONOUS]
6. _onTasksChanged() → render() → requestAnimationFrame(() => setData()) [ASYNC]
7. _applyDateChangeImmediate() → render() → requestAnimationFrame(() => setData()) [ASYNC]
8. ⚠️ SchedulerViewport RAF loop fires → grid.render(state) [SYNCHRONOUS]
9. grid.render() → reads from this.data[i] [STALE - still '2025-12-29']
10. binder.bindRow() → _bindCell() → reads stale task data
11. _bindCell() → overwrites DOM with old value → REVERSION!
12. [Next frame] setData() finally runs → GridRenderer.data updated (too late)
```

### The Fix Strategy

**Option 1: Synchronous Data Update (RECOMMENDED)**
- Update `GridRenderer.data` synchronously in `_onTasksChanged()` BEFORE calling `render()`
- Or update it synchronously in `_applyDateChangeImmediate()` before `render()`
- Ensures data is fresh when RAF loop runs `grid.render()`

**Option 2: Query TaskStore Directly in BindingSystem**
- Have `BindingSystem._bindCell()` query `TaskStore.getById()` directly
- Eliminates stale data issue entirely
- More robust but adds dependency

**Option 3: Defer Render Until Data Updated**
- Make `render()` update `GridRenderer.data` synchronously for critical updates
- Or ensure `setData()` happens synchronously before scheduling render

## Recommended Fix Priority

1. **CRITICAL**: Fix async render/stale data issue (primary cause)
2. **HIGH**: Remove duplicate method definitions (prevents future bugs)
3. **MEDIUM**: Standardize date utilities (prevents inconsistencies)
4. **LOW**: Consolidate event handlers (code quality)
5. **LOW**: Extract SelectionService (architectural improvement)

## Next Steps

1. Implement fix for async render/stale data issue
2. Remove duplicate method definitions
3. Test thoroughly with debug logging
4. Consider architectural improvements as separate tasks
