# SchedulerService Complete Decomposition Plan

**Created:** January 8, 2026  
**Updated:** January 8, 2026 (Post-Review v1.1)  
**Status:** Ready for Implementation  
**Current Line Count:** 4,007 lines  
**Target Line Count:** 600-800 lines  
**Estimated Effort:** 10-14 hours  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Confidence Analysis](#2-confidence-analysis)
3. [Extraction Strategy](#3-extraction-strategy)
4. [Service Catalog](#4-service-catalog)
5. [Phase 0: Setup](#phase-0-setup-30-min)
6. [Phase 1: Finalize ViewCoordinator](#phase-1-finalize-viewcoordinator-1-hour)
7. [Phase 2: TaskOperationsService](#phase-2-taskoperationsservice-3-4-hours)
8. [Phase 3: ViewStateService](#phase-3-viewstateservice-2-hours)
9. [Phase 4: ContextMenuService](#phase-4-contextmenuservice-1-hour)
10. [Phase 5: ModalCoordinator](#phase-5-modalcoordinator-15-hours)
11. [Phase 6: FileOperationsService](#phase-6-fileoperationsservice-15-hours)
12. [Phase 7: BaselineService](#phase-7-baselineservice-1-hour)
13. [Phase 8: TradePartnerService](#phase-8-tradepartnerservice-1-hour)
14. [Phase 9: ColumnPreferencesService](#phase-9-columnpreferencesservice-2-hours)
15. [Phase 10: Final Cleanup](#phase-10-final-cleanup-2-hours)
16. [What Stays in SchedulerService](#16-what-stays-in-schedulerservice)
17. [Verification Protocol](#17-verification-protocol)
18. [Risk Mitigation](#18-risk-mitigation)

> **REVIEWER NOTE (v1.1):** Phase order updated per external review.
> - ViewCoordinator finalization promoted to Phase 1 (stabilizes reactive data flow first)
> - RenderCoordinator (Phase 9) **eliminated** - use existing `ViewCoordinator.ts`
> - CallbackRegistry (Phase 10) **eliminated** - use existing ViewCoordinator callbacks
> - ViewStateService should inject ViewCoordinator for triggering updates

---

## 1. Executive Summary

`SchedulerService.ts` is a 4,007-line "God Class" that violates the Single Responsibility Principle. This plan fully decomposes it into **8 new services** plus leverages the **existing ViewCoordinator**, leaving a thin "Traffic Cop" orchestrator of ~600-800 lines.

### Current State

| Metric | Value |
|--------|-------|
| Total Lines | 4,007 |
| Public Methods | 45 |
| Private Methods | 57 |
| Properties | 35+ |
| Direct Dependencies | 310+ internal references |
| External Consumers | UIEventManager, main.ts, AppInitializer |

### Target State

| Metric | Value |
|--------|-------|
| SchedulerService Lines | 600-800 |
| New Services | 8 (+ ViewCoordinator already exists) |
| Public API Methods | 25-30 (thin facades) |
| Responsibility | Lifecycle, wiring, routing only |

---

## 2. Confidence Analysis

### High Confidence Areas (90%+)

| Area | Confidence | Reasoning |
|------|------------|-----------|
| TaskOperationsService extraction | 95% | Methods are self-contained, clear boundaries |
| FileOperationsService extraction | 95% | Already delegates to FileService |
| TradePartnerService extraction | 95% | Isolated data operations |
| BaselineService extraction | 90% | Clear responsibility, few dependencies |
| ContextMenuService extraction | 90% | Self-contained menu logic |

### Medium Confidence Areas (75-90%)

| Area | Confidence | Reasoning | Mitigation |
|------|------------|-----------|------------|
| ViewStateService extraction | 85% → **90%** | Navigation methods reference multiple services | Inject ViewCoordinator for render calls |
| ColumnPreferencesService extraction | 80% | DOM manipulation, CSS variables | Careful DOM reference handling |
| ModalCoordinator extraction | 80% | Modal instances created in init() | Move modal creation to new service |

> **CONFIDENCE BOOST:** ViewStateService confidence increased to 90% because ViewCoordinator 
> already handles reactive rendering. ViewStateService simply calls `viewCoordinator.forceRender()`.

### Lower Confidence Areas (60-75%)

| Area | Confidence | Initial Concern | Resolution Strategy |
|------|------------|-----------------|---------------------|
| Event handlers | 70% | Complex interactions between handlers | **KEEP IN SCHEDULERSERVICE** - they are the routing layer |
| KeyboardService integration | 75% | Created with many callbacks | Keep initKeyboard() in SchedulerService, wire to extracted services |
| Circular dependencies | 70% | Services may need SchedulerService methods | **Use callback injection pattern** - pass functions, not service references |

### Resolution for Lower Confidence Areas

#### Event Handlers - KEEP IN SCHEDULERSERVICE

The following event handlers will **remain in SchedulerService** as they are the "routing layer" that delegates to extracted services:

```
_handleRowClick()        → Stays (routes to SelectionModel, updates callbacks)
_handleRowDoubleClick()  → Stays (routes to ModalCoordinator.openDrawer)
_handleCellChange()      → Stays (routes to SchedulingLogicService.applyEdit)
_handleAction()          → Stays (routes to TaskOperationsService)
_handleBarDrag()         → Stays (routes to ProjectController.updateTask)
_handleSelectionChange() → Stays (routes to CallbackRegistry)
_handleRowMove()         → EXTRACT to TaskOperationsService (self-contained)
_handleEnterLastRow()    → EXTRACT to TaskOperationsService (self-contained)
```

#### Callback Injection Pattern

Instead of services referencing SchedulerService, pass callback functions:

```typescript
// WRONG - Creates circular dependency
class TaskOperationsService {
    constructor(private scheduler: SchedulerService) {}
    
    addTask() {
        // ...
        this.scheduler.render(); // Circular!
    }
}

// CORRECT - Callback injection
class TaskOperationsService {
    constructor(deps: {
        projectController: ProjectController;
        selectionModel: SelectionModel;
        getGrid: () => VirtualScrollGridFacade | null;
        onTaskAdded?: () => void; // Callback instead of reference
    }) {}
    
    addTask() {
        // ...
        this.deps.onTaskAdded?.(); // No circular dependency
    }
}
```

---

## 3. Extraction Strategy

### Guiding Principles

1. **Extract least-coupled first** - Start with services that have minimal dependencies
2. **One service per phase** - Complete and verify before moving to next
3. **Callback injection** - Avoid circular dependencies via callback pattern
4. **Keep routing in SchedulerService** - Event handlers stay as thin routing layer
5. **Preserve public API** - SchedulerService methods become thin facades

### Dependency Graph (Services to Extract)

```
Level 0 (Already Exists - Finalize First):
└── ViewCoordinator (src/services/migration/ViewCoordinator.ts)
    ├── Handles reactive rendering via RxJS
    ├── Manages data/selection callbacks
    └── Batches DOM updates

Level 1 (No dependencies on other NEW services):
├── BaselineService
├── TradePartnerService
├── FileOperationsService
└── TaskOperationsService (largest extraction, relies on ViewCoordinator reactivity)

Level 2 (May depend on Level 1):
├── ViewStateService (injects ViewCoordinator for triggering renders)
├── ContextMenuService (uses TaskOperationsService)
├── ColumnPreferencesService (relies on ViewCoordinator reactivity)
└── ModalCoordinator
```

> **KEY INSIGHT:** By finalizing ViewCoordinator first, other services don't need 
> `render()` callbacks - they rely on reactive updates triggered by ProjectController changes.

### Extraction Order (Risk-Minimized)

| Order | Phase | Service | Risk Level | Reason |
|-------|-------|---------|------------|--------|
| 1 | 1 | ViewCoordinator (finalize) | Low | Already exists, stabilizes reactive flow |
| 2 | 2 | TaskOperationsService | Low-Medium | Largest, but well-contained |
| 3 | 3 | ViewStateService | Low | View state is isolated |
| 4 | 4 | ContextMenuService | Low | Self-contained UI |
| 5 | 5 | ModalCoordinator | Low | Isolated modal logic |
| 6 | 6 | FileOperationsService | Low | Already delegates to FileService |
| 7 | 7 | BaselineService | Low | Isolated data operations |
| 8 | 8 | TradePartnerService | Low | Isolated CRUD |
| 9 | 9 | ColumnPreferencesService | Medium | DOM manipulation |

> **KEY CHANGE:** ViewCoordinator finalization moved to Phase 1. 
> RenderCoordinator and CallbackRegistry eliminated (use existing ViewCoordinator).

---

## 4. Service Catalog

### Summary Table

| Service | Lines | Methods | Primary Responsibility | Status |
|---------|-------|---------|------------------------|--------|
| **ViewCoordinator** | 470 | 15 | Reactive rendering, data flow | ✅ EXISTS (finalize) |
| TaskOperationsService | ~550 | 17 | Task CRUD, hierarchy, movement | 🔨 CREATE |
| ViewStateService | ~200 | 12 | Navigation, edit mode, view settings | 🔨 CREATE |
| ContextMenuService | ~180 | 3 | Right-click menu | 🔨 CREATE |
| ModalCoordinator | ~150 | 8 | Modals and drawer management | 🔨 CREATE |
| FileOperationsService | ~220 | 9 | File open/save/import/export | 🔨 CREATE |
| BaselineService | ~130 | 6 | Baseline set/clear/variance | 🔨 CREATE |
| TradePartnerService | ~170 | 9 | Trade partner CRUD | 🔨 CREATE |
| ColumnPreferencesService | ~320 | 12 | Header, preferences, CSS | 🔨 CREATE ⚠️ Legacy |

> **NOTE:** `RenderCoordinator` and `CallbackRegistry` eliminated - functionality already exists in `ViewCoordinator.ts`

**Total to Extract:** ~1,920 lines  
**Remaining in SchedulerService:** ~2,100 lines → reduced to ~700 after removing extracted code and dead code cleanup

---

## Phase 0: Setup (30 min)

### 0.1 Create Directory Structure

```
src/services/scheduler/
├── TaskOperationsService.ts
├── ViewStateService.ts
├── ContextMenuService.ts
├── ModalCoordinator.ts
├── FileOperationsService.ts
├── BaselineService.ts
├── TradePartnerService.ts
├── ColumnPreferencesService.ts
├── RenderCoordinator.ts
├── CallbackRegistry.ts
├── types.ts                    # Shared types for extracted services
└── index.ts                    # Barrel export
```

### 0.2 Create Shared Types

```typescript
// src/services/scheduler/types.ts

import type { Task, Calendar, TradePartner, GridColumn, ColumnPreferences } from '../../types';

/**
 * Common callback types used across scheduler services
 */
export interface SchedulerCallbacks {
    onTaskAdded?: () => void;
    onTaskDeleted?: () => void;
    onRender?: () => void;
    onToast?: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

/**
 * Grid facade interface for services that need grid access
 */
export interface GridAccessor {
    scrollToTask: (id: string) => void;
    highlightCell: (id: string, field: string) => void;
    focusCell: (id: string, field: string) => void;
    setSelection: (ids: Set<string>, focusedId?: string | null, options?: { focusCell?: boolean; focusField?: string }) => void;
}

/**
 * Gantt facade interface for services that need gantt access
 */
export interface GanttAccessor {
    setSelection: (ids: Set<string>) => void;
    setViewMode: (mode: string) => void;
}
```

### 0.3 Verification Baseline

Run before any changes:

```powershell
npm run build
npx vitest run tests/unit --reporter=verbose
(Get-Content src/services/SchedulerService.ts | Measure-Object -Line).Lines  # Record: 4007
```

---

## Phase 1: Finalize ViewCoordinator (1 hour)

> **CRITICAL:** This phase must be completed first. It establishes the reactive data flow 
> that other services will rely on, eliminating the need to pass `render()` callbacks.

### 1.1 Service Location

**Existing file:** `src/services/migration/ViewCoordinator.ts` (470 lines)

### 1.2 What Already Exists

`ViewCoordinator` already implements:

| Feature | Status | Notes |
|---------|--------|-------|
| Reactive subscriptions | ✅ Complete | `tasks$`, `calendar$`, `selection$`, `stats$` |
| Batched DOM updates | ✅ Complete | `requestAnimationFrame` based |
| Grid/Gantt data updates | ✅ Complete | `_updateGridData()`, `_updateGanttData()` |
| Callback registration | ✅ Complete | `onSelectionChange()`, `onDataChange()` |
| Component references | ✅ Complete | `setComponents()` |
| Pure DI constructor | ✅ Complete | Accepts injected deps, falls back to singletons |

### 1.3 What Needs to Be Added

| Method | From SchedulerService | Purpose |
|--------|----------------------|---------|
| `assignVisualRowNumbers()` | `_assignVisualRowNumbers()` (lines 3315-3346) | Assign row numbers for display |

### 1.4 Implementation Steps

1. **Move `_assignVisualRowNumbers()` to ViewCoordinator:**

```typescript
// Add to ViewCoordinator.ts

/**
 * Assign visual row numbers based on visible hierarchy
 * Called before rendering to ensure row numbers are up-to-date
 */
public assignVisualRowNumbers(): void {
    if (!this.projectController) return;
    
    const controller = this.projectController;
    const tasks = controller.getTasks();
    
    // Get visible tasks respecting collapse state
    const visibleTasks = controller.getVisibleTasks(id => {
        const task = controller.getTaskById(id);
        return task?._collapsed || false;
    });
    
    // Assign sequential row numbers
    visibleTasks.forEach((task, index) => {
        task._visualRowNumber = index + 1;
    });
}
```

2. **Call from `_updateGridData()`:**

```typescript
private _updateGridData(tasks: Task[]): void {
    if (!this.grid || !this.projectController) return;
    
    // Assign visual row numbers before building grid data
    this.assignVisualRowNumbers();
    
    const controller = this.projectController;
    // ... rest of existing logic
}
```

3. **Update SchedulerService to use ViewCoordinator:**

```typescript
// In SchedulerService constructor or init():
this.viewCoordinator = new ViewCoordinator({
    projectController: this.projectController,
    selectionModel: this.selectionModel
});

// Replace render() calls:
// OLD: this.render();
// NEW: this.viewCoordinator.forceUpdate();
```

4. **Wire ViewCoordinator in main.ts:**

```typescript
// In Composition Root
const viewCoordinator = new ViewCoordinator({
    projectController,
    selectionModel
});
ViewCoordinator.setInstance(viewCoordinator);
```

### 1.5 Methods to Remove from SchedulerService

After ViewCoordinator is finalized, remove these from SchedulerService:

| Method | Lines | Replacement |
|--------|-------|-------------|
| `render()` | 3383-3413 | `viewCoordinator.forceUpdate()` |
| `_assignVisualRowNumbers()` | 3315-3346 | `viewCoordinator.assignVisualRowNumbers()` |
| `_updateGridDataSync()` | 3354-3362 | Handled by ViewCoordinator reactively |
| `_updateGanttDataSync()` | 3370-3378 | Handled by ViewCoordinator reactively |

**Lines removed:** ~87

### 1.6 Verification

```powershell
npm run build
npx vitest run tests/unit
```

Manual tests:
- [ ] Grid renders correctly after data load
- [ ] Gantt renders correctly after data load
- [ ] Row numbers update after add/delete/move
- [ ] Selection updates are instant (no flicker)
- [ ] Edits trigger reactive re-render

### 1.7 Impact on Other Phases

After ViewCoordinator finalization:

| Service | Before | After |
|---------|--------|-------|
| TaskOperationsService | Needs `render()` callback | Relies on reactive updates |
| ViewStateService | Needs `render()` callback | Injects `ViewCoordinator.forceRender()` |
| ColumnPreferencesService | Needs `render()` callback | Relies on reactive updates |
| ModalCoordinator | No change | No change |
| FileOperationsService | No change | No change |

---

## Phase 2: TaskOperationsService (3-4 hours)

### 1.1 Service Responsibility

Handles all task-level CRUD, hierarchy operations, and movement.

### 1.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `addTask()` | 68 | 2106-2173 |
| `deleteTask()` | 24 | 2178-2201 |
| `indent()` | 45 | 2224-2268 |
| `outdent()` | 32 | 2273-2303 |
| `indentSelected()` | 58 | 2549-2606 |
| `outdentSelected()` | 48 | 2612-2659 |
| `deleteSelected()` | 48 | 2665-2712 |
| `moveSelectedTasks()` | 18 | 2912-2929 |
| `insertBlankRowAbove()` | 29 | 2409-2437 |
| `insertBlankRowBelow()` | 29 | 2442-2470 |
| `wakeUpBlankRow()` | 26 | 2476-2501 |
| `convertBlankToTask()` | 23 | 2506-2528 |
| `toggleCollapse()` | 4 | 2216-2219 |
| `_handleRowMove()` | 184 | 1634-1816 |
| `_handleEnterLastRow()` | 26 | 1454-1479 |
| `_getAllDescendants()` | 13 | 2741-2752 |
| `_confirmAction()` | 7 | 2718-2724 |

**Total: ~550 lines**

### 1.3 Dependencies Required

```typescript
interface TaskOperationsServiceDeps {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    editingStateManager: EditingStateManager;
    commandService: CommandService;
    toastService: ToastService;
    getGrid: () => GridAccessor | null;
    getGantt: () => GanttAccessor | null;
    saveCheckpoint: () => void;
    enterEditMode: () => void;
}
```

### 1.4 Interface Definition

```typescript
// src/services/scheduler/TaskOperationsService.ts

import { OperationQueue } from '../../core/OperationQueue';
import { OrderingService } from '../OrderingService';
import { DateUtils } from '../../core/DateUtils';
import type { Task } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ToastService } from '../../ui/services/ToastService';
import type { GridAccessor, GanttAccessor } from './types';

export interface TaskOperationsServiceDeps {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    editingStateManager: EditingStateManager;
    commandService: CommandService;
    toastService: ToastService;
    getGrid: () => GridAccessor | null;
    getGantt: () => GanttAccessor | null;
    saveCheckpoint: () => void;
    enterEditMode: () => void;
    isInitialized: () => boolean;
    // Cross-service callbacks (avoids circular deps)
    updateHeaderCheckboxState: () => void;  // Called after addTask/deleteTask
}

export class TaskOperationsService {
    private deps: TaskOperationsServiceDeps;
    private operationQueue: OperationQueue;

    constructor(deps: TaskOperationsServiceDeps) {
        this.deps = deps;
        this.operationQueue = new OperationQueue();
    }

    // === CRUD Operations ===
    async addTask(taskData?: Partial<Task>): Promise<Task | undefined> { /* ... */ }
    deleteTask(taskId: string): void { /* ... */ }
    async deleteSelected(): Promise<void> { /* ... */ }

    // === Hierarchy Operations ===
    indent(taskId: string): void { /* ... */ }
    outdent(taskId: string): void { /* ... */ }
    indentSelected(): void { /* ... */ }
    outdentSelected(): void { /* ... */ }
    
    // === Movement Operations ===
    moveSelectedTasks(direction: number): void { /* ... */ }
    handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void { /* ... */ }
    
    // === Blank Row Operations ===
    insertBlankRowAbove(taskId: string): void { /* ... */ }
    insertBlankRowBelow(taskId: string): void { /* ... */ }
    wakeUpBlankRow(taskId: string): void { /* ... */ }
    convertBlankToTask(taskId: string): void { /* ... */ }
    
    // === Collapse Operations ===
    toggleCollapse(taskId: string): void { /* ... */ }

    // === Insert Operations (delegate to CommandService) ===
    insertTaskAbove(): void {
        this.deps.commandService.execute('task.insertAbove');
    }
    
    insertTaskBelow(): void {
        this.deps.commandService.execute('task.insertBelow');
    }
    
    addChildTask(): void {
        this.deps.commandService.execute('task.addChild');
    }

    // === Helper Methods ===
    handleEnterLastRow(lastTaskId: string, field: string): void { /* ... */ }
    getAllDescendants(taskId: string): Set<string> { /* ... */ }
}
```

### 2.5 Implementation Steps

1. Create `src/services/scheduler/TaskOperationsService.ts` with interface
2. Copy `addTask()` method body, adapt references:
   - `this.projectController` → `this.deps.projectController`
   - `this.selectionModel` → `this.deps.selectionModel`
   - `this.grid` → `this.deps.getGrid()`
   - `this.saveCheckpoint()` → `this.deps.saveCheckpoint()`
3. Copy remaining methods one by one, adapting references
4. Add service to SchedulerService constructor:
   ```typescript
   this.taskOperations = new TaskOperationsService({
       projectController: this.projectController,
       selectionModel: this.selectionModel,
       editingStateManager: this.editingStateManager,
       commandService: this.commandService,
       toastService: this.toastService,
       getGrid: () => this.grid,
       getGantt: () => this.gantt,
       saveCheckpoint: () => this.saveCheckpoint(),
       enterEditMode: () => this.enterEditMode(),
       isInitialized: () => this.isInitialized,
   });
   ```
5. Replace SchedulerService method bodies with delegations:
   ```typescript
   addTask(taskData?: Partial<Task>): Promise<Task | undefined> {
       return this.taskOperations.addTask(taskData);
   }
   ```
6. Update event handler callbacks to use new service:
   ```typescript
   // In init() options:
   onRowMove: (taskIds, targetId, position) => this.taskOperations.handleRowMove(taskIds, targetId, position),
   onEnterLastRow: (lastTaskId, field) => this.taskOperations.handleEnterLastRow(lastTaskId, field),
   ```

### 1.6 Verification

```powershell
npm run build                           # TypeScript compiles
npx vitest run tests/unit               # All tests pass
```

Manual tests:
- [ ] Add task (Insert key)
- [ ] Delete task (Delete key)
- [ ] Indent (Tab)
- [ ] Outdent (Shift+Tab)
- [ ] Multi-select indent/outdent
- [ ] Drag and drop task
- [ ] Insert blank row above/below
- [ ] Convert blank row to task

---

## Phase 3: ViewStateService (2 hours)

### 3.1 Service Responsibility

Manages view state, navigation, and edit mode.

### 3.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `viewMode` property | 3 | 176 |
| `displaySettings` property | 5 | 179-182 |
| `setViewMode()` | 9 | 3919-3927 |
| `toggleDrivingPathMode()` | 5 | 746-750 |
| `_updateGanttDrivingPathMode()` | 10 | 756-763 |
| `getHighlightDependenciesOnHover()` | 3 | 731-733 |
| `setHighlightDependenciesOnHover()` | 3 | 739-741 |
| `_handleCellNavigation()` | 86 | 1849-1934 |
| `_handleArrowCollapse()` | 13 | 1941-1953 |
| `_handleTabIndent()` | 4 | 1961-1964 |
| `_handleTabOutdent()` | 4 | 1970-1973 |
| `_handleEscape()` | 12 | 1979-1990 |
| `enterEditMode()` | 20 | 2989-3007 |
| `exitEditMode()` | 6 | 3013-3018 |

**Total: ~180 lines**

### 3.3 Interface Definition

```typescript
// src/services/scheduler/ViewStateService.ts

import type { ViewMode, GridColumn } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ViewCoordinator } from '../migration/ViewCoordinator';
import type { GridAccessor, GanttAccessor } from './types';
import { getTaskFieldValue } from '../../types';

export interface ViewStateServiceDeps {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    editingStateManager: EditingStateManager;
    commandService: CommandService;
    viewCoordinator: ViewCoordinator;  // Use for triggering updates
    getGrid: () => GridAccessor | null;
    getGantt: () => GanttAccessor | null;
    getColumnDefinitions: () => GridColumn[];
    closeDrawer: () => void;
}

export class ViewStateService {
    private deps: ViewStateServiceDeps;
    
    public viewMode: ViewMode = 'Week';
    public displaySettings = {
        highlightDependenciesOnHover: true,
        drivingPathMode: false
    };

    constructor(deps: ViewStateServiceDeps) {
        this.deps = deps;
    }

    // === View Mode ===
    setViewMode(mode: ViewMode): void {
        this.viewMode = mode;
        // ViewCoordinator handles reactive re-render
        this.deps.viewCoordinator.forceRender();
    }
    
    // === Display Settings ===
    toggleDrivingPathMode(): void { /* ... */ }
    getHighlightDependenciesOnHover(): boolean { /* ... */ }
    setHighlightDependenciesOnHover(enabled: boolean): void { /* ... */ }
    
    // === Navigation ===
    handleCellNavigation(direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean): void { /* ... */ }
    handleArrowCollapse(key: 'ArrowLeft' | 'ArrowRight'): void { /* ... */ }
    handleTabIndent(): void { /* ... */ }
    handleTabOutdent(): void { /* ... */ }
    handleEscape(): void { /* ... */ }
    
    // === Edit Mode ===
    enterEditMode(): void { /* ... */ }
    exitEditMode(): void { /* ... */ }
}
```

> **KEY CHANGE:** `render: () => void` callback replaced with `viewCoordinator: ViewCoordinator`.
> ViewStateService now calls `viewCoordinator.forceRender()` when view state changes.

### 3.4 Verification

```powershell
npm run build
npx vitest run tests/unit
```

Manual tests:
- [ ] Arrow key navigation (up/down/left/right)
- [ ] Shift+Arrow for range selection
- [ ] Tab/Shift+Tab indent
- [ ] Ctrl+Arrow collapse/expand
- [ ] F2 to edit
- [ ] Escape to exit edit
- [ ] View mode switching

---

## Phase 4: ContextMenuService (1 hour)

### 4.1 Service Responsibility

Manages right-click context menu display and actions.

### 4.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `_contextMenu` property | 3 | 2309 |
| `_getContextMenu()` | 6 | 2315-2320 |
| `_showRowContextMenu()` | 79 | 2326-2404 |

**Total: ~88 lines**

### 4.3 Interface Definition

```typescript
// src/services/scheduler/ContextMenuService.ts

import { ContextMenu, type ContextMenuItem } from '../../ui/components/ContextMenu';
import type { TaskOperationsService } from './TaskOperationsService';

export interface ContextMenuServiceDeps {
    taskOperations: TaskOperationsService;
    deleteTask: (taskId: string) => void;
    openProperties: (taskId: string) => void;
}

export class ContextMenuService {
    private deps: ContextMenuServiceDeps;
    private contextMenu: ContextMenu | null = null;

    constructor(deps: ContextMenuServiceDeps) {
        this.deps = deps;
    }

    private getContextMenu(): ContextMenu {
        if (!this.contextMenu) {
            this.contextMenu = new ContextMenu();
        }
        return this.contextMenu;
    }

    showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, event: MouseEvent): void {
        /* ... builds menu items and handles actions ... */
    }
}
```

---

## Phase 5: ModalCoordinator (1.5 hours)

### 5.1 Service Responsibility

Manages modal dialogs and drawer/panel opening.

### 5.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| Modal instance management | 30 | (from init()) |
| `openDrawer()` | 18 | 3162-3178 |
| `closeDrawer()` | 5 | 3183-3187 |
| `openDependencies()` | 25 | 3193-3219 |
| `openCalendar()` | 4 | 3224-3227 |
| `openColumnSettings()` | 4 | 3232-3235 |
| `openProperties()` | 15 | 2533-2546 |

**Total: ~100 lines**

### 5.3 Interface Definition

```typescript
// src/services/scheduler/ModalCoordinator.ts

import type { Task, Calendar, Dependency, ColumnPreferences, GridColumn } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import { DependenciesModal } from '../../ui/components/DependenciesModal';
import { CalendarModal } from '../../ui/components/CalendarModal';
import { ColumnSettingsModal } from '../../ui/components/ColumnSettingsModal';
import { SideDrawer } from '../../ui/components/SideDrawer';

export interface ModalCoordinatorDeps {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    columnRegistry: ColumnRegistry;
    openPanelCallbacks: Array<(panelId: string) => void>;
    onDependenciesSave: (taskId: string, deps: Dependency[]) => void;
    onCalendarSave: (calendar: Calendar) => void;
    onColumnPreferencesSave: (prefs: ColumnPreferences) => void;
    getColumnPreferences: () => ColumnPreferences;
    updateSelection: () => void;
}

export class ModalCoordinator {
    private deps: ModalCoordinatorDeps;
    private dependenciesModal: DependenciesModal | null = null;
    private calendarModal: CalendarModal | null = null;
    private columnSettingsModal: ColumnSettingsModal | null = null;
    private drawer: SideDrawer | null = null;

    constructor(deps: ModalCoordinatorDeps) {
        this.deps = deps;
    }

    initialize(container: HTMLElement): void {
        /* Creates modal instances */
    }

    openDrawer(taskId: string): void { /* ... */ }
    closeDrawer(): void { /* ... */ }
    openDependencies(taskId: string): void { /* ... */ }
    openCalendar(): void { /* ... */ }
    openColumnSettings(): void { /* ... */ }
    openProperties(taskId: string): void { /* ... */ }
    
    isDrawerOpen(): boolean { /* ... */ }
    
    destroy(): void {
        this.dependenciesModal?.destroy();
        this.calendarModal?.destroy();
        this.columnSettingsModal?.destroy();
        this.drawer?.destroy();
    }
}
```

---

## Phase 6: FileOperationsService (1.5 hours)

### 6.1 Service Responsibility

File open, save, import, and export operations.

### 6.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `saveToFile()` | 10 | 3752-3761 |
| `openFromFile()` | 16 | 3767-3782 |
| `exportAsDownload()` | 7 | 3787-3793 |
| `importFromFile()` | 20 | 3799-3818 |
| `importFromMSProjectXML()` | 23 | 3825-3847 |
| `importFromMSProjectXMLContent()` | 15 | 3853-3867 |
| `exportToMSProjectXML()` | 7 | 3871-3877 |
| `clearAllData()` | 28 | 3882-3909 |
| `_assignSortKeysToImportedTasks()` | 126 | 3584-3710 |

**Total: ~252 lines**

### 6.3 Interface Definition

```typescript
// src/services/scheduler/FileOperationsService.ts

import type { Task, Calendar } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { FileService } from '../../ui/services/FileService';
import type { ToastService } from '../../ui/services/ToastService';
import type { PersistenceService } from '../../data/PersistenceService';
import { OrderingService } from '../OrderingService';

export interface FileOperationsServiceDeps {
    projectController: ProjectController;
    fileService: FileService;
    toastService: ToastService;
    persistenceService: PersistenceService | null;
    saveCheckpoint: () => void;
    saveData: () => void;
    recalculateAll: () => void;
    createSampleData: () => void;
}

export class FileOperationsService {
    private deps: FileOperationsServiceDeps;

    constructor(deps: FileOperationsServiceDeps) {
        this.deps = deps;
    }

    async saveToFile(): Promise<void> { /* ... */ }
    async openFromFile(): Promise<void> { /* ... */ }
    exportAsDownload(): void { /* ... */ }
    async importFromFile(file: File): Promise<void> { /* ... */ }
    async importFromMSProjectXML(file: File): Promise<void> { /* ... */ }
    async importFromMSProjectXMLContent(content: string): Promise<void> { /* ... */ }
    exportToMSProjectXML(): void { /* ... */ }
    async clearAllData(): Promise<void> { /* ... */ }

    // Helper
    assignSortKeysToImportedTasks(tasks: Task[]): Task[] { /* ... */ }
}
```

---

## Phase 7: BaselineService (1 hour)

### 7.1 Service Responsibility

Baseline set, clear, and variance calculation.

### 7.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `_hasBaseline` property | 3 | 1074 |
| `hasBaseline()` | 19 | 1080-1099 |
| `setBaseline()` | 33 | 1105-1139 |
| `clearBaseline()` | 30 | 1144-1176 |
| `_updateBaselineButtonVisibility()` | 26 | 1184-1210 |
| `calculateVariance()` | 4 | 1217-1219 |
| `_calculateVariance()` | 5 | 1229-1233 |

**Total: ~120 lines**

### 7.3 Interface Definition

```typescript
// src/services/scheduler/BaselineService.ts

import type { Task, Calendar } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ToastService } from '../../ui/services/ToastService';
import { calculateVariance as calculateVarianceFn } from '../../core/calculations';

export interface BaselineServiceDeps {
    projectController: ProjectController;
    columnRegistry: ColumnRegistry;
    toastService: ToastService;
    saveCheckpoint: () => void;
    saveData: () => void;
    // Cross-service callback (called after baseline set/clear)
    rebuildGridColumns: () => void;  // Triggers ColumnPreferencesService.rebuildGridColumns()
}

export class BaselineService {
    private deps: BaselineServiceDeps;
    private _hasBaseline: boolean = false;

    constructor(deps: BaselineServiceDeps) {
        this.deps = deps;
    }

    hasBaseline(): boolean { /* ... */ }
    setBaseline(): void { /* ... */ }
    clearBaseline(): void { /* ... */ }
    updateBaselineButtonVisibility(): void { /* ... */ }
    calculateVariance(task: Task): { start: number | null; finish: number | null } { /* ... */ }
}
```

---

## Phase 8: TradePartnerService (1 hour)

### 8.1 Service Responsibility

Trade partner CRUD and task assignment.

### 8.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `getTradePartners()` | 3 | 4032-4034 |
| `getTradePartner()` | 3 | 4039-4041 |
| `createTradePartner()` | 23 | 4089-4111 |
| `updateTradePartner()` | 20 | 4116-4139 |
| `deleteTradePartner()` | 24 | 4144-4169 |
| `assignTradePartner()` | 22 | 4174-4195 |
| `unassignTradePartner()` | 22 | 4200-4221 |
| `getTaskTradePartners()` | 5 | 4226-4230 |
| `_handleTradePartnerClick()` | 12 | 1488-1499 |

**Total: ~134 lines**

### 8.3 Interface Definition

```typescript
// src/services/scheduler/TradePartnerService.ts

import type { TradePartner, Task } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { TradePartnerStore } from '../../data/TradePartnerStore';
import type { PersistenceService } from '../../data/PersistenceService';
import type { ToastService } from '../../ui/services/ToastService';

export interface TradePartnerServiceDeps {
    projectController: ProjectController;
    tradePartnerStore: TradePartnerStore;
    persistenceService: PersistenceService | null;
    toastService: ToastService;
    viewCoordinator: ViewCoordinator;  // Use forceUpdate() instead of render()
    // NOTE: notifyDataChange() handled by ViewCoordinator reactively via onDataChange callbacks
}

export class TradePartnerService {
    private deps: TradePartnerServiceDeps;

    constructor(deps: TradePartnerServiceDeps) {
        this.deps = deps;
    }

    getAll(): TradePartner[] { /* ... */ }
    get(id: string): TradePartner | undefined { /* ... */ }
    create(data: Omit<TradePartner, 'id'>): TradePartner { /* ... */ }
    update(id: string, field: keyof TradePartner, value: unknown): void { /* ... */ }
    delete(id: string): void { /* ... */ }
    assignToTask(taskId: string, tradePartnerId: string): void { /* ... */ }
    unassignFromTask(taskId: string, tradePartnerId: string, showToast?: boolean): void { /* ... */ }
    getForTask(taskId: string): TradePartner[] { /* ... */ }
    handleClick(taskId: string, tradePartnerId: string, e: MouseEvent): void { /* ... */ }
}
```

---

## Phase 9: ColumnPreferencesService (2 hours)

> ⚠️ **ARCHITECTURAL NOTE: Encapsulated Legacy**
> 
> This service contains **direct DOM manipulation** (`_buildGridHeader`) which is an 
> imperative pattern. In a modern application, header rendering should be part of 
> `GridRenderer` or a reactive component.
> 
> **Strategy:** Extract as planned (cleans up SchedulerService), but mark this service 
> internally as "Encapsulated Legacy". This isolates the imperative code so that when 
> the Grid Rendering engine is rewritten (e.g., to React/Solid), this one service can 
> be replaced without touching the rest of the application.

### 9.1 Service Responsibility

Column management, header rendering, CSS variables (legacy DOM manipulation).

### 9.2 Methods to Extract

| Method | Lines | Location |
|--------|-------|----------|
| `_getColumnDefinitions()` | 5 | 770-774 |
| `_getColumnPreferences()` | 17 | 783-799 |
| `_getDefaultColumnPreferences()` | 3 | 807-809 |
| `_saveColumnPreferences()` | 8 | 815-822 |
| `updateColumnPreferences()` | 33 | 827-859 |
| `_buildGridHeader()` | 112 | 866-977 |
| `_calculateStickyLeft()` | 11 | 986-996 |
| `_initHeaderScrollSync()` | 23 | 1001-1023 |
| `_initializeColumnCSSVariables()` | 36 | 1029-1064 |
| `_rebuildGridColumns()` | 22 | 1240-1261 |
| `_updateHeaderCheckboxState()` | 36 | 3062-3097 |
| `_handleSelectAllClick()` | 22 | 3104-3125 |

**Total: ~328 lines**

### 9.3 Interface Definition

```typescript
// src/services/scheduler/ColumnPreferencesService.ts

import type { GridColumn, ColumnPreferences, Task } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ToastService } from '../../ui/services/ToastService';
import type { GridAccessor } from './types';

export interface ColumnPreferencesServiceDeps {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    columnRegistry: ColumnRegistry;
    toastService: ToastService;
    getGrid: () => GridAccessor | null;
    render: () => void;
}

export class ColumnPreferencesService {
    private deps: ColumnPreferencesServiceDeps;

    constructor(deps: ColumnPreferencesServiceDeps) {
        this.deps = deps;
    }

    // === Column Definitions ===
    getColumnDefinitions(): GridColumn[] { /* ... */ }
    
    // === Preferences ===
    getPreferences(): ColumnPreferences { /* ... */ }
    getDefaultPreferences(): ColumnPreferences { /* ... */ }
    savePreferences(prefs: ColumnPreferences): void { /* ... */ }
    updatePreferences(preferences: ColumnPreferences): void { /* ... */ }
    
    // === Header Management ===
    buildGridHeader(): void { /* ... */ }
    initializeColumnCSSVariables(): void { /* ... */ }
    initHeaderScrollSync(): void { /* ... */ }
    rebuildGridColumns(): void { /* ... */ }
    
    // === Selection Checkbox ===
    updateHeaderCheckboxState(checkbox?: HTMLInputElement): void { /* ... */ }
    handleSelectAllClick(checkbox: HTMLInputElement): void { /* ... */ }
    
    // === Helpers ===
    calculateStickyLeft(pinnedIndex: number, columns: GridColumn[]): string { /* ... */ }
}
```

---

## Phase 10: Final Cleanup (2 hours)

### 10.1 Create Barrel Export

```typescript
// src/services/scheduler/index.ts

export { TaskOperationsService, type TaskOperationsServiceDeps } from './TaskOperationsService';
export { ViewStateService, type ViewStateServiceDeps } from './ViewStateService';
export { ContextMenuService, type ContextMenuServiceDeps } from './ContextMenuService';
export { ModalCoordinator, type ModalCoordinatorDeps } from './ModalCoordinator';
export { FileOperationsService, type FileOperationsServiceDeps } from './FileOperationsService';
export { BaselineService, type BaselineServiceDeps } from './BaselineService';
export { TradePartnerService, type TradePartnerServiceDeps } from './TradePartnerService';
export { ColumnPreferencesService, type ColumnPreferencesServiceDeps } from './ColumnPreferencesService';
export type { GridAccessor, GanttAccessor, SchedulerCallbacks } from './types';

// NOTE: RenderCoordinator and CallbackRegistry eliminated
// Use ViewCoordinator from src/services/migration/ViewCoordinator.ts instead
```

### 10.2 Remove Dead Code

Search and remove:
- Unused imports
- Old method implementations (now delegated)
- Commented-out code
- `ENABLE_LEGACY_RECALC` dead paths (it's always `false`)

### 10.3 Final Verification

```powershell
npm run build
npx vitest run tests/unit
npx vitest run tests/integration
(Get-Content src/services/SchedulerService.ts | Measure-Object -Line).Lines  # Should be 600-800
```

---

## 16. What Stays in SchedulerService

After all extractions, SchedulerService should contain only:

### 16.1 Properties (~50 lines)

```typescript
// Injected services (from Composition Root)
private projectController: ProjectController;
private selectionModel: SelectionModel;
private commandService: CommandService;
private schedulingLogicService: SchedulingLogicService;
private editingStateManager: EditingStateManager;
private columnRegistry: ColumnRegistry;
private viewCoordinator: ViewCoordinator;  // Handles reactive rendering

// Extracted services (new in decomposition)
private taskOperations: TaskOperationsService;
private viewState: ViewStateService;
private contextMenu: ContextMenuService;
private modalCoordinator: ModalCoordinator;
private fileOperations: FileOperationsService;
private baseline: BaselineService;
private tradePartner: TradePartnerService;
private columnPreferences: ColumnPreferencesService;

// UI components
public grid: VirtualScrollGridFacade | null = null;
public gantt: CanvasGanttFacade | null = null;
public toastService: ToastService;
private fileService: FileService;
private keyboardService: KeyboardService | null = null;

// State
public isInitialized: boolean = false;
```

> **NOTE:** `ViewCoordinator` replaces both `RenderCoordinator` and `CallbackRegistry`.
> It already exists at `src/services/migration/ViewCoordinator.ts` and handles:
> - Reactive rendering via RxJS subscriptions
> - Batched DOM updates via `requestAnimationFrame`
> - Selection and data change callbacks

### 16.2 Constructor (~80 lines)

```typescript
constructor(options: SchedulerServiceOptions) {
    // Initialize injected services
    // Create extracted services with dependency injection
    // Wire callbacks between services
}
```

### 16.3 Lifecycle Methods (~150 lines)

```typescript
async init(): Promise<void> { /* Component setup, wiring */ }
initKeyboard(): void { /* Wire KeyboardService to extracted services */ }
destroy(): void { /* Cleanup */ }
async loadData(): Promise<void> { /* Orchestrate loading */ }
async saveData(): Promise<void> { /* Orchestrate saving */ }
async onShutdown(): Promise<void> { /* Orchestrate cleanup */ }
```

### 16.4 Event Routing (~200 lines)

```typescript
// These stay as routing layer - they delegate to extracted services
private _handleRowClick(taskId: string, e: MouseEvent): void { /* ... */ }
private _handleRowDoubleClick(taskId: string, e: MouseEvent): void { /* ... */ }
private _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> { /* ... */ }
private _handleAction(taskId: string, action: string, e?: Event): void { /* ... */ }
private _handleBarDrag(task: Task, start: string, end: string): void { /* ... */ }
private _handleSelectionChange(selectedIds: string[]): void { /* ... */ }
private _handleDependenciesSave(taskId: string, dependencies: Dependency[]): void { /* ... */ }
private _handleCalendarSave(calendar: Calendar): void { /* ... */ }
private _onEditingStateChange(event: EditingStateChangeEvent): void { /* ... */ }
private _updateSelection(): void { /* ... */ }
```

### 16.5 Public API Facades (~100 lines)

```typescript
// Thin delegations to extracted services
addTask(taskData?: Partial<Task>): Promise<Task | undefined> {
    return this.taskOperations.addTask(taskData);
}

deleteTask(taskId: string): void {
    this.taskOperations.deleteTask(taskId);
}

// ... etc for all public methods
```

### 16.6 Data Accessors (~50 lines)

```typescript
get tasks(): Task[] { return this.projectController.getTasks(); }
set tasks(tasks: Task[]) { /* ... */ }
get calendar(): Calendar { return this.projectController.getCalendar(); }
set calendar(calendar: Calendar) { /* ... */ }
getTask(id: string): Task | undefined { /* ... */ }
getStats(): { /* ... */ } { /* ... */ }
getZoomController(): ZoomController | null { /* ... */ }
```

**Estimated Total: 630-750 lines**

---

## 17. Verification Protocol

### Per-Phase Verification

After each phase:

1. **Build Check**
   ```powershell
   npm run build
   ```

2. **Unit Tests**
   ```powershell
   npx vitest run tests/unit
   ```

3. **Line Count Check**
   ```powershell
   (Get-Content src/services/SchedulerService.ts | Measure-Object -Line).Lines
   ```

4. **Manual Smoke Tests** (phase-specific)

### Final Verification Checklist

- [ ] Build succeeds: `npm run build`
- [ ] All unit tests pass: `npx vitest run tests/unit`
- [ ] All integration tests pass: `npx vitest run tests/integration`
- [ ] SchedulerService ≤ 800 lines
- [ ] All 10 services created
- [ ] No circular dependencies
- [ ] Manual test: Add/delete/edit tasks
- [ ] Manual test: Indent/outdent
- [ ] Manual test: Drag and drop
- [ ] Manual test: Context menu
- [ ] Manual test: File operations
- [ ] Manual test: Baseline operations
- [ ] Manual test: Trade partner operations
- [ ] Manual test: Column preferences
- [ ] Manual test: Keyboard navigation

---

## 18. Cross-Service Dependencies (Verified)

During deep analysis, the following cross-service calls were identified:

### Verified Call Patterns

| Caller Service | Calls | Recipient | Resolution |
|----------------|-------|-----------|------------|
| TaskOperationsService.addTask() | `_updateHeaderCheckboxState()` | ColumnPreferencesService | Pass as callback in deps |
| BaselineService.setBaseline() | `_rebuildGridColumns()` | ColumnPreferencesService | Pass as callback in deps |
| BaselineService.clearBaseline() | `_rebuildGridColumns()` | ColumnPreferencesService | Pass as callback in deps |
| TradePartnerService.update/delete() | `_notifyDataChange()` | CallbackRegistry | **Eliminated** - ViewCoordinator handles reactively |
| TradePartnerService.update/delete() | `render()` | RenderCoordinator | **Eliminated** - ViewCoordinator handles reactively |

### Key Insight: ViewCoordinator Eliminates Many Callbacks

With ViewCoordinator finalized (Phase 1), these patterns become **unnecessary**:

```
// BEFORE (explicit callbacks)
tradePartnerService.update(...);
this._notifyDataChange();
this.render();

// AFTER (reactive)
tradePartnerService.update(...);
// ViewCoordinator reactively updates when ProjectController.tasks$ emits
```

### OperationQueue Ownership

- **Location:** `src/services/SchedulerService.ts` line 194
- **Usage:** Only in `addTask()` (line 2113)
- **Decision:** TaskOperationsService owns its own OperationQueue instance
- **Rationale:** Task serialization is a TaskOperationsService concern

### Test Impact (Verified)

- **Integration test:** `tests/integration/EditingStateManager-SchedulerService.test.ts`
- **Impact:** **None** - Test only simulates SchedulerService behavior, doesn't instantiate it
- **No test updates required during extraction**

---

## 19. Risk Mitigation

### Known Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Circular dependencies | Medium | High | Use callback injection pattern exclusively |
| Breaking existing tests | Medium | Medium | Run tests after each extraction |
| Missing edge cases | Low | Medium | Comprehensive manual testing |
| Performance regression | Low | Low | No new abstractions in hot paths |

### Rollback Strategy

If any phase fails:

1. **Single file rollback:**
   ```powershell
   git checkout HEAD -- src/services/SchedulerService.ts
   ```

2. **Phase rollback:**
   ```powershell
   git reset --hard HEAD~1
   ```

3. **Full rollback:**
   ```powershell
   git checkout main -- src/services/
   ```

### Commit Strategy

Create a commit after each successful phase:

```
Phase 0: Setup scheduler service directory structure
Phase 1: Finalize ViewCoordinator (add assignVisualRowNumbers, wire to SchedulerService)
Phase 2: Extract TaskOperationsService (550 lines)
Phase 3: Extract ViewStateService (200 lines)
Phase 4: Extract ContextMenuService (90 lines)
Phase 5: Extract ModalCoordinator (100 lines)
Phase 6: Extract FileOperationsService (250 lines)
Phase 7: Extract BaselineService (120 lines)
Phase 8: Extract TradePartnerService (135 lines)
Phase 9: Extract ColumnPreferencesService (330 lines)
Phase 10: Final cleanup and verification
```

> **NOTE:** Phases 9-10 (RenderCoordinator, CallbackRegistry) eliminated - use ViewCoordinator

---

## Appendix A: Method Cross-Reference

| Method | Current Lines | Destination | Phase |
|--------|---------------|-------------|-------|
| `render()` | 3383-3413 | ViewCoordinator (existing) | 1 |
| `_assignVisualRowNumbers()` | 3315-3346 | ViewCoordinator (existing) | 1 |
| `_updateGridDataSync()` | 3354-3362 | ViewCoordinator (existing) | 1 |
| `_updateGanttDataSync()` | 3370-3378 | ViewCoordinator (existing) | 1 |
| `addTask()` | 2106-2173 | TaskOperationsService | 2 |
| `deleteTask()` | 2178-2201 | TaskOperationsService | 2 |
| `indent()` | 2224-2268 | TaskOperationsService | 2 |
| `outdent()` | 2273-2303 | TaskOperationsService | 2 |
| `indentSelected()` | 2549-2606 | TaskOperationsService | 2 |
| `outdentSelected()` | 2612-2659 | TaskOperationsService | 2 |
| `deleteSelected()` | 2665-2712 | TaskOperationsService | 2 |
| `moveSelectedTasks()` | 2912-2929 | TaskOperationsService | 2 |
| `insertBlankRowAbove()` | 2409-2437 | TaskOperationsService | 2 |
| `insertBlankRowBelow()` | 2442-2470 | TaskOperationsService | 2 |
| `wakeUpBlankRow()` | 2476-2501 | TaskOperationsService | 2 |
| `convertBlankToTask()` | 2506-2528 | TaskOperationsService | 2 |
| `toggleCollapse()` | 2216-2219 | TaskOperationsService | 2 |
| `_handleRowMove()` | 1634-1816 | TaskOperationsService | 2 |
| `_handleEnterLastRow()` | 1454-1479 | TaskOperationsService | 2 |
| `setViewMode()` | 3919-3927 | ViewStateService | 3 |
| `toggleDrivingPathMode()` | 746-750 | ViewStateService | 3 |
| `_handleCellNavigation()` | 1849-1934 | ViewStateService | 3 |
| `_handleArrowCollapse()` | 1941-1953 | ViewStateService | 3 |
| `_handleEscape()` | 1979-1990 | ViewStateService | 3 |
| `enterEditMode()` | 2989-3007 | ViewStateService | 3 |
| `exitEditMode()` | 3013-3018 | ViewStateService | 3 |
| `_showRowContextMenu()` | 2326-2404 | ContextMenuService | 4 |
| `openDrawer()` | 3162-3178 | ModalCoordinator | 5 |
| `openDependencies()` | 3193-3219 | ModalCoordinator | 5 |
| `openCalendar()` | 3224-3227 | ModalCoordinator | 5 |
| `openColumnSettings()` | 3232-3235 | ModalCoordinator | 5 |
| `openProperties()` | 2533-2546 | ModalCoordinator | 5 |
| `saveToFile()` | 3752-3761 | FileOperationsService | 6 |
| `openFromFile()` | 3767-3782 | FileOperationsService | 6 |
| `importFromFile()` | 3799-3818 | FileOperationsService | 6 |
| `importFromMSProjectXML()` | 3825-3847 | FileOperationsService | 6 |
| `exportToMSProjectXML()` | 3871-3877 | FileOperationsService | 6 |
| `clearAllData()` | 3882-3909 | FileOperationsService | 6 |
| `hasBaseline()` | 1080-1099 | BaselineService | 7 |
| `setBaseline()` | 1105-1139 | BaselineService | 7 |
| `clearBaseline()` | 1144-1176 | BaselineService | 7 |
| `calculateVariance()` | 1217-1233 | BaselineService | 7 |
| `getTradePartners()` | 4032-4034 | TradePartnerService | 8 |
| `createTradePartner()` | 4089-4111 | TradePartnerService | 8 |
| `updateTradePartner()` | 4116-4139 | TradePartnerService | 8 |
| `deleteTradePartner()` | 4144-4169 | TradePartnerService | 8 |
| `assignTradePartner()` | 4174-4195 | TradePartnerService | 8 |
| `_buildGridHeader()` | 866-977 | ColumnPreferencesService | 9 |
| `_initializeColumnCSSVariables()` | 1029-1064 | ColumnPreferencesService | 9 |
| `updateColumnPreferences()` | 827-859 | ColumnPreferencesService | 9 |
| `_rebuildGridColumns()` | 1240-1261 | ColumnPreferencesService | 9 |
| `onTaskSelect()` | 2018-2029 | ViewCoordinator (existing) | 1 |
| `onPanelOpenRequest()` | 2047-2058 | KEEP in SchedulerService | - |
| `onDataChange()` | 3283-3291 | ViewCoordinator (existing) | 1 |

> **NOTE:** Methods going to "ViewCoordinator (existing)" are moved to the already-implemented 
> `src/services/migration/ViewCoordinator.ts`. `onPanelOpenRequest()` stays in SchedulerService 
> as it's UI-layer specific.

---

**Document Version:** 1.0  
**Last Updated:** January 8, 2026  
**Author:** AI Assistant (Claude)  
**Status:** Ready for Implementation
