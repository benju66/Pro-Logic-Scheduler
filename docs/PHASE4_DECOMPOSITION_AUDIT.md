# Phase 4: SchedulerService Decomposition - Audit & Plan

**Date:** January 2025  
**Status:** 📋 **AUDIT COMPLETE** - Ready for Planning  
**Current State:** 1,887 lines (down from 2,217 in Phase 3)  
**Target:** 1,200-1,400 lines (optional further reduction)

---

## Executive Summary

After Phase 3 completion, `SchedulerService.ts` has been reduced from **2,217 lines** to **1,887 lines** (15% reduction). This audit analyzes what remains and identifies opportunities for Phase 4 extraction.

**Key Finding:** The remaining code is **mostly appropriate** for an orchestrator service. However, there are opportunities to extract:
1. **Event Handler Routing** (~200 lines) - Consolidate event routing logic
2. **Keyboard Handler Orchestration** (~100 lines) - Extract keyboard binding setup
3. **Selection UI Updates** (~80 lines) - Extract selection rendering logic
4. **Viewport Facade Creation** (~100 lines) - Extract viewport initialization

**Assessment:** Phase 4 is **OPTIONAL** - Current size is acceptable for an orchestrator. Further reduction would improve maintainability but is not critical.

---

## Current State Analysis

### Line Count Breakdown

| Category | Lines | % of Total | Assessment |
|----------|-------|-----------|------------|
| **Lifecycle & Initialization** | ~350 | 18.5% | ✅ Appropriate |
| **Event Handlers** | ~400 | 21.2% | ⚠️ Could consolidate |
| **Keyboard Handlers** | ~150 | 7.9% | ⚠️ Could extract |
| **Selection Management** | ~100 | 5.3% | ⚠️ Could extract UI updates |
| **Public API Facades** | ~200 | 10.6% | ✅ Appropriate (thin delegations) |
| **Data Access** | ~150 | 7.9% | ✅ Appropriate |
| **Persistence** | ~100 | 5.3% | ✅ Appropriate |
| **Utility Methods** | ~50 | 2.6% | ✅ Appropriate |
| **Viewport Creation** | ~100 | 5.3% | ⚠️ Could extract |
| **Other Orchestration** | ~287 | 15.2% | ✅ Appropriate |
| **TOTAL** | **1,887** | **100%** | |

---

## Detailed Method Analysis

### 1. Event Handlers (~400 lines)

#### Current State
All event handlers are private methods that route to extracted services:

```typescript
// Examples:
private _handleRowClick(taskId: string, e: MouseEvent): void { /* ~65 lines */ }
private _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> { /* ~30 lines */ }
private _handleAction(taskId: string, action: string, e?: Event): void { /* ~30 lines */ }
private _handleDrawerUpdate(taskId: string, field: string, value: unknown): Promise<void> { /* ~30 lines */ }
private _handleDependenciesSave(taskId: string, dependencies: Array<...>): void { /* ~15 lines */ }
private _handleCalendarSave(calendar: Calendar): void { /* ~10 lines */ }
private _handleRowMove(taskIds: string[], targetId: string, position: ...): void { /* ~5 lines */ }
private _handleBarDrag(task: Task, start: string, end: string): void { /* ~10 lines */ }
private _handleTradePartnerClick(taskId: string, tradePartnerId: string, e: MouseEvent): void { /* ~5 lines */ }
private _handleEnterLastRow(lastTaskId: string, field: string): void { /* ~5 lines */ }
```

#### Assessment
- ✅ **Good:** Most handlers are thin delegations (< 10 lines)
- ⚠️ **Issue:** `_handleRowClick` is complex (~65 lines) - contains selection logic
- ⚠️ **Issue:** `_handleCellChange` and `_handleDrawerUpdate` have duplicate logic (~30 lines each)

#### Phase 4 Opportunity
**Extract: `EventRouterService`**
- Consolidate event routing logic
- Extract `_handleRowClick` selection logic to `SelectionService`
- Consolidate `_handleCellChange` and `_handleDrawerUpdate` (duplicate SchedulingLogicService calls)
- **Expected Reduction:** ~150-200 lines

**Risk:** ⚠️ **MEDIUM** - Event handlers are tightly coupled to SchedulerService's internal state

---

### 2. Keyboard Handlers (~150 lines)

#### Current State
Keyboard handlers set up bindings and route to services:

```typescript
initKeyboard(): void { /* ~60 lines - sets up all bindings */ }
private _handleCellNavigation(direction: ..., shiftKey: boolean): void { /* ~40 lines */ }
private _handleArrowCollapse(key: 'ArrowLeft' | 'ArrowRight'): void { /* ~15 lines */ }
private _handleTabIndent(): void { /* ~5 lines - delegates */ }
private _handleTabOutdent(): void { /* ~5 lines - delegates */ }
private _handleEscape(): void { /* ~5 lines - delegates */ }
```

#### Assessment
- ✅ **Good:** Most handlers delegate to services
- ⚠️ **Issue:** `initKeyboard()` is large (~60 lines) - sets up all bindings
- ⚠️ **Issue:** `_handleCellNavigation` is complex (~40 lines) - mixes navigation and selection

#### Phase 4 Opportunity
**Extract: `KeyboardBindingService`**
- Extract keyboard binding setup from `initKeyboard()`
- Extract `_handleCellNavigation` logic (can stay but simplified)
- **Expected Reduction:** ~80-100 lines

**Risk:** ✅ **LOW** - Keyboard handlers are well-isolated

---

### 3. Selection Management (~100 lines)

#### Current State
Selection management includes UI updates:

```typescript
private _handleSelectionChange(selectedIds: string[]): void { /* ~20 lines */ }
private _updateSelection(): void { /* ~20 lines - UI updates */ }
private _updateHeaderCheckboxState(checkbox?: HTMLInputElement): void { /* ~10 lines */ }
public onTaskSelect(callback: ...): () => void { /* ~15 lines */ }
public getSelectedTask(): Task | null { /* ~5 lines */ }
public onPanelOpenRequest(callback: ...): () => void { /* ~15 lines */ }
```

#### Assessment
- ✅ **Good:** Selection state is managed by `SelectionModel` (already extracted)
- ⚠️ **Issue:** UI update logic (`_updateSelection`, `_updateHeaderCheckboxState`) is in SchedulerService
- ⚠️ **Issue:** `_handleRowClick` contains selection logic (~30 lines of the 65 total)

#### Phase 4 Opportunity
**Extract: `SelectionUIService`**
- Extract UI update methods (`_updateSelection`, `_updateHeaderCheckboxState`)
- Extract selection logic from `_handleRowClick` to work with `SelectionUIService`
- **Expected Reduction:** ~50-80 lines

**Risk:** ⚠️ **MEDIUM** - UI updates are tightly coupled to grid/gantt components

---

### 4. Viewport Facade Creation (~100 lines)

#### Current State
Viewport facades are created in `init()`:

```typescript
private _createGridFacade(viewport: SchedulerViewport): VirtualScrollGridFacade { /* ~55 lines */ }
private _createGanttFacade(viewport: SchedulerViewport): CanvasGanttFacade { /* ~30 lines */ }
```

#### Assessment
- ✅ **Good:** Facades are well-defined interfaces
- ⚠️ **Issue:** Creation logic is verbose and could be extracted

#### Phase 4 Opportunity
**Extract: `ViewportFactoryService`**
- Extract facade creation logic
- **Expected Reduction:** ~80-100 lines

**Risk:** ✅ **LOW** - Facade creation is isolated

---

### 5. Lifecycle & Initialization (~350 lines)

#### Current State
```typescript
constructor(options: ...) { /* ~50 lines */ }
private async _initServices(): Promise<void> { /* ~50 lines */ }
async init(): Promise<void> { /* ~250 lines */ }
destroy(): void { /* ~15 lines */ }
```

#### Assessment
- ✅ **Appropriate:** Lifecycle methods are core to orchestrator
- ✅ **Good:** `init()` orchestrates all component initialization
- ⚠️ **Note:** Could extract viewport creation, but `init()` should remain

**Phase 4 Recommendation:** ✅ **KEEP** - Lifecycle is appropriate for orchestrator

---

### 6. Public API Facades (~200 lines)

#### Current State
Many thin delegations:
```typescript
getTask(id: string): Task | undefined { return this.projectController.getTaskById(id); }
addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> { return this.taskOperations.addTask(taskData); }
deleteTask(taskId: string): void { this.taskOperations.deleteTask(taskId); }
// ... ~50 more similar methods
```

#### Assessment
- ✅ **Appropriate:** Public API facades are thin delegations
- ✅ **Good:** Maintains backward compatibility
- ✅ **Good:** Clear separation between public API and implementation

**Phase 4 Recommendation:** ✅ **KEEP** - Public API facades are appropriate

---

### 7. Data Access (~150 lines)

#### Current State
```typescript
get tasks(): Task[] { return this.projectController.getTasks(); }
set tasks(tasks: Task[]) { /* ~15 lines */ }
get calendar(): Calendar { return this.projectController.getCalendar(); }
set calendar(calendar: Calendar) { this.projectController.updateCalendar(calendar); }
async loadData(): Promise<void> { /* ~40 lines */ }
async saveData(): Promise<void> { /* ~20 lines */ }
async onShutdown(): Promise<void> { /* ~20 lines */ }
```

#### Assessment
- ✅ **Appropriate:** Data access is core orchestrator responsibility
- ✅ **Good:** Properly delegates to ProjectController

**Phase 4 Recommendation:** ✅ **KEEP** - Data access is appropriate

---

## Phase 4 Extraction Opportunities

### Priority 1: High Value, Low Risk

#### 4.1: ViewportFactoryService ✅
- **Extract:** `_createGridFacade()`, `_createGanttFacade()`
- **Lines:** ~85 lines
- **Risk:** ✅ **LOW**
- **Value:** ✅ **HIGH** - Cleaner initialization
- **Confidence:** **95%**

#### 4.2: KeyboardBindingService ✅
- **Extract:** `initKeyboard()` binding setup, `_handleCellNavigation` simplification
- **Lines:** ~80-100 lines
- **Risk:** ✅ **LOW**
- **Value:** ✅ **MEDIUM** - Better organization
- **Confidence:** **90%**

### Priority 2: Medium Value, Medium Risk

#### 4.3: SelectionUIService ⚠️
- **Extract:** `_updateSelection()`, `_updateHeaderCheckboxState()`, selection logic from `_handleRowClick`
- **Lines:** ~80 lines
- **Risk:** ⚠️ **MEDIUM** - Tight coupling to grid/gantt
- **Value:** ✅ **MEDIUM** - Better separation
- **Confidence:** **80%**

#### 4.4: EventRouterService ⚠️
- **Extract:** Consolidate event routing, deduplicate `_handleCellChange`/`_handleDrawerUpdate`
- **Lines:** ~150-200 lines
- **Risk:** ⚠️ **MEDIUM** - Complex event routing
- **Value:** ✅ **MEDIUM** - Reduced duplication
- **Confidence:** **75%**

---

## Phase 4 Implementation Plan

### Phase 4.1: ViewportFactoryService (Recommended)

**Goal:** Extract viewport facade creation logic

**Steps:**
1. Create `src/services/scheduler/ViewportFactoryService.ts`
2. Move `_createGridFacade()` and `_createGanttFacade()` to factory
3. Update `init()` to use factory
4. Update barrel export

**Expected Reduction:** ~85 lines  
**Risk:** ✅ **LOW**  
**Confidence:** **95%**

---

### Phase 4.2: KeyboardBindingService (Recommended)

**Goal:** Extract keyboard binding setup and simplify navigation

**Steps:**
1. Create `src/services/scheduler/KeyboardBindingService.ts`
2. Extract binding setup from `initKeyboard()`
3. Simplify `_handleCellNavigation` (keep in SchedulerService but delegate more)
4. Update `initKeyboard()` to use service

**Expected Reduction:** ~80-100 lines  
**Risk:** ✅ **LOW**  
**Confidence:** **90%**

---

### Phase 4.3: SelectionUIService (Optional)

**Goal:** Extract selection UI update logic

**Steps:**
1. Create `src/services/scheduler/SelectionUIService.ts`
2. Extract `_updateSelection()`, `_updateHeaderCheckboxState()`
3. Extract selection logic from `_handleRowClick` (keep routing in SchedulerService)
4. Update handlers to use service

**Expected Reduction:** ~80 lines  
**Risk:** ⚠️ **MEDIUM**  
**Confidence:** **80%**

---

### Phase 4.4: EventRouterService (Optional)

**Goal:** Consolidate event routing and reduce duplication

**Steps:**
1. Create `src/services/scheduler/EventRouterService.ts`
2. Consolidate `_handleCellChange` and `_handleDrawerUpdate` (both call SchedulingLogicService)
3. Extract routing logic from `_handleAction`
4. Update SchedulerService to use router

**Expected Reduction:** ~150-200 lines  
**Risk:** ⚠️ **MEDIUM**  
**Confidence:** **75%**

---

## Expected Results

### If All Phase 4 Extractions Completed:
- **Current:** 1,887 lines
- **After 4.1:** ~1,802 lines (-85)
- **After 4.2:** ~1,702 lines (-100)
- **After 4.3:** ~1,622 lines (-80)
- **After 4.4:** ~1,422 lines (-200)
- **Total Reduction:** ~465 lines (25% from Phase 3 baseline)

### Recommended Minimum (4.1 + 4.2):
- **Current:** 1,887 lines
- **After 4.1 + 4.2:** ~1,702 lines (-185)
- **Total Reduction:** ~185 lines (10% from Phase 3 baseline)

---

## Risk Assessment

### Overall Risk: ⚠️ **MEDIUM**

| Extraction | Risk | Mitigation |
|------------|------|------------|
| ViewportFactoryService | ✅ LOW | Well-isolated, clear interface |
| KeyboardBindingService | ✅ LOW | Keyboard handlers are isolated |
| SelectionUIService | ⚠️ MEDIUM | Tight coupling to grid/gantt - test thoroughly |
| EventRouterService | ⚠️ MEDIUM | Complex routing - incremental extraction |

---

## Recommendations

### ✅ **Recommended: Phase 4.1 + 4.2**
- **Value:** High (cleaner initialization, better organization)
- **Risk:** Low
- **Effort:** 4-6 hours
- **Result:** ~1,702 lines (10% reduction)

### ⚠️ **Optional: Phase 4.3 + 4.4**
- **Value:** Medium (better separation, reduced duplication)
- **Risk:** Medium (requires careful testing)
- **Effort:** 8-12 hours
- **Result:** ~1,422 lines (25% reduction)

### ✅ **Alternative: Stop Here**
- **Current State:** 1,887 lines is **acceptable** for an orchestrator
- **Assessment:** Remaining code is mostly appropriate
- **Recommendation:** Phase 4 is **optional** - current state is production-ready

---

## Conclusion

Phase 4 decomposition is **optional** but offers value:

✅ **Phase 4.1 + 4.2:** Recommended - Low risk, high value  
⚠️ **Phase 4.3 + 4.4:** Optional - Medium risk, medium value  
✅ **Stop Here:** Also valid - Current state is acceptable

**Recommendation:** Proceed with **Phase 4.1 + 4.2** if further reduction is desired. Phase 4.3 + 4.4 can be deferred or skipped entirely.

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Status:** ✅ Audit Complete - Ready for Planning
