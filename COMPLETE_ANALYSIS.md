# Complete Root Cause Analysis: Date Double-Entry Bug

## Executive Summary

**Root Cause:** `SchedulerService.render()` updates `GridRenderer.data` asynchronously via `requestAnimationFrame`, but `SchedulerViewport`'s RAF loop calls `GridRenderer.render()` synchronously, causing `BindingSystem._bindCell()` to read stale data and overwrite the DOM with old values.

**Confidence:** 95% - Console logs confirm the exact sequence and stale data issue.

---

## Detailed Analysis from Console Logs

### Critical Log Sequence (Lines 434-446)

```
434: [GridRenderer] Enter handler - BEFORE clear: 
     {wasEditing: true, inputValue: '12/30/2025', taskId: 'task_1767026015597_17ry72ix6', field: 'start'}
     ✅ User typed correct value

435: [GridRenderer] Enter handler - AFTER clear: 
     {isEditingAfterClear: false, editingCell: null, inEditingRows: false}
     ✅ Editing state cleared correctly

436: [GridRenderer] _saveDateInput called: 
     {fromKeyboard: true, inputValue: '12/30/2025', storedIso: '2025-12-29', ...}
     ⚠️ storedIso is OLD value (from input.dataset.isoValue)

437: [GridRenderer] _saveDateInput - calling onCellChange: 
     {taskId: 'task_1767026015597_17ry72ix6', field: 'start', isoValue: '2025-12-30', displayValue: '12/30/2025'}
     ✅ Correct new value being saved

438: [GridRenderer] _saveDateInput - onCellChange completed
     ✅ Save completed

439: [GridRenderer] Enter handler - AFTER save: 
     {inputValue: '12/30/2025', isoValue: '2025-12-30'}
     ✅ DOM still has correct value

440: [GridRenderer] Enter handler - calling blur()
     ✅ Blur triggered

441: [GridRenderer] _onBlur date input: 
     {wasEditing: false, inputValue: '12/30/2025', saveInProgress: true}
     ✅ Blur handler correctly skips save

442-443: [GridRenderer] _saveDateInput - skipping (already saved from keyboard)
     ✅ Double-save prevention working

445: [BindingSystem] _bindCell date input: 
     {taskId: 'task_1767026015597_17ry72ix6', field: 'start', isBeingEdited: false, 
      storedValue: '2025-12-29', currentInputValue: '12/29/2025', ...}
     ⚠️⚠️⚠️ storedValue is OLD VALUE! (should be '2025-12-30')

446: [BindingSystem] _bindCell - UPDATED DOM: 
     {newInputValue: '12/29/2025', newIsoValue: '2025-12-29'}
     ⚠️⚠️⚠️ DOM REVERTED TO OLD VALUE!
```

### Key Finding

**Line 445 shows `storedValue: '2025-12-29'`** - This is read from `GridRenderer.data`, which hasn't been updated yet because `SchedulerService.render()` uses `requestAnimationFrame` (async).

---

## Root Cause: Async Data Update vs Synchronous Render

### The Problem Chain

1. **TaskStore.update()** → triggers `onChange` callback **SYNCHRONOUSLY**
2. **`_onTasksChanged()`** → calls `render()` → schedules `setData()` for **next animation frame** (ASYNC)
3. **`_applyDateChangeImmediate()`** → ALSO calls `render()` → also async
4. **SchedulerViewport RAF loop** → calls `grid.render(state)` **SYNCHRONOUSLY** (line 413)
5. **`GridRenderer.render()`** → reads from `this.data[i]` → **STALE DATA** (line 200)
6. **`BindingSystem._bindCell()`** → reads stale task → overwrites DOM → **REVERSION**

### Code Evidence

**SchedulerService.ts line 5566-5595:**
```typescript
render(): void {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {  // ⚠️ ASYNC!
        const tasks = this.taskStore.getVisibleTasks(...);
        if (this.grid) {
            this.grid.setData(tasks);  // Updates GridRenderer.data HERE (async)
        }
    });
}
```

**SchedulerViewport.ts line 382-413:**
```typescript
private _renderLoop(): void {
    // ... guards ...
    const state = this._calculateViewportState();
    grid.render(state);  // ⚠️ SYNCHRONOUS call!
}
```

**GridRenderer.ts line 185-222:**
```typescript
render(state: ViewportState): void {
    // ...
    for (let i = start; i <= end && i < this.data.length; i++) {
        const task = this.data[i];  // ⚠️ Reads from this.data (may be stale)
        // ...
        this.binder.bindRow(row, context);  // Calls _bindCell() with stale task
    }
}
```

---

## Impact Assessment of Listed Issues

### 1. Duplicate Method Definitions ⚠️ MEDIUM-HIGH IMPACT

**Files:** `SchedulerService.ts`
- `_getFlatList()` at lines 3074 and 4253 (different implementations)
- `_getAllDescendants()` at lines 3057 and 4264 (similar implementations)

**Impact on Date Bug:** 
- **LOW** - Not directly related
- **BUT**: One implementation overrides the other (last one wins)
- Could cause inconsistent hierarchy calculations
- May affect which tasks are visible/rendered

**Recommendation:** 
- **HIGH PRIORITY** - Remove duplicates immediately
- Keep line 4253 implementation (uses `taskStore.getVisibleTasks()` - more efficient)
- Remove line 3074 implementation (manual recursion - less efficient)

### 2. Date Parsing/Formatting ⚠️ LOW-MEDIUM IMPACT

**Files:** `DateUtils.ts`, `CanvasGantt.ts`, various string manipulations

**Impact on Date Bug:**
- **LOW** - Date parsing works correctly (logs show correct ISO conversion)
- **BUT**: Multiple code paths could cause inconsistencies
- Risk of timezone/format bugs if different utilities used
- `CanvasGantt._parseDate()` may be redundant

**Recommendation:**
- **MEDIUM PRIORITY** - Standardize on `DateUtils.ts`
- Audit all date operations to use `DateUtils`
- Remove redundant `CanvasGantt._parseDate()` if not needed
- Document: ISO (YYYY-MM-DD) for storage, MM/DD/YYYY for display

### 3. Event Handler Patterns ⚠️ LOW IMPACT

**Files:** `UIEventManager`, `GridRenderer`, `SchedulerViewport`

**Impact on Date Bug:**
- **NONE** - Event handlers work correctly
- **BUT**: Multiple delegation patterns could cause conflicts
- Makes debugging harder (which handler fires first?)

**Recommendation:**
- **LOW PRIORITY** - Document event delegation hierarchy
- Ensure clear separation: document-level vs component-level vs viewport-level
- Consider consolidation if patterns overlap significantly

### 4. Selection State Management ⚠️ LOW IMPACT

**Files:** `SchedulerService`, `GridRenderer`, `SchedulerViewport`

**Impact on Date Bug:**
- **NONE** - Selection not involved in date editing
- **BUT**: Multiple sources of truth could cause selection bugs

**Recommendation:**
- **LOW PRIORITY** - Extract to `SelectionService` (good architecture)
- Not urgent for date bug fix
- Would improve code maintainability

### 5. Editing State Management ✅ CORRECTLY IMPLEMENTED

**Files:** `EditingStateManager.ts`, `GridRenderer.ts`

**Impact on Date Bug:**
- **NONE** - Architecture is correct
- Logs confirm editing state is cleared properly (line 435)
- `GridRenderer.editingCell` is for scroll preservation only (as designed)
- `EditingStateManager` is single source of truth (as designed)

**Recommendation:**
- **NO CHANGES NEEDED** - Keep as-is

---

## Primary Root Cause: Async Render with Stale Data

### The Exact Problem

**`SchedulerService.render()` updates `GridRenderer.data` asynchronously, but `SchedulerViewport`'s RAF loop calls `GridRenderer.render()` synchronously, causing `BindingSystem._bindCell()` to read stale data.**

### Why It Happens

1. **TaskStore.update()** → `_notifyChange()` → `onChange()` → `_onTasksChanged()` [SYNCHRONOUS]
2. **`_onTasksChanged()`** → `render()` → `requestAnimationFrame(() => setData())` [ASYNC]
3. **`_applyDateChangeImmediate()`** → `render()` → also async
4. **SchedulerViewport RAF loop** → `grid.render(state)` [SYNCHRONOUS - happens BEFORE setData()]
5. **`GridRenderer.render()`** → reads `this.data[i]` [STALE - still has old value]
6. **`BindingSystem._bindCell()`** → reads stale task → overwrites DOM

### Why Second Attempt Works

- First attempt: Store updated ✅, but `GridRenderer.data` not updated yet ❌ → DOM reverted
- Second attempt: `GridRenderer.data` now has correct value from first attempt ✅ → DOM updates correctly

---

## Recommended Fix Strategies

### Option 1: Synchronous Data Update (RECOMMENDED) ⭐

**Approach:** Update `GridRenderer.data` synchronously before render cycle

**Implementation:**
```typescript
// In _onTasksChanged() or _applyDateChangeImmediate():
const tasks = this.taskStore.getVisibleTasks(...);
if (this.grid) {
    this.grid.setData(tasks);  // Update synchronously FIRST
}
this.render();  // Then schedule render
```

**Pros:**
- Minimal code change
- Ensures data is fresh when render runs
- Maintains async render for performance

**Cons:**
- Still relies on data propagation timing
- May need to update in multiple places

### Option 2: Query TaskStore Directly (MOST ROBUST) ⭐⭐

**Approach:** Have `BindingSystem._bindCell()` query `TaskStore` directly

**Implementation:**
```typescript
// In BindingSystem._bindCell():
// Instead of: const value = getTaskFieldValue(task, col.field);
// Use: const taskFromStore = taskStore.getById(task.id);
//      const value = getTaskFieldValue(taskFromStore, col.field);
```

**Pros:**
- Eliminates stale data issue entirely
- Always reads latest value
- More robust architecture

**Cons:**
- Adds TaskStore dependency to BindingSystem
- Requires passing TaskStore reference
- Slightly more complex

### Option 3: Synchronous Render for Critical Updates

**Approach:** Make `render()` synchronous for date updates

**Implementation:**
```typescript
render(sync: boolean = false): void {
    if (sync) {
        // Update data and render immediately
        const tasks = this.taskStore.getVisibleTasks(...);
        if (this.grid) this.grid.setData(tasks);
        // ... render synchronously ...
    } else {
        // Existing async render
    }
}
```

**Pros:**
- Ensures immediate update
- Maintains async for non-critical updates

**Cons:**
- More complex render logic
- May impact performance if overused

---

## Fix Priority

1. **CRITICAL** ⚠️: Fix async render/stale data issue (primary cause of date bug)
2. **HIGH** ⚠️: Remove duplicate method definitions (prevents future bugs)
3. **MEDIUM**: Standardize date utilities (prevents inconsistencies)
4. **LOW**: Consolidate event handlers (code quality)
5. **LOW**: Extract SelectionService (architectural improvement)

---

## Additional Observations

### Why Editing State Clearing Didn't Fix It

- Editing state IS cleared correctly (logs confirm)
- BUT the issue is stale DATA, not stale editing state
- Editing guard works correctly - it's just reading from stale data source

### Why Blur Handler Works

- Blur handler also clears editing state before save ✅
- BUT blur happens AFTER the async render cycle completes
- By the time blur fires, `GridRenderer.data` has been updated
- So blur doesn't see the stale data issue

### The Real Issue

- **Not** editing state timing
- **Not** blur handler interference  
- **IS** async data update vs synchronous render cycle
- **IS** `GridRenderer.data` being stale when `_bindCell()` runs

---

## Next Steps

1. **Implement Option 1 or Option 2** to fix stale data issue
2. **Remove duplicate method definitions** (lines 3074, 3057)
3. **Test thoroughly** with debug logging enabled
4. **Consider architectural improvements** as separate tasks
