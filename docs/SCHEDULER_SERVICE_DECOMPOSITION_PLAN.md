# Implementation Plan: Decompose SchedulerService.ts

**Created:** January 7, 2025  
**Status:** Ready for Implementation  
**Estimated Time:** 3-4 hours  
**Risk Level:** Low-Medium  

---

## Executive Summary

`SchedulerService.ts` is a 4,959-line "God Class" that violates the Single Responsibility Principle. This plan decomposes it into a thin "Traffic Cop" by:

1. Removing selection wrapper methods (delegating directly to `SelectionModel`)
2. Wiring up the existing `SchedulingLogicService` (already extracted, just needs connection)
3. Cleaning up dead code

**Target:** Reduce to ~800-1000 lines with all domain logic properly delegated.

---

## Pre-Implementation Checklist

- [ ] Verify build compiles: `npm run build`
- [ ] Note current line count: **4,959 lines**
- [ ] Target line count: **~800-1000 lines** (after all future phases)
- [ ] Immediate target: **~4,300 lines** (after this plan)

---

## Phase 1: Remove Selection Wrappers

### Goal
Replace 74 `_sel_*` wrapper calls with direct `SelectionModel` method calls, then delete the 16 wrapper methods.

### Files Modified
- `src/services/SchedulerService.ts`

### Step 1.1: Find & Replace Mappings

| Find | Replace With |
|------|--------------|
| `this._sel_clear()` | `this.selectionModel.clear()` |
| `this._sel_add(id)` | `this.selectionModel.addToSelection([id])` |
| `this._sel_delete(id)` | `this.selectionModel.removeFromSelection([id])` |
| `this._sel_count()` | `this.selectionModel.getSelectionCount()` |
| `this._sel_has(id)` | `this.selectionModel.isSelected(id)` |
| `this._sel_toArray()` | `this.selectionModel.getSelectedIds()` |
| `this._sel_getFocused()` | `this.selectionModel.getFocusedId()` |
| `this._sel_getAnchor()` | `this.selectionModel.getAnchorId()` |
| `this._sel_getFocusedColumn()` | `this.selectionModel.getFocusedField()` |
| `this._sel_setFocused(id, field)` | `this.selectionModel.setFocus(id, field)` |
| `this._sel_setFocusedColumn(field)` | `this.selectionModel.setFocusedField(field)` |
| `this._sel_setAnchor(id)` | *Delete call entirely* (no-op in current implementation) |

### Step 1.2: Handle Complex Cases

#### `_sel_selectSingle(id)` — Appears 15+ times

**Replace with:**
```typescript
this.selectionModel.setSelection(new Set([id]), id, [id]);
```

#### `_sel_set(ids, focusId)` — Case-by-case review needed

**Original wrapper:**
```typescript
private _sel_set(ids: string[], focusId?: string | null): void {
    const focus = focusId ?? (ids.length > 0 ? ids[ids.length - 1] : null);
    this.selectionModel.setSelection(new Set(ids), focus, ids);
}
```

**Replace each call site with:**
```typescript
const focus = focusId ?? (ids.length > 0 ? ids[ids.length - 1] : null);
this.selectionModel.setSelection(new Set(ids), focus, ids);
```

Or simplify where `focusId` is always provided:
```typescript
this.selectionModel.setSelection(new Set(ids), focusId, ids);
```

### Step 1.3: Delete Wrapper Methods

Delete lines **191-288** containing these 16 methods:
- `_sel_clear()`
- `_sel_add()`
- `_sel_delete()`
- `_sel_set()`
- `_sel_setFocused()`
- `_sel_setAnchor()`
- `_sel_count()`
- `_sel_has()`
- `_sel_toArray()`
- `_sel_selectSingle()`
- `_sel_getFocused()`
- `_sel_getAnchor()`
- `_sel_getFocusedColumn()`
- `_sel_setFocusedColumn()`

### Step 1.4: Verification

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Run unit tests: `npx vitest run tests/unit/CommandService.test.ts`
- [ ] Run unit tests: `npx vitest run tests/unit/EditingStateManager.test.ts`
- [ ] Manual test: Click a task row → should select it
- [ ] Manual test: Ctrl+Click multiple tasks → should multi-select
- [ ] Manual test: Shift+Click → should range select

### Estimated Lines Removed: ~100

---

## Phase 2: Wire Up SchedulingLogicService

### Goal
Replace `_applyTaskEdit` and `_applyDateChangeImmediate` with the existing `SchedulingLogicService.applyEdit()`.

> **KEY DISCOVERY:** The `SchedulingLogicService` already exists at `src/services/migration/SchedulingLogicService.ts` with all scheduling logic extracted (680 lines). It just needs to be wired up!

> ⚠️ **DI COMPLIANCE:** This phase follows the Pure DI pattern from `TRUE_PURE_DI_IMPLEMENTATION_PLAN.md`.
> We use constructor injection with singleton fallback—NOT direct `getInstance()` calls—to maintain testability.

### Files Modified
- `src/services/SchedulerService.ts` — Add property, update constructor, replace method calls
- `src/main.ts` — Create and register `SchedulingLogicService` in Composition Root
- `src/services/AppInitializer.ts` — Pass `SchedulingLogicService` through to `SchedulerService`

### Step 2.1: Add Import

At the top of `SchedulerService.ts`, add:
```typescript
import { SchedulingLogicService } from './migration/SchedulingLogicService';
```

### Step 2.2: Add Service as Class Property

In the class properties section (around line 130), add:
```typescript
/** SchedulingLogicService - scheduling business logic */
private schedulingLogicService: SchedulingLogicService;
```

### Step 2.3: Add to Constructor Options Interface (DI Compliance)

> ⚠️ **IMPORTANT:** Do NOT use `getInstance()` directly. This step follows the Pure DI pattern
> established in `TRUE_PURE_DI_IMPLEMENTATION_PLAN.md` to maintain testability.

**Step 2.3.1:** Update the constructor options interface (around line 324):

```typescript
constructor(options: SchedulerServiceOptions & {
    // Existing DI Dependencies
    projectController?: ProjectController;
    selectionModel?: SelectionModel;
    commandService?: CommandService;
    rendererFactory?: RendererFactory;
    keyboardService?: KeyboardService;
    // NEW: Add SchedulingLogicService
    schedulingLogicService?: SchedulingLogicService;
} = {} as SchedulerServiceOptions) {
```

**Step 2.3.2:** Initialize with fallback in constructor body (around line 350):

```typescript
// Use injected service or fall back to singleton (backward compatibility)
this.schedulingLogicService = options.schedulingLogicService || SchedulingLogicService.getInstance();
```

**Step 2.3.3:** Update `main.ts` Composition Root (add after other Level 2 services):

```typescript
// Level 2: Scheduling logic (stateless, no deps)
const schedulingLogicService = new SchedulingLogicService();
SchedulingLogicService.setInstance(schedulingLogicService);
```

**Step 2.3.4:** Update `AppInitializer` to pass through (in `AppInitializerOptions` interface and constructor):

```typescript
// In AppInitializerOptions interface:
schedulingLogicService?: SchedulingLogicService;

// In AppInitializer constructor:
this.schedulingLogicService = options.schedulingLogicService || null;

// When creating SchedulerService options:
const options = {
    // ... existing options ...
    schedulingLogicService: this.schedulingLogicService || undefined,
};
```

> **Why this pattern?** The fallback `|| SchedulingLogicService.getInstance()` maintains backward
> compatibility while allowing tests to inject mocks via the constructor. This is consistent with
> how `projectController`, `selectionModel`, and `commandService` are handled.

### Step 2.4: Replace `_handleCellChange` (around line 2048)

**Before:**
```typescript
private async _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> {
    if (field === 'checkbox') return;
    
    this.saveCheckpoint();
    
    const result = await this._applyTaskEdit(taskId, field, value);
    
    if (!result.success) return;
    
    // Handle follow-up actions
    if (result.needsRecalc) {
        if (ENABLE_LEGACY_RECALC) {
            await this.recalculateAll();
            this.saveData();
        }
    }
    // ... more legacy handling
}
```

**After:**
```typescript
private async _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> {
    if (field === 'checkbox') return;
    
    this.saveCheckpoint();
    
    const result = this.schedulingLogicService.applyEdit(taskId, field, value, {
        controller: this.projectController,
        calendar: this.projectController.getCalendar(),
    });
    
    // Show toast message if provided
    if (result.message) {
        switch (result.messageType) {
            case 'success': this.toastService?.success(result.message); break;
            case 'warning': this.toastService?.warning(result.message); break;
            case 'error': this.toastService?.error(result.message); break;
            default: this.toastService?.info(result.message);
        }
    }
    
    if (!result.success) return;
    
    // NOTE: With ENABLE_LEGACY_RECALC=false, ProjectController.updateTask() triggers
    // Worker calculation, and reactive saveData subscription handles persistence
}
```

### Step 2.5: Replace `_handleDrawerUpdate` (around line 2210)

Apply the same pattern as Step 2.4:

**After:**
```typescript
private async _handleDrawerUpdate(taskId: string, field: string, value: unknown): Promise<void> {
    this.saveCheckpoint();
    
    const result = this.schedulingLogicService.applyEdit(taskId, field, value, {
        controller: this.projectController,
        calendar: this.projectController.getCalendar(),
    });
    
    // Show toast message if provided
    if (result.message) {
        switch (result.messageType) {
            case 'success': this.toastService?.success(result.message); break;
            case 'warning': this.toastService?.warning(result.message); break;
            case 'error': this.toastService?.error(result.message); break;
            default: this.toastService?.info(result.message);
        }
    }
    
    if (!result.success) return;
    
    // Sync drawer with updated values (dates may have changed from CPM)
    if (this.drawer && this.drawer.isDrawerOpen() && this.drawer.getActiveTaskId() === taskId) {
        const updatedTask = this.projectController.getTaskById(taskId);
        if (updatedTask) {
            this.drawer.sync(updatedTask);
        }
    }
}
```

### Step 2.6: Replace `setSchedulingMode` (around line 4761)

**Before:**
```typescript
public async setSchedulingMode(taskId: string, mode: 'Auto' | 'Manual'): Promise<void> {
    this.saveCheckpoint();
    
    const result = await this._applyTaskEdit(taskId, 'schedulingMode', mode);
    
    if (result.success && result.needsRecalc) {
        if (ENABLE_LEGACY_RECALC) {
            this.recalculateAll();
            this.saveData();
            this.render();
        }
    }
}
```

**After:**
```typescript
public async setSchedulingMode(taskId: string, mode: 'Auto' | 'Manual'): Promise<void> {
    this.saveCheckpoint();
    
    const result = this.schedulingLogicService.applyEdit(taskId, 'schedulingMode', mode, {
        controller: this.projectController,
        calendar: this.projectController.getCalendar(),
    });
    
    if (result.message) {
        switch (result.messageType) {
            case 'success': this.toastService?.success(result.message); break;
            case 'warning': this.toastService?.warning(result.message); break;
            default: this.toastService?.info(result.message);
        }
    }
}
```

### Step 2.7: Delete Legacy Methods

Delete these methods entirely:

1. **`_applyTaskEdit`** (lines ~1719-2030) — **~310 lines**
2. **`_applyDateChangeImmediate`** (lines ~1509-1708) — **~200 lines**

### Step 2.8: Verification

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Manual test: Edit a task's **start date** → should see "Start constraint applied (SNET)" toast
- [ ] Manual test: Edit a task's **end date** → should see "Finish constraint applied (FNLT)" toast
- [ ] Manual test: Edit a task's **duration** → end date should recalculate
- [ ] Manual test: Set **actualStart** → should see "Task started - schedule locked with SNET constraint"
- [ ] Manual test: Set **actualFinish** → should see "Task complete" with variance message
- [ ] Manual test: Toggle **scheduling mode** Auto ↔ Manual → appropriate toast messages

### Estimated Lines Removed: ~510

---

## Phase 3: Cleanup Dead Code

### Step 3.1: Remove Unused `ENABLE_LEGACY_RECALC` Checks

Search for remaining `ENABLE_LEGACY_RECALC` references and remove dead code paths where the flag is `false`.

### Step 3.2: Remove Duplicate Toast Logic

The `SchedulingLogicService` now returns messages with types. Remove any duplicate/hardcoded toast calls in SchedulerService that are now redundant.

### Step 3.3: Final Verification

- [ ] TypeScript compiles: `npm run build`
- [ ] Run all unit tests: `npx vitest run tests/unit`
- [ ] Final line count check: should be ~4,300 lines

### Estimated Lines Removed: ~50

---

## Phase 4: Update Stale Tests (Optional/Future)

### Issue
Some integration tests import `TaskStore` which was removed during the ProjectController migration.

### Files Affected
- `tests/integration/DriverModeStatusing.test.ts`
- `tests/unit/BlankRow.test.ts`
- `tests/unit/TaskAddition.test.ts`

### Approach Options
1. **Update tests** to use `ProjectController` instead of `TaskStore`
2. **Mark as skipped** pending future test refactoring
3. **Delete and rewrite** with new architecture

### Recommendation
Skip for now; create a separate ticket for test modernization.

---

## Summary

| Phase | Lines Removed | Risk Level | Time | Status |
|-------|---------------|------------|------|--------|
| Phase 1: Selection Wrappers | ~100 | Low | 1 hr | ⬜ Pending |
| Phase 2: Scheduling Logic + DI Wiring | ~510 | Medium | 1.5-2 hr | ⬜ Pending |
| Phase 3: Cleanup | ~50 | Low | 30 min | ⬜ Pending |
| Phase 4: Test Updates | N/A | Low | Optional | ⬜ Future |
| **Total** | **~660** | | **3-4 hr** | |

> **Note:** Phase 2 includes DI wiring in `main.ts` and `AppInitializer.ts` to maintain Pure DI compliance.

### Expected Outcome
- **Before:** 4,959 lines
- **After this plan:** ~4,300 lines
- **Ultimate target:** ~800-1000 lines (requires additional future phases)

---

## Rollback Plan

If anything goes wrong:
```bash
# Phase 1 rollback (single file):
git checkout -- src/services/SchedulerService.ts

# Phase 2 rollback (multiple files due to DI wiring):
git checkout -- src/services/SchedulerService.ts src/main.ts src/services/AppInitializer.ts
```

> **Tip:** Create a git commit after each phase to enable granular rollback.

---

## Future Work (Not in This Plan)

After this plan is complete, additional decomposition opportunities include:

1. **Task Operations** — `addTask`, `deleteTask`, `indent`, `outdent` → `TaskOperationsService`
2. **Clipboard Operations** — Already delegate to `CommandService`, just cleanup
3. **Row Movement** — `moveSelectedTasks`, `_handleRowMove` → `TaskOperationsService`
4. **View State** — `viewMode`, column preferences → `ViewStateService`
5. **File Operations** — import/export → `FileOperationsService`

Each of these would further reduce SchedulerService toward the ~800 line target.

---

## Appendix A: SchedulingLogicService Reference

The `SchedulingLogicService` at `src/services/migration/SchedulingLogicService.ts` implements:

| Field | Business Rule |
|-------|---------------|
| `duration` | Accept raw value, validate at commit |
| `start` | Apply SNET constraint (Auto mode) or set directly (Manual mode) |
| `end` | Apply FNLT constraint (Auto mode) or recalculate duration (Manual mode) |
| `actualStart` | Anchor with SNET, recalculate duration if actualFinish exists |
| `actualFinish` | Complete task (100%), auto-populate actualStart, show variance |
| `constraintType` | Clear date if set to 'asap' |
| `constraintDate` | Simple update |
| `schedulingMode` | Manual→Auto adds SNET to preserve dates; Auto→Manual pins dates |
| `progress` | Clamp 0-100 |
| `tradePartnerIds` | Simple array update |
| Other fields | Simple update (name, notes, etc.) |

---

## Appendix B: SelectionModel API Reference

Methods used after replacing `_sel_*` wrappers:

| Method | Description |
|--------|-------------|
| `clear()` | Clear all selection |
| `addToSelection(ids: string[])` | Add tasks to selection |
| `removeFromSelection(ids: string[])` | Remove tasks from selection |
| `setSelection(ids: Set<string>, focusId: string \| null, order?: string[])` | Replace selection entirely |
| `setFocus(id: string \| null, field?: string)` | Set focused task/field |
| `setFocusedField(field: string \| null)` | Set focused column |
| `getSelectionCount()` | Get count of selected tasks |
| `isSelected(id: string)` | Check if task is selected |
| `getSelectedIds()` | Get array of selected IDs |
| `getFocusedId()` | Get currently focused task ID |
| `getAnchorId()` | Get anchor for range selection |
| `getFocusedField()` | Get currently focused column |
