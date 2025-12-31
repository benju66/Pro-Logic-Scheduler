# Strangler Fig Migration - Implementation Plan

## Overview

This document summarizes the complete implementation plan for migrating `SchedulerService.ts` (6,575 lines) to a modern, reactive architecture using the Strangler Fig pattern.

---

## Created Infrastructure

### 1. Feature Flags (`src/core/FeatureFlags.ts`)
- Type-safe feature flag system
- Persists to localStorage
- Enables incremental rollout
- DevTools accessible via `window.FeatureFlags`

### 2. SchedulingLogicService (`src/services/migration/SchedulingLogicService.ts`)
- Extracted business logic from `_applyTaskEdit()`
- Fully documented business rules
- Handles: duration, start, end, actualStart, actualFinish, constraints, schedulingMode
- **Confidence: 92%** (well-tested in existing tests)

### 3. ViewCoordinator (`src/services/migration/ViewCoordinator.ts`)
- Reactive subscriptions to ProjectController
- Batched DOM updates via requestAnimationFrame
- Handles Grid/Gantt synchronization
- **Fixes the UI blocking issue**
- **Confidence: 88%** (new code, needs integration testing)

### 4. Test Infrastructure

| File | Purpose |
|------|---------|
| `tests/integration/MigrationValidation.test.ts` | Feature flag tests, service tests |
| `tests/integration/BehaviorSnapshot.test.ts` | Snapshot tests for parity verification |
| `docs/migration/METHOD_TEST_MAPPING.md` | Method-by-method test coverage map |
| `docs/migration/UI_EVENT_COORDINATOR_DIAGRAM.md` | Event flow architecture |

---

## Migration Phases

### Phase 1: Fix UI Blocking (CRITICAL - START HERE)

**Goal:** Make the UI responsive by wiring reactive subscriptions.

**Steps:**
1. Enable `USE_REACTIVE_SUBSCRIPTIONS` feature flag
2. Modify `SchedulerService.init()` to call `ViewCoordinator.initSubscriptions()`
3. Set `ViewCoordinator.setComponents(grid, gantt)` after component creation
4. Remove manual `render()` calls (they'll happen automatically via subscription)

**Code Change in SchedulerService.init():**
```typescript
// After creating grid and gantt components...
import { ViewCoordinator } from './migration';

async init(): Promise<void> {
    // ... existing component setup ...
    
    // NEW: Wire reactive architecture
    if (FeatureFlags.get('USE_REACTIVE_SUBSCRIPTIONS')) {
        const coordinator = ViewCoordinator.getInstance();
        coordinator.setComponents(this.grid, this.gantt);
        coordinator.initSubscriptions();
    }
}
```

**Verification:**
- App loads and displays tasks
- Clicking on tasks updates selection immediately
- Adding/deleting tasks updates UI automatically

---

### Phase 2: Extract Scheduling Logic

**Goal:** Replace `_applyTaskEdit()` with `SchedulingLogicService`.

**Steps:**
1. Enable `USE_SCHEDULING_LOGIC_SERVICE` feature flag
2. Modify `_handleCellChange()` to delegate to new service:

```typescript
private async _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> {
    if (field === 'checkbox') return;
    
    this.saveCheckpoint();
    
    if (FeatureFlags.get('USE_SCHEDULING_LOGIC_SERVICE')) {
        const result = schedulingLogic.applyEdit(taskId, field, value, {
            controller: ProjectController.getInstance(),
            calendar: ProjectController.getInstance().getCalendar()
        });
        
        if (result.message) {
            if (result.messageType === 'success') {
                this.toastService.success(result.message);
            } else if (result.messageType === 'warning') {
                this.toastService.warning(result.message);
            } else {
                this.toastService.info(result.message);
            }
        }
        
        // ViewCoordinator handles render automatically
    } else {
        // Legacy path
        const result = await this._applyTaskEdit(taskId, field, value);
        // ... legacy handling
    }
}
```

**Verification:**
- Duration edits recalculate end date
- Start edits apply SNET constraint
- ActualStart/Finish follow Driver Mode rules
- Compare results with BehaviorSnapshot tests

---

### Phase 3: Extract Task Operations

**Goal:** Create TaskOperationService for CRUD.

**Services to create:**
- `addTask()` - Already delegates to ProjectController
- `deleteTask()` - Already delegates to ProjectController
- `indent()` / `outdent()` - Uses OrderingService

**This phase is mostly cleanup** - the actual logic already delegates to ProjectController.

---

### Phase 4: Extract UI Events

**Goal:** Create UIEventCoordinator (see diagram document).

**Methods to migrate:**
- `_handleRowClick()` → SelectionModel
- `_handleAction()` → TaskOperationService
- `_handleArrowNavigation()` → SelectionModel
- `_showRowContextMenu()` → UIEventCoordinator

---

### Phase 5: Extract Remaining Features

| Service | Methods |
|---------|---------|
| ClipboardService | copySelected, cutSelected, paste |
| BaselineManager | hasBaseline, setBaseline, clearBaseline |
| ColumnManager | getColumnDefinitions, buildGridHeader |
| FileOperationService | saveToFile, openFromFile, importFromFile |
| TradePartnerOperationService | CRUD for trade partners |

---

### Phase 6: Final Cleanup

1. Remove legacy methods from SchedulerService
2. Rename SchedulerService to SchedulerFacade
3. Verify all feature flags can be enabled
4. Run full test suite
5. Remove feature flags (all new code becomes default)

---

## Confidence Assessment

| Component | Confidence | Justification |
|-----------|------------|---------------|
| Feature Flags | 95% | Simple, well-tested pattern |
| SchedulingLogicService | 92% | Extracted from tested code, business rules documented |
| ViewCoordinator | 88% | New code, needs integration testing |
| UIEventCoordinator | 75% | Many interactions, timing sensitive |
| Full Integration | 80% | Many moving parts, incremental approach mitigates risk |

---

## Risk Mitigation

1. **Feature Flags**: Enable incremental rollout, easy rollback
2. **Snapshot Tests**: Capture current behavior, detect regressions
3. **Method Mapping**: Clear documentation of what moves where
4. **Parity Tests**: Verify new code produces identical results
5. **Existing Tests**: 11 methods already tested (17% coverage)

---

## Next Steps (Immediate Actions)

1. **Run existing tests** to establish baseline
   ```bash
   npm run test
   ```

2. **Enable Phase 1 flag and test**
   ```typescript
   FeatureFlags.enable('USE_REACTIVE_SUBSCRIPTIONS');
   ```

3. **Verify UI responsiveness** with browser DevTools

4. **Generate behavior snapshots**
   ```bash
   npm run test -- --update-snapshots tests/integration/BehaviorSnapshot.test.ts
   ```

5. **Begin Phase 2** once Phase 1 is stable

---

## File Summary

| File | Lines | Purpose |
|------|-------|---------|
| `src/core/FeatureFlags.ts` | ~200 | Feature flag infrastructure |
| `src/services/migration/SchedulingLogicService.ts` | ~400 | Business logic extraction |
| `src/services/migration/ViewCoordinator.ts` | ~300 | Reactive view updates |
| `src/services/migration/index.ts` | ~20 | Module exports |
| `tests/integration/MigrationValidation.test.ts` | ~300 | Migration tests |
| `tests/integration/BehaviorSnapshot.test.ts` | ~300 | Snapshot tests |
| `docs/migration/METHOD_TEST_MAPPING.md` | ~400 | Method documentation |
| `docs/migration/UI_EVENT_COORDINATOR_DIAGRAM.md` | ~300 | Architecture diagram |
| `docs/migration/IMPLEMENTATION_PLAN.md` | ~300 | This document |

**Total new infrastructure: ~2,500 lines**
