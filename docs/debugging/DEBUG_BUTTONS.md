# Button Debugging Checklist

## Buttons in HTML that call scheduler methods:

1. ✅ `scheduler.undo()` - EXISTS
2. ✅ `scheduler.redo()` - EXISTS  
3. ✅ `scheduler.addTask()` - EXISTS (just fixed)
4. ✅ `scheduler.zoomOut()` - EXISTS
5. ✅ `scheduler.zoomIn()` - EXISTS
6. ✅ `scheduler.openCalendar()` - EXISTS

## Buttons that call window functions:

1. `generate1000Tasks()` - EXISTS in main.js
2. `generate5000Tasks()` - EXISTS in main.js
3. `clearTasks()` - EXISTS in main.js
4. `showStats()` - EXISTS in main.js
5. `handleNewProject()` - EXISTS in main.js
6. `handleOpenFile()` - EXISTS in main.js
7. `handleSaveFile()` - EXISTS in main.js
8. `handleExportJSON()` - EXISTS in main.js
9. `handleImportXML()` - EXISTS in main.js
10. `handleExportXML()` - EXISTS in main.js

## Potential Issues:

1. **addTask** - Fixed: Now selects, focuses, and scrolls to new task
2. **render()** - May not be updating grid correctly
3. **getVisibleTasks()** - Only returns root tasks (tasks without parentId)
4. **setSelection()** - May need focusedId parameter

## Next Steps:

1. Test addTask button
2. Check console for errors
3. Verify render() is called
4. Check if tasks are being added to store

