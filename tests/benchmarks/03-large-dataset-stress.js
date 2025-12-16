/**
 * Phase 1, Script 3: Large Dataset Stress Test
 * 
 * INSTRUCTIONS:
 * 1. Open DevTools Console (F12)
 * 2. Make sure the scheduler is loaded
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 * 
 * WHAT IT DOES:
 * - Generates synthetic task data (1000, 5000, 10000 tasks)
 * - Injects into the grid via setData()
 * - Measures initial render time
 * - Runs scroll benchmark at each dataset size
 * - Reports performance at each dataset size
 * 
 * INTERPRETATION:
 * - Initial render should scale linearly or sub-linearly
 * - Scroll performance should remain consistent regardless of dataset size
 * - Memory usage should be reasonable (virtualization working)
 */

(function() {
    'use strict';
    
    console.log('=== Large Dataset Stress Test ===');
    console.log('Starting stress test...\n');
    
    // Get scheduler instance
    const scheduler = window.scheduler;
    if (!scheduler || !scheduler.grid) {
        console.error('❌ Error: Scheduler not found. Make sure the app is loaded.');
        return;
    }
    
    const grid = scheduler.grid;
    
    // Helper function to generate synthetic tasks
    function generateTasks(count) {
        const tasks = [];
        const startDate = '2024-01-01';
        
        for (let i = 0; i < count; i++) {
            tasks.push({
                id: `task-${i}`,
                name: `Task ${i + 1}`,
                level: 0,
                start: startDate,
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
    
    // Test dataset sizes
    const DATASET_SIZES = [1000, 5000, 10000];
    const results = [];
    
    // Store original data to restore later
    const originalData = grid['data'] ? [...grid['data']] : [];
    
    console.log('⚠️  Note: This will replace your current data temporarily.');
    console.log('Original data will be restored after the test.\n');
    
    // Run tests for each dataset size
    async function runTest(size) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing with ${size.toLocaleString()} tasks`);
        console.log('='.repeat(60));
        
        // Generate tasks
        console.log(`Generating ${size.toLocaleString()} synthetic tasks...`);
        const tasks = generateTasks(size);
        
        // Measure initial render time
        console.log('Measuring initial render time...');
        const renderStart = performance.now();
        
        grid.setData(tasks);
        
        // Wait for render to complete (use RAF to ensure DOM updates)
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const renderEnd = performance.now();
                    const renderTime = renderEnd - renderStart;
                    
                    console.log(`✅ Initial render completed: ${renderTime.toFixed(2)}ms`);
                    
                    // Measure scroll performance (simplified version)
                    console.log('Measuring scroll performance...');
                    const viewport = document.querySelector('.vsg-viewport');
                    if (viewport) {
                        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
                        const scrollStart = performance.now();
                        
                        // Scroll to middle
                        viewport.scrollTop = maxScroll / 2;
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                const scrollEnd = performance.now();
                                const scrollTime = scrollEnd - scrollStart;
                                
                                console.log(`✅ Scroll to middle: ${scrollTime.toFixed(2)}ms`);
                                
                                // Scroll to bottom
                                const scrollBottomStart = performance.now();
                                viewport.scrollTop = maxScroll;
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        const scrollBottomEnd = performance.now();
                                        const scrollBottomTime = scrollBottomEnd - scrollBottomStart;
                                        
                                        console.log(`✅ Scroll to bottom: ${scrollBottomTime.toFixed(2)}ms`);
                                        
                                        // Get visible row count
                                        const visibleCount = grid['_getVisibleRowCount'] ? grid['_getVisibleRowCount'].call(grid) : 'unknown';
                                        const firstVisible = grid['firstVisibleIndex'] || 'unknown';
                                        const lastVisible = grid['lastVisibleIndex'] || 'unknown';
                                        
                                        console.log(`\n📊 Grid State:`);
                                        console.log(`  Visible row count: ${visibleCount}`);
                                        console.log(`  First visible index: ${firstVisible}`);
                                        console.log(`  Last visible index: ${lastVisible}`);
                                        console.log(`  Rendered rows: ${lastVisible !== 'unknown' && firstVisible !== 'unknown' ? lastVisible - firstVisible + 1 : 'unknown'}`);
                                        
                                        results.push({
                                            size,
                                            renderTime,
                                            scrollTime,
                                            scrollBottomTime,
                                            visibleCount,
                                            firstVisible,
                                            lastVisible
                                        });
                                        
                                        resolve();
                                    });
                                });
                            });
                        });
                    } else {
                        resolve();
                    }
                });
            });
        });
    }
    
    // Run all tests sequentially
    (async () => {
        for (const size of DATASET_SIZES) {
            await runTest(size);
            
            // Small delay between tests
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Restore original data
        console.log(`\n${'='.repeat(60)}`);
        console.log('Restoring original data...');
        if (originalData.length > 0) {
            // Wait a moment for any pending operations to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            
            try {
                grid.setData(originalData);
                // Wait for render to complete
                await new Promise(resolve => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            resolve();
                        });
                    });
                });
                console.log(`✅ Restored ${originalData.length} original tasks`);
            } catch (error) {
                console.warn(`⚠️  Error restoring data (non-critical): ${error.message}`);
                console.log('Original data may need to be restored manually');
            }
        } else {
            console.log('⚠️  No original data to restore');
        }
        
        // Output summary
        console.log(`\n${'='.repeat(60)}`);
        console.log('=== Stress Test Summary ===');
        console.log('='.repeat(60));
        
        console.log('\n📊 Performance by Dataset Size:\n');
        results.forEach(result => {
            console.log(`${result.size.toLocaleString().padStart(6)} tasks:`);
            console.log(`  Initial render: ${result.renderTime.toFixed(2)}ms`);
            console.log(`  Scroll to middle: ${result.renderTime.toFixed(2)}ms`);
            console.log(`  Scroll to bottom: ${result.scrollBottomTime.toFixed(2)}ms`);
            console.log(`  Rendered rows: ${result.firstVisible !== 'unknown' ? result.lastVisible - result.firstVisible + 1 : 'unknown'}`);
            console.log('');
        });
        
        // Performance analysis
        console.log('📈 Performance Analysis:\n');
        
        // Check if render time scales reasonably
        const renderTimes = results.map(r => r.renderTime);
        const firstRenderTime = renderTimes[0];
        const lastRenderTime = renderTimes[renderTimes.length - 1];
        const scaleFactor = lastRenderTime / firstRenderTime;
        const dataScaleFactor = DATASET_SIZES[DATASET_SIZES.length - 1] / DATASET_SIZES[0];
        
        console.log(`Render time scaling:`);
        console.log(`  Dataset size increased ${dataScaleFactor.toFixed(1)}x`);
        console.log(`  Render time increased ${scaleFactor.toFixed(2)}x`);
        
        if (scaleFactor < dataScaleFactor * 0.5) {
            console.log(`  ✅ Excellent: Render time scales sub-linearly (virtualization working well)`);
        } else if (scaleFactor < dataScaleFactor) {
            console.log(`  ⚠️  Good: Render time scales sub-linearly but could be better`);
        } else {
            console.log(`  ❌ Poor: Render time scales linearly or worse (virtualization may not be working)`);
        }
        
        // Check scroll performance consistency
        const scrollTimes = results.map(r => r.scrollBottomTime);
        const avgScrollTime = scrollTimes.reduce((a, b) => a + b, 0) / scrollTimes.length;
        const maxScrollTime = Math.max(...scrollTimes);
        const scrollVariance = maxScrollTime / avgScrollTime;
        
        console.log(`\nScroll performance consistency:`);
        console.log(`  Average scroll time: ${avgScrollTime.toFixed(2)}ms`);
        console.log(`  Max scroll time: ${maxScrollTime.toFixed(2)}ms`);
        console.log(`  Variance: ${scrollVariance.toFixed(2)}x`);
        
        if (scrollVariance < 1.5) {
            console.log(`  ✅ Excellent: Scroll performance is consistent across dataset sizes`);
        } else if (scrollVariance < 2) {
            console.log(`  ⚠️  Good: Scroll performance is mostly consistent`);
        } else {
            console.log(`  ❌ Poor: Scroll performance degrades with larger datasets`);
        }
        
        // Check virtualization effectiveness
        const renderedRows = results.map(r => 
            r.firstVisible !== 'unknown' ? r.lastVisible - r.firstVisible + 1 : null
        ).filter(r => r !== null);
        
        if (renderedRows.length > 0) {
            const avgRendered = renderedRows.reduce((a, b) => a + b, 0) / renderedRows.length;
            console.log(`\nVirtualization effectiveness:`);
            console.log(`  Average rendered rows: ${avgRendered.toFixed(0)}`);
            console.log(`  Dataset sizes tested: ${DATASET_SIZES.map(s => s.toLocaleString()).join(', ')}`);
            
            if (avgRendered < 100) {
                console.log(`  ✅ Excellent: Only ${avgRendered.toFixed(0)} rows rendered regardless of dataset size`);
            } else {
                console.log(`  ⚠️  Warning: ${avgRendered.toFixed(0)} rows rendered (may be high)`);
            }
        }
        
        return results;
    })();
})();

