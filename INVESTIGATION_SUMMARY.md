# Phase 1 & Phase 2 - Investigation Summary

## Executive Summary

**Investigation Complete**: ✅ All cell types, dependencies, and edge cases identified.

**Confidence Levels**:
- **Phase 1**: 95% confidence - Low risk, straightforward implementation
- **Phase 2**: 85% confidence - Medium risk, requires careful hash design and testing

**Key Findings**:
1. 11 distinct cell types identified with specific dependencies
2. Actions column currently has no `showIf` functions (conservative hashing safe)
3. Variance columns depend on 3 source fields each
4. Custom renderers require conservative hashing (unknown dependencies)
5. Readonly state affects multiple cell types

---

## Cell Type Analysis

### Complete Dependency Matrix

| Cell Type | Field | Dependencies | Hash Components |
|-----------|-------|--------------|-----------------|
| **Standard Input** | `name`, `duration`, `notes`, `progress`, etc. | Field value + readonly state | `${value}\|${readonly}` |
| **Name** | `name` | Value + depth + parent + collapsed | `${task.name}\|${meta.depth}\|${meta.isParent}\|${meta.isCollapsed}` |
| **Start Date** | `start` | Value + constraint type + constraint date + readonly | `${task.start}\|${task.constraintType}\|${task.constraintDate}\|${readonly}` |
| **End Date** | `end` | Value + constraint type + constraint date + readonly | `${task.end}\|${task.constraintType}\|${task.constraintDate}\|${readonly}` |
| **Checkbox** | `checkbox` | Selection state only | `${isSelected}` |
| **Row Number** | `rowNum` | Index only | `${meta.index}` |
| **Health** | `_health` | Health object (status, icon, summary) | `${task._health?.status}\|${task._health?.icon}\|${task._health?.summary}` |
| **Start Variance** | `startVariance` | Computed from 3 fields | `${task.start}\|${task.baselineStart}\|${task.actualStart}` |
| **Finish Variance** | `finishVariance` | Computed from 3 fields | `${task.end}\|${task.baselineFinish}\|${task.actualFinish}` |
| **Actions** | `actions` | Entire task object (conservative) | `${task.id}\|${task.name}\|${meta.isParent}\|${meta.depth}\|${meta.isCollapsed}` |
| **Custom Renderer** | Various | Unknown (conservative) | All common task fields + meta |
| **Drag Handle** | `drag` | None (static) | `''` (empty) |

---

## Critical Dependencies Identified

### 1. Name Cell (`col.field === 'name'`)
**Why Complex**: Handles indent, collapse button, and value
- `task.name` → Input value
- `meta.depth` → Padding-left (indent)
- `meta.isParent` → Collapse button visibility
- `meta.isCollapsed` → Chevron direction (right/down)

**Hash**: `${task.name}|${meta.depth}|${meta.isParent}|${meta.isCollapsed}`

### 2. Start/End Date Cells
**Why Complex**: Includes constraint icons
- Field value → Input value
- `task.constraintType` → Icon visibility (snet, snlt, fnet, fnlt, mfo)
- `task.constraintDate` → Icon tooltip
- `meta.isParent` → Readonly state

**Hash**: `${task[field]}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`

### 3. Variance Cells
**Why Complex**: Computed values from multiple sources
- `_calculateVariance()` uses:
  - `task.baselineStart/Finish` (baseline date)
  - `task.actualStart/Finish` (actual date, or `task.start/end` as fallback)
  - Calendar (service property, not task property - safe to ignore)

**Hash**: 
- Start: `${task.start}|${task.baselineStart || ''}|${task.actualStart || ''}`
- Finish: `${task.end}|${task.baselineFinish || ''}|${task.actualFinish || ''}`

### 4. Actions Column
**Why Complex**: `showIf` functions could check any task property
**Current State**: No `showIf` functions in use (verified via grep)
**Strategy**: Conservative hashing - include common fields
**Hash**: `${task.id}|${task.name}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`

### 5. Custom Renderers
**Why Complex**: Unknown dependencies
**Current Renderers**:
- `rowNum`: Only uses `meta.index` ✅ Simple
- `health`: Uses `task._health` ✅ Known
- `startVariance`/`finishVariance`: Uses `_calculateVariance(task)` ✅ Known

**Strategy**: Conservative hashing for future-proofing
**Hash**: Include all commonly used fields

---

## Readonly State Logic

**Formula**: `col.editable === false || (col.readonlyForParent && meta.isParent)`

**Affects**:
- All input cells (text, number, date, select)
- Must be included in hash for editable cells with `readonlyForParent: true`

**Examples**:
- `duration`, `start`, `end`, `constraintType` → `readonlyForParent: true`
- `name` → Always editable (no `readonlyForParent`)
- `checkbox` → Not affected (reflects selection, not task data)

---

## Phase 1 Implementation Details

### #4: Display Check Optimization
**File**: `VirtualScrollGrid.ts`
**Location**: `_recycleRows()` method (~line 1211)
**Change**: Add conditional before setting `display: flex`
**Risk**: Very Low
**Testing**: Verify rows show/hide correctly

### #3: Batch DOM Reads/Writes
**File**: `VirtualScrollGrid.ts`
**Location**: `_bindRowData()` method (~line 1259)
**Changes**:
1. Compute all values first (reads only)
2. Build className string instead of multiple `toggle()` calls
3. Use `dataset` instead of `setAttribute`
4. Batch all DOM writes together

**Risk**: Low
**Testing**: 
- Row classes (selected, parent, collapsed, critical)
- Selection state
- Parent/collapse states
- Critical path highlighting

---

## Phase 2 Implementation Details

### Architecture Changes

**New Data Structure**:
```typescript
// Cell-level hash storage
private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();
// Format: row element -> Map<fieldName, hashString>
```

**New Method**: `_getCellHash(task, col, meta, isSelected)`
- Returns hash string specific to cell type
- Includes all dependencies for that cell
- Handles all 11 cell types

**Modified Method**: `_bindRowData()`
- Check cell-level hashes before calling `_bindCellData()`
- Only update cells whose hash changed
- Always update if row is being edited (bypass hash check)

**Hash Invalidation**:
- Clear on `setData()` and `setVisibleData()`
- Preserved during scrolling (field-based, not position-based)

---

## Testing Strategy

### Phase 1 Testing
1. ✅ Display check: Rows show/hide correctly during scroll
2. ✅ Batch writes: All row classes update correctly
3. ✅ Selection: Row selection works
4. ✅ Parent/collapse: States update correctly
5. ✅ Critical path: Highlighting works

### Phase 2 Testing
**Functional Tests**:
1. ✅ Edit name → only name cell updates
2. ✅ Edit start → only start cell + icon update
3. ✅ Change selection → checkbox + row class update
4. ✅ Collapse/expand → name cell updates
5. ✅ Change constraint → start/end cells update
6. ✅ Edit duration → only duration cell updates
7. ✅ Change parent state → readonly cells update
8. ✅ Custom renderer → updates when dependencies change
9. ✅ Variance → updates when source fields change
10. ✅ Health → updates when health changes

**Performance Tests**:
1. Measure `_bindRowData` time before/after
2. Count DOM updates (should be 1 cell instead of 12+)
3. Monitor frame rates during rapid scrolling

**Edge Cases**:
1. Row being edited → all cells update (bypass hash)
2. Data refresh → hashes cleared
3. Column order change → hashes preserved
4. Rapid scrolling → no visual glitches

---

## Risk Assessment

### Phase 1 Risks
- **#4 Display Check**: Very Low - Simple conditional
- **#3 Batch Writes**: Low - Standard pattern, well-tested

### Phase 2 Risks
- **Hash Completeness**: Medium - Must include all dependencies
- **Custom Renderers**: Medium - Unknown dependencies
- **Actions Column**: Low - No `showIf` functions currently
- **Variance Columns**: Low - Dependencies known

### Mitigation Strategies
1. **Conservative Hashing**: Include more fields than necessary
2. **Editing Bypass**: Always update if row is being edited
3. **Comprehensive Testing**: Test all cell types thoroughly
4. **Debug Mode**: Optional logging for hash comparisons

---

## Implementation Order

1. **Phase 1.1**: Display check (#4) - 5 minutes
2. **Phase 1.2**: Batch DOM reads/writes (#3) - 30 minutes
3. **Test Phase 1**: Verify all functionality
4. **Phase 2.1**: Add cell hash storage + `_getCellHash()` method
5. **Phase 2.2**: Modify `_bindRowData()` to use cell-level hashing
6. **Phase 2.3**: Clear cell hashes on data changes
7. **Test Phase 2**: Comprehensive testing

---

## Expected Performance Improvements

### Phase 1
- **Display Check**: ~5% reduction in style recalculations
- **Batch Writes**: ~30-40% reduction in layout thrashing

### Phase 2
- **Cell-Level Hashing**: 50-70% reduction in unnecessary DOM updates
- **Single Field Edits**: 1 cell update instead of 12+
- **Overall Rendering**: 40-60% faster during edits and scrolling

---

## Notes

- **Memory**: WeakMap + Map per row is minimal overhead (~100 bytes per row)
- **Garbage Collection**: WeakMap automatically cleans up when rows are removed
- **Backward Compatibility**: All changes are internal, no API changes
- **Future Optimization**: Custom renderer hashing could be optimized if needed

---

## Ready for Implementation

✅ All cell types identified
✅ All dependencies mapped
✅ Hash functions designed
✅ Testing strategy defined
✅ Risk mitigation planned

**Status**: Ready to proceed with implementation

