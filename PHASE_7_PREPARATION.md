# Phase 7: Additional Services Migration - Preparation

## Overview
Migrate the remaining three service files from JavaScript to TypeScript:
1. **AppInitializer.js** (206 lines)
2. **StatsService.js** (103 lines)  
3. **UIEventManager.js** (701 lines)

## Files to Migrate

### 1. AppInitializer.js → AppInitializer.ts
**Size:** 206 lines  
**Complexity:** Medium  
**Dependencies:**
- ✅ `SchedulerService` (already migrated to TypeScript)
- ⚠️ `StatsService` (will be migrated in this phase)

**Key Responsibilities:**
- Application startup sequence
- Tauri API setup (dynamic imports)
- Scheduler initialization
- Stats service initialization
- Window global assignments (`window.scheduler`, `window.statsService`)

**TypeScript Challenges:**
- Window globals (`window.scheduler`, `window.statsService`, `window.tauriDialog`, `window.tauriFs`)
- Dynamic imports for Tauri APIs (`@tauri-apps/api/dialog`, `@tauri-apps/api/fs`)
- Nullable scheduler reference during initialization
- Promise-based async initialization

**Migration Strategy:**
1. Define `AppInitializerOptions` interface
2. Type all class properties
3. Handle window globals (check `globals.d.ts` or extend it)
4. Type async methods properly
5. Handle nullable scheduler with proper checks

---

### 2. StatsService.js → StatsService.ts
**Size:** 103 lines  
**Complexity:** Low  
**Dependencies:**
- ✅ `SchedulerService` (already migrated to TypeScript)

**Key Responsibilities:**
- Periodic stats updates (setInterval)
- DOM manipulation for stats bar
- Performance memory tracking
- Button count tracking

**TypeScript Challenges:**
- Function type for `getScheduler` callback
- Nullable scheduler reference
- DOM element access (may be null)
- `performance.memory` (non-standard, may not exist)

**Migration Strategy:**
1. Define `StatsServiceOptions` interface
2. Type `getScheduler` callback properly
3. Handle nullable DOM elements
4. Type interval ID (`number | null` or `NodeJS.Timeout | null`)
5. Handle optional `performance.memory` with type guards

---

### 3. UIEventManager.js → UIEventManager.ts
**Size:** 701 lines  
**Complexity:** High  
**Dependencies:**
- ✅ `SchedulerService` (already migrated to TypeScript)
- ✅ `ToastService` (already migrated to TypeScript)

**Key Responsibilities:**
- Pane resizer (between grid and Gantt)
- File input handlers
- Keyboard shortcuts (Ctrl+O, Ctrl+S)
- Column resizers with localStorage persistence
- Button click handlers (event delegation)
- Window functions (file operations, demo functions)
- Dropdown menu management

**TypeScript Challenges:**
- Extensive DOM manipulation
- Event handler typing (`MouseEvent`, `KeyboardEvent`, `Event`)
- Event delegation patterns
- Nullable DOM elements throughout
- localStorage typing
- Window global access (`window.scheduler`)
- Optional chaining for scheduler methods
- File input element typing (`HTMLInputElement`)
- Popup window handling (`window.open`)
- ⚠️ **Note:** Uses `scheduler.grid.refresh()` and `scheduler.gantt.refresh()` - verify these methods exist in TypeScript versions or replace with `render()`

**Migration Strategy:**
1. Define `UIEventManagerOptions` interface
2. Type all event handlers properly
3. Create helper types for DOM element access
4. Handle nullable elements with proper checks
5. Type localStorage operations
6. Type file input change events
7. Handle popup window typing

---

## Type Definitions Needed

### AppInitializerOptions
```typescript
export interface AppInitializerOptions {
  isTauri?: boolean;
}
```

### StatsServiceOptions
```typescript
export interface StatsServiceOptions {
  getScheduler?: () => SchedulerService | null;
}
```

### UIEventManagerOptions
```typescript
export interface UIEventManagerOptions {
  getScheduler?: () => SchedulerService | null;
  toastService?: ToastService | null;
  isTauri?: boolean;
}
```

## Window Globals

Need to ensure these are typed in `globals.d.ts`:
- `window.scheduler: SchedulerService | null`
- `window.statsService: StatsService | null`
- `window.tauriDialog: { open: Function; save: Function } | undefined`
- `window.tauriFs: { readTextFile: Function; writeTextFile: Function } | undefined`
- `window.uiEventManager: UIEventManager | null`

## Migration Order

1. **StatsService.ts** (simplest, no dependencies on other services)
2. **AppInitializer.ts** (depends on StatsService)
3. **UIEventManager.ts** (most complex, depends on both)

## Key Patterns to Follow

1. **Nullable Scheduler Access:**
   ```typescript
   const scheduler = this.getScheduler();
   if (!scheduler) return;
   // Use scheduler...
   ```

2. **DOM Element Access:**
   ```typescript
   const element = document.getElementById('id');
   if (!element) return;
   // Use element...
   ```

3. **Event Handler Typing:**
   ```typescript
   element.addEventListener('click', (e: MouseEvent) => {
     // Handle event
   });
   ```

4. **Optional Chaining:**
   ```typescript
   scheduler?.grid?.refresh();
   ```

5. **Type Guards for Optional APIs:**
   ```typescript
   if ('memory' in performance && performance.memory) {
     // Use performance.memory
   }
   ```

## Testing Checklist

After migration:
- [ ] App initializes correctly
- [ ] Stats bar updates periodically
- [ ] Pane resizer works
- [ ] Column resizers work
- [ ] File operations work (open, save, export, import)
- [ ] Button handlers work
- [ ] Keyboard shortcuts work (Ctrl+O, Ctrl+S)
- [ ] Dropdown menus work
- [ ] Window functions work
- [ ] Tauri APIs work (if in Tauri environment)

## Risk Assessment

**Low Risk:**
- StatsService (simple, isolated)

**Medium Risk:**
- AppInitializer (async initialization, window globals)

**High Risk:**
- UIEventManager (extensive DOM manipulation, event delegation, many edge cases)

## Success Criteria

1. All three files compile without TypeScript errors
2. All imports updated correctly
3. No runtime errors
4. All functionality preserved
5. Type safety improved throughout

## Next Steps

After Phase 7:
- Phase 8: Main Entry Point (`main.js` → `main.ts`)
