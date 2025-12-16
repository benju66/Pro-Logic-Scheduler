# Phase 6 Preparation: SchedulerService Migration

## Overview

**Phase 6** involves migrating the largest and most complex file: **SchedulerService.js** (2,387 lines).

This is the main orchestrator that coordinates all services, components, and business logic.

## File Analysis

### SchedulerService.js
- **Size:** 2,387 lines
- **Complexity:** Very High
- **Dependencies:** ALL modules (core, data, ui/services, ui/components)
- **Responsibilities:**
  - Orchestrates all services and components
  - Manages selection and focus state
  - Coordinates CPM calculations
  - Routes user actions to appropriate handlers
  - Maintains view synchronization
  - Handles clipboard operations (copy/cut/paste)
  - Manages undo/redo via HistoryManager
  - Coordinates file operations
  - Handles keyboard shortcuts

## Key Patterns Identified

### 1. Service Initialization
```javascript
_initServices() {
    this.taskStore = new TaskStore({ onChange: () => this._onTasksChanged() });
    this.calendarStore = new CalendarStore({ onChange: () => this._onCalendarChanged() });
    this.historyManager = new HistoryManager({ maxHistory: 50 });
    this.toastService = new ToastService({ container: document.body });
    this.fileService = new FileService({ isTauri: this.isTauri, onToast: ... });
}
```

**TypeScript Challenge:** All services are already typed, so this should be straightforward.

### 2. Component Initialization
```javascript
this.grid = new VirtualScrollGrid(gridContainer, {
    columns: this._getColumnDefinitions(),
    isParent: (id) => this.taskStore.isParent(id),
    getDepth: (id) => this.taskStore.getDepth(id),
    onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
    // ... many callbacks
});
```

**TypeScript Challenge:** All components are already typed. Callback functions need proper typing.

### 3. Event Handlers
```javascript
_handleRowClick(taskId, e) { ... }
_handleCellChange(taskId, field, value) { ... }
_handleBarDrag(task, start, end) { ... }
```

**TypeScript Challenge:** Need to type all event handlers with proper MouseEvent, KeyboardEvent types.

### 4. CPM Integration
```javascript
recalculateAll() {
    const result = CPM.calculate(this.taskStore.getAll(), this.calendarStore.get());
    // Update tasks with CPM results
}
```

**TypeScript Challenge:** CPM is already typed, should be straightforward.

### 5. Clipboard Operations
```javascript
copySelected() {
    this.clipboard = payloadArray.map(t => JSON.parse(JSON.stringify(t)));
    this.clipboardOriginalIds = payloadArray.map(t => t.id);
}
```

**TypeScript Challenge:** Need to type clipboard as `Task[] | null`.

### 6. Selection Management
```javascript
this.selectedIds = new Set();
this.focusedId = null;
this.anchorId = null;
```

**TypeScript Challenge:** Already using Set<string>, should be straightforward.

### 7. Window Globals (Backward Compatibility)
```javascript
window.scheduler = this;
```

**TypeScript Challenge:** Already handled in `globals.d.ts`.

## Critical Methods to Type

### Core Methods
1. `init()` - Initializes all components
2. `recalculateAll()` - Runs CPM calculation
3. `render()` - Updates UI components
4. `saveData()` / `loadData()` - Persistence
5. `_getColumnDefinitions()` - Returns GridColumn[]
6. `_getFlatList()` - Returns Task[] (visible tasks)

### Event Handlers
1. `_handleRowClick()` - MouseEvent handling
2. `_handleCellChange()` - Field updates with CPM logic
3. `_handleBarDrag()` - Task date updates
4. `_handleRowMove()` - Drag-and-drop reordering
5. `_handleDrawerUpdate()` - Side drawer updates
6. `_handleDependenciesSave()` - Dependency modal save
7. `_handleCalendarSave()` - Calendar modal save

### Clipboard Operations
1. `copySelected()` - Copy to clipboard
2. `cutSelected()` - Cut to clipboard
3. `paste()` - Paste from clipboard

### Task Management
1. `addTask()` - Create new task
2. `deleteTask()` - Delete task
3. `updateTask()` - Update task
4. `indent()` / `outdent()` - Hierarchy changes
5. `toggleCollapse()` - Expand/collapse parent tasks

### File Operations
1. `exportToJSON()` - Export to JSON
2. `importFromJSON()` - Import from JSON
3. `exportToMSProjectXML()` - Export to XML
4. `importFromMSProjectXML()` - Import from XML

## TypeScript Challenges

### 1. Callback Function Typing
**Challenge:** Many callbacks passed to components need proper typing.

**Solution:** Use function types from component interfaces:
```typescript
onRowClick: (taskId: string, event: MouseEvent) => void;
onCellChange: (taskId: string, field: string, value: unknown) => void;
```

### 2. Dynamic Property Access
**Challenge:** Some code may access task properties dynamically.

**Solution:** Use `getTaskFieldValue` helper or explicit type assertions.

### 3. Window Globals
**Challenge:** `window.scheduler = this` for backward compatibility.

**Solution:** Already handled in `globals.d.ts`.

### 4. Complex State Management
**Challenge:** Multiple state variables (selectedIds, focusedId, clipboard, etc.).

**Solution:** Type each explicitly:
```typescript
private selectedIds: Set<string> = new Set();
private focusedId: string | null = null;
private clipboard: Task[] | null = null;
private clipboardIsCut: boolean = false;
private clipboardOriginalIds: string[] = [];
```

### 5. Component Nullability
**Challenge:** Components initialized in `init()`, may be null before.

**Solution:** Use definite assignment assertions or null checks:
```typescript
private grid!: VirtualScrollGrid; // Initialized in init()
// OR
if (!this.grid) return; // Guard checks
```

### 6. Date String Handling
**Challenge:** Dates stored as ISO strings, need conversion.

**Solution:** Use DateUtils methods which are already typed.

## Migration Strategy

### Step 1: Create TypeScript File
- Copy structure from JS file
- Add all imports with proper types
- Type all class properties

### Step 2: Type Constructor and Initialization
- Type `options` parameter
- Type all service initializations
- Type component initializations

### Step 3: Type Event Handlers
- Type all `_handle*` methods
- Type all callback functions
- Ensure MouseEvent, KeyboardEvent types

### Step 4: Type Business Logic
- Type CPM integration
- Type clipboard operations
- Type selection management
- Type file operations

### Step 5: Type Public API
- Type all public methods
- Type return types
- Type parameters

### Step 6: Fix Type Errors
- Address any type narrowing issues
- Fix null checks
- Handle optional properties

### Step 7: Update Imports
- Update imports in dependent files
- Update main.js import

## Dependencies Already Migrated ✅

All dependencies are already in TypeScript:
- ✅ `core/CPM.ts`
- ✅ `core/DateUtils.ts`
- ✅ `core/Constants.ts`
- ✅ `data/TaskStore.ts`
- ✅ `data/CalendarStore.ts`
- ✅ `data/HistoryManager.ts`
- ✅ `ui/services/ToastService.ts`
- ✅ `ui/services/FileService.ts`
- ✅ `ui/services/KeyboardService.ts`
- ✅ `services/SyncService.ts`
- ✅ `ui/components/VirtualScrollGrid.ts`
- ✅ `ui/components/CanvasGantt.ts`
- ✅ `ui/components/SideDrawer.ts`
- ✅ `ui/components/DependenciesModal.ts`
- ✅ `ui/components/CalendarModal.ts`

## Estimated Complexity

- **Lines of Code:** 2,387
- **Methods:** ~100+ methods
- **Complexity:** Very High
- **Estimated Time:** 2-3 hours
- **Confidence:** 90%

## Risk Assessment

### High Risk Areas
1. **Event Handler Typing** - Many callbacks, need careful typing
2. **State Management** - Complex state with multiple Set/Map/Array structures
3. **Component Lifecycle** - Components initialized in `init()`, null before
4. **CPM Integration** - Complex date calculations and task updates

### Medium Risk Areas
1. **Clipboard Operations** - Deep cloning and ID mapping
2. **File Operations** - Async operations with error handling
3. **Selection Management** - Complex selection logic with anchor/focus

### Low Risk Areas
1. **Service Initialization** - All services already typed
2. **Component Initialization** - All components already typed
3. **Simple Utilities** - Helper methods should be straightforward

## Success Criteria

1. ✅ All TypeScript errors resolved
2. ✅ Build succeeds
3. ✅ All imports updated
4. ✅ No runtime errors
5. ✅ All methods properly typed
6. ✅ Event handlers correctly typed

## Next Steps After Phase 6

**Phase 7: Additional Services** (after SchedulerService)
- UIEventManager.ts (700 lines)
- StatsService.ts (102 lines)
- AppInitializer.ts (206 lines)

**Phase 8: Main Entry Point**
- main.ts (190 lines)

## Ready to Proceed?

**Status:** ✅ **READY**

All dependencies are migrated. SchedulerService is the orchestrator that ties everything together. The migration will be complex but manageable with careful typing of:
- Event handlers
- Callback functions
- State management
- Component lifecycle

**Confidence Level:** 90%

The remaining 10% accounts for:
- Complex event handler typing
- Edge cases in state management
- Component nullability handling

But these are all manageable with the patterns established in previous phases.
