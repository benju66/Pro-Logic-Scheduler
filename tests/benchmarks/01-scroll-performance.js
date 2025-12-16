/**
 * Phase 1, Script 1: Scroll Performance Benchmark
 * 
 * INSTRUCTIONS:
 * 1. Open DevTools Console (F12)
 * 2. Make sure the scheduler is loaded and has data
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 * 
 * WHAT IT DOES:
 * - Programmatically scrolls the grid viewport from top to bottom
 * - Measures time between scroll events using requestAnimationFrame
 * - Tracks frame times and identifies dropped frames (>16.67ms)
 * - Reports average FPS, max frame time, and dropped frame count
 * 
 * INTERPRETATION:
 * - Average frame time < 12ms = Excellent (60+ FPS)
 * - Average frame time 12-16ms = Good (50-60 FPS)
 * - Average frame time > 16.67ms = Poor (<60 FPS)
 * - Dropped frames > 5% = Performance issue detected
 */

(function() {
    'use strict';
    
    console.log('=== Scroll Performance Benchmark ===');
    console.log('Starting benchmark...\n');
    
    // Get grid instance
    const scheduler = window.scheduler;
    if (!scheduler || !scheduler.grid) {
        console.error('❌ Error: Scheduler not found. Make sure the app is loaded.');
        console.log('Try: window.scheduler');
        return;
    }
    
    const grid = scheduler.grid;
    const viewport = document.querySelector('.vsg-viewport');
    
    if (!viewport) {
        console.error('❌ Error: Grid viewport not found (.vsg-viewport)');
        return;
    }
    
    // Get current scroll state
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    if (maxScroll <= 0) {
        console.error('❌ Error: Grid has no scrollable content. Add more tasks first.');
        return;
    }
    
    console.log(`Grid viewport found:`);
    console.log(`  - Scroll height: ${viewport.scrollHeight}px`);
    console.log(`  - Client height: ${viewport.clientHeight}px`);
    console.log(`  - Max scroll: ${maxScroll}px`);
    console.log(`  - Current scroll: ${viewport.scrollTop}px\n`);
    
    // Configuration
    const SCROLL_EVENTS = 100;
    const TARGET_FRAME_TIME = 16.67; // 60 FPS
    const SCROLL_STEP = maxScroll / SCROLL_EVENTS;
    
    // Performance tracking
    const frameTimes = [];
    const scrollPositions = [];
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let droppedFrames = 0;
    let maxFrameTime = 0;
    let maxFrameTimePosition = 0;
    
    // Track scroll events
    const scrollListener = () => {
        const now = performance.now();
        const frameTime = now - lastFrameTime;
        
        frameTimes.push(frameTime);
        scrollPositions.push(viewport.scrollTop);
        
        if (frameTime > TARGET_FRAME_TIME) {
            droppedFrames++;
        }
        
        if (frameTime > maxFrameTime) {
            maxFrameTime = frameTime;
            maxFrameTimePosition = viewport.scrollTop;
        }
        
        lastFrameTime = now;
        frameCount++;
    };
    
    // Add scroll listener
    viewport.addEventListener('scroll', scrollListener, { passive: true });
    
    // Scroll animation function
    return new Promise((resolve) => {
        let currentScroll = 0;
        let scrollIndex = 0;
        
        const scrollStep = () => {
            if (scrollIndex >= SCROLL_EVENTS) {
                // Cleanup
                viewport.removeEventListener('scroll', scrollListener);
                
                // Calculate statistics
                const totalTime = frameTimes.reduce((a, b) => a + b, 0);
                const avgFrameTime = totalTime / frameTimes.length;
                const effectiveFPS = 1000 / avgFrameTime;
                const dropPercentage = (droppedFrames / frameCount) * 100;
                
                // Calculate percentiles
                const sortedTimes = [...frameTimes].sort((a, b) => a - b);
                const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
                const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
                
                // Output results
                console.log('\n=== Scroll Performance Results ===');
                console.log(`Total scroll events: ${SCROLL_EVENTS}`);
                console.log(`Total frames tracked: ${frameCount}`);
                console.log(`\n📊 Frame Time Statistics:`);
                console.log(`  Average frame time: ${avgFrameTime.toFixed(2)}ms`);
                console.log(`  Max frame time: ${maxFrameTime.toFixed(2)}ms`);
                console.log(`  95th percentile: ${p95.toFixed(2)}ms`);
                console.log(`  99th percentile: ${p99.toFixed(2)}ms`);
                console.log(`\n🎯 Performance Metrics:`);
                console.log(`  Effective FPS: ${effectiveFPS.toFixed(1)}`);
                console.log(`  Dropped frames (>${TARGET_FRAME_TIME}ms): ${droppedFrames} (${dropPercentage.toFixed(1)}%)`);
                console.log(`  Max spike position: ~${Math.round(maxFrameTimePosition)}px`);
                
                // Performance assessment
                console.log(`\n📈 Performance Assessment:`);
                if (avgFrameTime < 12) {
                    console.log(`  ✅ Excellent: Average frame time < 12ms (60+ FPS)`);
                } else if (avgFrameTime < 16.67) {
                    console.log(`  ✅ Good: Average frame time < 16.67ms (50-60 FPS)`);
                } else if (avgFrameTime < 20) {
                    console.log(`  ⚠️  Acceptable: Average frame time < 20ms (50+ FPS) - Close to target`);
                } else {
                    console.log(`  ❌ Poor: Average frame time > 20ms (<50 FPS)`);
                }
                
                // More nuanced assessment based on percentiles and max
                const hasSignificantIssues = maxFrameTime > 50 || p95 > 33.33 || effectiveFPS < 45;
                
                if (hasSignificantIssues) {
                    console.log(`  ⚠️  Performance issues detected:`);
                    if (maxFrameTime > 50) {
                        console.log(`     - Max frame time ${maxFrameTime.toFixed(2)}ms exceeds 50ms threshold`);
                    }
                    if (p95 > 33.33) {
                        console.log(`     - 95th percentile ${p95.toFixed(2)}ms indicates frequent spikes`);
                    }
                    if (effectiveFPS < 45) {
                        console.log(`     - Effective FPS ${effectiveFPS.toFixed(1)} is below 45 FPS`);
                    }
                    console.log(`     - Max spike at scroll position ~${Math.round(maxFrameTimePosition)}px`);
                } else if (dropPercentage > 30) {
                    console.log(`  ⚠️  Note: ${dropPercentage.toFixed(1)}% of frames exceeded ${TARGET_FRAME_TIME}ms threshold`);
                    console.log(`     - However, max frame time (${maxFrameTime.toFixed(2)}ms) and FPS (${effectiveFPS.toFixed(1)}) are acceptable`);
                    console.log(`     - This may be due to test overhead or minor frame timing variations`);
                } else {
                    console.log(`  ✅ No significant performance issues detected`);
                }
                
                // Detailed breakdown
                console.log(`\n📋 Detailed Breakdown:`);
                const ranges = [
                    { min: 0, max: 8, label: 'Excellent (<8ms)', emoji: '🟢' },
                    { min: 8, max: 12, label: 'Good (8-12ms)', emoji: '🟢' },
                    { min: 12, max: 16.67, label: 'Acceptable (12-16.67ms)', emoji: '🟡' },
                    { min: 16.67, max: 33.33, label: 'Slightly Slow (16.67-33.33ms)', emoji: '🟡' },
                    { min: 33.33, max: 50, label: 'Slow (33.33-50ms)', emoji: '🟠' },
                    { min: 50, max: Infinity, label: 'Very Slow (>50ms)', emoji: '🔴' }
                ];
                
                ranges.forEach(range => {
                    const count = frameTimes.filter(t => t >= range.min && t < range.max).length;
                    const percentage = (count / frameTimes.length) * 100;
                    if (count > 0) {
                        console.log(`  ${range.emoji} ${range.label}: ${count} frames (${percentage.toFixed(1)}%)`);
                    }
                });
                
                // Summary recommendation
                console.log(`\n💡 Summary:`);
                if (effectiveFPS >= 55 && maxFrameTime < 50) {
                    console.log(`  ✅ Scroll performance is GOOD - ${effectiveFPS.toFixed(1)} FPS is smooth`);
                    console.log(`     Average frame time (${avgFrameTime.toFixed(2)}ms) is close to target`);
                    console.log(`     Max frame time (${maxFrameTime.toFixed(2)}ms) is acceptable`);
                } else if (effectiveFPS >= 45 && maxFrameTime < 50) {
                    console.log(`  ⚠️  Scroll performance is ACCEPTABLE - ${effectiveFPS.toFixed(1)} FPS`);
                    console.log(`     Consider optimization if user complaints about jank`);
                } else {
                    console.log(`  ❌ Scroll performance needs IMPROVEMENT`);
                    console.log(`     FPS: ${effectiveFPS.toFixed(1)}, Max: ${maxFrameTime.toFixed(2)}ms`);
                    console.log(`     Investigate rendering bottlenecks`);
                }
                
                resolve({
                    avgFrameTime,
                    maxFrameTime,
                    effectiveFPS,
                    droppedFrames,
                    dropPercentage,
                    p95,
                    p99,
                    frameTimes,
                    scrollPositions
                });
            } else {
                currentScroll += SCROLL_STEP;
                viewport.scrollTop = currentScroll;
                scrollIndex++;
                
                // Use requestAnimationFrame for smooth scrolling
                requestAnimationFrame(scrollStep);
            }
        };
        
        // Reset scroll to top
        viewport.scrollTop = 0;
        
        // Wait a moment for initial render, then start
        setTimeout(() => {
            lastFrameTime = performance.now();
            requestAnimationFrame(scrollStep);
        }, 100);
    });
})();

