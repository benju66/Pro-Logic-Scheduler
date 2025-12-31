# SchedulerService Method-Level Test Mapping

## Overview

This document provides a comprehensive mapping of every method in `SchedulerService.ts` to:
1. **Target Service** - Where the method will migrate to
2. **Test Coverage** - Current test status
3. **Risk Level** - Complexity and migration risk (🟢 Low, 🟡 Medium, 🔴 High)
4. **Migration Notes** - Special considerations

---

## Migration Target Services

| Service | Responsibility |
|---------|----------------|
| `TaskOperationService` | CRUD operations for tasks |
| `SchedulingLogicService` | Business rules, scheduling triangle, driver mode |
| `UIEventCoordinator` | Event routing, UI interactions |
| `ViewCoordinator` | Grid/Gantt synchronization, rendering |
| `ColumnManager` | Column definitions and preferences |
| `BaselineManager` | Baseline snapshot/comparison |
| `ClipboardService` | Copy/cut/paste operations |
| `FileOperationService` | Import/export, file I/O |
| `TradePartnerOperationService` | Trade partner CRUD |
| `SchedulerFacade` | Thin orchestration layer (final SchedulerService) |

---

## Method Mapping

### 1. Task Operations (→ TaskOperationService)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `addTask()` | 3423-3491 | ✅ `AddTaskAppendBottom.test.ts`, `TaskAdditionIntegration.test.ts` | 🟢 | Delegates to ProjectController |
| `deleteTask()` | 3496-3519 | ✅ `scheduling_logic.spec.ts` | 🟢 | Delegates to ProjectController |
| `_deleteSelected()` | 3525-3555 | ⚠️ Partial | 🟡 | Composite action, needs undo test |
| `toggleCollapse()` | 3561-3573 | ⚠️ Partial | 🟢 | Simple delegation |
| `indent()` | 3578-3621 | ❌ Missing | 🟡 | Uses OrderingService |
| `outdent()` | 3627-3657 | ❌ Missing | 🟡 | Uses OrderingService |
| `wakeUpBlankRow()` | ~3800 | ✅ `BlankRow.test.ts` | 🟢 | Blank → Task conversion |
| `insertBlankRowAbove()` | ~3850 | ✅ `BlankRow.test.ts` | 🟢 | |
| `insertBlankRowBelow()` | ~3900 | ✅ `BlankRow.test.ts` | 🟢 | |
| `maybeRevertToBlank()` | ~3950 | ✅ `BlankRow.test.ts` | 🟢 | |

### 2. Scheduling Logic (→ SchedulingLogicService)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `_applyTaskEdit()` | 2014-2326 | ✅ `DriverModeStatusing.test.ts` | 🔴 | **CRITICAL**: Complex business logic |
| `_applyDateChangeImmediate()` | 1810-2004 | ✅ `DriverModeStatusing.test.ts` | 🔴 | Scheduling triangle |
| `_handleCellChange()` | 2343-2389 | ✅ `DateDoubleEntryBug.test.ts` | 🟡 | Routes to _applyTaskEdit |
| `recalculateAll()` | 5296-5302 | ✅ Implicit | 🟢 | Already thin wrapper |
| `_applyCalculationResult()` | 5308-5393 | ❌ Missing | 🟡 | Manual result application |

#### `_applyTaskEdit` Field Handlers (All require tests)

| Field | Lines | Test Coverage | Risk | Business Rule |
|-------|-------|---------------|------|---------------|
| `duration` | 2029-2053 | ⚠️ Partial | 🟡 | No validation during edit |
| `start` | 2055-2073 | ✅ | 🟡 | Applies SNET constraint |
| `end` | 2076-2090 | ⚠️ Partial | 🟡 | Applies FNLT constraint |
| `actualStart` | 2092-2141 | ✅ Full | 🔴 | Driver Mode + Anchor |
| `actualFinish` | 2143-2231 | ✅ Full | 🔴 | Driver Mode + Completion |
| `constraintType` | 2233-2247 | ⚠️ Partial | 🟡 | ASAP clears constraintDate |
| `constraintDate` | 2249-2253 | ⚠️ Partial | 🟢 | Simple update |
| `tradePartnerIds` | 2255-2262 | ❌ Missing | 🟢 | Display only |
| `schedulingMode` | 2264-2317 | ❌ Missing | 🟡 | Auto ↔ Manual transitions |

### 3. UI Event Handling (→ UIEventCoordinator)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `_handleRowClick()` | 1693-1776 | ❌ Missing | 🟡 | Selection logic |
| `_handleAction()` | 2451-2487 | ❌ Missing | 🟢 | Action routing |
| `_showRowContextMenu()` | 3680-3761 | ❌ Missing | 🟢 | Context menu |
| `_handleArrowNavigation()` | 2808-2900 | ❌ Missing | 🟡 | Keyboard nav |
| `_handleCellNavigation()` | 2900-3000 | ❌ Missing | 🟡 | Tab/Enter nav |
| `_handleTabIndent()` | 3000-3050 | ❌ Missing | 🟢 | Tab → indent |
| `_handleTabOutdent()` | 3050-3118 | ❌ Missing | 🟢 | Shift+Tab → outdent |
| `_handleEnterLastRow()` | 2392-2423 | ❌ Missing | 🟢 | Auto-add task |
| `_handleSelectionChange()` | 595-620 | ❌ Missing | 🟢 | Selection sync |

### 4. View Coordination (→ ViewCoordinator)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `render()` | 5560-5590 | ❌ Missing | 🟡 | Main render orchestration |
| `_updateGridDataSync()` | 5531-5539 | ❌ Missing | 🟡 | **BLOCKING**: Sync operation |
| `_updateGanttDataSync()` | 5547-5557 | ❌ Missing | 🟡 | **BLOCKING**: Sync operation |
| `_updateSelection()` | ~4916 | ❌ Missing | 🟢 | Selection → UI sync |
| `_updateHeaderCheckboxState()` | ~4880 | ❌ Missing | 🟢 | Checkbox sync |
| `scrollToTask()` | ~5400 | ❌ Missing | 🟢 | Scroll management |

### 5. Column Management (→ ColumnManager)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `_getBaseColumnDefinitions()` | 747-1066 | ❌ Missing | 🟢 | Static definitions |
| `_getColumnDefinitions()` | 1072-1100 | ❌ Missing | 🟢 | Applies preferences |
| `_applyColumnPreferences()` | 1100-1128 | ❌ Missing | 🟢 | Width/visibility |
| `_buildGridHeader()` | 1218-1333 | ❌ Missing | 🟢 | Dynamic header |
| `openColumnSettings()` | ~4200 | ❌ Missing | 🟢 | Modal open |
| `_saveColumnSettings()` | ~4250 | ❌ Missing | 🟢 | Persist to localStorage |

### 6. Baseline Management (→ BaselineManager)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `hasBaseline()` | 1448-1460 | ❌ Missing | 🟢 | Check existence |
| `setBaseline()` | 1462-1530 | ❌ Missing | 🟡 | Snapshot current schedule |
| `clearBaseline()` | 1532-1590 | ❌ Missing | 🟡 | Clear all baseline data |
| `_calculateVariance()` | 1592-1612 | ❌ Missing | 🟢 | Variance calculation |

### 7. Clipboard Operations (→ ClipboardService)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `copySelected()` | 4922-4957 | ❌ Missing | 🟡 | Includes descendants |
| `cutSelected()` | 4959-4999 | ❌ Missing | 🟡 | Deferred delete |
| `paste()` | 5005-5189 | ❌ Missing | 🔴 | Complex: ID remap, hierarchy |

### 8. File Operations (→ FileOperationService)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `loadData()` | 5604-5642 | ✅ `persistence.test.ts` | 🟡 | SQLite load |
| `saveData()` | 5647-5666 | ✅ `persistence.test.ts` | 🟡 | SQLite save |
| `saveToFile()` | 5967-6010 | ❌ Missing | 🟡 | Tauri dialog |
| `openFromFile()` | 6010-6070 | ❌ Missing | 🟡 | Tauri dialog + import |
| `importFromFile()` | 6070-6100 | ❌ Missing | 🟡 | JSON/MPX import |
| `clearAllData()` | 6100-6129 | ❌ Missing | 🟡 | Full reset |
| `_createSampleData()` | 5692-5758 | ❌ Missing | 🟢 | Demo data |
| `_assignSortKeysToImportedTasks()` | 5761-5895 | ❌ Missing | 🟡 | Import processing |

### 9. Trade Partner Operations (→ TradePartnerOperationService)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `getTradePartners()` | 6362-6370 | ❌ Missing | 🟢 | Simple getter |
| `createTradePartner()` | 6372-6420 | ❌ Missing | 🟢 | CRUD |
| `updateTradePartner()` | 6420-6470 | ❌ Missing | 🟢 | CRUD |
| `deleteTradePartner()` | 6470-6520 | ❌ Missing | 🟢 | CRUD |
| `assignTradePartner()` | 6520-6554 | ❌ Missing | 🟢 | Task assignment |

### 10. Zoom/View Mode (→ SchedulerFacade)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `zoomIn()` | 6140-6170 | ❌ Missing | 🟢 | View control |
| `zoomOut()` | 6170-6200 | ❌ Missing | 🟢 | View control |
| `setViewMode()` | 6200-6230 | ❌ Missing | 🟢 | Day/Week/Month |
| `setGanttZoom()` | 6230-6249 | ❌ Missing | 🟢 | Gantt-specific |

### 11. Initialization & Lifecycle (→ SchedulerFacade)

| Method | Lines | Test Coverage | Risk | Notes |
|--------|-------|---------------|------|-------|
| `init()` | ~300-500 | ⚠️ Partial | 🔴 | **CRITICAL**: Must add subscriptions |
| `_initServices()` | 229-311 | ❌ Missing | 🟡 | Persistence setup (redundant) |
| `destroy()` | 6559-6573 | ❌ Missing | 🟢 | Cleanup |

---

## Test Coverage Summary

| Category | Total Methods | Tested | Partial | Missing |
|----------|---------------|--------|---------|---------|
| Task Operations | 10 | 6 | 2 | 2 |
| Scheduling Logic | 5 | 3 | 0 | 2 |
| UI Event Handling | 10 | 0 | 0 | 10 |
| View Coordination | 6 | 0 | 0 | 6 |
| Column Management | 6 | 0 | 0 | 6 |
| Baseline Management | 4 | 0 | 0 | 4 |
| Clipboard Operations | 3 | 0 | 0 | 3 |
| File Operations | 8 | 2 | 0 | 6 |
| Trade Partner Ops | 5 | 0 | 0 | 5 |
| Zoom/View Mode | 4 | 0 | 0 | 4 |
| Initialization | 3 | 0 | 1 | 2 |
| **TOTAL** | **64** | **11 (17%)** | **3 (5%)** | **50 (78%)** |

---

## Priority Migration Order

### Phase 1: Foundation (Critical Path)
1. **ViewCoordinator** - Fix UI blocking issue
2. **SchedulingLogicService** - Extract `_applyTaskEdit()` (most tested)

### Phase 2: Core Operations
3. **TaskOperationService** - Already well-tested, straightforward
4. **UIEventCoordinator** - Event routing (needs new tests)

### Phase 3: Features
5. **ClipboardService** - Self-contained
6. **BaselineManager** - Self-contained
7. **ColumnManager** - UI only

### Phase 4: Cleanup
8. **FileOperationService** - Mostly delegates to FileService
9. **TradePartnerOperationService** - Simple CRUD
10. **SchedulerFacade** - Final thin wrapper

---

## Risk Assessment

### 🔴 High Risk Methods (Require Pre-Migration Tests)

1. **`_applyTaskEdit()`** - Complex branching, business rules
   - ✅ `DriverModeStatusing.test.ts` covers actualStart/actualFinish
   - ❌ Need tests for: `schedulingMode`, `constraintType` transitions

2. **`paste()`** - Complex ID remapping, hierarchy preservation
   - ❌ No test coverage
   - Need: Unit test with nested hierarchy paste

3. **`init()`** - Application bootstrap
   - ❌ Missing reactive subscriptions (ROOT CAUSE of UI freeze)
   - Need: Integration test verifying subscription wiring

### 🟡 Medium Risk Methods (Should Have Tests)

1. **`_updateGridDataSync()`** / **`_updateGanttDataSync()`**
   - Synchronous main-thread operations
   - Potential UI blocking if called incorrectly

2. **Navigation handlers** (`_handleArrowNavigation`, etc.)
   - Complex state management
   - Timing-sensitive

3. **Indent/Outdent**
   - Uses OrderingService
   - Edge cases with deep nesting

---

## Next Steps

1. **Create missing tests** for 🔴 High Risk methods before migration
2. **Add snapshot tests** to capture current behavior
3. **Build feature flag system** for incremental rollout
4. **Create integration test harness** for migration validation
