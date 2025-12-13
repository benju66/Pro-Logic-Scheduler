# Migration Plan - AI-Friendly Architecture

## Status: In Progress

This document tracks the migration from the old structure to the new AI-friendly architecture.

## Completed ✅

1. ✅ Created directory structure (`core/`, `data/`, `ui/components/`, `ui/services/`, `services/`)
2. ✅ Created `ARCHITECTURE.md` documentation
3. ✅ Moved `CPM.js` → `core/CPM.js`
4. ✅ Moved `DateUtils.js` → `core/DateUtils.js`
5. ✅ Created `data/TaskStore.js`
6. ✅ Created `data/CalendarStore.js`
7. ✅ Created `data/HistoryManager.js`
8. ✅ Created `ui/services/ToastService.js`
9. ✅ Moved UI components to `ui/components/`:
   - `VirtualScrollGrid.js`
   - `CanvasGantt.js`
   - `SideDrawer.js`
   - `DependenciesModal.js`
   - `CalendarModal.js`

## In Progress 🔄

1. 🔄 Updating imports across all files
2. 🔄 Adding JSDoc module tags
3. 🔄 Refactoring `SchedulerEngine.js` → `services/SchedulerService.js`

## Pending ⏳

1. ⏳ Create `ui/services/FileService.js`
2. ⏳ Create `ui/services/KeyboardService.js`
3. ⏳ Create `services/SyncService.js`
4. ⏳ Refactor `main.js` to be minimal entry point
5. ⏳ Remove global `window` assignments
6. ⏳ Update all imports to use new paths
7. ⏳ Test application after migration
8. ⏳ Implement Phase 1: Stable input references (editing UX)

## Import Path Changes

### Old → New

```
./CPM.js → ./core/CPM.js
./DateUtils.js → ./core/DateUtils.js
./VirtualScrollGrid.js → ./ui/components/VirtualScrollGrid.js
./CanvasGantt.js → ./ui/components/CanvasGantt.js
./SideDrawer.js → ./ui/components/SideDrawer.js
./DependenciesModal.js → ./ui/components/DependenciesModal.js
./CalendarModal.js → ./ui/components/CalendarModal.js
./SchedulerEngine.js → ./services/SchedulerService.js (after refactor)
```

## Breaking Changes

### Global Window Assignments
**Old:**
```javascript
window.CanvasGantt = CanvasGantt;
window.VirtualScrollGrid = VirtualScrollGrid;
```

**New:**
- Remove all global assignments
- Use dependency injection instead
- Import directly where needed

### SchedulerEngine → SchedulerService
**Old:**
```javascript
import { SchedulerEngine } from './SchedulerEngine.js';
const scheduler = new SchedulerEngine(options);
```

**New:**
```javascript
import { SchedulerService } from './services/SchedulerService.js';
const scheduler = new SchedulerService(dependencies);
```

## Testing Checklist

After migration, verify:
- [ ] Application starts without errors
- [ ] Grid renders correctly
- [ ] Gantt renders correctly
- [ ] Task editing works
- [ ] Keyboard shortcuts work
- [ ] File operations work
- [ ] Undo/redo works
- [ ] Calendar modal works
- [ ] Dependencies modal works
- [ ] Side drawer works

## Rollback Plan

If issues arise:
1. Git commit before starting migration
2. Keep old files until migration complete
3. Can revert imports if needed

