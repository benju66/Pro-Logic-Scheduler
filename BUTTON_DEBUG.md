# Button Debugging Guide

## Issue: Buttons Not Working

### Root Cause Analysis

1. **Global Scheduler Access**
   - Buttons use `onclick="scheduler.addTask()"` 
   - Requires `window.scheduler` to be available
   - Fixed: Added immediate `window.scheduler = scheduler` assignment

2. **Initialization Timing**
   - Buttons might be clicked before scheduler initializes
   - Fixed: Added error handling and immediate global assignment

3. **Sample Data Creation**
   - `_createSampleData()` uses `this.calendar` getter
   - Calendar store might not be ready
   - Fixed: Changed to `this.calendarStore.get()`

### Testing Steps

1. **Open Browser Console (F12)**
2. **Check for errors:**
   - Look for red error messages
   - Check if `window.scheduler` exists: `typeof window.scheduler`
   - Check if scheduler initialized: Look for "✅ Scheduler initialized"

3. **Test Button Manually:**
   ```javascript
   // In browser console:
   window.scheduler.addTask()
   ```

4. **Check Task Count:**
   ```javascript
   window.scheduler.tasks.length
   ```

### Expected Console Output

```
🏎️ Pro Logic Scheduler - VS Code of Scheduling Tools
==================================================
Environment: Tauri Desktop
[SchedulerService] Initialized - VS Code of Scheduling Tools
✅ Scheduler initialized
✅ window.scheduler available: object
✅ Initial task count: 2
```

### If Buttons Still Don't Work

1. Check console for JavaScript errors
2. Verify `window.scheduler` exists
3. Try calling methods directly in console
4. Check if containers exist in DOM

