# Pro Logic Scheduler - Test Plan

## Quick Start Guide

### Prerequisites
- Node.js v18+ installed
- Rust toolchain installed (`rustc --version`)
- Tauri CLI installed (comes with npm install)

### Running the Application

#### Option 1: Web-Only Mode (Fastest for Testing)
```bash
npm run dev
```
Opens at http://localhost:1420 (or the port shown)

#### Option 2: Full Tauri Desktop App
```bash
npm run tauri:dev
```
Opens native desktop window with full file system access

#### Option 3: Production Build
```bash
npm run tauri:build
```
Creates executable in `src-tauri/target/release/`

---

## Functional Test Checklist

### ✅ Core Functionality Tests

#### 1. Application Startup
- [ ] App loads without errors
- [ ] Console shows "Pro Logic Scheduler - Ferrari Engine v2.0"
- [ ] Grid and Gantt panes render correctly
- [ ] Sample data loads (if present)

#### 2. Task Management
- [ ] **Add Task**: Click "Add Task" button → new task appears
- [ ] **Edit Task Name**: Double-click name cell → edit → Enter → saves
- [ ] **Edit Duration**: Click duration cell → change value → updates
- [ ] **Delete Task**: Click delete icon → confirms → removes task
- [ ] **Select Multiple**: Ctrl+Click or Shift+Click → multiple selected
- [ ] **Keyboard Navigation**: Arrow keys move selection

#### 3. Task Hierarchy
- [ ] **Indent**: Select task → Tab key → becomes child
- [ ] **Outdent**: Select child → Shift+Tab → becomes sibling
- [ ] **Collapse/Expand**: Click chevron on parent → children hide/show
- [ ] **Parent Dates**: Parent dates update when children change

#### 4. Drag and Drop
- [ ] **Reorder Tasks**: Drag handle → move to new position → reorders
- [ ] **Make Child**: Drag task onto another → becomes child
- [ ] **Visual Feedback**: Drag shows ghost and drop indicators

#### 5. Dependencies
- [ ] **Open Dependencies**: Click links icon → modal opens
- [ ] **Add Predecessor**: Select task → Add → link created
- [ ] **Change Link Type**: Select FS/SS/FF/SF → updates
- [ ] **Set Lag**: Enter lag days → applies correctly
- [ ] **Remove Link**: Click delete → removes dependency
- [ ] **Visual Arrows**: Dependencies show as arrows in Gantt

#### 6. CPM Calculations
- [ ] **Auto-Calculate**: Change task → dates recalculate automatically
- [ ] **Critical Path**: Critical tasks highlighted in red
- [ ] **Float Display**: Side drawer shows Total Float and Free Float
- [ ] **Late Dates**: Late Start/Finish calculated correctly

#### 7. Calendar System
- [ ] **Open Calendar**: Click Calendar button → modal opens
- [ ] **Toggle Working Days**: Click weekday buttons → updates
- [ ] **Add Exception**: Enter date + reason → adds holiday
- [ ] **Remove Exception**: Click delete → removes exception
- [ ] **Date Calculations**: Respects working days and holidays

#### 8. Gantt Chart
- [ ] **Bars Render**: Task bars appear in correct positions
- [ ] **Zoom Controls**: Week/Day/Month views work
- [ ] **Scroll Sync**: Grid and Gantt scroll together
- [ ] **Drag Bars**: Drag task bar → dates update
- [ ] **Today Line**: Red dashed line shows current date
- [ ] **Weekend Shading**: Weekends show gray background

#### 9. Constraints
- [ ] **Set SNET**: Change constraint to SNET → enter date → applies
- [ ] **Set MFO**: Change to MFO → enter date → task fixed
- [ ] **Constraint Icons**: Icons show on start/end dates
- [ ] **Constraint Descriptions**: Help text explains each type

#### 10. File Operations
- [ ] **Save JSON**: File → Save → file saved
- [ ] **Open JSON**: File → Open → loads tasks
- [ ] **Export JSON**: File → Export JSON → downloads file
- [ ] **Import MS Project**: File → Import XML → parses correctly
- [ ] **Export MS Project**: File → Export XML → generates valid XML

#### 11. Undo/Redo
- [ ] **Undo**: Ctrl+Z → reverts last change
- [ ] **Redo**: Ctrl+Y → reapplies change
- [ ] **History Limit**: Multiple undos work correctly

#### 12. Clipboard Operations
- [ ] **Copy**: Ctrl+C → copies selected tasks
- [ ] **Cut**: Ctrl+X → marks for deletion
- [ ] **Paste**: Ctrl+V → pastes tasks with new IDs
- [ ] **Dependencies Preserved**: Internal dependencies maintained

#### 13. Performance Tests
- [ ] **1000 Tasks**: Click "+ 1,000 Tasks" → renders smoothly
- [ ] **5000 Tasks**: Click "+ 5,000 Tasks" → still responsive
- [ ] **Virtual Scrolling**: Only visible rows rendered
- [ ] **Stats Bar**: Shows performance metrics

#### 14. Side Drawer
- [ ] **Open Drawer**: Double-click task → drawer opens
- [ ] **Edit Fields**: Change values → updates task
- [ ] **CPM Data**: Shows float, late dates, critical status
- [ ] **Close Drawer**: Click X or Esc → closes

#### 15. Keyboard Shortcuts
- [ ] **F2**: Enters edit mode on focused cell
- [ ] **Delete**: Deletes selected tasks
- [ ] **Tab/Shift+Tab**: Indent/outdent
- [ ] **Arrow Keys**: Navigate selection
- [ ] **Ctrl+N**: New project (if implemented)
- [ ] **Ctrl+O**: Open file
- [ ] **Ctrl+S**: Save file

---

## Performance Benchmarks

### Expected Performance
- **1000 tasks**: < 100ms render time
- **5000 tasks**: < 500ms render time
- **CPM calculation**: < 50ms for 1000 tasks
- **Gantt render**: < 16ms (60 FPS)
- **Memory usage**: < 200MB for 5000 tasks

### Check Stats Bar
- Tasks count matches actual
- Visible rows < total rows (virtual scrolling)
- CPM calc time reasonable
- Gantt render time < 20ms

---

## Browser Compatibility

### Tested Browsers
- ✅ Chrome/Edge (Chromium)
- ✅ Safari (WebKit)
- ✅ Firefox (Gecko)

### Tauri Desktop
- ✅ macOS
- ✅ Windows
- ✅ Linux

---

## Known Issues to Verify

1. **Circular Dependencies**: Should warn or prevent
2. **Invalid Dates**: Should handle gracefully
3. **Large Projects**: Should remain responsive
4. **File System Access**: Tauri file dialogs work correctly
5. **localStorage Limits**: Should handle large datasets

---

## Automated Test Script

Run `npm run test` (if implemented) or use browser DevTools:

```javascript
// In browser console:
// 1. Check scheduler exists
console.log('Scheduler:', window.scheduler);

// 2. Check task count
console.log('Tasks:', window.scheduler.tasks.length);

// 3. Test adding task
window.scheduler.addTask({ name: 'Test Task' });
console.log('Added task:', window.scheduler.tasks.length);

// 4. Test CPM calculation
window.scheduler.recalculateAll();
console.log('CPM Stats:', window.scheduler.getStats());

// 5. Test virtual scrolling
console.log('Grid Stats:', window.scheduler.grid.getStats());
```

---

## Manual Test Scenarios

### Scenario 1: Simple Project
1. Add 3 tasks: "Design", "Build", "Test"
2. Set "Build" depends on "Design" (FS)
3. Set "Test" depends on "Build" (FS)
4. Verify dates calculate correctly
5. Verify critical path shows all 3 tasks

### Scenario 2: Complex Hierarchy
1. Create parent "Phase 1"
2. Add 5 child tasks under Phase 1
3. Set dependencies between children
4. Verify parent dates roll up correctly
5. Collapse/expand parent

### Scenario 3: Calendar Exceptions
1. Add holiday on a working day
2. Create task that spans the holiday
3. Verify duration excludes holiday
4. Remove holiday
5. Verify duration recalculates

### Scenario 4: MS Project Import
1. Export a project to XML
2. Clear all tasks
3. Import the XML file
4. Verify all tasks, dependencies, dates restored

---

## Troubleshooting

### App Won't Start
- Check Node.js version: `node --version` (need v18+)
- Check Rust: `rustc --version`
- Reinstall dependencies: `npm install`
- Clear cache: `rm -rf node_modules package-lock.json && npm install`

### Build Errors
- Check Tauri prerequisites: https://tauri.app/v1/guides/getting-started/prerequisites
- macOS: `xcode-select --install`
- Windows: Install Visual Studio C++ Build Tools

### Runtime Errors
- Check browser console (F12)
- Check Tauri console output
- Verify all modules imported correctly
- Check localStorage for corrupted data

---

## Success Criteria

✅ All core features work
✅ Performance acceptable for 1000+ tasks
✅ No console errors
✅ File operations work (save/load)
✅ CPM calculations correct
✅ UI responsive and intuitive

