# Phase 2 Preparation - Cell-Level Change Detection

## Overview

**Phase 2 Goal**: Implement cell-level change detection to update only changed cells instead of all cells in a row.

**Expected Impact**: 50-70% reduction in unnecessary DOM updates during single-field edits.

**Confidence Level**: 85% (Medium risk - requires careful hash design)

---

## Current State Analysis

### Current Implementation (Row-Level Hashing)

**Location**: `_bindRowData()` method (line ~1263)

**Current Behavior**:
- Row-level hash: If ANY field changes, ALL cells update
- Example: Edit task name → 12+ cells update unnecessarily

**Hash Function**: `_getRowHash()` (line ~1249)
```typescript
private _getRowHash(task: Task, meta: CellMeta, isSelected: boolean): string {
    return `${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}|${isSelected}`;
}
```

**Problem**: Hash includes ALL fields, so ANY change triggers ALL cell updates.

---

## Target State (Cell-Level Hashing)

### New Architecture

**Data Structure**:
```typescript
// Store cell hashes per row
private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();
// Format: row element -> Map<fieldName, hashString>
```

**New Method**: `_getCellHash(task, col, meta, isSelected)`
- Returns hash string specific to cell type
- Includes ONLY dependencies for that cell

**Modified Method**: `_bindRowData()`
- Check cell-level hashes before calling `_bindCellData()`
- Only update cells whose hash changed
- Always update if row is being edited (bypass hash check)

---

## Complete Cell Type Analysis

### 1. Standard Input Cells
**Fields**: `name`, `duration`, `notes`, `progress`, `wbs`, `level`, etc.
**Dependencies**:
- Field value: `getTaskFieldValue(task, col.field)`
- Readonly state: `col.editable === false || (col.readonlyForParent && meta.isParent)`

**Hash**: `${value}|${readonly}`

**Example**:
- `duration`: `${task.duration}|${readonly}`
- `notes`: `${task.notes}|${readonly}`

---

### 2. Name Cell (`col.field === 'name'`)
**Dependencies**:
- `task.name` (input value)
- `meta.depth` (indent padding - affects `_bindNameCell()`)
- `meta.isParent` (collapse button visibility)
- `meta.isCollapsed` (chevron direction)

**Hash**: `${task.name}|${meta.depth}|${meta.isParent}|${meta.isCollapsed}`

**Special Handling**: Calls `_bindNameCell()` which handles indent and collapse button

---

### 3. Start Date Cell (`col.field === 'start'`)
**Dependencies**:
- `task.start` (input value)
- `task.constraintType` (icon visibility - affects `_bindConstraintIcon()`)
- `task.constraintDate` (icon tooltip)
- `meta.isParent` (readonly state)

**Hash**: `${task.start}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`

**Special Handling**: Calls `_bindConstraintIcon()` if `col.showConstraintIcon === true`

---

### 4. End Date Cell (`col.field === 'end'`)
**Dependencies**:
- `task.end` (input value)
- `task.constraintType` (icon visibility)
- `task.constraintDate` (icon tooltip)
- `meta.isParent` (readonly state)

**Hash**: `${task.end}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`

**Special Handling**: Calls `_bindConstraintIcon()` if `col.showConstraintIcon === true`

---

### 5. Checkbox Cell (`col.field === 'checkbox'`)
**Dependencies**:
- Selection state only: `this.selectedIds.has(task.id)`

**Hash**: `${isSelected}`

**Special**: Reflects selection, not task data

---

### 6. Row Number Cell (`col.field === 'rowNum'`)
**Dependencies**:
- `meta.index` only

**Hash**: `${meta.index}`

**Special**: Uses custom renderer: `(_task, meta) => meta.index + 1`

---

### 7. Health Cell (`col.field === '_health'`)
**Dependencies**:
- `task._health` object (status, icon, summary)

**Hash**: `${task._health?.status || ''}|${task._health?.icon || ''}|${task._health?.summary || ''}`

**Special**: Uses custom renderer that accesses `task._health`

---

### 8. Start Variance Cell (`col.field === 'startVariance'`)
**Dependencies**: Computed from multiple fields
- `task.start` (fallback if no actualStart)
- `task.baselineStart` (baseline date)
- `task.actualStart` (actual date, or start as fallback)

**Hash**: `${task.start}|${task.baselineStart || ''}|${task.actualStart || ''}`

**Special**: Uses custom renderer that calls `_calculateVariance(task)`

**Variance Calculation** (from `SchedulerService._calculateVariance`):
```typescript
const compareStart = task.actualStart || task.start;
if (task.baselineStart && compareStart) {
    startVariance = DateUtils.calcWorkDaysDifference(compareStart, task.baselineStart, calendar);
}
```

---

### 9. Finish Variance Cell (`col.field === 'finishVariance'`)
**Dependencies**: Computed from multiple fields
- `task.end` (fallback if no actualFinish)
- `task.baselineFinish` (baseline date)
- `task.actualFinish` (actual date, or end as fallback)

**Hash**: `${task.end}|${task.baselineFinish || ''}|${task.actualFinish || ''}`

**Special**: Uses custom renderer that calls `_calculateVariance(task)`

---

### 10. Actions Cell (`col.type === 'actions'`)
**Dependencies**: **COMPLEX** - Conservative approach needed
- Entire `task` object (actions may check any property)
- `meta` object (`showIf` functions use it)
- `col.actions` array (if dynamic)

**Current State**: No `showIf` functions in use (verified via grep)

**Hash (Conservative)**: `${task.id}|${task.name}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`

**Special**: Calls `_bindActionsCell()` which iterates actions and checks `showIf`

**Note**: Conservative hashing - includes common fields that `showIf` might check. If `showIf` functions are added later that check other fields, hash will need to be updated.

---

### 11. Custom Renderer Cells (`col.renderer` exists)
**Dependencies**: **UNKNOWN** - Depends on renderer implementation

**Current Renderers**:
1. **rowNum**: Only uses `meta.index` ✅ Simple
2. **health**: Uses `task._health` ✅ Known (handled separately)
3. **startVariance/finishVariance**: Uses `_calculateVariance(task)` ✅ Known (handled separately)

**Hash (Conservative)**: Include all commonly used fields
```typescript
`${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${task._health?.status || ''}|${meta.index}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`
```

**Strategy**: Conservative hashing for future-proofing. If a renderer uses fields not in hash, cell will update unnecessarily (safe but not optimal).

---

### 12. Drag Handle Cell (`col.type === 'drag'`)
**Dependencies**: None (static UI element)

**Hash**: `''` (empty - never changes)

**Special**: Static element, never needs updating

---

## Hash Function Design

### Complete `_getCellHash()` Implementation

```typescript
/**
 * Generate a hash for a specific cell to detect changes
 * @private
 * @param task - The task data
 * @param col - Column definition
 * @param meta - Cell metadata
 * @param isSelected - Whether task is selected
 * @returns Hash string
 */
private _getCellHash(
    task: Task, 
    col: GridColumn, 
    meta: CellMeta, 
    isSelected: boolean
): string {
    const field = col.field;
    
    // Special cells
    if (field === 'checkbox') {
        return String(isSelected);
    }
    
    if (field === 'drag') {
        return ''; // Never changes
    }
    
    if (field === 'rowNum') {
        return String(meta.index);
    }
    
    // Name cell - complex dependencies
    if (field === 'name') {
        return `${task.name}|${meta.depth}|${meta.isParent}|${meta.isCollapsed}`;
    }
    
    // Start/End cells - include constraint info
    if (field === 'start' || field === 'end') {
        const value = getTaskFieldValue(task, field);
        const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
        return `${value}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`;
    }
    
    // Variance cells - include all source fields
    if (field === 'startVariance') {
        return `${task.start}|${task.baselineStart || ''}|${task.actualStart || ''}`;
    }
    if (field === 'finishVariance') {
        return `${task.end}|${task.baselineFinish || ''}|${task.actualFinish || ''}`;
    }
    
    // Health cell
    if (field === '_health') {
        const health = task._health;
        return `${health?.status || ''}|${health?.icon || ''}|${health?.summary || ''}`;
    }
    
    // Actions cell - CONSERVATIVE: include common fields
    // (since showIf functions could check anything)
    if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS) {
        return `${task.id}|${task.name}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`;
    }
    
    // Custom renderer - CONSERVATIVE: include all common fields
    if (col.renderer) {
        // Check if it's a known renderer first
        // rowNum is handled above, health is handled above, variance is handled above
        // For unknown renderers, be conservative
        return `${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${task._health?.status || ''}|${meta.index}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`;
    }
    
    // Standard cells - field value + readonly state
    const value = getTaskFieldValue(task, field);
    const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
    return `${value}|${readonly}`;
}
```

---

## Implementation Steps

### Step 1: Add Cell Hash Storage
**Location**: Class properties section (after `_rowHashes`)

**Code**:
```typescript
// Change detection: Store row hashes to skip unnecessary updates
private _rowHashes = new WeakMap<HTMLElement, string>();  // Row element -> hash string

// Cell-level change detection: Store cell hashes per row
private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();  // Row element -> Map<fieldName, hashString>
```

---

### Step 2: Implement `_getCellHash()` Method
**Location**: After `_getRowHash()` method (around line ~1252)

**Code**: See hash function design above

**Testing**: Unit test each cell type hash generation

---

### Step 3: Modify `_bindRowData()` to Use Cell-Level Hashing
**Location**: `_bindRowData()` method (line ~1263)

**Current Code** (cell update loop):
```typescript
this.options.columns?.forEach(col => {
    // ... get cell ...
    this._bindCellData(cell, col, task, meta, cache);
});
```

**New Code**:
```typescript
// Get or create cell hash map for this row
let cellHashes = this._cellHashes.get(row);
if (!cellHashes) {
    cellHashes = new Map();
    this._cellHashes.set(row, cellHashes);
}

// Update each cell with change detection
this.options.columns?.forEach(col => {
    // Use cached cell reference if available, fallback to querySelector
    let cell: HTMLElement | null = null;
    if (cache) {
        cell = cache.cells.get(col.field) || null;
    }
    
    // Fallback to querySelector if cache not available (backward compatibility)
    if (!cell) {
        cell = row.querySelector(`[data-field="${col.field}"]`) as HTMLElement | null;
    }
    
    if (!cell) return;
    
    // Cell-level change detection
    const cellHash = this._getCellHash(task, col, meta, isSelected);
    const oldCellHash = cellHashes.get(col.field);
    
    // Always update if:
    // 1. Hash doesn't match (data changed)
    // 2. Row is being edited (must update to preserve editing state)
    // 3. No hash exists (first render)
    const shouldUpdateCell = cellHash !== oldCellHash || this.editingRows.has(task.id) || oldCellHash === undefined;
    
    if (shouldUpdateCell) {
        this._bindCellData(cell, col, task, meta, cache);
        cellHashes.set(col.field, cellHash);
    }
});
```

---

### Step 4: Clear Cell Hashes on Data Changes
**Location**: `setData()` and `setVisibleData()` methods

**Current Code**:
```typescript
setData(tasks: Task[]): void {
    this.allData = tasks;
    this.data = tasks;
    this._rowHashes = new WeakMap();
    this._measure();
    this._updateVisibleRows();
}
```

**New Code**:
```typescript
setData(tasks: Task[]): void {
    this.allData = tasks;
    this.data = tasks;
    // Clear row and cell hashes when data changes (invalidate change detection cache)
    this._rowHashes = new WeakMap();
    this._cellHashes = new WeakMap();
    this._measure();
    this._updateVisibleRows();
}
```

**Same change for**: `setVisibleData()`

---

## Edge Cases & Special Handling

### 1. Row Being Edited
**Issue**: If row is being edited, we must update all cells to preserve editing state.

**Solution**: Always bypass hash check if `this.editingRows.has(task.id)`

**Code**: Already included in `shouldUpdateCell` check

---

### 2. First Render
**Issue**: No hash exists for new rows.

**Solution**: Always update if `oldCellHash === undefined`

**Code**: Already included in `shouldUpdateCell` check

---

### 3. Column Order Change
**Issue**: Columns might be reordered, but hashes are field-based.

**Solution**: Field-based hashing (not position-based) - hashes preserved correctly

**Verification**: Test column reordering

---

### 4. Custom Renderer Dependencies
**Issue**: Unknown dependencies for custom renderers.

**Solution**: Conservative hashing - include all common fields. If renderer uses other fields, cell will update unnecessarily (safe but not optimal).

**Future Optimization**: Could analyze renderer code or provide dependency hints

---

### 5. Actions Column `showIf` Functions
**Issue**: `showIf` functions could check any task property.

**Current State**: No `showIf` functions in use (verified)

**Solution**: Conservative hashing - include common fields. If `showIf` functions are added later, hash may need updating.

**Future Optimization**: Could analyze `showIf` functions or provide dependency hints

---

### 6. Variance Calculation Dependencies
**Issue**: Variance depends on calendar (service property, not task property).

**Solution**: Calendar is service-level, not task-level - safe to ignore in hash. If calendar changes, data refresh will clear hashes.

**Verification**: Test calendar changes

---

## Testing Strategy

### Unit Tests (Per Cell Type)

1. **Standard Input Cells**
   - Edit value → only that cell updates
   - Change readonly state → cell updates
   - Edit other field → cell doesn't update

2. **Name Cell**
   - Edit name → only name cell updates
   - Change depth → name cell updates (indent)
   - Toggle collapse → name cell updates (chevron)
   - Edit other field → name cell doesn't update

3. **Start/End Date Cells**
   - Edit date → only date cell updates
   - Change constraint type → date cell updates (icon)
   - Change constraint date → date cell updates (icon tooltip)
   - Edit other field → date cell doesn't update

4. **Checkbox Cell**
   - Change selection → only checkbox updates
   - Edit task → checkbox doesn't update

5. **Variance Cells**
   - Edit start date → startVariance updates
   - Edit baselineStart → startVariance updates
   - Edit actualStart → startVariance updates
   - Edit other field → variance doesn't update

6. **Actions Cell**
   - Edit task name → actions cell updates (conservative)
   - Change parent state → actions cell updates
   - Edit other field → actions cell may or may not update (conservative)

7. **Custom Renderer Cells**
   - Edit dependencies → cell updates
   - Edit non-dependencies → cell may update (conservative)

---

### Integration Tests

1. **Edit Single Field**
   - Edit task name → verify only name cell updates
   - Edit duration → verify only duration cell updates
   - Edit start date → verify only start cell + constraint icon update

2. **Edit Multiple Fields**
   - Edit name + duration → verify both cells update
   - Edit start + end → verify both cells update

3. **Change Selection**
   - Select row → checkbox + row-selected class update
   - Deselect row → checkbox + row-selected class update

4. **Collapse/Expand**
   - Collapse parent → name cell updates (chevron)
   - Expand parent → name cell updates (chevron)

5. **Change Constraint**
   - Change constraint type → start/end cells update (icons)
   - Change constraint date → start/end cells update (tooltips)

6. **Rapid Scrolling**
   - Scroll rapidly → verify no visual glitches
   - Verify cells update correctly as they scroll into view

7. **Editing State**
   - Start editing → verify all cells update (bypass hash)
   - Stop editing → verify hash check resumes

---

### Performance Tests

1. **Measure DOM Updates**
   - Before: Edit name → 12+ cells update
   - After: Edit name → 1 cell updates
   - Expected: 50-70% reduction

2. **Measure Render Time**
   - Before: ~Xms for single field edit
   - After: ~Yms for single field edit
   - Expected: Significant improvement

3. **Frame Rate**
   - During rapid edits → should maintain 60fps
   - During scrolling → should maintain 60fps

---

## Risk Assessment

### High Risk Areas

1. **Hash Completeness**
   - **Risk**: Missing dependencies → cell won't update when it should
   - **Mitigation**: Conservative hashing, comprehensive testing
   - **Detection**: Visual testing, automated tests

2. **Custom Renderers**
   - **Risk**: Unknown dependencies → cell may not update
   - **Mitigation**: Conservative hashing (include all common fields)
   - **Detection**: Test all custom renderers

3. **Actions Column**
   - **Risk**: `showIf` functions check fields not in hash
   - **Mitigation**: Conservative hashing, monitor for issues
   - **Detection**: Test actions column thoroughly

### Medium Risk Areas

1. **Editing State**
   - **Risk**: Hash check might interfere with editing
   - **Mitigation**: Always bypass hash if row is being edited
   - **Detection**: Test editing functionality

2. **Data Refresh**
   - **Risk**: Hashes might not clear on data changes
   - **Mitigation**: Clear hashes in `setData()` and `setVisibleData()`
   - **Detection**: Test data refresh scenarios

### Low Risk Areas

1. **Memory Usage**
   - **Risk**: WeakMap + Map per row might use memory
   - **Mitigation**: WeakMap auto-cleans, Map is small (~100 bytes per row)
   - **Impact**: Minimal

2. **Hash Computation**
   - **Risk**: Hash computation might be slow
   - **Mitigation**: Simple string concatenation, very fast
   - **Impact**: Negligible

---

## Success Criteria

### Functional
- ✅ All cell types update correctly
- ✅ Single field edits → only that cell updates
- ✅ Multiple field edits → all affected cells update
- ✅ Selection changes → checkbox + row class update
- ✅ Collapse/expand → name cell updates
- ✅ Constraint changes → date cells update
- ✅ Editing state → all cells update (bypass hash)
- ✅ No visual glitches during rapid scrolling

### Performance
- ✅ 50-70% reduction in unnecessary cell updates
- ✅ Single field edit → 1 cell update instead of 12+
- ✅ Maintain 60fps during rapid edits
- ✅ Maintain 60fps during scrolling

### Code Quality
- ✅ Clean implementation
- ✅ Well-documented
- ✅ No linter errors
- ✅ Backward compatible

---

## Implementation Checklist

### Preparation
- [x] Review cell types and dependencies
- [x] Design hash function
- [x] Identify edge cases
- [x] Create testing strategy
- [x] Assess risks

### Implementation
- [ ] Add `_cellHashes` WeakMap
- [ ] Implement `_getCellHash()` method
- [ ] Modify `_bindRowData()` to use cell-level hashing
- [ ] Clear cell hashes in `setData()` and `setVisibleData()`
- [ ] Test each cell type
- [ ] Test edge cases
- [ ] Performance testing

### Testing
- [ ] Unit tests for each cell type
- [ ] Integration tests
- [ ] Performance tests
- [ ] Edge case tests
- [ ] Manual testing

---

## Next Steps

1. **Review this preparation document**
2. **Verify all dependencies are correct**
3. **Proceed with implementation**
4. **Test thoroughly**
5. **Measure performance improvements**

---

## Confidence Level

**85%** - Medium risk, but well-prepared with:
- ✅ Complete cell type analysis
- ✅ Comprehensive hash function design
- ✅ Edge case identification
- ✅ Testing strategy
- ✅ Risk mitigation

**Ready to proceed** ✅

