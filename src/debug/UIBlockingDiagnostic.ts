/**
 * UI Blocking Diagnostic Tool
 * 
 * Run this in the browser console or import at app start to diagnose
 * why the UI is unresponsive.
 * 
 * Usage: 
 *   1. Import at top of main.ts: import './debug/UIBlockingDiagnostic';
 *   2. Or paste diagnoseUIBlocking() in browser console
 */

export function diagnoseUIBlocking(): void {
    console.log('='.repeat(60));
    console.log('🔍 UI BLOCKING DIAGNOSTIC STARTING');
    console.log('='.repeat(60));

    // Test 1: Check for invisible overlays
    console.log('\n📋 TEST 1: Checking for blocking overlays...');
    checkForOverlays();

    // Test 2: Check if click events reach the grid
    console.log('\n📋 TEST 2: Setting up click listener on document...');
    setupClickTracer();

    // Test 3: Check for JavaScript errors
    console.log('\n📋 TEST 3: Checking for pending errors...');
    checkForErrors();

    // Test 4: Check scheduler initialization state
    console.log('\n📋 TEST 4: Checking scheduler state...');
    checkSchedulerState();

    // Test 5: Check if grid rows exist
    console.log('\n📋 TEST 5: Checking grid DOM structure...');
    checkGridDOM();

    // Test 6: Check for blocking operations
    console.log('\n📋 TEST 6: Checking for main thread blocking...');
    checkMainThreadBlocking();

    console.log('\n' + '='.repeat(60));
    console.log('🔍 DIAGNOSTIC COMPLETE - Check results above');
    console.log('💡 Now try clicking on the grid and watch console');
    console.log('='.repeat(60));
}

function checkForOverlays(): void {
    const body = document.body;
    const allElements = document.querySelectorAll('*');
    const blockingElements: HTMLElement[] = [];

    allElements.forEach((el) => {
        const element = el as HTMLElement;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        // Check for full-screen or large overlays
        const isLargeElement = rect.width > window.innerWidth * 0.5 && 
                               rect.height > window.innerHeight * 0.5;
        
        // Check for high z-index
        const zIndex = parseInt(style.zIndex) || 0;
        const isHighZ = zIndex > 100;

        // Check for fixed/absolute positioning covering viewport
        const isFixed = style.position === 'fixed';
        const isAbsolute = style.position === 'absolute';
        
        // Check pointer-events
        const blocksPointer = style.pointerEvents === 'auto' || style.pointerEvents === '';

        if (isLargeElement && isHighZ && (isFixed || isAbsolute) && blocksPointer) {
            blockingElements.push(element);
        }
    });

    if (blockingElements.length > 0) {
        console.log('⚠️ POTENTIAL BLOCKING ELEMENTS FOUND:');
        blockingElements.forEach((el, i) => {
            const style = window.getComputedStyle(el);
            console.log(`  ${i + 1}. <${el.tagName.toLowerCase()}> class="${el.className}"`);
            console.log(`     z-index: ${style.zIndex}, position: ${style.position}`);
            console.log(`     pointer-events: ${style.pointerEvents}`);
            console.log(`     display: ${style.display}, visibility: ${style.visibility}`);
            console.log(`     Element:`, el);
        });
    } else {
        console.log('✅ No obvious blocking overlays detected');
    }

    // Specifically check known modal/overlay elements
    const knownOverlays = [
        '#settings-modal-overlay',
        '.modal-overlay',
        '.context-menu-backdrop',
        '.loading-overlay',
        '[class*="overlay"]',
        '[class*="backdrop"]',
        '[class*="modal"]',
    ];

    console.log('\n  Checking known overlay selectors:');
    knownOverlays.forEach(selector => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && 
                             style.visibility !== 'hidden' && 
                             style.opacity !== '0';
            console.log(`  ${selector}: ${isVisible ? '⚠️ VISIBLE' : '✅ hidden'}`);
            if (isVisible) {
                console.log(`    display: ${style.display}, visibility: ${style.visibility}, opacity: ${style.opacity}`);
            }
        }
    });
}

function setupClickTracer(): void {
    // Remove any existing tracer
    document.removeEventListener('click', clickTracer, true);
    document.removeEventListener('mousedown', mousedownTracer, true);

    // Add capture phase listeners to see ALL clicks
    document.addEventListener('click', clickTracer, true);
    document.addEventListener('mousedown', mousedownTracer, true);

    console.log('✅ Click tracers installed');
    console.log('   Now click anywhere on the grid - watch for console output');
}

function clickTracer(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    console.log('🖱️ CLICK detected:', {
        target: `<${target.tagName.toLowerCase()}> .${target.className}`,
        x: e.clientX,
        y: e.clientY,
        defaultPrevented: e.defaultPrevented,
        propagationStopped: e.cancelBubble,
    });

    // Check if click is on a grid row
    const row = target.closest('.vsg-row, [class*="row"]');
    if (row) {
        console.log('   ✅ Click is on a grid row:', row);
        const taskId = row.getAttribute('data-task-id') || row.getAttribute('data-id');
        console.log('   Task ID:', taskId);
    } else {
        console.log('   ❌ Click is NOT on a grid row');
    }
}

function mousedownTracer(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    console.log('🖱️ MOUSEDOWN detected:', {
        target: `<${target.tagName.toLowerCase()}> .${target.className}`,
        defaultPrevented: e.defaultPrevented,
    });
}

function checkForErrors(): void {
    // Check if there were any unhandled errors
    const errorHandler = (window as any).__diagnosticErrors || [];
    if (errorHandler.length > 0) {
        console.log('⚠️ Previous errors detected:', errorHandler);
    } else {
        console.log('✅ No errors captured (install error handler for more info)');
    }

    // Install error catcher for future errors
    (window as any).__diagnosticErrors = [];
    window.addEventListener('error', (e) => {
        (window as any).__diagnosticErrors.push(e);
        console.log('🔴 ERROR:', e.message, e.filename, e.lineno);
    });
    console.log('✅ Error catcher installed for future errors');
}

function checkSchedulerState(): void {
    const scheduler = (window as any).scheduler;
    const projectController = (window as any).projectController;

    console.log('  window.scheduler:', scheduler ? '✅ exists' : '❌ MISSING');
    console.log('  window.projectController:', projectController ? '✅ exists' : '❌ MISSING');

    if (scheduler) {
        console.log('  scheduler.isInitialized:', scheduler.isInitialized);
        console.log('  scheduler.grid:', scheduler.grid ? '✅ exists' : '❌ MISSING');
        console.log('  scheduler.gantt:', scheduler.gantt ? '✅ exists' : '❌ MISSING');
    }

    if (projectController) {
        console.log('  projectController.isInitialized$:', projectController.isInitialized$?.value);
        console.log('  projectController.tasks$.value.length:', projectController.tasks$?.value?.length);
    }
}

function checkGridDOM(): void {
    // Check for grid container
    const gridContainer = document.getElementById('grid-container');
    console.log('  #grid-container:', gridContainer ? '✅ exists' : '❌ MISSING');

    // Check for row container
    const rowContainer = document.querySelector('.vsg-rows, [class*="row-container"]');
    console.log('  Row container:', rowContainer ? '✅ exists' : '❌ MISSING');

    // Check for actual rows
    const rows = document.querySelectorAll('.vsg-row, [class*="row"]');
    console.log('  Number of rows:', rows.length);

    if (rows.length > 0) {
        const firstRow = rows[0] as HTMLElement;
        const style = window.getComputedStyle(firstRow);
        console.log('  First row style:');
        console.log('    pointer-events:', style.pointerEvents);
        console.log('    visibility:', style.visibility);
        console.log('    display:', style.display);
        console.log('    position:', style.position);
        
        // Check if row has click handler
        // Note: Can't directly check, but we can try to trigger
        console.log('  First row element:', firstRow);
    }

    // Check row container's pointer-events
    if (rowContainer) {
        const style = window.getComputedStyle(rowContainer as HTMLElement);
        console.log('  Row container pointer-events:', style.pointerEvents);
        if (style.pointerEvents === 'none') {
            console.log('  ⚠️ ROW CONTAINER HAS pointer-events: none - THIS BLOCKS CLICKS!');
        }
    }
}

function checkMainThreadBlocking(): void {
    // Test if main thread is responsive
    const start = performance.now();
    
    setTimeout(() => {
        const delay = performance.now() - start;
        if (delay > 100) {
            console.log(`⚠️ Main thread delayed by ${delay.toFixed(0)}ms - may indicate blocking`);
        } else {
            console.log(`✅ Main thread responsive (${delay.toFixed(0)}ms delay)`);
        }
    }, 0);

    // Check for long tasks
    if ('PerformanceObserver' in window) {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > 50) {
                        console.log(`⚠️ Long task detected: ${entry.duration.toFixed(0)}ms`);
                    }
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
            console.log('✅ Long task observer installed');
        } catch (e) {
            console.log('ℹ️ Long task observer not available');
        }
    }
}

// Auto-run if imported
if (typeof window !== 'undefined') {
    // Expose to window for console access
    (window as any).diagnoseUIBlocking = diagnoseUIBlocking;
    console.log('💡 UI Diagnostic loaded. Run: diagnoseUIBlocking()');
}
