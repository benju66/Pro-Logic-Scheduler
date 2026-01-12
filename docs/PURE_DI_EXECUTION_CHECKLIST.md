# Pure DI Subordinate Factory - Execution Checklist

**Reference:** [PURE_DI_SUBORDINATE_FACTORY_PLAN.md](PURE_DI_SUBORDINATE_FACTORY_PLAN.md)  
**Started:** Not yet started  
**Status:** 🔴 Not Started

---

## Execution Rules

1. **Complete each step in order** - Do not skip ahead
2. **Mark checkbox only after verification** - Not when code is written, but when it's verified working
3. **Run gate checks before proceeding** - Each phase has verification requirements
4. **Commit after each phase** - Create git commit with specified message
5. **Stop on failure** - If any step fails, debug before continuing

---

## Phase 0: Prerequisites & File Structure

### Pre-flight Checks
- [ ] Workspace is clean (`git status` shows no uncommitted changes or changes are stashed)
- [ ] Current branch is appropriate for this work
- [ ] `npm run build` passes before starting

### Step 0.1: Verify File Structure Understanding
- [ ] Confirmed `src/services/scheduler/` directory exists
- [ ] Confirmed `src/ui/services/` directory exists
- [ ] Read current `src/services/scheduler/index.ts` exports

**Phase 0 Gate:** All pre-flight checks pass

---

## Phase 1: Lift Shared Services to main.ts

### Step 1.1: Create UI Services Export
- [ ] Created `src/ui/services/index.ts`
- [ ] Exports `ToastService` (class)
- [ ] Exports `ToastOptions` (type)
- [ ] Exports `FileService` (class)
- [ ] Exports `FileServiceOptions` (type)
- [ ] Exports `KeyboardService` (class)
- [ ] **Verified:** No side-effect imports in the file

### Step 1.2: Update main.ts - Create Services
- [ ] Added import for `ToastService` from `'./ui/services/ToastService'`
- [ ] Added import for `FileService` from `'./ui/services/FileService'`
- [ ] Created `toastService` instance after Level 2 services
- [ ] Created `fileService` instance with `toastService` callback
- [ ] Added console.log confirmation message

### Step 1.3: Update AppInitializerOptions
- [ ] Added `toastService?: ToastService` to interface
- [ ] Added `fileService?: FileService` to interface
- [ ] Added private properties in class
- [ ] Updated constructor to store injected services

**Phase 1 Gate:**
- [ ] `npx tsc --noEmit` passes
- [ ] No new TypeScript errors introduced

**Phase 1 Commit:**
```bash
git add -A && git commit -m "DI Phase 1: Lift ToastService and FileService to main.ts"
```
- [ ] Committed

---

## Phase 2: Define Subordinate Factory Interface

### Step 2.1: Create Factory Interface File
- [ ] Created `src/services/scheduler/SchedulerSubordinateFactory.ts`
- [ ] Defined `SubordinateFactoryContext` interface with all properties:
  - [ ] Runtime UI accessors (getGrid, getGantt)
  - [ ] SchedulerService method callbacks (render, saveCheckpoint, etc.)
  - [ ] Selection/navigation callbacks
  - [ ] Panel/drawer callbacks
  - [ ] Event handlers
  - [ ] Task operations callbacks
  - [ ] Keyboard actions object
  - [ ] Config (storageKey, modalContainer)
- [ ] Defined `SubordinateServicesBundle` interface with all 13 services
- [ ] Defined `SchedulerSubordinateFactory` interface with `createAll` method

### Step 2.2: Export from Index
- [ ] Added exports to `src/services/scheduler/index.ts`:
  - [ ] `SchedulerSubordinateFactory` (type)
  - [ ] `SubordinateFactoryContext` (type)
  - [ ] `SubordinateServicesBundle` (type)

**Phase 2 Gate:**
- [ ] `npx tsc --noEmit` passes
- [ ] Interface is importable from `'./services/scheduler'`

**Phase 2 Commit:**
```bash
git add -A && git commit -m "DI Phase 2: Create SchedulerSubordinateFactory interface"
```
- [ ] Committed

---

## Phase 3: Implement Subordinate Factory

### Step 3.1: Create Factory Implementation
- [ ] Created `src/services/scheduler/createSubordinateFactory.ts`
- [ ] Defined `FactoryDependencies` interface
- [ ] Implemented `createSubordinateFactory` function
- [ ] **Phase 1 services (independent):**
  - [ ] ViewportFactoryService
  - [ ] GridNavigationController
  - [ ] DependencyValidationService
  - [ ] TestDataGenerator
- [ ] **Phase 2 services (cross-dependent with forward refs):**
  - [ ] Declared `let _viewStateService` and `let _columnPreferencesService`
  - [ ] Created ColumnPreferencesService with forward ref
  - [ ] Assigned `_columnPreferencesService`
  - [ ] Created ViewStateService with forward ref
  - [ ] Assigned `_viewStateService`
- [ ] **Phase 3 services (depend on Phase 2):**
  - [ ] TaskOperationsService (uses `_viewStateService`)
  - [ ] ContextMenuService
  - [ ] ModalCoordinator (uses `_viewStateService`)
  - [ ] FileOperationsService
  - [ ] BaselineService (uses `_columnPreferencesService`)
  - [ ] TradePartnerService
  - [ ] KeyboardBindingService
- [ ] **Phase 4 post-init:**
  - [ ] Called `modalCoordinator.initialize(ctx.modalContainer)`
- [ ] Returns complete `SubordinateServicesBundle`

### Step 3.2: Export from Index
- [ ] Added `createSubordinateFactory` export
- [ ] Added `FactoryDependencies` type export

**Phase 3 Gate:**
- [ ] `npx tsc --noEmit` passes
- [ ] Factory function is importable

**Phase 3 Commit:**
```bash
git add -A && git commit -m "DI Phase 3: Implement createSubordinateFactory"
```
- [ ] Committed

---

## Phase 4: Update main.ts - Create Factory

### Step 4.1: Add Factory Import
- [ ] Added import for `createSubordinateFactory`

### Step 4.2: Create Factory Instance
- [ ] Created `subordinateFactory` using `createSubordinateFactory`
- [ ] Passed all required dependencies:
  - [ ] projectController
  - [ ] selectionModel
  - [ ] editingStateManager
  - [ ] commandService
  - [ ] columnRegistry
  - [ ] viewCoordinator
  - [ ] toastService
  - [ ] fileService
  - [ ] tradePartnerStore
  - [ ] persistenceService
- [ ] Added console.log confirmation

### Step 4.3: Pass to AppInitializer
- [ ] Added `subordinateFactory` to AppInitializer constructor options

**Phase 4 Gate:**
- [ ] `npx tsc --noEmit` passes

**Phase 4 Commit:**
```bash
git add -A && git commit -m "DI Phase 4: Wire factory in main.ts"
```
- [ ] Committed

---

## Phase 5: Update AppInitializer

### Step 5.1: Update Options Interface
- [ ] Added import for `SchedulerSubordinateFactory` type
- [ ] Added `subordinateFactory?: SchedulerSubordinateFactory` to options

### Step 5.2: Store in Constructor
- [ ] Added `private subordinateFactory` property
- [ ] Assigned in constructor

### Step 5.3: Update _initializeScheduler
- [ ] Pass `toastService` to SchedulerService options
- [ ] Pass `fileService` to SchedulerService options
- [ ] Pass `subordinateFactory` to SchedulerService options
- [ ] Pass `editingStateManager` (required, no fallback)

**Phase 5 Gate:**
- [ ] `npx tsc --noEmit` passes

**Phase 5 Commit:**
```bash
git add -A && git commit -m "DI Phase 5: Update AppInitializer"
```
- [ ] Committed

---

## Phase 6: Update SchedulerService

> ⚠️ **CRITICAL: This is the highest-risk phase. Follow steps exactly.**

### Step 6.1: Update Options Interface
- [ ] Added imports for new types
- [ ] Updated `SchedulerServiceOptions` interface:
  - [ ] Required: projectController, selectionModel, commandService, editingStateManager
  - [ ] Required: schedulingLogicService, columnRegistry
  - [ ] Required: toastService, fileService, subordinateFactory
  - [ ] Optional (nullable): zoomController, tradePartnerStore, dataLoader, etc.

### Step 6.2: Update Constructor
- [ ] Removed ALL `|| Service.getInstance()` fallbacks
- [ ] Assigned required dependencies directly (fail fast)
- [ ] Assigned optional dependencies with `?? null`
- [ ] Added `subordinateFactory` property assignment

### Step 6.3: Remove Dead Code
- [ ] Removed `private drawer: SideDrawer | null = null;`
- [ ] Removed `import { SideDrawer } from '../ui/components/SideDrawer';`
- [ ] Removed `if (this.drawer) this.drawer.destroy();` from destroy()

### Step 6.4: Remove _initServices() Method
- [ ] Deleted entire `_initServices()` method
- [ ] Removed `this.initPromise` assignment in constructor
- [ ] Removed `await this.initPromise` in init()

### Step 6.5: Update init() - CRITICAL ORDERING
- [ ] **FIRST:** Container validation only (no service usage)
- [ ] **SECOND:** Call `factory.createAll()` with full context
- [ ] **THIRD:** Assign ALL 13 services to instance properties
- [ ] **FOURTH:** Now safe to call `_initializeColumnCSSVariables()`
- [ ] **FIFTH:** Now safe to call `_buildGridHeader()`
- [ ] Rest of init() unchanged (viewport, grid, gantt setup)

**Phase 6 Gate:**
- [ ] `npx tsc --noEmit` passes
- [ ] No runtime errors on import

**Phase 6 Commit:**
```bash
git add -A && git commit -m "DI Phase 6: Update SchedulerService to use factory"
```
- [ ] Committed

---

## Phase 7: Testing & Validation

### Step 7.1: Verify ToastService Export
- [ ] Checked `src/ui/services/index.ts` has no side-effect imports
- [ ] Checked no instantiation at module level

### Step 7.2: Compile Check
- [ ] `npx tsc --noEmit` passes with zero errors

### Step 7.3: Manual Smoke Test
- [ ] `npm run tauri dev` starts without errors
- [ ] App loads and displays grid/gantt
- [ ] **Test: Add task** - Works
- [ ] **Test: Delete task** - Works
- [ ] **Test: Indent/outdent** - Works
- [ ] **Test: Arrow key navigation** - Works
- [ ] **Test: Right-click context menu** - Works
- [ ] **Test: Dependencies modal** - Works
- [ ] **Test: Column settings** - Works
- [ ] **Test: File save** - Works
- [ ] **Test: File open** - Works
- [ ] **Test: Undo/redo** - Works
- [ ] **Test: Copy/paste** - Works

### Step 7.4: Integration Tests
- [ ] `npm run test:e2e` passes (if available)

**Phase 7 Commit:**
```bash
git add -A && git commit -m "DI Phase 7: Testing verified, cleanup complete"
```
- [ ] Committed

---

## Final Verification

- [ ] All phases completed
- [ ] All commits made
- [ ] No TypeScript errors
- [ ] Manual smoke tests pass
- [ ] Integration tests pass (if available)

**Final Status:** ⬜ Not Complete

---

## Execution Log

| Timestamp | Phase | Step | Action | Result |
|-----------|-------|------|--------|--------|
| | | | | |

---

## Rollback Commands (If Needed)

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Revert specific file to last commit
git checkout HEAD -- src/services/SchedulerService.ts

# View recent commits
git log --oneline -10
```
