/**
 * Phase 1, Script 2: Render Performance Benchmark
 * 
 * INSTRUCTIONS:
 * 1. Open DevTools Console (F12)
 * 2. Make sure the scheduler is loaded and has data
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 * 
 * WHAT IT DOES:
 * - Accesses VirtualScrollGrid instance via window.scheduler.grid
 * - Calls _updateVisibleRows() repeatedly (50-100 times)
 * - Measures execution time of each call using performance.now()
 * - Reports average render time, max render time, p95, p99
 * 
 * INTERPRETATION:
 * - Average render time < 8ms = Excellent
 * - Average render time 8-12ms = Good
 * - Average render time > 12ms = Needs optimization
 * 
 * NOTE: This tests the raw render method. Real-world performance may differ
 * due to RAF batching and scroll debouncing.
 */

(function() {
    'use strict';
    
    console.log('=== Render Performance Benchmark ===');
    console.log('Starting benchmark...\n');
    
    // Get grid instance
    const scheduler = window.scheduler;
    if (!scheduler || !scheduler.grid) {
        console.error('❌ Error: Scheduler not found. Make sure the app is loaded.');
        console.log('Try: window.scheduler');
        return;
    }
    
    const grid = scheduler.grid;
    
    // Check if grid has data
    const data = grid['data'] || [];
    if (data.length === 0) {
        console.error('❌ Error: Grid has no data. Add tasks first.');
        return;
    }
    
    console.log(`Grid instance found:`);
    console.log(`  - Data rows: ${data.length}`);
    console.log(`  - Viewport height: ${grid['viewportHeight'] || 'unknown'}px`);
    console.log(`  - Row height: ${grid['options']?.rowHeight || 'unknown'}px\n`);
    
    // Configuration
    const ITERATIONS = 100;
    const WARMUP_ITERATIONS = 5;
    
    // Performance tracking
    const renderTimes = [];
    
    // Access private method using bracket notation
    const updateVisibleRows = grid['_updateVisibleRows'];
    if (!updateVisibleRows || typeof updateVisibleRows !== 'function') {
        console.error('❌ Error: _updateVisibleRows method not accessible.');
        console.log('This may require a test build with exposed methods.');
        return;
    }
    
    console.log(`Running ${WARMUP_ITERATIONS} warmup iterations...`);
    
    // Warmup runs (to get JIT compilation benefits)
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        updateVisibleRows.call(grid);
    }
    
    console.log(`Running ${ITERATIONS} benchmark iterations...\n`);
    
    // Benchmark runs
    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        updateVisibleRows.call(grid);
        const end = performance.now();
        const duration = end - start;
        
        renderTimes.push(duration);
        
        // Progress indicator every 10 iterations
        if ((i + 1) % 10 === 0) {
            console.log(`  Completed ${i + 1}/${ITERATIONS} iterations...`);
        }
    }
    
    // Calculate statistics
    const totalTime = renderTimes.reduce((a, b) => a + b, 0);
    const avgRenderTime = totalTime / renderTimes.length;
    const maxRenderTime = Math.max(...renderTimes);
    const minRenderTime = Math.min(...renderTimes);
    
    // Calculate percentiles
    const sortedTimes = [...renderTimes].sort((a, b) => a - b);
    const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.50)];
    const p75 = sortedTimes[Math.floor(sortedTimes.length * 0.75)];
    const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
    
    // Output results
    console.log('\n=== Render Performance Results ===');
    console.log(`Total iterations: ${ITERATIONS}`);
    console.log(`\n📊 Render Time Statistics:`);
    console.log(`  Average render time: ${avgRenderTime.toFixed(2)}ms`);
    console.log(`  Min render time: ${minRenderTime.toFixed(2)}ms`);
    console.log(`  Max render time: ${maxRenderTime.toFixed(2)}ms`);
    console.log(`\n📈 Percentiles:`);
    console.log(`  50th percentile (median): ${p50.toFixed(2)}ms`);
    console.log(`  75th percentile: ${p75.toFixed(2)}ms`);
    console.log(`  95th percentile: ${p95.toFixed(2)}ms`);
    console.log(`  99th percentile: ${p99.toFixed(2)}ms`);
    console.log(`\n⏱️  Total Time:`);
    console.log(`  Total execution time: ${totalTime.toFixed(2)}ms`);
    console.log(`  Average per iteration: ${avgRenderTime.toFixed(2)}ms`);
    
    // Performance assessment
    console.log(`\n📈 Performance Assessment:`);
    if (avgRenderTime < 8) {
        console.log(`  ✅ Excellent: Average render time < 8ms`);
    } else if (avgRenderTime < 12) {
        console.log(`  ⚠️  Good: Average render time < 12ms`);
    } else {
        console.log(`  ❌ Needs Optimization: Average render time > 12ms`);
    }
    
    if (p95 > 16.67) {
        console.log(`  ⚠️  Warning: 95th percentile exceeds 16.67ms (60 FPS threshold)`);
    }
    
    if (maxRenderTime > 50) {
        console.log(`  ⚠️  Warning: Max render time (${maxRenderTime.toFixed(2)}ms) is very high`);
    }
    
    // Detailed breakdown
    console.log(`\n📋 Detailed Breakdown:`);
    const ranges = [
        { min: 0, max: 4, label: 'Very Fast (<4ms)' },
        { min: 4, max: 8, label: 'Fast (4-8ms)' },
        { min: 8, max: 12, label: 'Acceptable (8-12ms)' },
        { min: 12, max: 16.67, label: 'Slow (12-16.67ms)' },
        { min: 16.67, max: Infinity, label: 'Very Slow (>16.67ms)' }
    ];
    
    ranges.forEach(range => {
        const count = renderTimes.filter(t => t >= range.min && t < range.max).length;
        const percentage = (count / renderTimes.length) * 100;
        console.log(`  ${range.label}: ${count} iterations (${percentage.toFixed(1)}%)`);
    });
    
    // Return results object for programmatic access
    return {
        avgRenderTime,
        minRenderTime,
        maxRenderTime,
        p50,
        p75,
        p95,
        p99,
        totalTime,
        iterations: ITERATIONS,
        renderTimes
    };
})();

