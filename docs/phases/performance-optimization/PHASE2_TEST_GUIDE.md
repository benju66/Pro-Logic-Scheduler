# Phase 2 Testing Guide - Cell-Level Change Detection

## Overview

Phase 2 implements cell-level change detection to update only changed cells instead of all cells in a row.

**Expected Impact**: 50-70% reduction in unnecessary DOM updates during single-field edits.

---

## Quick Start

### 1. Start the Application
```bash
npm run dev
# or
npm run tauri:dev
```

### 2. Open Browser Console
- **Chrome/Edge**: F12 or Ctrl+Shift+I (Windows) / Cmd+Option+I (Mac)
- **Firefox**: F12 or Ctrl+Shift+K (Windows) / Cmd+Option+K (Mac)

### 3. Run Test Script
Copy and paste `PHASE2_TEST_SCRIPT.js` into the console, or run:
```javascript
fetch('./PHASE2_TEST_SCRIPT.js').then(r => r.text()).then(eval);
```

---

## Manual Testing Checklist

### ✅ Test 1: Single Field Edit - Name
**Goal**: Verify only name cell updates when editing name

**Steps**:
1. Double-click a task name cell
2. Edit the name (e.g., change "Task 1" to "Task 1 Updated")
3. Press Enter to save

**Expected**:
- ✅ Only name cell updates
- ✅ Other cells (duration, start, end, etc.) do NOT update
- ✅ No visual glitches

**How to Verify**:
- Open Chrome DevTools → Elements tab
- Inspect the row
- Watch cell elements during edit
- Only name cell should change

---

### ✅ Test 2: Single Field Edit - Duration
**Goal**: Verify only duration cell updates when editing duration

**Steps**:
1. Click a duration cell
2. Change the value (e.g., change "5" to "10")
3. Press Enter or click away

**Expected**:
- ✅ Only duration cell updates
- ✅ Other cells do NOT update
- ✅ No visual glitches

---

### ✅ Test 3: Single Field Edit - Start Date
**Goal**: Verify only start cell + constraint icon update

**Steps**:
1. Click a start date cell
2. Change the date
3. Press Enter or click away

**Expected**:
- ✅ Only start cell updates
- ✅ Constraint icon updates (if constraint exists)
- ✅ Other cells do NOT update

---

### ✅ Test 4: Selection Change
**Goal**: Verify checkbox + row-selected class update

**Steps**:
1. Click a row (not a cell)
2. Row should highlight
3. Click checkbox column
4. Checkbox should toggle

**Expected**:
- ✅ Checkbox cell updates
- ✅ Row-selected class added/removed
- ✅ Other cells do NOT update

**How to Verify**:
- Inspect row element
- Watch `row-selected` class toggle
- Watch checkbox `checked` property

---

### ✅ Test 5: Collapse/Expand
**Goal**: Verify name cell updates (chevron direction)

**Steps**:
1. Find a parent task (has children)
2. Click the collapse chevron (◄ or ▼)
3. Children should hide/show
4. Chevron should change direction

**Expected**:
- ✅ Name cell updates (chevron changes)
- ✅ Indent may change (if depth changes)
- ✅ Other cells do NOT update

---

### ✅ Test 6: Constraint Change
**Goal**: Verify start/end cells update (constraint icons)

**Steps**:
1. Change constraint type (e.g., ASAP → Start No Earlier Than)
2. Set constraint date
3. Observe constraint icons

**Expected**:
- ✅ Start cell updates (icon appears/changes)
- ✅ End cell updates (if end constraint)
- ✅ Other cells do NOT update

---

### ✅ Test 7: Multiple Field Edits
**Goal**: Verify all affected cells update

**Steps**:
1. Edit task name
2. Edit duration
3. Edit start date

**Expected**:
- ✅ Name cell updates
- ✅ Duration cell updates
- ✅ Start cell updates
- ✅ Each cell updates independently

---

### ✅ Test 8: Rapid Scrolling
**Goal**: Verify no visual glitches during rapid scrolling

**Steps**:
1. Scroll rapidly up and down
2. Scroll using mouse wheel
3. Scroll using scrollbar drag

**Expected**:
- ✅ Smooth scrolling
- ✅ No visual glitches
- ✅ Cells update correctly as they scroll into view
- ✅ No lag or stuttering

---

### ✅ Test 9: Editing State
**Goal**: Verify editing bypasses hash check

**Steps**:
1. Start editing a cell (double-click name)
2. While editing, change another field programmatically (if possible)
3. Complete the edit

**Expected**:
- ✅ All cells update when row is being edited (bypasses hash)
- ✅ Editing state preserved
- ✅ No conflicts

---

### ✅ Test 10: Data Refresh
**Goal**: Verify hashes are cleared on data refresh

**Steps**:
1. Edit a task name
2. Refresh data (if possible) or reload page
3. Verify cells update correctly

**Expected**:
- ✅ Hashes cleared on data refresh
- ✅ All cells update correctly after refresh
- ✅ No stale data

---

## Performance Testing

### Chrome DevTools Performance Tab

1. **Open DevTools** → **Performance** tab
2. **Click Record** (● button)
3. **Perform actions**:
   - Edit task name
   - Edit duration
   - Edit start date
   - Change selection
   - Scroll rapidly
4. **Stop recording**
5. **Analyze**:
   - Count DOM updates (should be fewer)
   - Measure render times (should be faster)
   - Check FPS (should be stable ~60fps)

**Expected Improvements**:
- **Before Phase 2**: Edit name → 12+ DOM updates
- **After Phase 2**: Edit name → 1 DOM update
- **Improvement**: 50-70% reduction

---

### Chrome DevTools Elements Tab

1. **Open DevTools** → **Elements** tab
2. **Select a row element**
3. **Edit a cell** (e.g., name)
4. **Watch the DOM**:
   - Only the edited cell should change
   - Other cells should remain unchanged
   - No unnecessary updates

---

## Automated Verification

### Test Script Features

The `PHASE2_TEST_SCRIPT.js` provides:
- ✅ Hash function verification
- ✅ Cell hash storage verification
- ✅ Performance measurements
- ✅ Edge case documentation

### Running Automated Tests

```javascript
// Run test script
// Copy PHASE2_TEST_SCRIPT.js into console

// Or load it:
fetch('./PHASE2_TEST_SCRIPT.js').then(r => r.text()).then(eval);
```

---

## Expected Results

### Functional
- ✅ All cell types update correctly
- ✅ Single field edits → only that cell updates
- ✅ Multiple field edits → all affected cells update
- ✅ Selection changes → checkbox + row class update
- ✅ Collapse/expand → name cell updates
- ✅ Constraint changes → date cells update
- ✅ No visual glitches

### Performance
- ✅ 50-70% reduction in unnecessary cell updates
- ✅ Single field edit → 1 cell update instead of 12+
- ✅ Faster editing performance
- ✅ Maintain 60fps during rapid edits

---

## Troubleshooting

### Issue: All cells still update on single field edit
**Possible Causes**:
- Cell hash not matching correctly
- Hash function missing dependencies
- Row-level hash still triggering updates

**Check**:
- Verify `_getCellHash()` is being called
- Check hash values in console
- Verify cell hash comparison logic

### Issue: Cell doesn't update when it should
**Possible Causes**:
- Hash missing dependencies
- Hash comparison failing
- Cell hash not stored correctly

**Check**:
- Verify hash includes all dependencies
- Check hash comparison logic
- Verify cell hash storage

### Issue: Editing broken
**Possible Causes**:
- Hash check interfering with editing
- Editing bypass not working

**Check**:
- Verify `this.editingRows.has(task.id)` check
- Verify editing state is preserved

---

## Success Criteria

### Must Pass
- ✅ Edit name → only name cell updates
- ✅ Edit duration → only duration cell updates
- ✅ Edit start → only start cell + icon updates
- ✅ Change selection → checkbox + row class updates
- ✅ Collapse/expand → name cell updates
- ✅ No visual glitches during rapid scrolling

### Performance Targets
- ✅ 50-70% reduction in DOM updates
- ✅ Single field edit → 1 cell update instead of 12+
- ✅ Maintain 60fps during rapid edits

---

## Test Results Template

```
Phase 2 Test Results
Date: ___________
Tester: ___________

Functional Tests:
[ ] Test 1: Edit name - PASSED / FAILED
[ ] Test 2: Edit duration - PASSED / FAILED
[ ] Test 3: Edit start date - PASSED / FAILED
[ ] Test 4: Selection change - PASSED / FAILED
[ ] Test 5: Collapse/expand - PASSED / FAILED
[ ] Test 6: Constraint change - PASSED / FAILED
[ ] Test 7: Multiple edits - PASSED / FAILED
[ ] Test 8: Rapid scrolling - PASSED / FAILED
[ ] Test 9: Editing state - PASSED / FAILED
[ ] Test 10: Data refresh - PASSED / FAILED

Performance Tests:
[ ] DOM updates reduced - YES / NO
[ ] Render time improved - YES / NO
[ ] Frame rate stable - YES / NO

Issues Found:
_________________________________________________
_________________________________________________

Overall: PASSED / FAILED
```

---

## Next Steps

If all tests pass:
- ✅ Phase 2 is successful
- ✅ Performance improvements verified
- ✅ Ready for production

If issues found:
- Document the issue
- Check console for errors
- Review hash function dependencies
- Fix and retest

---

## Tips

1. **Use Chrome DevTools**: Best tool for verifying DOM updates
2. **Watch Elements Tab**: See which cells actually update
3. **Performance Tab**: Measure actual improvements
4. **Console Logging**: Add temporary logs to track hash comparisons
5. **Visual Inspection**: Look for any visual glitches or lag

---

## Expected Performance Improvements

### Before Phase 2
- Edit name → 12+ cells update
- Edit duration → 12+ cells update
- Change selection → 12+ cells update

### After Phase 2
- Edit name → 1 cell updates ✅
- Edit duration → 1 cell updates ✅
- Change selection → 2 cells update (checkbox + row class) ✅

### Improvement
- **50-70% reduction** in unnecessary DOM updates
- **Faster editing** performance
- **Smoother scrolling** during rapid changes

