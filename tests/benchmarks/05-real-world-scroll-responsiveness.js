/**
 * Phase 1, Script 5: Real-World Scroll Responsiveness Test
 * 
 * INSTRUCTIONS:
 * 1. Open DevTools Console (F12)
 * 2. Make sure the scheduler is loaded and has data
 * 3. Copy and paste this entire script into the console
 * 4. Follow the on-screen instructions to manually scroll
 * 5. Results will be displayed automatically
 * 
 * WHAT IT DOES:
 * - Measures actual user scroll responsiveness (not programmatic)
 * - Tracks time between scroll event and visible row update
 * - Measures horizontal scroll sync responsiveness
 * - Detects rendering lag during active scrolling
 * - Reports real-world UX metrics
 * 
 * INTERPRETATION:
 * - Update delay < 16ms = Excellent (keeps up with scroll)
 * - Update delay 16-33ms = Good (slight lag)
 * - Update delay > 33ms = Poor (noticeable lag)
 * - Rendering during scroll = Good
 * - No rendering during scroll = Poor (causes laggy feel)
 */

(function() {
    'use strict';
    
    console.log('=== Real-World Scroll Responsiveness Test ===');
    console.log('This test measures actual user scroll experience\n');
    
    // Get grid instance
    const scheduler = window.scheduler;
    if (!scheduler || !scheduler.grid) {
        console.error('❌ Error: Scheduler not found. Make sure the app is loaded.');
        return;
    }
    
    const grid = scheduler.grid;
    const viewport = document.querySelector('.vsg-viewport');
    
    if (!viewport) {
        console.error('❌ Error: Grid viewport not found (.vsg-viewport)');
        return;
    }
    
    // Check if grid has data
    const data = grid['data'] || [];
    if (data.length === 0) {
        console.error('❌ Error: Grid has no data. Add tasks first.');
        return;
    }
    
    console.log(`Grid found:`);
    console.log(`  - Data rows: ${data.length}`);
    console.log(`  - Viewport: ${viewport.clientWidth}x${viewport.clientHeight}px\n`);
    
    // Performance tracking
    const scrollEvents = [];
    const renderTimings = [];
    let lastScrollTime = 0;
    let lastRenderTime = 0;
    let scrollEventCount = 0;
    let renderCount = 0;
    
    // Track when rows actually update
    const originalUpdateVisibleRows = grid['_updateVisibleRows'];
    if (!originalUpdateVisibleRows) {
        console.error('❌ Error: _updateVisibleRows method not accessible.');
        return;
    }
    
    // Wrap _updateVisibleRows to track render timing
    grid['_updateVisibleRows'] = function() {
        const renderStart = performance.now();
        const scrollTime = lastScrollTime;
        const timeSinceScroll = scrollTime > 0 ? renderStart - scrollTime : 0;
        
        originalUpdateVisibleRows.call(this);
        
        const renderEnd = performance.now();
        const renderDuration = renderEnd - renderStart;
        
        renderTimings.push({
            scrollTime,
            renderStart,
            renderEnd,
            timeSinceScroll,
            renderDuration
        });
        
        renderCount++;
        lastRenderTime = renderEnd;
    };
    
    // Track scroll events
    const scrollListener = () => {
        const now = performance.now();
        const scrollTop = viewport.scrollTop;
        const scrollLeft = viewport.scrollLeft;
        
        scrollEvents.push({
            time: now,
            scrollTop,
            scrollLeft,
            timeSinceLastScroll: lastScrollTime > 0 ? now - lastScrollTime : 0
        });
        
        lastScrollTime = now;
        scrollEventCount++;
    };
    
    viewport.addEventListener('scroll', scrollListener, { passive: true });
    
    // Instructions for user
    console.log('📋 TEST INSTRUCTIONS:');
    console.log('1. Scroll VERTICALLY using your mouse wheel or trackpad');
    console.log('2. Scroll for about 5-10 seconds');
    console.log('3. Try both slow and fast scrolling');
    console.log('4. Also try HORIZONTAL scrolling');
    console.log('5. The test will automatically stop after 10 seconds\n');
    console.log('⏱️  Starting test in 3 seconds...\n');
    
    // Start test after countdown
    setTimeout(() => {
        console.log('✅ Test started! Start scrolling now...\n');
        
        const testDuration = 10000; // 10 seconds
        const startTime = performance.now();
        
        // Monitor scroll activity
        const monitorInterval = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const remaining = Math.ceil((testDuration - elapsed) / 1000);
            
            if (remaining > 0 && remaining <= 5) {
                console.log(`⏱️  ${remaining} seconds remaining...`);
            }
            
            if (elapsed >= testDuration) {
                clearInterval(monitorInterval);
                viewport.removeEventListener('scroll', scrollListener);
                
                // Restore original method
                grid['_updateVisibleRows'] = originalUpdateVisibleRows;
                
                analyzeResults();
            }
        }, 1000);
    }, 3000);
    
    function analyzeResults() {
        console.log('\n=== Scroll Responsiveness Results ===\n');
        
        if (scrollEvents.length === 0) {
            console.log('⚠️  No scroll events detected.');
            console.log('Please scroll the grid and run the test again.');
            return;
        }
        
        console.log(`📊 Test Statistics:`);
        console.log(`  Total scroll events: ${scrollEvents.length}`);
        console.log(`  Total renders: ${renderCount}`);
        console.log(`  Test duration: 10 seconds`);
        console.log(`  Scroll events per second: ${(scrollEvents.length / 10).toFixed(1)}`);
        console.log(`  Renders per second: ${(renderCount / 10).toFixed(1)}\n`);
        
        // Calculate render responsiveness
        const renderDelays = renderTimings
            .filter(t => t.timeSinceScroll > 0)
            .map(t => t.timeSinceScroll);
        
        if (renderDelays.length > 0) {
            const avgDelay = renderDelays.reduce((a, b) => a + b, 0) / renderDelays.length;
            const maxDelay = Math.max(...renderDelays);
            const minDelay = Math.min(...renderDelays);
            
            // Calculate percentiles
            const sortedDelays = [...renderDelays].sort((a, b) => a - b);
            const p50 = sortedDelays[Math.floor(sortedDelays.length * 0.50)];
            const p95 = sortedDelays[Math.floor(sortedDelays.length * 0.95)];
            const p99 = sortedDelays[Math.floor(sortedDelays.length * 0.99)];
            
            console.log(`⏱️  Render Responsiveness (Time from scroll to render):`);
            console.log(`  Average delay: ${avgDelay.toFixed(2)}ms`);
            console.log(`  Min delay: ${minDelay.toFixed(2)}ms`);
            console.log(`  Max delay: ${maxDelay.toFixed(2)}ms`);
            console.log(`  50th percentile: ${p50.toFixed(2)}ms`);
            console.log(`  95th percentile: ${p95.toFixed(2)}ms`);
            console.log(`  99th percentile: ${p99.toFixed(2)}ms\n`);
            
            // Assessment
            console.log(`📈 Responsiveness Assessment:`);
            if (avgDelay < 16) {
                console.log(`  ✅ Excellent: Average delay < 16ms (keeps up with scroll)`);
            } else if (avgDelay < 33) {
                console.log(`  ⚠️  Good: Average delay < 33ms (slight lag)`);
            } else {
                console.log(`  ❌ Poor: Average delay > 33ms (noticeable lag)`);
            }
            
            if (maxDelay > 100) {
                console.log(`  ⚠️  Warning: Max delay ${maxDelay.toFixed(2)}ms is very high`);
            }
            
            if (p95 > 50) {
                console.log(`  ⚠️  Warning: 95th percentile ${p95.toFixed(2)}ms indicates frequent lag`);
            }
        } else {
            console.log(`⚠️  No render timing data collected`);
        }
        
        // Check if renders happen during active scrolling
        const activeScrollRenders = renderTimings.filter(t => {
            // Check if render happened within 100ms of a scroll event
            return scrollEvents.some(e => Math.abs(e.time - t.renderStart) < 100);
        });
        
        const renderDuringScrollPercentage = (activeScrollRenders.length / renderCount) * 100;
        
        console.log(`\n🎯 Rendering During Scroll:`);
        console.log(`  Renders during active scrolling: ${activeScrollRenders.length} (${renderDuringScrollPercentage.toFixed(1)}%)`);
        
        if (renderDuringScrollPercentage > 50) {
            console.log(`  ✅ Good: Most renders happen during active scrolling`);
        } else {
            console.log(`  ⚠️  Warning: Many renders are deferred (causes laggy feel)`);
        }
        
        // Scroll event frequency analysis
        const scrollIntervals = scrollEvents
            .slice(1)
            .map((e, i) => e.time - scrollEvents[i].time)
            .filter(i => i > 0);
        
        if (scrollIntervals.length > 0) {
            const avgInterval = scrollIntervals.reduce((a, b) => a + b, 0) / scrollIntervals.length;
            const minInterval = Math.min(...scrollIntervals);
            
            console.log(`\n📊 Scroll Event Frequency:`);
            console.log(`  Average interval: ${avgInterval.toFixed(2)}ms`);
            console.log(`  Min interval: ${minInterval.toFixed(2)}ms`);
            console.log(`  Effective scroll rate: ${(1000 / avgInterval).toFixed(1)} events/sec\n`);
        }
        
        // Horizontal scroll analysis
        const horizontalScrolls = scrollEvents.filter(e => Math.abs(e.scrollLeft - (scrollEvents[0]?.scrollLeft || 0)) > 1);
        
        if (horizontalScrolls.length > 0) {
            console.log(`📊 Horizontal Scroll:`);
            console.log(`  Horizontal scroll events: ${horizontalScrolls.length}`);
            console.log(`  Percentage of total: ${(horizontalScrolls.length / scrollEvents.length * 100).toFixed(1)}%`);
        }
        
        // Detailed breakdown
        console.log(`\n📋 Delay Breakdown:`);
        const ranges = [
            { min: 0, max: 8, label: 'Excellent (<8ms)', emoji: '🟢' },
            { min: 8, max: 16, label: 'Good (8-16ms)', emoji: '🟢' },
            { min: 16, max: 33, label: 'Acceptable (16-33ms)', emoji: '🟡' },
            { min: 33, max: 50, label: 'Poor (33-50ms)', emoji: '🟠' },
            { min: 50, max: Infinity, label: 'Very Poor (>50ms)', emoji: '🔴' }
        ];
        
        ranges.forEach(range => {
            const count = renderDelays.filter(d => d >= range.min && d < range.max).length;
            const percentage = renderDelays.length > 0 ? (count / renderDelays.length) * 100 : 0;
            if (count > 0) {
                console.log(`  ${range.emoji} ${range.label}: ${count} renders (${percentage.toFixed(1)}%)`);
            }
        });
        
        // Recommendations
        console.log(`\n💡 Recommendations:`);
        let avgDelay = null;
        let maxDelay = null;
        
        if (renderDelays.length > 0) {
            avgDelay = renderDelays.reduce((a, b) => a + b, 0) / renderDelays.length;
            maxDelay = Math.max(...renderDelays);
            
            if (avgDelay > 33) {
                console.log(`  ❌ Reduce scroll debouncing - current delay is too high`);
                console.log(`  ❌ Consider immediate rendering during scroll`);
                console.log(`  ❌ Reduce or remove setTimeout delays`);
            } else if (avgDelay > 16) {
                console.log(`  ⚠️  Consider reducing debounce delays for better responsiveness`);
            } else {
                console.log(`  ✅ Responsiveness is excellent`);
            }
        } else {
            console.log(`  ⚠️  No render delay data available for recommendations`);
        }
        
        if (renderDuringScrollPercentage < 50) {
            console.log(`  ⚠️  Enable rendering during active scrolling`);
            console.log(`  ⚠️  Current deferral strategy causes laggy feel`);
        } else {
            console.log(`  ✅ Rendering during active scrolling is working well`);
        }
        
        return {
            scrollEvents: scrollEvents.length,
            renders: renderCount,
            avgDelay: avgDelay,
            maxDelay: maxDelay,
            renderDuringScrollPercentage
        };
    }
})();

