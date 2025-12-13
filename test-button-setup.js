/**
 * Test script to verify button setup
 * Run this in browser console after page loads
 */

function testButtonSetup() {
    console.log('🧪 Testing Button Setup');
    console.log('='.repeat(50));
    
    // Test 1: Check if buttons exist
    const buttons = document.querySelectorAll('[data-action]');
    console.log('\n1️⃣ Button Count:', buttons.length);
    
    if (buttons.length === 0) {
        console.error('❌ NO BUTTONS FOUND!');
        return;
    }
    
    // Test 2: List all buttons
    console.log('\n2️⃣ All Buttons:');
    buttons.forEach((btn, i) => {
        const action = btn.dataset.action;
        const text = btn.textContent?.trim().substring(0, 30) || '';
        const inHeader = btn.closest('.header') ? 'HEADER' : 'OTHER';
        console.log(`  ${i + 1}. [${inHeader}] ${action}: "${text}"`);
    });
    
    // Test 3: Check button styles
    console.log('\n3️⃣ Button Styles (first button):');
    const firstBtn = buttons[0];
    const styles = window.getComputedStyle(firstBtn);
    console.log('  pointer-events:', styles.pointerEvents);
    console.log('  cursor:', styles.cursor);
    console.log('  z-index:', styles.zIndex);
    console.log('  display:', styles.display);
    console.log('  visibility:', styles.visibility);
    console.log('  opacity:', styles.opacity);
    
    // Test 4: Check if scheduler exists
    console.log('\n4️⃣ Scheduler Status:');
    console.log('  window.scheduler:', typeof window.scheduler);
    if (window.scheduler) {
        console.log('  scheduler.grid:', !!window.scheduler.grid);
        console.log('  scheduler.gantt:', !!window.scheduler.gantt);
        console.log('  scheduler.addTask:', typeof window.scheduler.addTask);
    }
    
    // Test 5: Simulate click on first button
    console.log('\n5️⃣ Testing Click Simulation:');
    const testBtn = document.querySelector('[data-action="add-task"]');
    if (testBtn) {
        console.log('  Found "Add Task" button');
        console.log('  Attempting programmatic click...');
        testBtn.click();
        console.log('  Click dispatched');
    } else {
        console.warn('  "Add Task" button not found');
    }
    
    // Test 6: Check event listeners (hard to verify, but check if handler exists)
    console.log('\n6️⃣ Event Handler Check:');
    console.log('  Note: Cannot directly verify event listeners');
    console.log('  But clicks should log messages if handler is working');
    
    console.log('\n✅ Test Complete!');
    console.log('='.repeat(50));
    console.log('\n💡 Next Steps:');
    console.log('  1. Click a button manually');
    console.log('  2. Check for "🖱️ Header click detected" messages');
    console.log('  3. Check for "🖱️ Button clicked" messages');
    console.log('  4. Check for any error messages');
}

// Auto-run if in browser (dev mode only)
if (typeof window !== 'undefined') {
    window.testButtonSetup = testButtonSetup;
    
    // Only auto-run in development (when Vite dev server is running)
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (isDev) {
        console.log('💡 Run testButtonSetup() in console to test button setup');
        
        // Auto-run after a delay in dev mode
        setTimeout(() => {
            if (document.readyState === 'complete') {
                testButtonSetup();
            } else {
                window.addEventListener('load', testButtonSetup);
            }
        }, 2000);
    }
}

