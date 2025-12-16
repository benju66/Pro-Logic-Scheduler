# Phase 2 Quick Reference Guide

## Implementation Checklist

### Step 1: Add Cell Hash Storage ✅
**Location**: After `_rowHashes` (line ~154)
```typescript
private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();
```

### Step 2: Implement `_getCellHash()` Method ✅
**Location**: After `_getRowHash()` (line ~1252)
- Handle all 12 cell types
- Include all dependencies per cell type
- Use conservative hashing for unknown dependencies

### Step 3: Modify `_bindRowData()` ✅
**Location**: `_bindRowData()` method (line ~1263)
- Get/create cell hash map
- Check cell hash before calling `_bindCellData()`
- Only update if hash changed or row is being edited

### Step 4: Clear Cell Hashes ✅
**Location**: `setData()` and `setVisibleData()` methods
- Clear `_cellHashes` WeakMap when data changes

---

## Cell Type Hash Reference

| Cell Type | Field | Hash Formula |
|-----------|-------|--------------|
| **Checkbox** | `checkbox` | `${isSelected}` |
| **Drag** | `drag` | `''` (empty) |
| **Row Number** | `rowNum` | `${meta.index}` |
| **Name** | `name` | `${task.name}\|${meta.depth}\|${meta.isParent}\|${meta.isCollapsed}` |
| **Start Date** | `start` | `${task.start}\|${task.constraintType}\|${task.constraintDate}\|${readonly}` |
| **End Date** | `end` | `${task.end}\|${task.constraintType}\|${task.constraintDate}\|${readonly}` |
| **Start Variance** | `startVariance` | `${task.start}\|${task.baselineStart}\|${task.actualStart}` |
| **Finish Variance** | `finishVariance` | `${task.end}\|${task.baselineFinish}\|${task.actualFinish}` |
| **Health** | `_health` | `${task._health?.status}\|${task._health?.icon}\|${task._health?.summary}` |
| **Actions** | `actions` | `${task.id}\|${task.name}\|${meta.isParent}\|${meta.depth}\|${meta.isCollapsed}` |
| **Custom Renderer** | Various | All common fields (conservative) |
| **Standard Input** | Others | `${value}\|${readonly}` |

---

## Key Dependencies

### Readonly State
```typescript
const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
```

### Special Cell Handlers
- **Name**: `_bindNameCell()` - handles indent + collapse button
- **Start/End**: `_bindConstraintIcon()` - handles constraint icons
- **Actions**: `_bindActionsCell()` - handles action buttons

---

## Testing Priorities

### Critical Tests
1. ✅ Edit name → only name cell updates
2. ✅ Edit start → only start cell + icon update
3. ✅ Change selection → checkbox + row class update
4. ✅ Collapse/expand → name cell updates
5. ✅ Edit duration → only duration cell updates

### Edge Cases
1. ✅ Row being edited → all cells update (bypass hash)
2. ✅ Data refresh → hashes cleared
3. ✅ Rapid scrolling → no glitches
4. ✅ Variance columns → update when source fields change

---

## Risk Mitigation

1. **Conservative Hashing**: Include more fields than necessary
2. **Editing Bypass**: Always update if row is being edited
3. **Comprehensive Testing**: Test all cell types
4. **Visual Verification**: Check for missed updates

---

## Expected Results

- **Single field edit**: 1 cell update instead of 12+
- **Performance**: 50-70% reduction in DOM updates
- **Frame rate**: Maintain 60fps during edits

---

## Ready to Implement ✅

All preparation complete. Proceed with implementation.

