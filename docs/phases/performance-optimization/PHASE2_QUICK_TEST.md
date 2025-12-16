# Phase 2 Quick Test Reference

## 🚀 Quick Start

1. **Start the app**: `npm run dev` or `npm run tauri:dev`
2. **Open console**: F12 or Ctrl+Shift+I
3. **Run test script**: Copy `PHASE2_TEST_SCRIPT.js` into console

## ✅ Essential Tests (10 minutes)

### Test 1: Edit Name
- [ ] Double-click task name → edits
- [ ] Change name → only name cell updates
- [ ] Other cells unchanged

### Test 2: Edit Duration
- [ ] Click duration cell → edits
- [ ] Change value → only duration cell updates
- [ ] Other cells unchanged

### Test 3: Edit Start Date
- [ ] Click start date cell → edits
- [ ] Change date → only start cell + icon update
- [ ] Other cells unchanged

### Test 4: Change Selection
- [ ] Click row → highlights
- [ ] Click checkbox → toggles
- [ ] Only checkbox + row class update

### Test 5: Collapse/Expand
- [ ] Click chevron on parent → children hide/show
- [ ] Only name cell updates (chevron changes)
- [ ] Other cells unchanged

### Test 6: Rapid Scroll
- [ ] Scroll rapidly → smooth
- [ ] No lag or glitches
- [ ] Cells update correctly

## 🎯 Success Criteria

✅ Single field edit → only that cell updates
✅ Multiple edits → all affected cells update
✅ No visual glitches
✅ Smooth performance

## 📊 Performance Check

1. Open Chrome DevTools → Performance tab
2. Record while editing
3. Count DOM updates (should be fewer)
4. Check FPS (should be ~60fps)

## 🐛 If Issues Found

1. Check console for errors
2. Verify grid is loaded: `window.scheduler?.grid`
3. Check cell updates in Elements tab
4. Review `PHASE2_TEST_GUIDE.md` for detailed troubleshooting

