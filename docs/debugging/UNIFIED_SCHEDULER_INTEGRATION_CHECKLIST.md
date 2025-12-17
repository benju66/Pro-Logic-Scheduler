# Unified Scheduler Integration Checklist

## Core Operations That Need to Work

### ✅ Already Implemented
- [x] `setData()` - Updates tasks in viewport
- [x] `setVisibleData()` - Filters visible tasks
- [x] `setSelection()` - Updates selection
- [x] `scrollToTask()` - Scrolls to specific task
- [x] `focusCell()` - Focuses a cell in grid
- [x] `refresh()` - Forces re-render
- [x] `updateRow()` - Updates single row
- [x] `updateGridColumns()` - Updates column definitions
- [x] `setViewMode()` - Changes gantt view mode
- [x] `getData()` - Returns current tasks
- [x] `destroy()` - Cleanup

### 🔧 Needs Testing/Fixing

#### 1. Clear All Button
**Issue**: Not clearing properly
**Flow**:
- `clearTasks()` → `scheduler.tasks = []` → `tasks` setter → `render()`
- `render()` → `grid.setData([])` → `viewport.setData([])`
- `viewport.setData([])` should update scroll height to 0

**Potential Issues**:
- Scroll height might not be updating correctly
- Scroll position might not be reset
- Empty state might not be rendering

#### 2. Add Task
**Flow**:
- `addTask()` → adds to `taskStore` → `render()`
- Should appear in both grid and gantt

#### 3. Delete Task
**Flow**:
- `deleteTask()` → removes from `taskStore` → `render()`
- Should update both grid and gantt

#### 4. Update Task
**Flow**:
- `_handleCellChange()` → updates `taskStore` → `updateRow()` or `render()`
- Should update specific row or full render

#### 5. Selection
**Flow**:
- `_handleRowClick()` → `setSelection()` → `viewport.setSelection()`
- Should update both grid and gantt selection

#### 6. Collapse/Expand
**Flow**:
- `toggleCollapse()` → updates `_collapsed` → `setVisibleData()`
- Should filter visible tasks

#### 7. Column Updates
**Flow**:
- `updateColumnPreferences()` → `_rebuildGridColumns()` → `grid.updateColumns()`
- Should update grid renderer columns

#### 8. View Mode Changes
**Flow**:
- `setViewMode()` → `gantt.setViewMode()`
- Should update gantt renderer

## Integration Points to Verify

### SchedulerService → Viewport
1. ✅ Tasks setter calls `render()`
2. ✅ `render()` calls `grid.setData()` and `gantt.setData()`
3. ✅ Facades delegate to viewport correctly
4. ⚠️ Need to verify empty array handling

### Viewport → Renderers
1. ✅ `setData()` updates both renderers
2. ✅ `setSelection()` updates both renderers
3. ✅ Scroll sync works
4. ⚠️ Need to verify empty state rendering

### TaskStore → Viewport
1. ⚠️ TaskStore changes don't automatically trigger viewport updates
2. ⚠️ Need to ensure `render()` is called after store changes

## Fixes Needed

### 1. Clear All Button
- Ensure scroll height resets to 0
- Ensure scroll position resets to 0
- Ensure empty state renders correctly

### 2. TaskStore Integration
- Consider adding observer pattern or ensuring render() is called after changes
- Or ensure all TaskStore mutations trigger render()

### 3. Empty State Handling
- Verify viewport handles empty arrays correctly
- Verify scroll content height is 0 when no tasks
- Verify renderers show empty state

## Testing Checklist

- [ ] Clear All button clears tasks and resets view
- [ ] Add Task adds task and shows in both grid and gantt
- [ ] Delete Task removes task from both grid and gantt
- [ ] Update Task updates row in grid and bar in gantt
- [ ] Selection works in both grid and gantt
- [ ] Collapse/Expand filters visible tasks
- [ ] Column updates refresh grid
- [ ] View mode changes update gantt
- [ ] Scroll sync works vertically
- [ ] Horizontal scroll works independently
- [ ] Keyboard navigation works
- [ ] Drag and drop works (if implemented)

