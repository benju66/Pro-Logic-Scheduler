# Phase 1: Architectural Optimization

**Goal:** Stop doing double math and ensure the Undo stack survives page reloads/tab switches.

**Estimated Duration:** 1-2 Days  
**Confidence Level:** 75-80%  
**Document Created:** January 4, 2026

---

## Executive Summary

The current `SchedulerService` contains redundant calculation and rendering calls. When a task is updated:

1. `ProjectController.updateTask()` sends an `UPDATE_TASK` command to the WASM Worker
2. The Worker **already calculates** CPM and posts `CALCULATION_RESULT`
3. `SchedulerViewport` subscribes to `tasks$` and **auto-renders**
4. BUT the code then explicitly calls `recalculateAll()` (sends another `CALCULATE` command)
5. AND calls `render()` (redundant since viewport auto-renders)

This results in **double calculation** and **double rendering** on every task update.

---

## ⚠️ Critical Constraints (From Architecture Review)

### Constraint 1: The "Await" Trap (Race Condition Risk)

**Problem:** `ProjectController.updateTask()` currently returns `void` (fire-and-forget). The current code uses `await this.recalculateAll()` to ensure calculation completes before `saveData()` runs.

**Risk:** Simply removing `await this.recalculateAll()` will cause `saveData()` to execute with **uncalculated data** (optimistic update only, no CPM dates).

**Evidence:**
```typescript
// saveData() reads from tasks$.value
async saveData(): Promise<void> {
    await this.snapshotService.createSnapshot(
        ProjectController.getInstance().getTasks(),  // ← reads tasks$.value
        ...
    );
}
```

**Required Fix:** Choose one:
- **Option A:** Make `updateTask()` return `Promise<void>` that resolves on `CALCULATION_RESULT`
- **Option B:** Move `saveData()` to reactive subscription on `tasks$` with debounce
- **Option C:** Debounce `saveData()` with sufficient delay (simple but fragile)

### Constraint 2: The Viewport "Dirty" Check ✅ VERIFIED SAFE

**Verified:** `SchedulerViewport.setData()` always calls `_scheduleRender()`, which sets `dirty = true` and schedules RAF. The `dirty` flag only prevents duplicate RAF requests within the same frame.

**Verdict:** Safe to remove manual `render()` calls.

---

## Part 1: Remove Redundant `recalculateAll()` Calls

### 1.1 Worker Verification ✅

The worker already calculates on every mutation:

```typescript
// src/workers/scheduler.worker.ts (lines 110-115)
case 'UPDATE_TASK': {
    const { id, updates } = command.payload;
    engine.update_task(id, updates);
    const result = engine.calculate();  // ← Already calculates!
    postResponse({ type: 'CALCULATION_RESULT', payload: result });
    break;
}
```

Same pattern for `ADD_TASK`, `DELETE_TASK`, `SYNC_TASKS`, and `UPDATE_CALENDAR`.

### 1.2 UI Auto-Render Verification ✅

`SchedulerViewport` subscribes to `tasks$` and auto-renders:

```typescript
// src/ui/components/scheduler/SchedulerViewport.ts (lines 332-341)
this.controller.tasks$.subscribe(_tasks => {
    const visibleTasks = this.controller.getVisibleTasks(...);
    this.setData(visibleTasks);  // ← Triggers _scheduleRender()
})
```

### 1.3 Locations to Fix (21 instances)

| # | Method | Line | Current Code | Action |
|---|--------|------|--------------|--------|
| 1 | `_handleDateEdit` | 1610-1611 | `recalculateAll(); render();` | Remove both |
| 2 | `_handleDateEdit` | 1654-1655 | `recalculateAll(); render();` | Remove both |
| 3 | `_handleDateEdit` | 1660-1661 | `recalculateAll(); render();` | Remove both |
| 4 | `_handleCellChange` | 2022 | `await this.recalculateAll();` | Remove (see notes) |
| 5 | `_handleDrawerUpdate` | 2166-2168 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 6 | `_handleDependenciesSave` | 2204-2206 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 7 | `_handleCalendarSave` | 2220-2222 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 8 | `_handleBarDrag` | 2412-2414 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 9 | `updateTaskDates` | 2445-2447 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 10 | `_handleRowMove` | 2656-2658 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 11 | `_handleRowMove` | 2711-2713 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 12 | `indentSelected` | 3394-3396 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 13 | `outdentSelected` | 3449-3451 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 14 | `deleteProject` | 3504-3506 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 15 | `linkSelectedTasks` | 3743-3744 | `recalculateAll(); render();` | Remove both |
| 16 | `pasteFromClipboard` | 4505-4507 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 17 | `importFromJson` | 5188-5190 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 18 | `importFromMSProject` | 5278-5279 | `recalculateAll(); saveData();` | Remove recalc |
| 19 | `resetProject` | 5321-5323 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 20 | `repairSortKeys` | 5531-5533 | `recalculateAll(); saveData(); render();` | Remove recalc + render |
| 21 | `setSchedulingMode` | 5574-5576 | `recalculateAll(); saveData(); render();` | Remove recalc + render |

### 1.4 Locations to KEEP (2 instances)

| # | Method | Line | Reason |
|---|--------|------|--------|
| 1 | `loadData` | 4828 | Initial load from SQLite — needs first calculation |
| 2 | `_createSampleData` | 4934 | Initial sample data — needs first calculation |

### 1.5 Special Attention: `_handleCellChange` (Line 2022)

This method uses `await`:

```typescript
if (result.needsRecalc) {
    // CRITICAL: Await recalculation to prevent transaction conflicts and visual flash
    await this.recalculateAll();
    this.saveData();
}
```

The comment mentions "transaction conflicts" and "visual flash". These concerns should be resolved by:
- Transaction conflicts: Worker handles calculation atomically
- Visual flash: Optimistic updates in `ProjectController.updateTask()` prevent flash

**Recommendation:** Remove the `await this.recalculateAll()` but keep `this.saveData()`. Test carefully for any visual flash issues.

---

## Part 2: Move HistoryManager to AppInitializer

### 2.1 Current Location (SchedulerService)

```typescript
// src/services/SchedulerService.ts (lines 343-350)
// Initialize HistoryManager for undo/redo
this.historyManager = new HistoryManager({
    maxHistory: 50
});

// Wire HistoryManager to ProjectController for event recording
if (!controller.hasHistoryManager()) {
    controller.setHistoryManager(this.historyManager);
}
```

### 2.2 Problem

HistoryManager lives at the "View Level" (inside SchedulerService). If SchedulerService is destroyed/recreated:
- Tab switch
- View change
- Hot module reload

...the undo stack is lost.

### 2.3 Solution: Move to AppInitializer

Add to `AppInitializer` class:

```typescript
// Add property
private historyManager: HistoryManager | null = null;

// Add to _initializePersistenceLayer() after SnapshotService (around line 195)
// 3. Initialize HistoryManager (undo/redo at application level)
console.log('[AppInitializer] Initializing HistoryManager...');
this.historyManager = new HistoryManager({
    maxHistory: 50
});
this.projectController.setHistoryManager(this.historyManager);
console.log('[AppInitializer] ✅ HistoryManager initialized');
```

### 2.4 Changes Required

1. **AppInitializer.ts**
   - Add `historyManager` property
   - Instantiate in `_initializePersistenceLayer()`
   - Wire to `ProjectController`

2. **SchedulerService.ts**
   - Remove `historyManager` property
   - Remove instantiation code (lines 343-350)
   - Access via `ProjectController` or direct singleton if needed

3. **Types (if needed)**
   - Update `AppInitializer` interface if HistoryManager needs external access

---

## Part 3: Implementation Phases (Revised Order)

> **Important:** Per architecture review, do HistoryManager lift FIRST, then use feature flag for recalculateAll removal.

---

### Phase 0: Add Feature Flag (Prerequisite)

Add to top of `SchedulerService.ts`:
```typescript
/**
 * Feature flag for legacy recalculation behavior.
 * Set to false to use new reactive architecture.
 * Set to true to revert to legacy double-calculation if issues arise.
 */
const ENABLE_LEGACY_RECALC = true;  // Start with legacy, flip to false after testing
```

---

### Phase 1: HistoryManager Migration (Day 1 Morning) ⭐ DO FIRST

**Why First:** Lift state containers before optimizing logic. Ensures undo survives view changes.

1. **Modify `AppInitializer.ts`:**
   - Add `private historyManager: HistoryManager | null = null;`
   - Instantiate in `_initializePersistenceLayer()` after SnapshotService
   - Wire to ProjectController

2. **Modify `SchedulerService.ts`:**
   - Remove `this.historyManager = new HistoryManager()` (lines 343-350)
   - Add `setHistoryManager(hm: HistoryManager)` method if needed for external access

3. **Wire in initialization:**
   ```typescript
   // AppInitializer._initializePersistenceLayer()
   this.historyManager = new HistoryManager({ maxHistory: 50 });
   this.projectController.setHistoryManager(this.historyManager);
   ```

**Test:** Undo/redo works, history survives tab switch (if applicable)

---

### Phase 2: Resolve the "Await" Trap (Day 1 Afternoon) ⭐ CRITICAL

**Choose and implement one solution:**

#### Option A: Make `updateTask()` Return Promise (Recommended)
```typescript
// ProjectController.ts
private pendingCalculations = new Map<string, () => void>();

public updateTask(id: string, updates: Partial<Task>): Promise<void> {
    return new Promise((resolve) => {
        // Register callback for when CALCULATION_RESULT arrives
        const calcId = `calc_${Date.now()}`;
        this.pendingCalculations.set(calcId, resolve);
        
        // Optimistic update + send to worker
        // ... existing code ...
        this.send({ type: 'UPDATE_TASK', payload: { id, updates, calcId } });
    });
}

// In message handler for CALCULATION_RESULT:
private handleCalculationResult(response: WorkerResponse): void {
    this.tasks$.next(response.payload.tasks);
    // Resolve any pending promises
    if (response.payload.calcId) {
        const resolve = this.pendingCalculations.get(response.payload.calcId);
        if (resolve) {
            resolve();
            this.pendingCalculations.delete(response.payload.calcId);
        }
    }
}
```

#### Option B: Reactive saveData (Simpler)
```typescript
// In AppInitializer or SchedulerService initialization
this.controller.tasks$.pipe(
    skip(1),           // Skip initial value
    debounceTime(500)  // Wait for typing to stop
).subscribe(() => {
    this.saveData();
});
```

**Test:** Edit a task → verify snapshot contains calculated dates (not just user input)

---

### Phase 3: Remove Legacy Calls with Feature Flag (Day 2)

Wrap all `recalculateAll()` + `render()` calls:

```typescript
// Pattern for all 21 locations
if (ENABLE_LEGACY_RECALC) {
    this.recalculateAll();
    this.render();
}
// saveData() may need adjustment based on Phase 2 solution
```

**Test with flag = true:** Verify existing behavior unchanged
**Test with flag = false:** Verify reactive behavior works

---

### Phase 4: Verification (Day 2)

Open Chrome DevTools Console and watch Worker messages:

**Before (flag = true):**
```
UPDATE_TASK → CALCULATION_RESULT → CALCULATE → CALCULATION_RESULT
```

**After (flag = false):**
```
UPDATE_TASK → CALCULATION_RESULT
```

---

### Phase 5: Cleanup (After Verification)

Once `ENABLE_LEGACY_RECALC = false` is stable:
1. Remove the feature flag
2. Remove the wrapped code blocks
3. Consider deprecating `recalculateAll()` method entirely

---

## Part 4: Testing Checklist

### Phase 1 Verification: HistoryManager
- [ ] Undo/redo works for task edits
- [ ] Undo/redo works for dependency changes
- [ ] History survives view/tab switch (if applicable)
- [ ] `AppInitializer` correctly wires HistoryManager to ProjectController

### Phase 2 Verification: Await Trap Resolution
- [ ] Edit duration → `saveData()` snapshot contains CPM-calculated dates
- [ ] Edit start date → successor dates in snapshot are recalculated
- [ ] Rapid edits don't cause race conditions in persistence

### Phase 3 Verification: Double-Math Removal (DevTools)

**Open Chrome DevTools → Console, filter for worker messages:**

| Action | Before (flag=true) | After (flag=false) |
|--------|-------------------|-------------------|
| Edit task | UPDATE_TASK → CALC_RESULT → CALCULATE → CALC_RESULT | UPDATE_TASK → CALC_RESULT |
| Add task | ADD_TASK → CALC_RESULT → CALCULATE → CALC_RESULT | ADD_TASK → CALC_RESULT |
| Delete task | DELETE_TASK → CALC_RESULT → CALCULATE → CALC_RESULT | DELETE_TASK → CALC_RESULT |

### Functional Tests
- [ ] Edit task name → dates recalculate correctly
- [ ] Edit task duration → successor dates update
- [ ] Change dependencies → CPM recalculates
- [ ] Drag task bar → dates update, no double-render flicker
- [ ] Indent/outdent → hierarchy and dates correct
- [ ] Delete task → descendants removed, successors recalculate
- [ ] Import JSON → all tasks render correctly
- [ ] Paste tasks → inserted with correct dates
- [ ] Undo/Redo → works across all operations
- [ ] Calendar change → all dates recalculate

### UI/Visual Tests
- [ ] Grid updates immediately (no stale data until scroll)
- [ ] Gantt bars move smoothly (no flicker)
- [ ] No "flash" of old values when editing

### Performance Tests
- [ ] Edit 100 tasks rapidly → no lag or accumulating calculations
- [ ] Drag bar → smooth animation, no jitter
- [ ] Large file import (1000+ tasks) → loads efficiently

### Edge Cases
- [ ] Undo after tab switch (Phase 1)
- [ ] Redo after view change (Phase 1)
- [ ] Circular dependency detection still works
- [ ] Critical path calculation still works
- [ ] Baseline comparison still works

---

## Part 5: Rollback Plan

### Instant Rollback (Feature Flag)

The feature flag `ENABLE_LEGACY_RECALC` provides instant rollback:

```typescript
// src/services/SchedulerService.ts (top of file)
const ENABLE_LEGACY_RECALC = true;  // ← Flip to true to revert
```

**Rollback procedure:**
1. Set `ENABLE_LEGACY_RECALC = true`
2. Rebuild/restart
3. Legacy behavior restored in <1 minute

### Phase-by-Phase Rollback

| Phase | Rollback Method |
|-------|-----------------|
| Phase 1 (HistoryManager) | Move instantiation back to SchedulerService |
| Phase 2 (Await Trap) | Revert ProjectController changes |
| Phase 3 (Remove Calls) | Set feature flag to `true` |

### Git Strategy

```bash
# Each phase should be a separate commit
git commit -m "Phase 1: Move HistoryManager to AppInitializer"
git commit -m "Phase 2: Make updateTask return Promise"  
git commit -m "Phase 3: Add ENABLE_LEGACY_RECALC feature flag"
git commit -m "Phase 3: Wrap recalculateAll calls with feature flag"

# To rollback Phase 3:
git revert <phase-3-commit-hash>
```

---

## Part 6: Success Metrics

| Metric | Before | Target | How to Verify |
|--------|--------|--------|---------------|
| Worker CALCULATE messages per edit | 2 | 1 | DevTools Console |
| Render cycles per edit | 2+ | 1 | React DevTools / Performance panel |
| Undo survives tab switch | No | Yes | Manual test |
| `SchedulerService.ts` line count | 5758 | ~5700 (-1%) | `wc -l` |
| Snapshot contains calculated dates | N/A | Yes | Inspect SQLite after edit |

### Definition of Done

- [ ] `ENABLE_LEGACY_RECALC = false` is stable for 48 hours of testing
- [ ] All functional tests pass
- [ ] DevTools shows single CALCULATION_RESULT per operation
- [ ] No visual flash or stale data on any edit operation
- [ ] HistoryManager lives in AppInitializer (application level)
- [ ] Feature flag removed, dead code cleaned up

---

## Appendix: Files Modified

| File | Changes |
|------|---------|
| `src/services/SchedulerService.ts` | Remove 21 `recalculateAll()` calls, ~25 `render()` calls, remove HistoryManager init |
| `src/services/AppInitializer.ts` | Add HistoryManager instantiation and wiring |

---

## Appendix: Reference - Current recalculateAll() Implementation

```typescript
// src/services/SchedulerService.ts (lines 4622-4628)
recalculateAll(): Promise<void> {
    // In the new architecture, ProjectController.forceRecalculate() sends
    // a CALCULATE command to the WASM Worker. The Worker emits results
    // via tasks$ which the UI subscribes to. No manual result application needed.
    ProjectController.getInstance().forceRecalculate();
    return Promise.resolve();
}
```

This method is now essentially a pass-through and can potentially be deprecated after Phase 1 completion.
