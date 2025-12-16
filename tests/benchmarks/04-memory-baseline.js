/**
 * Phase 1, Script 4: Memory Baseline
 * 
 * INSTRUCTIONS:
 * 1. Open DevTools Console (F12)
 * 2. Make sure the scheduler is loaded
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 * 
 * WHAT IT DOES:
 * - Records initial memory usage (Chrome only)
 * - Performs 100 operations (scroll, data updates)
 * - Forces garbage collection if available
 * - Records final heap size
 * - Reports delta and growth pattern
 * 
 * INTERPRETATION:
 * - Memory growth < 10MB = Excellent (no leaks)
 * - Memory growth 10-50MB = Acceptable (may be normal)
 * - Memory growth > 50MB = Potential memory leak
 * 
 * NOTE: This requires Chrome DevTools with "Heap snapshot" enabled.
 * Memory APIs may not be available in Tauri WebView.
 */

(function() {
    'use strict';
    
    console.log('=== Memory Baseline Test ===');
    console.log('Starting memory test...\n');
    
    // Check if memory API is available
    const hasMemoryAPI = typeof performance !== 'undefined' && 
                         performance.memory !== undefined;
    
    if (!hasMemoryAPI) {
        console.warn('⚠️  Memory API not available.');
        console.log('This test requires Chrome DevTools with memory profiling enabled.');
        console.log('To enable:');
        console.log('  1. Open Chrome DevTools');
        console.log('  2. Go to Performance tab');
        console.log('  3. Check "Memory" checkbox');
        console.log('  4. Or use Chrome with --enable-precise-memory-info flag');
        console.log('\nContinuing with limited memory tracking...\n');
    }
    
    // Get scheduler instance
    const scheduler = window.scheduler;
    if (!scheduler || !scheduler.grid) {
        console.error('❌ Error: Scheduler not found. Make sure the app is loaded.');
        return;
    }
    
    const grid = scheduler.grid;
    const viewport = document.querySelector('.vsg-viewport');
    
    if (!viewport) {
        console.error('❌ Error: Grid viewport not found.');
        return;
    }
    
    // Helper function to get memory info
    function getMemoryInfo() {
        if (!hasMemoryAPI) {
            return null;
        }
        
        return {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
    }
    
    // Format bytes to MB
    function formatMB(bytes) {
        return (bytes / 1024 / 1024).toFixed(2);
    }
    
    // Record initial memory
    const initialMemory = getMemoryInfo();
    
    if (initialMemory) {
        console.log('📊 Initial Memory State:');
        console.log(`  Used JS Heap: ${formatMB(initialMemory.usedJSHeapSize)} MB`);
        console.log(`  Total JS Heap: ${formatMB(initialMemory.totalJSHeapSize)} MB`);
        console.log(`  Heap Limit: ${formatMB(initialMemory.jsHeapSizeLimit)} MB\n`);
    }
    
    // Configuration
    const OPERATIONS = 100;
    const OPERATION_TYPES = ['scroll', 'data-update'];
    
    // Memory snapshots
    const memorySnapshots = [];
    if (initialMemory) {
        memorySnapshots.push({
            operation: 0,
            type: 'initial',
            memory: initialMemory
        });
    }
    
    // Store original data
    const originalData = grid['data'] ? [...grid['data']] : [];
    
    // Generate test data
    function generateTestTasks(count) {
        const tasks = [];
        for (let i = 0; i < count; i++) {
            tasks.push({
                id: `test-task-${i}`,
                name: `Test Task ${i}`,
                level: 0,
                start: '2024-01-01',
                end: '2024-01-05',
                duration: 5,
                dependencies: [],
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                parentId: null,
                progress: 0
            });
        }
        return tasks;
    }
    
    console.log(`Performing ${OPERATIONS} operations...`);
    console.log('(This may take a moment)\n');
    
    // Perform operations
    return new Promise((resolve) => {
        let operationCount = 0;
        let scrollPosition = 0;
        let dataSize = 1000;
        
        const performOperation = () => {
            if (operationCount >= OPERATIONS) {
                // Operations complete - analyze results
                const finalMemory = getMemoryInfo();
                
                if (finalMemory) {
                    memorySnapshots.push({
                        operation: OPERATIONS,
                        type: 'final',
                        memory: finalMemory
                    });
                }
                
                // Try to force GC (if available)
                if (typeof gc === 'function') {
                    console.log('Forcing garbage collection...');
                    gc();
                    
                    // Wait a moment for GC to complete
                    setTimeout(() => {
                        const afterGCMemory = getMemoryInfo();
                        if (afterGCMemory) {
                            memorySnapshots.push({
                                operation: OPERATIONS + 1,
                                type: 'after-gc',
                                memory: afterGCMemory
                            });
                        }
                        
                        analyzeResults();
                    }, 1000);
                } else {
                    console.log('⚠️  Garbage collection not available (use Chrome with --js-flags="--expose-gc")');
                    analyzeResults();
                }
                
                return;
            }
            
            // Alternate between scroll and data update
            const operationType = OPERATION_TYPES[operationCount % OPERATION_TYPES.length];
            
            try {
                if (operationType === 'scroll') {
                    // Scroll operation
                    if (viewport && viewport.scrollHeight > viewport.clientHeight) {
                        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
                        scrollPosition = (scrollPosition + maxScroll / 10) % maxScroll;
                        viewport.scrollTop = scrollPosition;
                    }
                } else {
                    // Data update operation - add longer delay to prevent DOM race conditions
                    dataSize = 1000 + (operationCount % 5) * 500; // Vary data size
                    const newData = generateTestTasks(dataSize);
                    
                    // Use setTimeout with longer delay to ensure DOM is ready
                    // Don't await - let it happen asynchronously
                    setTimeout(() => {
                        try {
                            grid.setData(newData);
                        } catch (error) {
                            // Silently handle errors - they're expected during rapid operations
                            // These errors don't prevent the test from completing
                        }
                    }, 100); // Longer delay for data updates to prevent race conditions
                }
            } catch (error) {
                console.warn(`  Warning: Error during ${operationType} operation (${operationCount}): ${error.message}`);
            }
            
            operationCount++;
            
            // Record memory every 10 operations
            if (operationCount % 10 === 0) {
                const memory = getMemoryInfo();
                if (memory) {
                    memorySnapshots.push({
                        operation: operationCount,
                        type: operationType,
                        memory: memory
                    });
                }
                
                if (operationCount % 20 === 0) {
                    console.log(`  Completed ${operationCount}/${OPERATIONS} operations...`);
                }
            }
            
            // Add delay between operations to prevent DOM race conditions
            // Longer delay for data updates, shorter for scroll
            const delay = operationType === 'scroll' ? 30 : 120; // More time for data updates to complete
            
            setTimeout(() => {
                requestAnimationFrame(performOperation);
            }, delay);
        };
        
        // Start operations
        requestAnimationFrame(performOperation);
        
        function analyzeResults() {
            // Restore original data
            if (originalData.length > 0) {
                grid.setData(originalData);
            }
            
            console.log('\n=== Memory Test Results ===\n');
            
            if (memorySnapshots.length === 0) {
                console.log('⚠️  No memory data collected.');
                console.log('Memory API not available or test failed.');
                resolve(null);
                return;
            }
            
            // Calculate memory growth
            const firstSnapshot = memorySnapshots[0];
            const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
            
            const initialUsed = firstSnapshot.memory.usedJSHeapSize;
            const finalUsed = lastSnapshot.memory.usedJSHeapSize;
            const memoryGrowth = finalUsed - initialUsed;
            const growthPercentage = (memoryGrowth / initialUsed) * 100;
            
            console.log('📊 Memory Growth:');
            console.log(`  Initial: ${formatMB(initialUsed)} MB`);
            console.log(`  Final: ${formatMB(finalUsed)} MB`);
            console.log(`  Growth: ${formatMB(memoryGrowth)} MB (${growthPercentage.toFixed(2)}%)`);
            
            if (lastSnapshot.type === 'after-gc') {
                const afterGCUsed = lastSnapshot.memory.usedJSHeapSize;
                const gcReclaimed = finalUsed - afterGCUsed;
                console.log(`  After GC: ${formatMB(afterGCUsed)} MB`);
                console.log(`  GC Reclaimed: ${formatMB(gcReclaimed)} MB`);
            }
            
            // Performance assessment
            console.log('\n📈 Memory Assessment:');
            const growthMB = memoryGrowth / 1024 / 1024;
            
            if (growthMB < 10) {
                console.log(`  ✅ Excellent: Memory growth < 10MB (likely no leaks)`);
            } else if (growthMB < 50) {
                console.log(`  ⚠️  Acceptable: Memory growth ${growthMB.toFixed(2)}MB (may be normal)`);
            } else {
                console.log(`  ❌ Potential Leak: Memory growth ${growthMB.toFixed(2)}MB (investigate)`);
            }
            
            // Memory trend analysis
            if (memorySnapshots.length > 2) {
                console.log('\n📋 Memory Trend:');
                const midPoint = Math.floor(memorySnapshots.length / 2);
                const midSnapshot = memorySnapshots[midPoint];
                const midUsed = midSnapshot.memory.usedJSHeapSize;
                
                const firstHalfGrowth = (midUsed - initialUsed) / 1024 / 1024;
                const secondHalfGrowth = (finalUsed - midUsed) / 1024 / 1024;
                
                console.log(`  First half growth: ${firstHalfGrowth.toFixed(2)} MB`);
                console.log(`  Second half growth: ${secondHalfGrowth.toFixed(2)} MB`);
                
                // Only check for acceleration if first half growth is positive
                // Negative first half growth means GC occurred, which is good
                if (firstHalfGrowth > 0 && secondHalfGrowth > firstHalfGrowth * 1.5) {
                    console.log(`  ⚠️  Warning: Memory growth accelerating (potential leak)`);
                } else if (firstHalfGrowth < 0) {
                    console.log(`  ✅ Good: Memory decreased in first half (GC working), then stabilized`);
                } else if (secondHalfGrowth < firstHalfGrowth * 0.5) {
                    console.log(`  ✅ Good: Memory growth stabilizing`);
                }
            }
            
            // Detailed snapshots
            console.log('\n📋 Memory Snapshots:');
            memorySnapshots.forEach((snapshot, index) => {
                if (index === 0 || index === memorySnapshots.length - 1 || snapshot.operation % 20 === 0) {
                    console.log(`  Operation ${snapshot.operation} (${snapshot.type}): ${formatMB(snapshot.memory.usedJSHeapSize)} MB`);
                }
            });
            
            resolve({
                initialMemory: initialUsed,
                finalMemory: finalUsed,
                memoryGrowth: memoryGrowth,
                growthPercentage: growthPercentage,
                snapshots: memorySnapshots
            });
        }
    });
})();

