# UIEventCoordinator Interaction Diagram

## Overview

The `UIEventCoordinator` replaces the scattered event handlers in `SchedulerService` with a centralized, predictable event routing system.

---

## Current State (Legacy)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SchedulerService                                   │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │GridRenderer │  │GanttRenderer│  │KeyboardSvc  │  │UIEventMgr   │        │
│  │  onClick    │  │  onClick    │  │  onKeyDown  │  │  onAction   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         │  ┌─────────────┴────────────────┴────────────────┘               │
│         │  │                                                               │
│         ▼  ▼                                                               │
│  ┌──────────────────────────────────────────────────────────┐              │
│  │           _handleRowClick()                              │◄── 1693-1776 │
│  │           _handleCellChange()                            │◄── 2343-2389 │
│  │           _handleAction()                                │◄── 2451-2487 │
│  │           _handleArrowNavigation()                       │◄── 2808-2900 │
│  │           _handleCellNavigation()                        │◄── 2900-3000 │
│  │           _handleTabIndent()                             │◄── 3000-3050 │
│  │           _handleTabOutdent()                            │◄── 3050-3118 │
│  │           _showRowContextMenu()                          │◄── 3680-3761 │
│  └──────────────────────────────────────────────────────────┘              │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────┐              │
│  │           Direct State Mutations                          │              │
│  │           - this.selectedIds.add(id)                      │              │
│  │           - this.focusedId = id                           │              │
│  │           - ProjectController.updateTask()                │              │
│  │           - this.render()                                 │              │
│  └──────────────────────────────────────────────────────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Problems:**
1. Event handlers scattered throughout 6,500+ line file
2. Direct state mutations bypass reactive architecture
3. No clear event flow - hard to debug
4. Selection state duplicated (SchedulerService + SelectionModel)
5. `render()` called manually, can be missed

---

## Target State (New Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UI Components                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │GridRenderer │  │GanttRenderer│  │KeyboardSvc  │  │ContextMenu  │        │
│  │  onClick    │  │  onClick    │  │  onKeyDown  │  │  onSelect   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                                   ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        UIEventCoordinator                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │                    Event Router                               │    │  │
│  │  │  - rowClick → SelectionModel.select() + focus()              │    │  │
│  │  │  - cellChange → SchedulingLogicService.applyEdit()           │    │  │
│  │  │  - action → TaskOperationService.{add/delete/indent}()       │    │  │
│  │  │  - navigation → SelectionModel.moveFocus()                   │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  │                                   │                                   │  │
│  │                                   ▼                                   │  │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────┐    │  │
│  │  │  SelectionModel   │  │SchedulingLogicSvc │  │TaskOperationSvc│    │  │
│  │  │  (via state$)     │  │  (via controller) │  │(via controller)│    │  │
│  │  └─────────┬─────────┘  └─────────┬─────────┘  └───────┬────────┘    │  │
│  │            │                      │                    │             │  │
│  └────────────┼──────────────────────┼────────────────────┼─────────────┘  │
│               │                      │                    │                │
│               ▼                      ▼                    ▼                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      ProjectController                                │  │
│  │  - tasks$ (BehaviorSubject)                                          │  │
│  │  - selection updates → SelectionModel.state$                         │  │
│  │  - task updates → tasks$ emission                                    │  │
│  └───────────────────────────────────────┬──────────────────────────────┘  │
│                                          │                                  │
│                                          ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       ViewCoordinator                                 │  │
│  │  - Subscribes to tasks$, selection$                                  │  │
│  │  - Batches DOM updates via requestAnimationFrame                     │  │
│  │  - Updates Grid and Gantt automatically                              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**
1. Single entry point for all UI events
2. Clear, predictable event flow
3. Selection state in SelectionModel (single source of truth)
4. Automatic UI updates via ViewCoordinator subscriptions
5. Easier to test and debug

---

## Event Flow Details

### 1. Row Click Flow

```
User clicks row
       │
       ▼
GridRenderer.onClick(taskId, event)
       │
       ▼
UIEventCoordinator.handleRowClick(taskId, {
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    field: 'name'
})
       │
       ├─── ctrlKey? → SelectionModel.select(taskId, multi=true)
       │
       ├─── shiftKey? → SelectionModel.select(taskId, range=true, taskOrder)
       │
       └─── else → SelectionModel.select(taskId)
                          │
                          ▼
                   SelectionModel.state$ emits
                          │
                          ▼
                   ViewCoordinator subscription
                          │
                          ▼
                   Grid.setSelection(selectedIds, focusedId)
                   Gantt.setSelection(selectedIds)
```

### 2. Cell Change Flow

```
User edits cell and commits (blur/Enter)
       │
       ▼
GridRenderer.onCellChange(taskId, field, value)
       │
       ▼
UIEventCoordinator.handleCellChange(taskId, field, value)
       │
       ▼
HistoryManager.saveCheckpoint()
       │
       ▼
SchedulingLogicService.applyEdit(taskId, field, value, context)
       │
       ├─── Validates input
       │
       ├─── Applies business rules (scheduling triangle, driver mode)
       │
       └─── ProjectController.updateTask(taskId, updates)
                          │
                          ▼
                   ProjectController.tasks$ emits
                          │
                          ▼
                   ViewCoordinator subscription
                          │
                          ▼
                   Grid.data = visibleTasks
                   Grid.render()
                   Gantt.data = visibleTasks
                   Gantt.render()
```

### 3. Keyboard Navigation Flow

```
User presses Arrow Down
       │
       ▼
KeyboardService.onKeyDown('ArrowDown')
       │
       ▼
UIEventCoordinator.handleNavigation('down', {
    ctrlKey: false,
    shiftKey: false
})
       │
       ▼
Calculate next taskId from current focusedId
       │
       ├─── shiftKey? → SelectionModel.select(nextId, range=true)
       │
       └─── else → SelectionModel.setFocus(nextId)
                          │
                          ▼
                   SelectionModel.state$ emits
                          │
                          ▼
                   ViewCoordinator subscription
                          │
                          ▼
                   Grid scrolls to focused row
                   Selection highlight updates
```

### 4. Action Button Flow

```
User clicks "Delete" button
       │
       ▼
GridRenderer.onAction(taskId, 'delete')
       │
       ▼
UIEventCoordinator.handleAction(taskId, 'delete')
       │
       ▼
HistoryManager.saveCheckpoint()
       │
       ▼
TaskOperationService.deleteTask(taskId)
       │
       ▼
ProjectController.deleteTask(taskId)
       │
       ▼
ProjectController.tasks$ emits (minus deleted task)
       │
       ▼
ViewCoordinator subscription
       │
       ▼
UI updates automatically
```

---

## Method Migration Map

| Legacy Method | New Service | Notes |
|---------------|-------------|-------|
| `_handleRowClick()` | `UIEventCoordinator.handleRowClick()` | Delegates to SelectionModel |
| `_handleCellChange()` | `UIEventCoordinator.handleCellChange()` | Delegates to SchedulingLogicService |
| `_handleAction()` | `UIEventCoordinator.handleAction()` | Routes to TaskOperationService |
| `_handleArrowNavigation()` | `UIEventCoordinator.handleNavigation()` | Delegates to SelectionModel |
| `_handleCellNavigation()` | `UIEventCoordinator.handleCellNavigation()` | Tab/Enter handling |
| `_handleTabIndent()` | `TaskOperationService.indent()` | Direct delegation |
| `_handleTabOutdent()` | `TaskOperationService.outdent()` | Direct delegation |
| `_showRowContextMenu()` | `UIEventCoordinator.showContextMenu()` | Creates menu items |
| `_handleSelectionChange()` | **REMOVED** | Handled by ViewCoordinator subscription |
| `_updateSelection()` | **REMOVED** | Handled by ViewCoordinator subscription |

---

## Implementation Checklist

### Phase 1: Create UIEventCoordinator Shell
- [ ] Create `src/services/migration/UIEventCoordinator.ts`
- [ ] Define event handler signatures
- [ ] Wire to feature flag `USE_UI_EVENT_COORDINATOR`

### Phase 2: Migrate Selection Events
- [ ] `handleRowClick()` - route to SelectionModel
- [ ] `handleNavigation()` - arrow key handling
- [ ] `handleCellNavigation()` - Tab/Enter handling

### Phase 3: Migrate Action Events
- [ ] `handleAction()` - button click routing
- [ ] `showContextMenu()` - context menu creation

### Phase 4: Migrate Edit Events
- [ ] `handleCellChange()` - route to SchedulingLogicService

### Phase 5: Cleanup
- [ ] Remove legacy handlers from SchedulerService
- [ ] Update GridRenderer to call UIEventCoordinator
- [ ] Update KeyboardService to call UIEventCoordinator

---

## Testing Strategy

### Unit Tests (UIEventCoordinator)
- Test each handler in isolation
- Mock SelectionModel, SchedulingLogicService, TaskOperationService
- Verify correct routing and parameter passing

### Integration Tests
- Test full event flow from UI component to state update
- Verify ViewCoordinator receives updates
- Verify UI components receive updated state

### Parity Tests
- Compare legacy handler output with new coordinator output
- Run both paths, compare state after each operation

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Event timing changes | Selection feels laggy | Benchmark before/after, optimize critical path |
| Missing edge cases | Features break | Comprehensive test coverage |
| Memory leaks | Performance degrades | Proper subscription cleanup in dispose() |
| Callback ordering | Race conditions | Use RxJS operators (switchMap, debounce) |
