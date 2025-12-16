# Phase 1 Quick Test Reference

## 🚀 Quick Start

1. **Start the app**: `npm run dev` or `npm run tauri:dev`
2. **Open console**: F12 or Ctrl+Shift+I
3. **Run test script**: Copy `PHASE1_TEST_SCRIPT.js` into console

## ✅ Essential Tests (5 minutes)

### Test 1: Scroll Test
- [ ] Scroll up and down the grid
- [ ] Rows appear/disappear smoothly
- [ ] No flickering or glitches

### Test 2: Selection Test
- [ ] Click a row → highlights
- [ ] Click another row → previous deselects
- [ ] Ctrl+Click multiple → multiple selected

### Test 3: Collapse Test
- [ ] Click chevron on parent → children hide
- [ ] Click again → children show
- [ ] Parent row styling correct

### Test 4: Edit Test
- [ ] Double-click name → edits
- [ ] Press Enter → saves
- [ ] Edit other fields → works

### Test 5: Performance Test
- [ ] Rapid scroll → smooth
- [ ] No lag or stuttering
- [ ] Frame rate stable

## 🎯 Success Criteria

✅ All tests pass
✅ No console errors
✅ Smooth scrolling
✅ All functionality works

## 📊 Performance Check (Optional)

1. Open Chrome DevTools → Performance tab
2. Record while scrolling
3. Check FPS (should be ~60fps)
4. Look for "Recalculate Style" events (should be fewer)

## 🐛 If Issues Found

1. Check console for errors
2. Verify grid is loaded: `window.scheduler?.grid`
3. Check row elements: `document.querySelectorAll('.vsg-row').length`
4. Review `PHASE1_TEST_GUIDE.md` for detailed troubleshooting

