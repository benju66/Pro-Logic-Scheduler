# Phase 3: SchedulerService Decomposition Audit

**Date:** January 2025  
**Current Line Count:** 2,217 lines  
**Target Line Count:** 600-800 lines  
**Status:** Ready for Phase 3 Implementation

---

## Executive Summary

`SchedulerService.ts` has been partially decomposed. Many services have already been extracted, but significant work remains to reach the target of 600-800 lines. This audit identifies what's been completed and what still needs extraction.

---

## Current State Analysis

### ✅ Already Extracted Services

| Service | Status | Location | Notes |
|---------|--------|----------|-------|
| **TaskOperationsService** | ✅ Complete | `src/services/scheduler/TaskOperationsService.ts` | Fully extracted, SchedulerService delegates |
| **ViewStateService** | ✅ Complete | `src/services/scheduler/ViewStateService.ts` | Fully extracted, handles navigation/edit mode |
| **ContextMenuService** | ✅ Complete | `src/services/scheduler/ContextMenuService.ts` | Fully extracted |
| **ModalCoordinator** | ✅ Complete | `src/services/scheduler/ModalCoordinator.ts` | Fully extracted, manages modals/drawer |
| **FileOperationsService** | ✅ Complete | `src/services/scheduler/FileOperationsService.ts` | Fully extracted |
| **BaselineService** | ✅ Complete | `src/services/scheduler/BaselineService.ts` | Fully extracted |
| **TradePartnerService** | ✅ Complete | `src/services/scheduler/TradePartnerService.ts` | Fully extracted |
| **ColumnPreferencesService** | ✅ Complete | `src/services/scheduler/ColumnPreferencesService.ts` | Fully extracted |
| **GridNavigationController** | ✅ Complete | `src/services/scheduler/GridNavigationController.ts` | Fully extracted |

**Total Services Extracted:** 9 ✅

### 📊 Current SchedulerService Structure

**Total Lines:** 2,217  
**Public Methods:** ~50  
**Private Methods:** ~40  
**Properties:** ~35

---

## What Remains in SchedulerService

### 1. Lifecycle & Initialization (~300 lines)

**Status:** ✅ Should Stay  
**Reason:** Core orchestration responsibility

| Method | Lines | Purpose |
|--------|-------|---------|
| `constructor()` | ~50 | Service initialization, DI wiring |
| `_initServices()` | ~50 | Async service initialization |
| `_initializeEngine()` | ~5 | Engine init (now no-op, can be removed) |
| `init()` | ~300 | Component setup, viewport creation, service wiring |
| `_createGridFacade()` | ~50 | Viewport facade wrapper |
| `_createGanttFacade()` | ~30 | Viewport facade wrapper |
| `destroy()` | ~15 | Cleanup |

**Recommendation:** Keep all lifecycle methods. They're the core orchestration layer.

---

### 2. Event Handlers (~400 lines)

**Status:** ✅ Should Stay (as routing layer)  
**Reason:** These are the "traffic cop" routing layer

| Method | Lines | Current Delegation |
|--------|-------|-------------------|
| `_handleRowClick()` | ~70 | Routes to SelectionModel, updates callbacks |
| `_handleRowDoubleClick()` | ~3 | Routes to ModalCoordinator |
| `_handleCellChange()` | ~30 | Routes to SchedulingLogicService |
| `_handleAction()` | ~30 | Routes to TaskOperationsService |
| `_handleBarDrag()` | ~5 | Routes to ProjectController |
| `_handleSelectionChange()` | ~30 | Routes to callbacks |
| `_handleDependenciesSave()` | ~15 | Validates, routes to ProjectController |
| `_handleCalendarSave()` | ~5 | Routes to ProjectController |
| `_handleRowMove()` | ~3 | Routes to TaskOperationsService |
| `_handleEnterLastRow()` | ~3 | Routes to TaskOperationsService |
| `_handleTradePartnerClick()` | ~3 | Routes to TradePartnerService |
| `_handleDrawerUpdate()` | ~30 | Routes to SchedulingLogicService |
| `_onEditingStateChange()` | ~50 | Handles EditingStateManager events |
| `_updateSelection()` | ~20 | Updates UI components |

**Recommendation:** Keep all event handlers. They're the routing layer that delegates to extracted services.

---

### 3. Keyboard Handlers (~50 lines)

**Status:** ✅ Should Stay  
**Reason:** KeyboardService wiring is orchestration responsibility

| Method | Lines | Current Delegation |
|--------|-------|-------------------|
| `initKeyboard()` | ~50 | Wires KeyboardService callbacks to services |

**Recommendation:** Keep. This is orchestration, not domain logic.

---

### 4. Selection Management (~100 lines)

**Status:** ⚠️ Partially Extracted  
**Reason:** Some methods delegate, some are still inline

| Method | Lines | Status |
|--------|-------|--------|
| `_handleSelectionChange()` | ~30 | ✅ Stays (routing) |
| `_updateSelection()` | ~20 | ✅ Stays (orchestration) |
| `_updateHeaderCheckboxState()` | ~3 | ✅ Delegates to ColumnPreferencesService |
| `onTaskSelect()` | ~15 | ✅ Stays (callback registration) |
| `getSelectedTask()` | ~5 | ✅ Stays (public API) |
| `onPanelOpenRequest()` | ~15 | ✅ Stays (callback registration) |
| `getSelectionInOrder()` | ~3 | ✅ Delegates to SelectionModel |

**Recommendation:** All selection methods are appropriate to keep. They're either routing or public API.

---

### 5. Data Access & Persistence (~200 lines)

**Status:** ⚠️ Mixed  
**Reason:** Some methods orchestrate, some could delegate more

| Method | Lines | Current Status | Recommendation |
|--------|-------|----------------|----------------|
| `tasks` getter/setter | ~10 | ✅ Stays (public API) | Keep |
| `calendar` getter/setter | ~5 | ✅ Stays (public API) | Keep |
| `getTask()` | ~3 | ✅ Stays (public API) | Keep |
| `loadData()` | ~40 | ⚠️ Orchestrates FileOperationsService | Keep (orchestration) |
| `saveData()` | ~15 | ⚠️ Orchestrates SnapshotService | Keep (orchestration) |
| `onShutdown()` | ~20 | ⚠️ Orchestrates cleanup | Keep (orchestration) |
| `saveCheckpoint()` | ~3 | ✅ No-op (backward compat) | Keep |
| `recalculateAll()` | ~5 | ✅ Delegates to ProjectController | Keep |
| `render()` | ~5 | ✅ Delegates to ViewCoordinator | Keep |
| `_notifyDataChange()` | ~10 | ✅ Stays (callback orchestration) | Keep |
| `onDataChange()` | ~10 | ✅ Stays (callback registration) | Keep |

**Recommendation:** All data access methods are appropriate. They're either public API or orchestration.

---

### 6. Public API Facades (~150 lines)

**Status:** ✅ Already Delegating  
**Reason:** These are thin facades - exactly what we want

| Method | Lines | Delegates To |
|--------|-------|--------------|
| `addTask()` | ~3 | TaskOperationsService |
| `deleteTask()` | ~3 | TaskOperationsService |
| `toggleCollapse()` | ~3 | TaskOperationsService |
| `indent()` | ~3 | TaskOperationsService |
| `outdent()` | ~3 | TaskOperationsService |
| `insertBlankRowAbove()` | ~3 | TaskOperationsService |
| `insertBlankRowBelow()` | ~3 | TaskOperationsService |
| `wakeUpBlankRow()` | ~3 | TaskOperationsService |
| `convertBlankToTask()` | ~3 | TaskOperationsService |
| `indentSelected()` | ~3 | TaskOperationsService |
| `outdentSelected()` | ~3 | TaskOperationsService |
| `deleteSelected()` | ~3 | TaskOperationsService |
| `moveSelectedTasks()` | ~3 | TaskOperationsService |
| `openDrawer()` | ~3 | ModalCoordinator |
| `closeDrawer()` | ~3 | ModalCoordinator |
| `openDependencies()` | ~3 | ModalCoordinator |
| `openCalendar()` | ~3 | ModalCoordinator |
| `openColumnSettings()` | ~3 | ModalCoordinator |
| `openProperties()` | ~3 | ModalCoordinator |
| `hasBaseline()` | ~3 | BaselineService |
| `setBaseline()` | ~3 | BaselineService |
| `clearBaseline()` | ~3 | BaselineService |
| `calculateVariance()` | ~3 | BaselineService |
| `getTradePartners()` | ~3 | TradePartnerService |
| `getTradePartner()` | ~3 | TradePartnerService |
| `createTradePartner()` | ~3 | TradePartnerService |
| `updateTradePartner()` | ~3 | TradePartnerService |
| `deleteTradePartner()` | ~3 | TradePartnerService |
| `assignTradePartner()` | ~3 | TradePartnerService |
| `unassignTradePartner()` | ~3 | TradePartnerService |
| `getTaskTradePartners()` | ~3 | TradePartnerService |
| `saveToFile()` | ~3 | FileOperationsService |
| `openFromFile()` | ~3 | FileOperationsService |
| `exportAsDownload()` | ~3 | FileOperationsService |
| `importFromFile()` | ~3 | FileOperationsService |
| `importFromMSProjectXML()` | ~3 | FileOperationsService |
| `importFromMSProjectXMLContent()` | ~3 | FileOperationsService |
| `exportToMSProjectXML()` | ~3 | FileOperationsService |
| `clearAllData()` | ~3 | FileOperationsService |
| `setViewMode()` | ~3 | ViewStateService |
| `getHighlightDependenciesOnHover()` | ~3 | ViewStateService |
| `setHighlightDependenciesOnHover()` | ~3 | ViewStateService |
| `toggleDrivingPathMode()` | ~3 | ViewStateService |
| `enterEditMode()` | ~3 | ViewStateService |
| `exitEditMode()` | ~3 | ViewStateService |
| `getColumnDefinitions()` | ~3 | ColumnPreferencesService |
| `updateColumnPreferences()` | ~3 | ColumnPreferencesService |
| `getColumnDefinitionsForSettings()` | ~3 | ColumnRegistry |
| `getColumnPreferencesForSettings()` | ~3 | ColumnPreferencesService |
| `saveColumnPreferencesFromSettings()` | ~3 | ColumnPreferencesService |

**Recommendation:** ✅ Perfect! These are exactly the thin facades we want. Keep all.

---

### 7. Dependency Validation (~150 lines)

**Status:** ⚠️ Could Extract  
**Reason:** Self-contained logic, but used by event handlers

| Method | Lines | Purpose |
|--------|-------|---------|
| `_getAllPredecessors()` | ~25 | BFS traversal for dependency graph |
| `_wouldCreateCycle()` | ~5 | Cycle detection |
| `_validateDependencies()` | ~50 | Full dependency validation |
| `updateDependencies()` | ~3 | Public API (delegates to _handleDependenciesSave) |

**Recommendation:** ⚠️ **Consider extracting to DependencyValidationService** (~80 lines). This is pure business logic that could be reused elsewhere.

---

### 8. Utility Methods (~100 lines)

**Status:** ⚠️ Mixed  
**Reason:** Some are orchestration, some are utilities

| Method | Lines | Purpose | Recommendation |
|--------|-------|---------|----------------|
| `getStats()` | ~15 | Performance stats | ✅ Keep (public API) |
| `getZoomController()` | ~3 | Get zoom controller | ✅ Keep (public API) |
| `isParent()` | ~3 | Delegates to ProjectController | ✅ Keep (public API) |
| `getDepth()` | ~3 | Delegates to ProjectController | ✅ Keep (public API) |
| `generateMockTasks()` | ~60 | Test utility | ⚠️ Could extract to TestUtils |
| `setSchedulingMode()` | ~25 | Scheduling mode change | ✅ Keep (orchestrates SchedulingLogicService) |
| `toggleSchedulingMode()` | ~5 | Toggle scheduling mode | ✅ Keep (public API) |
| `linkSelectedInOrder()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `insertTaskAbove()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `insertTaskBelow()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `addChildTask()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `copySelected()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `cutSelected()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `paste()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `undo()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `redo()` | ~3 | Delegates to CommandService | ✅ Keep (public API) |
| `handleTaskUpdate()` | ~3 | Routes to _handleDrawerUpdate | ✅ Keep (public API) |

**Recommendation:** 
- ✅ Keep most utility methods (they're public API or orchestration)
- ⚠️ Consider extracting `generateMockTasks()` to a test utility (not core functionality)

---

### 9. Column Management (~50 lines)

**Status:** ✅ Already Delegating  
**Reason:** All methods delegate to ColumnPreferencesService

| Method | Lines | Delegates To |
|--------|-------|--------------|
| `_getColumnDefinitions()` | ~3 | ColumnPreferencesService |
| `_getColumnPreferences()` | ~3 | ColumnPreferencesService |
| `_buildGridHeader()` | ~3 | ColumnPreferencesService |
| `_initializeColumnCSSVariables()` | ~3 | ColumnPreferencesService |
| `_rebuildGridColumns()` | ~3 | ColumnPreferencesService |

**Recommendation:** ✅ Perfect! All delegate correctly.

---

## Gap Analysis: What Still Needs Extraction

### 🔴 High Priority Extractions

#### 1. Dependency Validation Service (~80 lines)

**Current Location:** Lines 1463-1551 in SchedulerService.ts  
**Extract To:** `src/services/scheduler/DependencyValidationService.ts`

**Methods to Extract:**
- `_getAllPredecessors()` - BFS traversal
- `_wouldCreateCycle()` - Cycle detection  
- `_validateDependencies()` - Full validation logic

**Dependencies:**
```typescript
interface DependencyValidationServiceDeps {
    projectController: ProjectController;
}
```

**Benefits:**
- Reusable validation logic
- Testable in isolation
- Cleaner event handlers

**Estimated Effort:** 1-2 hours

---

#### 2. Test Utilities Extraction (~60 lines)

**Current Location:** Lines 2057-2116 in SchedulerService.ts  
**Extract To:** `src/utils/TestDataGenerator.ts` (or similar)

**Methods to Extract:**
- `generateMockTasks()` - Test data generation

**Benefits:**
- Removes test code from production service
- Reusable across test files

**Estimated Effort:** 30 minutes

---

### 🟡 Medium Priority Cleanup

#### 3. Dead Code Removal (~20 lines)

**Candidates:**
- `_initializeEngine()` - Now a no-op (lines 309-313)
- Unused imports
- Commented-out code

**Estimated Effort:** 30 minutes

---

## Phase 3 Implementation Plan

### Phase 3.1: Extract DependencyValidationService (1-2 hours)

**Steps:**
1. Create `src/services/scheduler/DependencyValidationService.ts`
2. Extract `_getAllPredecessors()`, `_wouldCreateCycle()`, `_validateDependencies()`
3. Update `_handleDependenciesSave()` to use new service
4. Add to `src/services/scheduler/index.ts` barrel export
5. Update SchedulerService to inject and use service

**Verification:**
- Build succeeds
- Tests pass
- Manual test: Create/edit dependencies, verify validation

**Expected Reduction:** ~80 lines

---

### Phase 3.2: Extract Test Utilities (30 min)

**Steps:**
1. Create `src/utils/TestDataGenerator.ts`
2. Extract `generateMockTasks()` method
3. Update SchedulerService to import from utils
4. Update any tests that use this method

**Verification:**
- Build succeeds
- Tests pass

**Expected Reduction:** ~60 lines

---

### Phase 3.3: Dead Code Cleanup (30 min)

**Steps:**
1. Remove `_initializeEngine()` method (no-op)
2. Remove unused imports
3. Remove commented-out code
4. Clean up TODO comments (or convert to issues)

**Verification:**
- Build succeeds
- No functionality changes

**Expected Reduction:** ~20 lines

---

### Phase 3.4: Final Verification & Documentation (1 hour)

**Steps:**
1. Run full test suite
2. Manual smoke tests
3. Update documentation
4. Measure final line count
5. Create summary report

**Verification Checklist:**
- [ ] Build succeeds: `npm run build`
- [ ] All unit tests pass: `npm run test:unit`
- [ ] All integration tests pass: `npm run test:integration`
- [ ] SchedulerService ≤ 800 lines
- [ ] No circular dependencies
- [ ] Manual test: All core features work

---

## Expected Results

### Before Phase 3:
- **Current Lines:** 2,217
- **Services Extracted:** 9 ✅
- **Remaining Work:** Dependency validation, test utilities, cleanup

### After Phase 3:
- **Target Lines:** ~2,050-2,100 (after extractions)
- **Services Extracted:** 11 ✅ (+ DependencyValidationService, TestDataGenerator)
- **Status:** Ready for final optimization pass

### Final Target (Future Phase 4):
- **Target Lines:** 600-800
- **Strategy:** Further refactoring of lifecycle methods, event handlers consolidation

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking dependency validation | Low | Medium | Comprehensive tests, manual verification |
| Test utility extraction breaks tests | Low | Low | Update test imports |
| Dead code removal breaks something | Very Low | Low | Careful review, test after each removal |

**Overall Risk:** ✅ **LOW** - Most extractions are straightforward, well-isolated code.

---

## Dependencies & Prerequisites

- ✅ All Phase 2 services already extracted
- ✅ Tests passing
- ✅ Build succeeds
- ✅ No blocking issues

**Ready to Proceed:** ✅ **YES**

---

## Next Steps

1. **Review this audit** with team/stakeholders
2. **Approve Phase 3 plan** or request modifications
3. **Begin Phase 3.1** (DependencyValidationService extraction)
4. **Iterate through phases** 3.1 → 3.2 → 3.3 → 3.4
5. **Document results** and plan Phase 4 (if needed)

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Status:** Ready for Review
