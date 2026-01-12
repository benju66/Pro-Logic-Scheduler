# Pure DI Subordinate Factory Implementation Plan

## Complete Migration from Hybrid DI to Factory Pattern for SchedulerService

**Project:** Pro Logic Scheduler  
**Date:** January 12, 2026  
**Status:** 📋 **PLANNING COMPLETE** - Ready for Implementation  
**Estimated Effort:** 5-6 hours  
**Confidence Level:** 92%

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Architecture](#3-target-architecture)
4. [Implementation Phases](#4-implementation-phases)
5. [Phase 0: Prerequisites & File Structure](#5-phase-0-prerequisites--file-structure)
6. [Phase 1: Lift Shared Services to main.ts](#6-phase-1-lift-shared-services-to-maints)
7. [Phase 2: Define Subordinate Factory Interface](#7-phase-2-define-subordinate-factory-interface)
8. [Phase 3: Implement Subordinate Factory](#8-phase-3-implement-subordinate-factory)
9. [Phase 4: Update main.ts - Create Factory](#9-phase-4-update-maints---create-factory)
10. [Phase 5: Update AppInitializer](#10-phase-5-update-appinitializer)
11. [Phase 6: Update SchedulerService](#11-phase-6-update-schedulerservice)
12. [Phase 7: Testing & Validation](#12-phase-7-testing--validation)
13. [Risk Assessment](#13-risk-assessment)
14. [Rollback Strategy](#14-rollback-strategy)

---

## 1. Executive Summary

### Problem Statement

`SchedulerService` currently has two architectural issues:

1. **Hybrid Injection Pattern**: Constructor uses `|| Service.getInstance()` fallbacks, maintaining tight coupling to singleton implementations
2. **Direct Instantiation in init()**: 14 subordinate services are created directly using `new`, making SchedulerService both orchestrator and factory

### Solution: Curried Factory Pattern

- **Remove all singleton fallbacks** - Dependencies become mandatory
- **Create a SubordinateFactory** - Abstracts service creation from SchedulerService
- **main.ts as single Composition Root** - All wiring happens in one place
- **Forward references for circular deps** - Handles `ColumnPreferencesService ↔ ViewStateService` mutual dependency

### Benefits

| Benefit | Description |
|---------|-------------|
| **Explicit Dependencies** | Every constructor clearly declares what it needs |
| **Testability** | Unit tests can mock the factory interface |
| **No Hidden Coupling** | Dependencies visible in the call graph |
| **Single Responsibility** | SchedulerService orchestrates, factory creates |
| **Future-Proof** | Adding new features follows the same pattern |

---

## 2. Current State Analysis

### Services Created in SchedulerService.init() (14 total)

| # | Service | Static Dependencies | Cross-Dependencies |
|---|---------|---------------------|-------------------|
| 1 | `ColumnPreferencesService` | projectController, selectionModel, columnRegistry, toastService | ↔ ViewStateService |
| 2 | `GridNavigationController` | editingStateManager | None |
| 3 | `ViewportFactoryService` | None | None |
| 4 | `TaskOperationsService` | projectController, selectionModel, editingStateManager, commandService, toastService | → ViewStateService |
| 5 | `ViewStateService` | projectController, selectionModel, editingStateManager, commandService, viewCoordinator | ↔ ColumnPreferencesService |
| 6 | `ContextMenuService` | None (callbacks only) | None |
| 7 | `ModalCoordinator` | projectController, selectionModel, columnRegistry | → ViewStateService |
| 8 | `FileOperationsService` | projectController, fileService, toastService, persistenceService | None |
| 9 | `BaselineService` | projectController, columnRegistry, toastService | → ColumnPreferencesService |
| 10 | `TradePartnerService` | projectController, tradePartnerStore, persistenceService, toastService, viewCoordinator | None |
| 11 | `DependencyValidationService` | projectController | None |
| 12 | `KeyboardBindingService` | KeyboardService class | None |
| 13 | `TestDataGenerator` | projectController, toastService | None |

### Services Created in _initServices() (Must lift to main.ts)

| Service | Current Location | Dependencies |
|---------|------------------|--------------|
| `ToastService` | SchedulerService._initServices() line 285 | container: document.body |
| `FileService` | SchedulerService._initServices() line 289 | isTauri, onToast callback |

### Cross-Dependencies (Require Forward References)

```
┌──────────────────────────┐      ┌──────────────────────────┐
│  ColumnPreferencesService │◄────►│     ViewStateService      │
│  - updateSelection()  ────┼──────┼► updateSelection()        │
│  ◄───── getColumnDefs()   │      │   getColumnDefinitions()  │
│  ◄───── updateHeaderCB()  │      │   updateHeaderCheckboxState│
└──────────────────────────┘      └──────────────────────────┘
```

### Dead Code Found

- `private drawer: SideDrawer | null = null;` - Never instantiated (ModalCoordinator handles drawer now)
- Related drawer references in destroy() method

---

## 3. Target Architecture

### Dependency Flow

```
main.ts (Composition Root)
    │
    ├── Creates: ToastService, FileService
    ├── Creates: createSubordinateFactory(staticDeps)
    │
    └── Passes to: AppInitializer
                      │
                      └── Passes to: SchedulerService
                                        │
                                        └── Calls: factory.createAll(runtimeContext)
                                                      │
                                                      └── Returns: SubordinateServicesBundle
```

### Factory Pattern

```typescript
// Factory captures static deps in closure
const factory = createSubordinateFactory({
    projectController,
    selectionModel,
    // ... other static deps
});

// SchedulerService provides runtime context
const services = factory.createAll({
    getGrid: () => this.grid,
    getGantt: () => this.gantt,
    // ... other runtime callbacks
});
```

### Forward Reference Pattern

```typescript
// Inside createAll():
let _viewStateService: ViewStateService;
let _columnPreferencesService: ColumnPreferencesService;

const columnPreferencesService = new ColumnPreferencesService({
    // Forward ref - valid when callback is invoked at runtime
    updateSelection: () => _viewStateService?.updateSelection(),
});
_columnPreferencesService = columnPreferencesService;

const viewStateService = new ViewStateService({
    getColumnDefinitions: () => _columnPreferencesService.getColumnDefinitions(),
});
_viewStateService = viewStateService;
```

---

## 4. Implementation Phases

| Phase | Description | Est. Time |
|-------|-------------|-----------|
| Phase 0 | Prerequisites & File Structure | 15 min |
| Phase 1 | Lift ToastService & FileService to main.ts | 30 min |
| Phase 2 | Define SchedulerSubordinateFactory interface | 30 min |
| Phase 3 | Implement createSubordinateFactory | 1 hour |
| Phase 4 | Update main.ts - Create Factory | 20 min |
| Phase 5 | Update AppInitializer | 30 min |
| Phase 6 | Update SchedulerService | 1.5 hours |
| Phase 7 | Testing & Validation | 1 hour |
| **Total** | | **~5-6 hours** |

---

## 5. Phase 0: Prerequisites & File Structure

### New Files to Create

```
src/
├── services/
│   └── scheduler/
│       ├── SchedulerSubordinateFactory.ts    # NEW: Factory interface
│       └── createSubordinateFactory.ts       # NEW: Factory implementation
├── ui/
│   └── services/
│       └── index.ts                          # NEW: Export ToastService, FileService
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/main.ts` | Create ToastService, FileService, SubordinateFactory |
| `src/services/AppInitializer.ts` | Accept factory, pass to SchedulerService |
| `src/services/SchedulerService.ts` | Remove fallbacks, use factory, remove dead code |
| `src/services/scheduler/index.ts` | Export new types |

---

## 6. Phase 1: Lift Shared Services to main.ts

### Step 1.1: Create UI Services Export

**File:** `src/ui/services/index.ts` (NEW)

```typescript
export { ToastService } from './ToastService';
export type { ToastOptions } from './ToastService';
export { FileService } from './FileService';
export type { FileServiceOptions } from './FileService';
export { KeyboardService } from './KeyboardService';
```

### Step 1.2: Update main.ts - Create ToastService & FileService

**File:** `src/main.ts` - Add after Level 2 services (around line 140)

```typescript
// Level 2.5: UI Services (must exist before factory)
const toastService = new ToastService({ container: document.body });
const fileService = new FileService({
    isTauri: tauriAvailable,
    onToast: (msg, type) => toastService.show(msg, type as any)
});
console.log('[Composition Root] ✅ ToastService and FileService initialized');
```

### Step 1.3: Update AppInitializerOptions

**File:** `src/services/AppInitializer.ts`

Add to `AppInitializerOptions` interface:

```typescript
/** Injected ToastService (Phase 6 Pure DI) */
toastService?: ToastService;
/** Injected FileService (Phase 6 Pure DI) */
fileService?: FileService;
```

Store in constructor:

```typescript
this.toastService = options.toastService || null;
this.fileService = options.fileService || null;
```

---

## 7. Phase 2: Define Subordinate Factory Interface

### Step 2.1: Create Factory Interface

**File:** `src/services/scheduler/SchedulerSubordinateFactory.ts` (NEW)

```typescript
/**
 * @fileoverview Subordinate Factory Interface for SchedulerService
 * @module services/scheduler/SchedulerSubordinateFactory
 * 
 * Defines the contract for creating subordinate services used by SchedulerService.
 * The factory pattern allows SchedulerService to remain decoupled from concrete
 * service implementations while main.ts handles the complex dependency wiring.
 * 
 * @see docs/PURE_DI_SUBORDINATE_FACTORY_PLAN.md
 */

import type { TaskOperationsService } from './TaskOperationsService';
import type { ViewStateService } from './ViewStateService';
import type { ColumnPreferencesService } from './ColumnPreferencesService';
import type { GridNavigationController } from './GridNavigationController';
import type { ContextMenuService } from './ContextMenuService';
import type { ModalCoordinator } from './ModalCoordinator';
import type { FileOperationsService } from './FileOperationsService';
import type { BaselineService } from './BaselineService';
import type { TradePartnerService } from './TradePartnerService';
import type { DependencyValidationService } from './DependencyValidationService';
import type { ViewportFactoryService } from './ViewportFactoryService';
import type { KeyboardBindingService } from './KeyboardBindingService';
import type { TestDataGenerator } from '../../utils/TestDataGenerator';
import type { VirtualScrollGridFacade, CanvasGanttFacade } from '../../ui/components/scheduler/types';
import type { GridColumn, Calendar, Dependency, ColumnPreferences } from '../../types';

/**
 * Context provided by SchedulerService to the factory
 * Contains runtime accessors and callbacks that only SchedulerService can provide
 */
export interface SubordinateFactoryContext {
    // === Runtime UI Accessors ===
    getGrid: () => VirtualScrollGridFacade | null;
    getGantt: () => CanvasGanttFacade | null;
    
    // === SchedulerService Method Callbacks ===
    render: () => void;
    saveCheckpoint: () => void;
    saveData: () => void;
    recalculateAll: () => void;
    enterEditMode: () => void;
    exitEditMode: () => void;
    isInitialized: () => boolean;
    getColumnDefinitions: () => GridColumn[];
    getColumnPreferences: () => ColumnPreferences;
    getCalendar: () => Calendar;
    
    // === Selection/Navigation Callbacks ===
    handleSelectionChange: (selectedIds: string[]) => void;
    
    // === Panel/Drawer Callbacks ===
    getOpenPanelCallbacks: () => Array<(panelId: string) => void>;
    closeDrawer: () => void;
    isDrawerOpen: () => boolean;
    
    // === Event Handlers ===
    handleDependenciesSave: (taskId: string, deps: Dependency[]) => void;
    handleCalendarSave: (calendar: Calendar) => void;
    updateColumnPreferences: (prefs: ColumnPreferences) => void;
    notifyDataChange: () => void;
    
    // === Task Operations (for ContextMenuService) ===
    insertBlankRowAbove: (taskId: string) => void;
    insertBlankRowBelow: (taskId: string) => void;
    convertBlankToTask: (taskId: string) => void;
    deleteTask: (taskId: string) => void;
    openProperties: (taskId: string) => void;
    toggleCollapse: (taskId: string) => void;
    
    // === Keyboard Actions ===
    keyboardActions: {
        isAppReady: () => boolean;
        onUndo: () => void;
        onRedo: () => void;
        onDelete: () => void;
        onCopy: () => void;
        onCut: () => void;
        onPaste: () => void;
        onInsert: () => void;
        onShiftInsert: () => void;
        onCtrlEnter: () => void;
        onArrowUp: (shiftKey: boolean, ctrlKey: boolean) => void;
        onArrowDown: (shiftKey: boolean, ctrlKey: boolean) => void;
        onArrowLeft: (shiftKey: boolean, ctrlKey: boolean) => void;
        onArrowRight: (shiftKey: boolean, ctrlKey: boolean) => void;
        onCtrlArrowLeft: () => void;
        onCtrlArrowRight: () => void;
        onTab: () => void;
        onShiftTab: () => void;
        onCtrlArrowUp: () => void;
        onCtrlArrowDown: () => void;
        onF2: () => void;
        onEscape: () => void;
        onLinkSelected: () => void;
        onDrivingPath: () => void;
    };
    
    // === Config ===
    storageKey: string;
    modalContainer: HTMLElement;
}

/**
 * Bundle of all subordinate services created by the factory
 */
export interface SubordinateServicesBundle {
    columnPreferencesService: ColumnPreferencesService;
    gridNavigationController: GridNavigationController;
    viewportFactoryService: ViewportFactoryService;
    taskOperationsService: TaskOperationsService;
    viewStateService: ViewStateService;
    contextMenuService: ContextMenuService;
    modalCoordinator: ModalCoordinator;
    fileOperationsService: FileOperationsService;
    baselineService: BaselineService;
    tradePartnerService: TradePartnerService;
    dependencyValidationService: DependencyValidationService;
    keyboardBindingService: KeyboardBindingService;
    testDataGenerator: TestDataGenerator;
}

/**
 * Factory interface for creating subordinate services
 */
export interface SchedulerSubordinateFactory {
    /**
     * Create all subordinate services with proper dependency wiring
     * 
     * @param context - Runtime context from SchedulerService
     * @returns Bundle of all created services
     */
    createAll(context: SubordinateFactoryContext): SubordinateServicesBundle;
}
```

### Step 2.2: Export from index

**File:** `src/services/scheduler/index.ts` - Add export:

```typescript
export type { 
    SchedulerSubordinateFactory, 
    SubordinateFactoryContext, 
    SubordinateServicesBundle 
} from './SchedulerSubordinateFactory';
```

---

## 8. Phase 3: Implement Subordinate Factory

### Step 3.1: Create Factory Implementation

**File:** `src/services/scheduler/createSubordinateFactory.ts` (NEW)

```typescript
/**
 * @fileoverview Factory Implementation for SchedulerService Subordinates
 * @module services/scheduler/createSubordinateFactory
 * 
 * Creates the subordinate factory with all static dependencies captured in closure.
 * Cross-dependencies between services are handled using forward references.
 * 
 * @see docs/PURE_DI_SUBORDINATE_FACTORY_PLAN.md
 */

import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ViewCoordinator } from '../migration/ViewCoordinator';
import type { ToastService } from '../../ui/services/ToastService';
import type { FileService } from '../../ui/services/FileService';
import type { TradePartnerStore } from '../../data/TradePartnerStore';
import type { PersistenceService } from '../../data/PersistenceService';
import { KeyboardService } from '../../ui/services/KeyboardService';

import { TaskOperationsService } from './TaskOperationsService';
import { ViewStateService } from './ViewStateService';
import { ColumnPreferencesService } from './ColumnPreferencesService';
import { GridNavigationController } from './GridNavigationController';
import { ContextMenuService } from './ContextMenuService';
import { ModalCoordinator } from './ModalCoordinator';
import { FileOperationsService } from './FileOperationsService';
import { BaselineService } from './BaselineService';
import { TradePartnerService } from './TradePartnerService';
import { DependencyValidationService } from './DependencyValidationService';
import { ViewportFactoryService } from './ViewportFactoryService';
import { KeyboardBindingService } from './KeyboardBindingService';
import { TestDataGenerator } from '../../utils/TestDataGenerator';

import type { 
    SchedulerSubordinateFactory, 
    SubordinateFactoryContext,
    SubordinateServicesBundle 
} from './SchedulerSubordinateFactory';

/**
 * Static dependencies captured by the factory closure
 */
export interface FactoryDependencies {
    projectController: ProjectController;
    selectionModel: SelectionModel;
    editingStateManager: EditingStateManager;
    commandService: CommandService;
    columnRegistry: ColumnRegistry;
    viewCoordinator: ViewCoordinator | null;
    toastService: ToastService;
    fileService: FileService;
    tradePartnerStore: TradePartnerStore | null;
    persistenceService: PersistenceService | null;
}

/**
 * Create the subordinate factory with captured dependencies
 * 
 * @param deps - Static dependencies available at factory creation time
 * @returns Factory that can create all subordinate services
 */
export function createSubordinateFactory(deps: FactoryDependencies): SchedulerSubordinateFactory {
    const {
        projectController,
        selectionModel,
        editingStateManager,
        commandService,
        columnRegistry,
        viewCoordinator,
        toastService,
        fileService,
        tradePartnerStore,
        persistenceService,
    } = deps;

    return {
        createAll(ctx: SubordinateFactoryContext): SubordinateServicesBundle {
            // ═══════════════════════════════════════════════════════════════════
            // PHASE 1: Independent Services (no sibling dependencies)
            // ═══════════════════════════════════════════════════════════════════
            
            const viewportFactoryService = new ViewportFactoryService({});
            
            const gridNavigationController = new GridNavigationController({
                getVisibleTaskIds: () => {
                    return projectController.getVisibleTasks((id) => {
                        const task = projectController.getTaskById(id);
                        return task?._collapsed || false;
                    }).map(t => t.id);
                },
                getNavigableColumns: () => {
                    return ctx.getColumnDefinitions()
                        .filter(col => 
                            col.type === 'text' || 
                            col.type === 'number' || 
                            col.type === 'date' || 
                            col.type === 'select' || 
                            col.type === 'name' || 
                            col.type === 'schedulingMode'
                        )
                        .map(col => col.field);
                },
                isEditing: () => editingStateManager.isEditing(),
            });
            
            const dependencyValidationService = new DependencyValidationService({
                projectController,
            });
            
            const testDataGenerator = new TestDataGenerator({
                projectController,
                toastService,
            });

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 2: Cross-Dependent Services (use forward references)
            // ColumnPreferencesService ↔ ViewStateService have mutual dependencies
            // ═══════════════════════════════════════════════════════════════════
            
            // Forward references for circular dependencies
            let _viewStateService: ViewStateService;
            let _columnPreferencesService: ColumnPreferencesService;

            // Create ColumnPreferencesService first (needed for header build)
            const columnPreferencesService = new ColumnPreferencesService({
                projectController,
                selectionModel,
                columnRegistry,
                toastService,
                getGrid: ctx.getGrid,
                render: ctx.render,
                // Forward reference - will be valid when callback is invoked at runtime
                updateSelection: () => _viewStateService?.updateSelection(),
            });
            _columnPreferencesService = columnPreferencesService;

            // Create ViewStateService with forward reference to ColumnPreferencesService
            const viewStateService = new ViewStateService({
                projectController,
                selectionModel,
                editingStateManager,
                commandService,
                viewCoordinator: viewCoordinator!,
                getGrid: ctx.getGrid,
                getGantt: ctx.getGantt,
                getColumnDefinitions: () => _columnPreferencesService.getColumnDefinitions(),
                closeDrawer: ctx.closeDrawer,
                isDrawerOpen: ctx.isDrawerOpen,
                onSelectionChange: ctx.handleSelectionChange,
                updateHeaderCheckboxState: (checkbox) => _columnPreferencesService.updateHeaderCheckboxState(checkbox),
            });
            _viewStateService = viewStateService;

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 3: Services that depend on Phase 2 services
            // ═══════════════════════════════════════════════════════════════════

            const taskOperationsService = new TaskOperationsService({
                projectController,
                selectionModel,
                editingStateManager,
                commandService,
                toastService,
                getGrid: ctx.getGrid,
                getGantt: ctx.getGantt,
                saveCheckpoint: ctx.saveCheckpoint,
                enterEditMode: ctx.enterEditMode,
                isInitialized: ctx.isInitialized,
                // Use local reference (closure)
                updateHeaderCheckboxState: () => _viewStateService.updateHeaderCheckboxState(),
            });

            const contextMenuService = new ContextMenuService({
                insertBlankRowAbove: ctx.insertBlankRowAbove,
                insertBlankRowBelow: ctx.insertBlankRowBelow,
                convertBlankToTask: ctx.convertBlankToTask,
                deleteTask: ctx.deleteTask,
                openProperties: ctx.openProperties,
            });

            const modalCoordinator = new ModalCoordinator({
                projectController,
                selectionModel,
                columnRegistry,
                getOpenPanelCallbacks: ctx.getOpenPanelCallbacks,
                onDependenciesSave: ctx.handleDependenciesSave,
                onCalendarSave: ctx.handleCalendarSave,
                onColumnPreferencesSave: ctx.updateColumnPreferences,
                getColumnPreferences: ctx.getColumnPreferences,
                updateSelection: () => _viewStateService.updateSelection(),
            });

            const fileOperationsService = new FileOperationsService({
                projectController,
                fileService,
                toastService,
                persistenceService,
                saveCheckpoint: ctx.saveCheckpoint,
                saveData: ctx.saveData,
                recalculateAll: ctx.recalculateAll,
                storageKey: ctx.storageKey,
            });

            const baselineService = new BaselineService({
                projectController,
                columnRegistry,
                toastService,
                saveCheckpoint: ctx.saveCheckpoint,
                saveData: ctx.saveData,
                // Use local reference (closure)
                rebuildGridColumns: () => _columnPreferencesService.rebuildGridColumns(),
                getCalendar: ctx.getCalendar,
            });

            const tradePartnerService = new TradePartnerService({
                projectController,
                tradePartnerStore: tradePartnerStore!,
                persistenceService,
                toastService,
                viewCoordinator,
                notifyDataChange: ctx.notifyDataChange,
            });

            const keyboardBindingService = new KeyboardBindingService({
                actions: ctx.keyboardActions,
                KeyboardServiceClass: KeyboardService,
            });

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 4: Post-initialization (modals need container)
            // ═══════════════════════════════════════════════════════════════════
            
            modalCoordinator.initialize(ctx.modalContainer);

            // Return the complete bundle
            return {
                columnPreferencesService,
                gridNavigationController,
                viewportFactoryService,
                taskOperationsService,
                viewStateService,
                contextMenuService,
                modalCoordinator,
                fileOperationsService,
                baselineService,
                tradePartnerService,
                dependencyValidationService,
                keyboardBindingService,
                testDataGenerator,
            };
        }
    };
}
```

### Step 3.2: Export from index

**File:** `src/services/scheduler/index.ts` - Add export:

```typescript
export { createSubordinateFactory } from './createSubordinateFactory';
export type { FactoryDependencies } from './createSubordinateFactory';
```

---

## 9. Phase 4: Update main.ts - Create Factory

### Step 4.1: Add Imports

**File:** `src/main.ts` - Add imports:

```typescript
import { ToastService } from './ui/services/ToastService';
import { FileService } from './ui/services/FileService';
import { createSubordinateFactory } from './services/scheduler/createSubordinateFactory';
```

### Step 4.2: Add Factory Creation

**File:** `src/main.ts` - Add after Level 2.5 services:

```typescript
// Level 3: Subordinate Factory (captures all static deps in closure)
const subordinateFactory = createSubordinateFactory({
    projectController,
    selectionModel,
    editingStateManager,
    commandService,
    columnRegistry,
    viewCoordinator,
    toastService,
    fileService,
    tradePartnerStore,
    persistenceService,
});
console.log('[Composition Root] ✅ SubordinateFactory created');
```

### Step 4.3: Pass to AppInitializer

**File:** `src/main.ts` - Update AppInitializer instantiation:

```typescript
appInitializer = new AppInitializer({ 
    isTauri: tauriAvailable,
    rendererFactory,
    // ... existing props ...
    
    // Phase 6 Pure DI: Inject UI services
    toastService,
    fileService,
    
    // Phase 6 Pure DI: Inject subordinate factory
    subordinateFactory,
});
```

---

## 10. Phase 5: Update AppInitializer

### Step 5.1: Update AppInitializerOptions

**File:** `src/services/AppInitializer.ts`

```typescript
import type { SchedulerSubordinateFactory } from './scheduler/SchedulerSubordinateFactory';
import type { ToastService } from '../ui/services/ToastService';
import type { FileService } from '../ui/services/FileService';

export interface AppInitializerOptions {
    // ... existing props ...
    
    /** Injected ToastService (Phase 6 Pure DI) */
    toastService?: ToastService;
    /** Injected FileService (Phase 6 Pure DI) */
    fileService?: FileService;
    /** Injected SubordinateFactory (Phase 6 Pure DI) */
    subordinateFactory?: SchedulerSubordinateFactory;
}
```

### Step 5.2: Store in Constructor

```typescript
private toastService: ToastService | null = null;
private fileService: FileService | null = null;
private subordinateFactory: SchedulerSubordinateFactory | null = null;

constructor(options: AppInitializerOptions = {}) {
    // ... existing code ...
    this.toastService = options.toastService || null;
    this.fileService = options.fileService || null;
    this.subordinateFactory = options.subordinateFactory || null;
}
```

### Step 5.3: Update _initializeScheduler

Pass new services to SchedulerService:

```typescript
private async _initializeScheduler(): Promise<void> {
    // ... existing container setup ...
    
    const options = {
        // ... existing options ...
        
        // Phase 6 Pure DI: Inject new services
        toastService: this.toastService || undefined,
        fileService: this.fileService || undefined,
        subordinateFactory: this.subordinateFactory || undefined,
        
        // Required services (no fallback)
        projectController: this.projectController!,
        selectionModel: this.selectionModel!,
        commandService: this.commandService!,
        editingStateManager: getEditingStateManager(),
        persistenceService: this.persistenceService || undefined,
    };
    
    this.scheduler = new SchedulerService(options);
    // ... rest of method ...
}
```

---

## 11. Phase 6: Update SchedulerService

> ⚠️ **CRITICAL TIMING CONSTRAINT**
> 
> `factory.createAll()` MUST be called as the **very first logic** in `init()` after basic validation.
> The `_buildGridHeader()` method depends on `columnPreferencesService` existing.
> If you attempt to build headers before calling the factory, **the app will crash**.

### Step 6.1: Update SchedulerServiceOptions Interface

**File:** `src/services/SchedulerService.ts`

```typescript
import type { SchedulerSubordinateFactory, SubordinateFactoryContext } from './scheduler/SchedulerSubordinateFactory';
import type { ToastService } from '../ui/services/ToastService';
import type { FileService } from '../ui/services/FileService';

export interface SchedulerServiceOptions {
    // Required UI containers
    gridContainer: HTMLElement;
    ganttContainer: HTMLElement;
    drawerContainer?: HTMLElement;
    modalContainer?: HTMLElement;
    isTauri?: boolean;
    
    // Required core services (NO FALLBACKS)
    projectController: ProjectController;
    selectionModel: SelectionModel;
    commandService: CommandService;
    editingStateManager: EditingStateManager;
    schedulingLogicService: SchedulingLogicService;
    columnRegistry: ColumnRegistry;
    
    // Required UI services (NO FALLBACKS)
    toastService: ToastService;
    fileService: FileService;
    
    // Required factory (NO FALLBACK)
    subordinateFactory: SchedulerSubordinateFactory;
    
    // Optional services (null is acceptable)
    rendererFactory?: RendererFactory;
    zoomController?: ZoomController | null;
    tradePartnerStore?: TradePartnerStore | null;
    dataLoader?: DataLoader | null;
    snapshotService?: SnapshotService | null;
    viewCoordinator?: ViewCoordinator | null;
    keyboardService?: KeyboardService | null;
    persistenceService?: PersistenceService | null;
}
```

### Step 6.2: Update Constructor (Remove Fallbacks)

```typescript
constructor(options: SchedulerServiceOptions) {
    this.options = options;
    this.isTauri = options.isTauri ?? true;
    
    // === Required Dependencies (FAIL FAST - no fallbacks) ===
    this.projectController = options.projectController;
    this.selectionModel = options.selectionModel;
    this.commandService = options.commandService;
    this.editingStateManager = options.editingStateManager;
    this.schedulingLogicService = options.schedulingLogicService;
    this.columnRegistry = options.columnRegistry;
    this.toastService = options.toastService;
    this.fileService = options.fileService;
    this.subordinateFactory = options.subordinateFactory;
    
    // === Optional Dependencies (null is ok, NO singleton fallback) ===
    this.zoomController = options.zoomController ?? null;
    this.tradePartnerStore = options.tradePartnerStore ?? null;
    this.dataLoader = options.dataLoader ?? null;
    this.snapshotService = options.snapshotService ?? null;
    this.viewCoordinator = options.viewCoordinator ?? null;
    this.keyboardService = options.keyboardService ?? null;
    this.persistenceService = options.persistenceService ?? null;

    // Trade partner accessor wiring
    if (this.persistenceService && this.tradePartnerStore) {
        this.persistenceService.setTradePartnersAccessor(
            () => this.tradePartnerStore!.getAll()
        );
    }
}
```

### Step 6.3: Remove Dead Code

Remove from SchedulerService:

1. `private drawer: SideDrawer | null = null;` (line 152)
2. `import { SideDrawer } from '../ui/components/SideDrawer';` (line 52)
3. `if (this.drawer) this.drawer.destroy();` in destroy()

### Step 6.4: Remove _initServices() Method

Delete the entire `_initServices()` method (lines 246-293).

### Step 6.5: Update init() to Use Factory

Replace the 14 `new` calls with factory call. See full implementation in the codebase after migration.

> ⚠️ **CRITICAL: Execution Order**
> 
> The factory call MUST happen BEFORE `_initializeColumnCSSVariables()` and `_buildGridHeader()`.
> These methods depend on `columnPreferencesService` being available.

Key structure:

```typescript
async init(): Promise<void> {
    // 1. VALIDATION ONLY - no service usage
    const { gridContainer, ganttContainer, modalContainer } = this.options;
    if (!gridContainer || !ganttContainer) {
        throw new Error('gridContainer and ganttContainer are required');
    }

    const modalsContainer = modalContainer || document.body;
    
    // 2. FIRST: Create all subordinate services via factory
    //    This MUST happen before ANY code that uses subordinate services
    const subordinates = this.subordinateFactory.createAll({
        // Runtime UI accessors
        getGrid: () => this.grid,
        getGantt: () => this.gantt,
        
        // ... all other context properties ...
        
        storageKey: SchedulerService.STORAGE_KEY,
        modalContainer: modalsContainer,
    });

    // Assign to instance properties
    this.columnPreferencesService = subordinates.columnPreferencesService;
    this.gridNavigationController = subordinates.gridNavigationController;
    // ... assign all 13 services ...

    console.log('[SchedulerService] ✅ All subordinate services created via factory');

    // Continue with existing viewport/grid/gantt setup...
}
```

---

## 12. Phase 7: Testing & Validation

### Step 7.1: Verify ToastService Export

Before running compile check, verify `src/ui/services/index.ts` only exports types/classes without side effects:

```typescript
// ✅ CORRECT - named exports only, no instantiation
export { ToastService } from './ToastService';
export type { ToastOptions } from './ToastService';
export { FileService } from './FileService';
export type { FileServiceOptions } from './FileService';
export { KeyboardService } from './KeyboardService';

// ❌ WRONG - would cause side effects
// import './ToastService';  // side-effect import
// export default new ToastService();  // instantiation at import time
```

### Step 7.2: Compile Check

```bash
npx tsc --noEmit
```

### Step 7.3: Manual Smoke Test

1. Run `npm run tauri dev`
2. Verify app starts without errors
3. Test key functionality:
   - [ ] Add/delete tasks
   - [ ] Indent/outdent
   - [ ] Keyboard navigation (arrow keys)
   - [ ] Context menu (right-click)
   - [ ] Dependencies modal
   - [ ] Column preferences
   - [ ] File save/load
   - [ ] Undo/redo
   - [ ] Copy/paste

### Step 7.4: Integration Tests

Run existing E2E tests to verify no regressions:

```bash
npm run test:e2e
```

---

## 13. Risk Assessment

### Confidence Level: 92%

| Risk Area | Severity | Mitigation |
|-----------|----------|------------|
| Cross-dependency wiring | Medium | Forward ref pattern proven in investigation |
| KeyboardBindingService callbacks | Low | All 24 callbacks are simple method references |
| ToastService DOM dependency | Low | Created after DOMContentLoaded |
| Missing dependencies at runtime | Low | TypeScript catches at compile time |
| Initialization order issues | Medium | Factory phases ensure correct order |

### What TypeScript Will Catch

- Missing required dependencies in SchedulerServiceOptions
- Missing properties in SubordinateFactoryContext
- Type mismatches between factory and services

### What Requires Manual Testing

- Runtime callback invocation timing
- Forward reference resolution
- UI component wiring (grid/gantt availability)

---

## 14. Rollback Strategy

### Git Commits

Create a commit after each phase:

```bash
git commit -m "DI Phase 1: Lift ToastService and FileService to main.ts"
git commit -m "DI Phase 2: Create SchedulerSubordinateFactory interface"
git commit -m "DI Phase 3: Implement createSubordinateFactory"
git commit -m "DI Phase 4: Wire factory in main.ts"
git commit -m "DI Phase 5: Update AppInitializer"
git commit -m "DI Phase 6: Update SchedulerService to use factory"
git commit -m "DI Phase 7: Remove dead code and cleanup"
```

### Quick Rollback

```bash
git revert HEAD  # Undo last commit
# or
git reset --hard HEAD~1  # Hard reset (destructive)
```

### Partial Rollback

```bash
git checkout HEAD~1 -- src/services/SchedulerService.ts
```

---

---

## Future Optimization: Direct Service Wiring

### ContextMenuService → TaskOperationsService

The current plan routes ContextMenuService callbacks through SchedulerService:

```
ContextMenuService.deleteTask(id)
  → ctx.deleteTask(id)                    // callback to SchedulerService
    → SchedulerService.deleteTask(id)     // orchestrator method
      → taskOperationsService.deleteTask(id)  // final destination
```

**Future Optimization:** Wire ContextMenuService directly to TaskOperationsService inside the factory:

```typescript
// Inside createSubordinateFactory.createAll():
const contextMenuService = new ContextMenuService({
    deleteTask: (id) => taskOperationsService.deleteTask(id),  // Direct call
    // ... other direct wirings
});
```

**Why we're NOT doing this now:**
1. **Facade Pattern** - SchedulerService remains the single entry point for all operations
2. **Interception** - Allows adding logging, validation, or side effects at the orchestrator level
3. **Consistency** - All external callers go through SchedulerService
4. **Lower Risk** - The closure-based approach is validated to work

**When to consider this optimization:**
- If profiling shows the extra indirection is a performance bottleneck
- When refactoring SchedulerService further reduces its orchestration role
- When adding a command pattern that makes direct wiring cleaner

---

## Related Documentation

- [TRUE_PURE_DI_IMPLEMENTATION_PLAN.md](TRUE_PURE_DI_IMPLEMENTATION_PLAN.md) - Original DI migration plan
- [SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md](SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md) - Service extraction plan
- [ADR-001: Dependency Injection](adr/001-dependency-injection.md) - Architecture decision record

---

**Document Version:** 1.0  
**Last Updated:** January 12, 2026  
**Author:** AI Assistant (Claude)  
**Status:** Ready for Implementation
