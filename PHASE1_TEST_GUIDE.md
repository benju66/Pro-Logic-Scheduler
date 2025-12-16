# Phase 1 Testing Guide

## Overview

Phase 1 includes two optimizations:
1. **Display Check Optimization**: Avoids unnecessary style recalculations
2. **Batch DOM Reads/Writes**: Reduces layout thrashing by batching DOM operations

## Quick Start

### 1. Start the Application

```bash
# Option 1: Web-only mode (fastest)
npm run dev

# Option 2: Full Tauri app
npm run tauri:dev
```

### 2. Open Browser Console

- **Chrome/Edge**: F12 or Ctrl+Shift+I (Windows) / Cmd+Option+I (Mac)
- **Firefox**: F12 or Ctrl+Shift+K (Windows) / Cmd+Option+K (Mac)

### 3. Run Test Script

Copy and paste the test script from `PHASE1_TEST_SCRIPT.js` into the console, or run:
```javascript
// Load and run the test script
fetch('/PHASE1_TEST_SCRIPT.js').then(r => r.text()).then(eval);
```

---

## Manual Testing Checklist

### ✅ Test 1: Display Check Optimization

**What to Test**: Rows should show/hide correctly without unnecessary style recalculations.

**Steps**:
1. Load the application with multiple tasks (50+)
2. Scroll down the grid slowly
3. Scroll back up
4. Scroll rapidly up and down

**Expected Behavior**:
- ✅ Rows appear/disappear smoothly as you scroll
- ✅ No visual glitches or flickering
- ✅ No console errors

**How to Verify Optimization**:
- Open Chrome DevTools → Performance tab
- Record while scrolling
- Look for "Recalculate Style" events
- Should see fewer style recalculations compared to before (if you have baseline)

---

### ✅ Test 2: Batch DOM Writes - Row Classes

**What to Test**: Row classes (selected, parent, collapsed, critical) should update correctly.

**Steps**:

#### 2a. Selection State
1. Click a row → Should highlight (add `row-selected` class)
2. Click another row → Previous row deselects, new row selects
3. Ctrl+Click multiple rows → Multiple rows should be selected
4. Click empty area → All rows deselect

**Expected**: Selection highlighting works correctly

#### 2b. Parent/Collapse State
1. Find a parent task (has children)
2. Click the collapse chevron (◄/▼) → Children should hide
3. Click again → Children should show
4. Verify parent row has `is-parent` class
5. Verify collapsed parent has `is-collapsed` class

**Expected**: Collapse/expand works correctly

#### 2c. Critical Path
1. Create tasks with dependencies
2. Verify critical path tasks are highlighted
3. Check that critical tasks have `is-critical` class

**Expected**: Critical path highlighting works

**How to Verify Optimization**:
- Open Chrome DevTools → Performance tab
- Record while selecting/collapsing rows
- Look for "Layout" events
- Should see fewer layout events (batched writes reduce reflows)

---

### ✅ Test 3: Batch DOM Writes - Data Attributes

**What to Test**: Data attributes (`data-task-id`, `data-index`) should update correctly.

**Steps**:
1. Scroll through the grid
2. Inspect a row element (right-click → Inspect)
3. Verify `data-task-id` and `data-index` attributes are present
4. Scroll to different rows and verify attributes update

**Expected**: Data attributes are correct for each row

**How to Verify**:
- In DevTools Elements panel, watch `data-task-id` and `data-index` as you scroll
- Values should match the task ID and index

---

### ✅ Test 4: Performance During Rapid Scrolling

**What to Test**: Grid should remain smooth during rapid scrolling.

**Steps**:
1. Load 100+ tasks
2. Scroll rapidly up and down using mouse wheel
3. Scroll using scrollbar drag
4. Scroll using keyboard (Page Up/Down)

**Expected**:
- ✅ Smooth scrolling with no lag
- ✅ No visual glitches
- ✅ Rows update correctly as they come into view
- ✅ Frame rate stays high (60fps ideally)

**How to Verify**:
- Open Chrome DevTools → Performance tab
- Record while scrolling rapidly
- Check FPS meter (should stay near 60fps)
- Look for long tasks in the timeline (should be < 16ms for 60fps)

---

### ✅ Test 5: Editing Functionality

**What to Test**: Cell editing should still work correctly.

**Steps**:
1. Double-click a task name → Should enter edit mode
2. Type new name → Should update
3. Press Enter → Should save
4. Edit duration, start date, end date → Should all work
5. Edit constraint type → Should work

**Expected**: All editing functionality works as before

---

### ✅ Test 6: Selection and Keyboard Navigation

**What to Test**: Selection and keyboard navigation should work correctly.

**Steps**:
1. Click a row → Should select
2. Press Arrow Up/Down → Should navigate and select
3. Press Shift+Arrow → Should select range
4. Press Ctrl+Arrow → Should move selection
5. Press Tab → Should indent
6. Press Shift+Tab → Should outdent

**Expected**: All keyboard shortcuts work correctly

---

## Automated Browser Console Tests

Run the test script in `PHASE1_TEST_SCRIPT.js` for automated verification.

### What the Script Tests:

1. **Display Check**: Monitors style changes during scroll
2. **Batch Writes**: Verifies className updates are batched
3. **Data Attributes**: Checks data-task-id and data-index
4. **Row Classes**: Verifies selection, parent, collapsed, critical classes
5. **Performance**: Measures render times

### Running the Script:

```javascript
// Copy contents of PHASE1_TEST_SCRIPT.js into console
// Or load it:
fetch('./PHASE1_TEST_SCRIPT.js').then(r => r.text()).then(eval);
```

---

## Performance Monitoring

### Chrome DevTools Performance Tab

1. Open DevTools → Performance tab
2. Click Record (●)
3. Perform actions (scroll, select, collapse)
4. Stop recording
5. Analyze:
   - Look for "Recalculate Style" events (should be fewer)
   - Look for "Layout" events (should be batched)
   - Check FPS (should be stable ~60fps)
   - Look for long tasks (>16ms)

### Chrome DevTools Rendering Tab

1. Open DevTools → More Tools → Rendering
2. Enable:
   - "Paint flashing" (shows what's repainted)
   - "Layout Shift Regions" (shows layout shifts)
3. Scroll and interact
4. Should see:
   - Fewer paint flashes (display check optimization)
   - Fewer layout shifts (batch writes optimization)

---

## Expected Performance Improvements

### Display Check Optimization
- **Before**: Every row gets `display: flex` set on every scroll
- **After**: Only hidden rows get `display: flex` set
- **Improvement**: ~5% reduction in style recalculations

### Batch DOM Writes
- **Before**: Multiple `classList.toggle()` calls = multiple reflows
- **After**: Single `className` assignment = single reflow
- **Improvement**: ~30-40% reduction in layout thrashing

### Combined Impact
- Smoother scrolling
- Faster row updates
- Better frame rates during rapid scrolling

---

## Troubleshooting

### Issue: Rows not showing/hiding correctly
**Check**:
- Console for errors
- Verify `row.style.display` logic
- Check if rows are being recycled correctly

### Issue: Row classes not updating
**Check**:
- Verify selection state (`this.selectedIds`)
- Check parent/collapse state
- Verify `className` assignment is working

### Issue: Performance not improved
**Check**:
- Are you testing with enough rows? (50+ recommended)
- Is the browser DevTools Performance tab showing improvements?
- Compare before/after recordings

### Issue: Editing broken
**Check**:
- Verify `_bindRowData` is still being called
- Check if editing state is preserved
- Verify cell binding still works

---

## Success Criteria

✅ **All manual tests pass**
✅ **No console errors**
✅ **Performance metrics show improvement**
✅ **Visual behavior unchanged (functionality preserved)**
✅ **Frame rate stable during rapid scrolling**

---

## Next Steps

If all tests pass:
- ✅ Phase 1 is successful
- ✅ Ready to proceed with Phase 2 (Cell-Level Change Detection)

If issues found:
- Document the issue
- Check console for errors
- Verify the code changes are correct
- Test in isolation if needed

