# Phase 1 & Phase 2 Implementation Plan

## Investigation Summary

### Cell Types and Dependencies

#### 1. **Standard Input Cells** (text, number, date, select)
- **Dependencies**: Field value only
- **Hash**: `task[col.field]`
- **Readonly State**: `col.editable === false || (col.readonlyForParent && meta.isParent)`
- **Examples**: `name`, `duration`, `start`, `end`, `constraintType`, `notes`, `progress`

#### 2. **Name Cell** (`col.field === 'name'`)
- **Dependencies**:
  - `task.name` (value)
  - `meta.depth` (indent padding)
  - `meta.isParent` (collapse button visibility)
  - `meta.isCollapsed` (chevron direction)
- **Hash**: `${task.name}|${meta.depth}|${meta.isParent}|${meta.isCollapsed}`
- **Special**: Calls `_bindNameCell()` which handles indent and collapse button

#### 3. **Start/End Date Cells** (`col.field === 'start' || 'end'`)
- **Dependencies**:
  - Field value: `task.start` or `task.end`
  - `task.constraintType` (icon visibility)
  - `task.constraintDate` (icon tooltip)
  - `meta.isParent` (readonly state)
- **Hash**: `${task[col.field]}|${task.constraintType}|${task.constraintDate || ''}|${meta.isParent}`
- **Special**: Calls `_bindConstraintIcon()` if `col.showConstraintIcon === true`

#### 4. **Checkbox Cell** (`col.field === 'checkbox'`)
- **Dependencies**: Selection state only
- **Hash**: `${this.selectedIds.has(task.id)}`
- **Special**: Reflects selection, not task data

#### 5. **Row Number Cell** (`col.field === 'rowNum'`)
- **Dependencies**: `meta.index` only
- **Hash**: `${meta.index}`
- **Special**: Uses custom renderer: `(_task, meta) => meta.index + 1`

#### 6. **Health Cell** (`col.field === '_health'`)
- **Dependencies**: `task._health` object
- **Hash**: `${task._health?.status}|${task._health?.icon}|${task._health?.summary}`
- **Special**: Uses custom renderer that accesses `task._health`

#### 7. **Variance Cells** (`col.field === 'startVariance' || 'finishVariance'`)
- **Dependencies**: Computed from multiple fields
  - `task.start` or `task.end`
  - `task.baselineStart` or `task.baselineFinish`
  - `task.actualStart` or `task.actualFinish`
- **Hash**: `${task.start}|${task.baselineStart}|${task.actualStart}` (or end equivalents)
- **Special**: Uses custom renderer that calls `_calculateVariance(task)`

#### 8. **Actions Cell** (`col.type === 'actions'`)
- **Dependencies**: 
  - Entire `task` object (actions may check any property)
  - `meta` object (showIf functions use it)
  - `col.actions` array (if dynamic)
- **Hash**: **COMPLEX** - Must include all task fields that any `showIf` function might check
- **Special**: Calls `_bindActionsCell()` which iterates actions and checks `showIf`

#### 9. **Custom Renderer Cells** (`col.renderer` exists)
- **Dependencies**: **UNKNOWN** - Depends on renderer implementation
- **Hash**: **CONSERVATIVE** - Include all commonly used task fields
- **Special**: Renderer can access any `task` property or `meta` property

#### 10. **Drag Handle Cell** (`col.type === 'drag'`)
- **Dependencies**: None (static UI element)
- **Hash**: `''` (empty - never changes)

#### 11. **Readonly Display Cells** (no input, just text)
- **Dependencies**: Field value only
- **Hash**: `task[col.field]`

### Critical Findings

1. **Actions Column**: No `showIf` functions currently used in codebase, but API supports it. Must be conservative.

2. **Custom Renderers**: 
   - `rowNum`: Only uses `meta.index`
   - `health`: Uses `task._health`
   - `startVariance`/`finishVariance`: Uses computed values from `_calculateVariance(task)`

3. **Readonly State**: Affects input cells - must include in hash for editable cells with `readonlyForParent`

4. **Variance Calculation**: Need to check `_calculateVariance` to see exact dependencies

## Phase 1: Quick Wins

### #4: Display Check Optimization
**Location**: `_recycleRows()` method (line ~1211)

**Current Code**:
```typescript
row.style.display = 'flex';
this._bindRowData(row, task, dataIndex);
```

**Change**:
```typescript
if (row.style.display === 'none') {
    row.style.display = 'flex';
}
this._bindRowData(row, task, dataIndex);
```

**Risk**: Very Low
**Testing**: Verify rows show/hide correctly during scrolling

---

### #3: Batch DOM Reads/Writes
**Location**: `_bindRowData()` method (line ~1259)

**Current Pattern**: Interleaved reads/writes
```typescript
row.setAttribute('data-task-id', task.id);      // Write
row.setAttribute('data-index', String(index));  // Write
row.classList.toggle('row-selected', isSelected); // Read+Write
row.classList.toggle('is-parent', isParent);     // Read+Write
// ... then cell updates
```

**New Pattern**: Batch all reads, then all writes
```typescript
// PHASE 1: Compute everything (reads only)
const isParent = this.options.isParent ? this.options.isParent(task.id) : false;
const depth = this.options.getDepth ? this.options.getDepth(task.id) : 0;
const isCollapsed = task._collapsed || false;
const isSelected = this.selectedIds.has(task.id);
const isCritical = task._isCritical || false;
const meta: CellMeta = { isParent, depth, isCollapsed, index };

// Hash check (no DOM access)
const newHash = this._getRowHash(task, meta, isSelected);
const oldHash = this._rowHashes.get(row);
const shouldUpdate = oldHash !== newHash || this.editingRows.has(task.id) || oldHash === undefined;

if (!shouldUpdate) return;

// PHASE 2: All writes together (single reflow)
row.dataset.taskId = task.id;
row.dataset.index = String(index);

// Build className string (more efficient than multiple toggle calls)
const classes = ['vsg-row', 'grid-row'];
if (isSelected) classes.push('row-selected');
if (isParent) classes.push('is-parent');
if (isCollapsed) classes.push('is-collapsed');
if (isCritical) classes.push('is-critical');
row.className = classes.join(' ');

// Cell updates...
```

**Risk**: Low
**Testing**: 
- Verify row classes update correctly
- Verify selection state works
- Verify parent/collapse states work
- Verify critical path highlighting works

---

## Phase 2: Cell-Level Change Detection

### Architecture

**New Data Structure**:
```typescript
// Store cell hashes per row
private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();
// Format: row element -> Map<fieldName, hash>
```

**New Method**: `_getCellHash(task, col, meta, isSelected)`
- Returns hash string specific to cell type
- Includes all dependencies for that cell

**Modified Method**: `_bindRowData()`
- Check cell-level hashes before calling `_bindCellData()`
- Only update cells whose hash changed

### Hash Function Design

```typescript
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
        const readonly = col.readonlyForParent && meta.isParent;
        return `${value}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`;
    }
    
    // Variance cells - include all source fields
    // Variance calculation uses: baselineStart/Finish, actualStart/Finish (or start/end as fallback)
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
    
    // Actions cell - CONSERVATIVE: include all task fields
    // (since showIf functions could check anything)
    if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS) {
        // Include all commonly checked fields
        return `${task.id}|${task.name}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`;
        // Note: If showIf functions exist, they might check other fields
        // This is conservative but safe
    }
    
    // Custom renderer - CONSERVATIVE: include all common fields
    if (col.renderer) {
        // Include all fields that renderers typically use
        return `${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${task._health?.status || ''}|${meta.index}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`;
    }
    
    // Standard cells - field value + readonly state
    const value = getTaskFieldValue(task, field);
    const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
    return `${value}|${readonly}`;
}
```

### Implementation Steps

1. **Add cell hash storage**
   ```typescript
   private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();
   ```

2. **Implement `_getCellHash()` method**
   - Handle all cell types
   - Include all dependencies

3. **Modify `_bindRowData()`**
   ```typescript
   // Get or create cell hash map for this row
   let cellHashes = this._cellHashes.get(row);
   if (!cellHashes) {
       cellHashes = new Map();
       this._cellHashes.set(row, cellHashes);
   }
   
   // Update each cell with change detection
   this.options.columns?.forEach(col => {
       const cell = cache?.cells.get(col.field);
       if (!cell) return;
       
       const cellHash = this._getCellHash(task, col, meta, isSelected);
       const oldCellHash = cellHashes.get(col.field);
       
       if (cellHash !== oldCellHash || this.editingRows.has(task.id)) {
           this._bindCellData(cell, col, task, meta, cache);
           cellHashes.set(col.field, cellHash);
       }
   });
   ```

4. **Clear cell hashes on data change**
   ```typescript
   setData(tasks: Task[]): void {
       this.allData = tasks;
       this.data = tasks;
       this._rowHashes = new WeakMap();
       this._cellHashes = new WeakMap(); // Clear cell hashes too
       this._measure();
       this._updateVisibleRows();
   }
   ```

### Testing Requirements

**Functional Tests**:
1. ✅ Edit name → only name cell updates
2. ✅ Edit start date → only start cell + constraint icon update
3. ✅ Change selection → checkbox + row-selected class update
4. ✅ Collapse/expand → name cell (indent/chevron) updates
5. ✅ Change constraint type → start/end cells update
6. ✅ Edit duration → only duration cell updates
7. ✅ Change parent state → readonly cells update
8. ✅ Custom renderer → cell updates when dependencies change
9. ✅ Variance columns → update when source fields change
10. ✅ Health column → updates when health changes

**Performance Tests**:
1. Measure `_bindRowData` time before/after
2. Count DOM updates (should be 1 cell instead of 12+)
3. Monitor frame rates during rapid scrolling

**Edge Cases**:
1. Row being edited → all cells should update (bypass hash check)
2. Data refresh → all hashes cleared
3. Column order change → hashes preserved (field-based)
4. Rapid scrolling → no visual glitches

### Risk Mitigation

1. **Conservative Hashing**: Include more fields than necessary rather than missing updates
2. **Editing Bypass**: Always update cells if row is being edited
3. **Debug Mode**: Add flag to log hash comparisons (optional)
4. **Fallback**: If hash matches but cell looks wrong, force update

---

## Implementation Order

1. **Phase 1.1**: Display check (#4) - 5 minutes
2. **Phase 1.2**: Batch DOM reads/writes (#3) - 30 minutes
3. **Test Phase 1**: Verify all row states work correctly
4. **Phase 2.1**: Add cell hash storage and `_getCellHash()` method
5. **Phase 2.2**: Modify `_bindRowData()` to use cell-level hashing
6. **Phase 2.3**: Clear cell hashes on data changes
7. **Test Phase 2**: Comprehensive testing of all cell types

---

## Notes

- **Actions Column**: Currently no `showIf` functions in codebase, but API supports it. Hash includes common fields.
- **Custom Renderers**: Conservative approach - include all commonly used fields. Could be optimized later if needed.
- **Variance Columns**: Need to verify `_calculateVariance` dependencies before finalizing hash.
- **Memory**: WeakMap + Map per row is minimal overhead, automatically garbage collected.

