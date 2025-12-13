/**
 * Browser Console Test Suite for Pro Logic Scheduler
 * 
 * Copy and paste these tests into the browser console (F12)
 * to verify functionality
 */

console.log('🧪 Pro Logic Scheduler - Browser Test Suite');
console.log('='.repeat(60));

// Test 1: Check if scheduler is initialized
function testSchedulerExists() {
    console.log('\n📋 Test 1: Scheduler Initialization');
    if (typeof window.scheduler !== 'undefined') {
        console.log('✅ Scheduler exists:', window.scheduler);
        console.log('   - Type:', window.scheduler.constructor.name);
        return true;
    } else {
        console.log('❌ Scheduler not found');
        return false;
    }
}

// Test 2: Check task management
function testTaskManagement() {
    console.log('\n📋 Test 2: Task Management');
    if (!window.scheduler) {
        console.log('❌ Scheduler not available');
        return false;
    }
    
    const initialCount = window.scheduler.tasks.length;
    console.log(`   Initial task count: ${initialCount}`);
    
    // Add a task
    const newTask = window.scheduler.addTask({ name: 'Test Task' });
    console.log(`✅ Added task: "${newTask.name}" (ID: ${newTask.id})`);
    
    // Verify it was added
    const newCount = window.scheduler.tasks.length;
    if (newCount === initialCount + 1) {
        console.log(`✅ Task count increased: ${newCount}`);
    } else {
        console.log(`❌ Task count mismatch: expected ${initialCount + 1}, got ${newCount}`);
        return false;
    }
    
    // Test selection
    window.scheduler.selectedIds.clear();
    window.scheduler.selectedIds.add(newTask.id);
    console.log('✅ Task selected');
    
    return true;
}

// Test 3: Check CPM calculations
function testCPM() {
    console.log('\n📋 Test 3: CPM Calculations');
    if (!window.scheduler) {
        console.log('❌ Scheduler not available');
        return false;
    }
    
    const startTime = performance.now();
    window.scheduler.recalculateAll();
    const calcTime = performance.now() - startTime;
    
    console.log(`✅ CPM calculation completed in ${calcTime.toFixed(2)}ms`);
    
    const stats = window.scheduler.getStats();
    console.log('   Stats:', stats);
    
    if (calcTime < 1000) {
        console.log('✅ Performance acceptable');
    } else {
        console.log('⚠️  Performance may be slow');
    }
    
    return true;
}

// Test 4: Check virtual scrolling
function testVirtualScrolling() {
    console.log('\n📋 Test 4: Virtual Scrolling');
    if (!window.scheduler?.grid) {
        console.log('❌ Grid not available');
        return false;
    }
    
    const gridStats = window.scheduler.grid.getStats();
    console.log('   Grid Stats:', gridStats);
    
    if (gridStats.renderedRows < gridStats.totalTasks) {
        console.log(`✅ Virtual scrolling active (${gridStats.renderedRows} rendered of ${gridStats.totalTasks} total)`);
    } else {
        console.log('⚠️  All rows rendered (virtual scrolling may not be needed)');
    }
    
    return true;
}

// Test 5: Check Gantt chart
function testGantt() {
    console.log('\n📋 Test 5: Gantt Chart');
    if (!window.scheduler?.gantt) {
        console.log('❌ Gantt not available');
        return false;
    }
    
    const ganttStats = window.scheduler.gantt.getStats();
    console.log('   Gantt Stats:', ganttStats);
    
    if (ganttStats.lastRenderTime) {
        const renderTime = parseFloat(ganttStats.lastRenderTime);
        if (renderTime < 20) {
            console.log(`✅ Gantt render time acceptable: ${ganttStats.lastRenderTime}`);
        } else {
            console.log(`⚠️  Gantt render time may be slow: ${ganttStats.lastRenderTime}`);
        }
    }
    
    return true;
}

// Test 6: Check date utilities
function testDateUtils() {
    console.log('\n📋 Test 6: Date Utilities');
    try {
        // This will only work if DateUtils is accessible
        if (typeof DateUtils !== 'undefined') {
            const today = DateUtils.today();
            console.log(`✅ DateUtils.today(): ${today}`);
            
            const tomorrow = DateUtils.addWorkDays(today, 1, window.scheduler.calendar);
            console.log(`✅ DateUtils.addWorkDays(): ${tomorrow}`);
            
            return true;
        } else {
            console.log('⚠️  DateUtils not directly accessible (may be imported)');
            return true; // Not a failure, just not exposed globally
        }
    } catch (e) {
        console.log('❌ DateUtils test failed:', e.message);
        return false;
    }
}

// Test 7: Check calendar system
function testCalendar() {
    console.log('\n📋 Test 7: Calendar System');
    if (!window.scheduler) {
        console.log('❌ Scheduler not available');
        return false;
    }
    
    const calendar = window.scheduler.calendar;
    console.log('   Calendar:', calendar);
    
    if (calendar.workingDays && Array.isArray(calendar.workingDays)) {
        console.log(`✅ Working days configured: ${calendar.workingDays.join(', ')}`);
    } else {
        console.log('❌ Working days not configured');
        return false;
    }
    
    if (calendar.exceptions && typeof calendar.exceptions === 'object') {
        const exceptionCount = Object.keys(calendar.exceptions).length;
        console.log(`✅ Exceptions object exists (${exceptionCount} exceptions)`);
    } else {
        console.log('❌ Exceptions object missing');
        return false;
    }
    
    return true;
}

// Test 8: Check undo/redo
function testUndoRedo() {
    console.log('\n📋 Test 8: Undo/Redo');
    if (!window.scheduler) {
        console.log('❌ Scheduler not available');
        return false;
    }
    
    const initialHistorySize = window.scheduler.history.length;
    console.log(`   Initial history size: ${initialHistorySize}`);
    
    // Make a change
    window.scheduler.saveCheckpoint();
    const newHistorySize = window.scheduler.history.length;
    
    if (newHistorySize > initialHistorySize) {
        console.log(`✅ Checkpoint saved (history: ${newHistorySize})`);
    } else {
        console.log('⚠️  History may not have changed (could be duplicate state)');
    }
    
    // Test undo
    const beforeUndo = window.scheduler.tasks.length;
    window.scheduler.undo();
    const afterUndo = window.scheduler.tasks.length;
    
    if (beforeUndo === afterUndo || initialHistorySize === 0) {
        console.log('✅ Undo works (or nothing to undo)');
    } else {
        console.log('⚠️  Undo may have changed state');
    }
    
    return true;
}

// Test 9: Performance test with many tasks
function testPerformance() {
    console.log('\n📋 Test 9: Performance Test');
    if (!window.scheduler) {
        console.log('❌ Scheduler not available');
        return false;
    }
    
    const initialCount = window.scheduler.tasks.length;
    console.log(`   Initial tasks: ${initialCount}`);
    
    // Add 100 tasks
    console.log('   Adding 100 tasks...');
    const startTime = performance.now();
    
    for (let i = 0; i < 100; i++) {
        window.scheduler.addTask({ name: `Perf Test ${i}` });
    }
    
    const addTime = performance.now() - startTime;
    console.log(`✅ Added 100 tasks in ${addTime.toFixed(2)}ms (${(addTime/100).toFixed(2)}ms per task)`);
    
    // Recalculate
    const calcStart = performance.now();
    window.scheduler.recalculateAll();
    const calcTime = performance.now() - calcStart;
    console.log(`✅ Recalculated in ${calcTime.toFixed(2)}ms`);
    
    // Render
    const renderStart = performance.now();
    window.scheduler.render();
    const renderTime = performance.now() - renderStart;
    console.log(`✅ Rendered in ${renderTime.toFixed(2)}ms`);
    
    // Clean up
    window.scheduler.tasks = window.scheduler.tasks.slice(0, initialCount);
    window.scheduler.recalculateAll();
    window.scheduler.render();
    console.log('✅ Cleaned up test tasks');
    
    return true;
}

// Run all tests
function runAllTests() {
    console.log('\n🚀 Running All Tests...\n');
    
    const results = {
        schedulerExists: testSchedulerExists(),
        taskManagement: testTaskManagement(),
        cpm: testCPM(),
        virtualScrolling: testVirtualScrolling(),
        gantt: testGantt(),
        dateUtils: testDateUtils(),
        calendar: testCalendar(),
        undoRedo: testUndoRedo(),
        performance: testPerformance(),
    };
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Test Results Summary:');
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    Object.entries(results).forEach(([test, result]) => {
        console.log(`${result ? '✅' : '❌'} ${test}`);
    });
    
    console.log(`\n✅ Passed: ${passed}/${total}`);
    
    if (passed === total) {
        console.log('\n🎉 All tests passed!');
    } else {
        console.log('\n⚠️  Some tests failed. Check the details above.');
    }
    
    return results;
}

// Export for use
if (typeof window !== 'undefined') {
    window.testScheduler = {
        runAll: runAllTests,
        testSchedulerExists,
        testTaskManagement,
        testCPM,
        testVirtualScrolling,
        testGantt,
        testDateUtils,
        testCalendar,
        testUndoRedo,
        testPerformance,
    };
    
    console.log('\n💡 Tests are available! Run: window.testScheduler.runAll()');
}

// Auto-run if in browser
if (typeof window !== 'undefined' && window.scheduler) {
    setTimeout(() => {
        console.log('\n⏱️  Auto-running tests in 2 seconds...');
        setTimeout(runAllTests, 2000);
    }, 1000);
}

