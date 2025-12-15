# TypeScript Migration Playbook

**Purpose:** Specific typing patterns and solutions for common code patterns found in the codebase.

## Dependency Order Verification

### Phase 2: Core Modules (No dependencies on other project files)
```
Constants.ts          ← No imports from project
DateUtils.ts          ← Only imports Constants.ts (already migrated)
CPM.ts                ← Imports DateUtils.ts, Constants.ts (both migrated)
```

### Phase 3: Data Stores (Only depend on core)
```
TaskStore.ts          ← No imports from project
CalendarStore.ts      ← Imports Constants.ts
HistoryManager.ts     ← No imports from project
```

### Phase 4: UI Services (Depend on types, may depend on data stores)
```
ToastService.ts       ← No imports from project
FileService.ts        ← Imports types only
KeyboardService.ts    ← No imports from project
SyncService.ts        ← No imports from project (uses interfaces)
```

### Phase 5: UI Components (Depend on types, may depend on services)
```
SideDrawer.ts         ← Imports types only
DependenciesModal.ts  ← Imports Constants.ts
CalendarModal.ts      ← Imports types only
VirtualScrollGrid.ts  ← Imports types only
CanvasGantt.ts        ← Imports types only
```

### Phase 6: Services (Depend on everything above)
```
UIEventManager.ts     ← Imports SchedulerService (not yet migrated)
StatsService.ts       ← Imports SchedulerService (not yet migrated)
AppInitializer.ts     ← Imports SchedulerService, StatsService
```

### Phase 7: Orchestration (Depends on everything)
```
SchedulerService.ts   ← Imports ALL modules
main.ts               ← Imports SchedulerService, AppInitializer, UIEventManager
```

**Note:** UIEventManager, StatsService, and AppInitializer depend on SchedulerService, so they should be migrated AFTER SchedulerService, not before. This is a correction to the original plan.

---

## Typing Patterns Playbook

### Pattern 1: Dynamic Property Access (`task[col.field]`)

**Location:** `VirtualScrollGrid._bindCellData()`

**Problem:**
```typescript
const value = task[col.field]; // Error: col.field might be 'checkbox'
```

**Solution:**
```typescript
// Helper function
function getTaskFieldValue(task: Task, field: GridColumn['field']): unknown {
  if (field === 'checkbox') return undefined;
  return task[field as keyof Task];
}

// Usage
const value = getTaskFieldValue(task, col.field) ?? '';
```

**Alternative (simpler but less safe):**
```typescript
const value = col.field === 'checkbox' 
  ? undefined 
  : task[col.field as keyof Task] ?? '';
```

---

### Pattern 2: DOM Element Queries

**Location:** Throughout UI components

**Problem:**
```typescript
const element = document.getElementById('id'); // Element | null
element.value = 'test'; // Error: Element might not have 'value'
```

**Solution:**
```typescript
// Option 1: Type assertion (when you know the type)
const input = document.getElementById('input-id') as HTMLInputElement;
if (!input) throw new Error('Input not found');
input.value = 'test';

// Option 2: Type guard
function isHTMLInputElement(el: Element | null): el is HTMLInputElement {
  return el !== null && el instanceof HTMLInputElement;
}

const element = document.getElementById('input-id');
if (isHTMLInputElement(element)) {
  element.value = 'test';
}
```

---

### Pattern 3: Event Handlers

**Location:** All components with event listeners

**Problem:**
```typescript
element.addEventListener('click', (e) => {
  // e is Event, but we need MouseEvent
});
```

**Solution:**
```typescript
// Use specific event types
element.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  // ...
});

element.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    // ...
  }
});
```

---

### Pattern 4: Optional Chaining with Null Checks

**Location:** Throughout codebase

**Problem:**
```typescript
const task = tasks.find(t => t.id === id);
task.name = 'New'; // Error: task might be undefined
```

**Solution:**
```typescript
// Option 1: Early return
const task = tasks.find(t => t.id === id);
if (!task) return;
task.name = 'New'; // Safe

// Option 2: Optional chaining (for reads)
const name = tasks.find(t => t.id === id)?.name ?? 'Unknown';

// Option 3: Type guard
function findTaskById(tasks: Task[], id: string): Task | undefined {
  return tasks.find((t): t is Task => t.id === id);
}
```

---

### Pattern 5: Object.assign Updates

**Location:** `TaskStore.update()`, `SchedulerService.recalculateAll()`

**Problem:**
```typescript
Object.assign(task, updates); // TypeScript needs to know updates shape
```

**Solution:**
```typescript
update(id: string, updates: Partial<Task>): Task | undefined {
  const task = this.getById(id);
  if (!task) return undefined;
  Object.assign(task, updates); // TypeScript knows updates is Partial<Task>
  this._notifyChange();
  return task;
}
```

---

### Pattern 6: Array Methods with Type Guards

**Location:** Throughout codebase

**Problem:**
```typescript
const children = tasks.filter(t => t.parentId === id);
// TypeScript knows children is Task[], but we could be more explicit
```

**Solution:**
```typescript
// Type guard for better type narrowing
const children = tasks.filter((t): t is Task => t.parentId === id);

// Or explicit return type
function getChildren(tasks: Task[], parentId: string): Task[] {
  return tasks.filter(t => t.parentId === parentId);
}
```

---

### Pattern 7: Callback Functions

**Location:** Component options, store callbacks

**Problem:**
```typescript
onChange: () => void; // Too generic
```

**Solution:**
```typescript
// Use specific callback types
export type Callback<T = void> = (value: T) => void;

interface TaskStoreOptions {
  onChange?: Callback<Task[]>;
}

// Usage
constructor(options: TaskStoreOptions = {}) {
  this.options = options;
}

// Call
this.options.onChange?.(this.tasks);
```

---

### Pattern 8: Window Globals

**Location:** `main.ts`, `UIEventManager.ts`

**Problem:**
```typescript
window.scheduler = scheduler; // Error: scheduler not on Window type
```

**Solution:**
```typescript
// In src/types/globals.d.ts
declare global {
  interface Window {
    scheduler?: SchedulerService;
    uiEventManager?: UIEventManager;
    // ... other globals
  }
}

export {}; // Make this a module
```

---

### Pattern 9: Tauri Dynamic Imports

**Location:** `AppInitializer._setupTauriAPIs()`

**Problem:**
```typescript
const { open, save } = await import('@tauri-apps/api/dialog');
window.tauriDialog = { open, save }; // Error: tauriDialog not on Window
```

**Solution:**
```typescript
// In src/types/globals.d.ts
declare global {
  interface Window {
    tauriDialog?: {
      open: (options?: unknown) => Promise<string | null>;
      save: (options?: unknown) => Promise<string | null>;
    };
    tauriFs?: {
      readTextFile: (path: string) => Promise<string>;
      writeTextFile: (path: string, contents: string) => Promise<void>;
    };
  }
}

// In AppInitializer.ts
private async _setupTauriAPIs(): Promise<void> {
  try {
    const { open, save } = await import('@tauri-apps/api/dialog');
    window.tauriDialog = { open, save };
  } catch (e) {
    console.warn('Failed to load Tauri dialog API:', e);
  }
}
```

---

### Pattern 10: Canvas Rendering Context

**Location:** `CanvasGantt.ts`

**Problem:**
```typescript
const ctx = canvas.getContext('2d'); // CanvasRenderingContext2D | null
```

**Solution:**
```typescript
private canvas: HTMLCanvasElement;
private ctx: CanvasRenderingContext2D;

constructor(options: CanvasGanttOptions) {
  this.canvas = document.createElement('canvas');
  const context = this.canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context not available');
  }
  this.ctx = context;
}
```

---

### Pattern 11: Dataset Access

**Location:** Event handlers throughout

**Problem:**
```typescript
const taskId = element.dataset.taskId; // string | undefined
```

**Solution:**
```typescript
// Option 1: Null check
const taskId = element.dataset.taskId;
if (!taskId) return;

// Option 2: Assertion (when you know it exists)
const taskId = element.dataset.taskId!; // Non-null assertion

// Option 3: Helper
function getTaskId(element: HTMLElement): string | null {
  return element.dataset.taskId ?? null;
}
```

---

### Pattern 12: Class Static Properties

**Location:** `VirtualScrollGrid.COLUMN_TYPES`, `CanvasGantt.VIEW_MODES`

**Problem:**
```typescript
static COLUMN_TYPES = { ... }; // Type inference might not be strict enough
```

**Solution:**
```typescript
// Use 'as const' for readonly
static readonly COLUMN_TYPES = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  // ...
} as const;

// Or explicit type
type ColumnType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'readonly' | 'actions' | 'drag';

static readonly COLUMN_TYPES: Record<string, ColumnType> = {
  TEXT: 'text',
  // ...
};
```

---

## Validation Checklist Per Phase

### After Each File Migration:

- [ ] File renamed `.js` → `.ts`
- [ ] All imports updated (remove `.js` extensions or add `.ts`)
- [ ] No TypeScript errors (`tsc --noEmit`)
- [ ] App still runs (`npm run tauri:dev`)
- [ ] Related functionality still works
- [ ] No runtime errors in console

### After Phase 1 (Config):
- [ ] `tsconfig.json` created and valid
- [ ] `vite.config.ts` works (build succeeds)
- [ ] `src/types/index.ts` created with correct Task interface
- [ ] `src/types/globals.d.ts` created
- [ ] `vitest.config.ts` updated
- [ ] `npm run build` succeeds
- [ ] `npm run test` still works

### After Phase 2 (Core):
- [ ] Constants.ts - all exports typed
- [ ] DateUtils.ts - all methods typed, exports preserved
- [ ] CPM.ts - complex but typed correctly
- [ ] CPM tests still pass

### After Phase 3 (Data):
- [ ] TaskStore.ts - CRUD operations typed
- [ ] CalendarStore.ts - calendar operations typed
- [ ] HistoryManager.ts - undo/redo typed
- [ ] Undo/redo functionality works

### After Phase 4 (UI Services):
- [ ] ToastService.ts - notifications work
- [ ] FileService.ts - save/load works
- [ ] KeyboardService.ts - shortcuts work
- [ ] SyncService.ts - scroll sync works

### After Phase 5 (UI Components):
- [ ] SideDrawer.ts - drawer opens/closes
- [ ] DependenciesModal.ts - modal works
- [ ] CalendarModal.ts - modal works
- [ ] VirtualScrollGrid.ts - grid renders, editing works
- [ ] CanvasGantt.ts - Gantt renders, interactions work

### After Phase 6 (Services):
- [ ] UIEventManager.ts - all buttons work
- [ ] StatsService.ts - stats update
- [ ] AppInitializer.ts - app initializes correctly

### After Phase 7 (Orchestration):
- [ ] SchedulerService.ts - all methods work
- [ ] main.ts - app starts correctly
- [ ] Full integration test passes

### After Phase 8 (Tests):
- [ ] All test files migrated
- [ ] All tests pass
- [ ] Test coverage maintained

---

## Common Pitfalls & Solutions

### Pitfall 1: Forgetting to Remove `.js` Extensions

**Problem:** TypeScript might complain about `.js` imports in `.ts` files

**Solution:** 
- Option A: Remove extensions (TypeScript will resolve)
- Option B: Keep extensions (Vite handles it)
- **Recommendation:** Remove extensions for cleaner imports

### Pitfall 2: Type Assertions Overuse

**Problem:** Using `as` everywhere defeats type safety

**Solution:** Use type guards and proper narrowing instead

### Pitfall 3: Not Testing After Each File

**Problem:** Errors compound, harder to debug

**Solution:** Test after EVERY file migration

### Pitfall 4: Ignoring `strictNullChecks`

**Problem:** Missing null checks cause runtime errors

**Solution:** Always check for null/undefined before use

### Pitfall 5: Not Updating Related Files

**Problem:** Importing a migrated file from non-migrated file causes issues

**Solution:** Follow dependency order strictly

---

## Quick Reference: Type Definitions

### Task Interface (Corrected)
```typescript
export interface Task {
  id: string;
  name: string;
  wbs?: string; // Optional, not used
  level: number;
  start: string;
  end: string;
  duration: number;
  dependencies: Dependency[];
  constraintType: ConstraintType;
  constraintDate: string | null;
  notes: string;
  parentId: string | null; // ADDED
  progress: number; // ADDED
  
  // Calculated fields
  _isCritical?: boolean;
  _totalFloat?: number;
  _freeFloat?: number;
  _collapsed?: boolean;
  _earlyStart?: string;
  _earlyFinish?: string;
  lateStart?: string | null; // FIXED (was _lateStart)
  lateFinish?: string | null; // FIXED (was _lateFinish)
  totalFloat?: number; // ADDED
  freeFloat?: number; // ADDED
}
```

---

## Migration Command Reference

```bash
# Check for TypeScript errors (no build)
npx tsc --noEmit

# Build the project
npm run build

# Run in dev mode
npm run tauri:dev

# Run tests
npm run test

# Run specific test file
npm run test tests/unit/CPM.test.ts
```

---

## Success Metrics

Migration is successful when:

1. ✅ Zero TypeScript errors (`tsc --noEmit`)
2. ✅ App runs without errors (`npm run tauri:dev`)
3. ✅ All tests pass (`npm run test`)
4. ✅ All functionality works identically
5. ✅ No `any` types (except truly dynamic cases)
6. ✅ Build succeeds (`npm run build`)
