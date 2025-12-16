/**
 * Phase 1 Code Verification Script
 * 
 * Verifies that Phase 1 optimizations are correctly implemented in the code.
 * Run with: node verify-phase1.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const gridFile = join(__dirname, 'src/ui/components/VirtualScrollGrid.ts');
const code = readFileSync(gridFile, 'utf-8');

console.log('🔍 Phase 1 Code Verification');
console.log('='.repeat(60));
console.log('');

let passed = 0;
let failed = 0;

// Test 1: Display check optimization
console.log('Test 1: Display Check Optimization');
console.log('-'.repeat(60));
if (code.includes('if (row.style.display === \'none\')')) {
    console.log('✅ Display check found: row.style.display === \'none\'');
    passed++;
} else {
    console.log('❌ Display check NOT found');
    failed++;
}

if (code.includes('row.style.display = \'flex\'')) {
    console.log('✅ Display assignment found: row.style.display = \'flex\'');
    passed++;
} else {
    console.log('❌ Display assignment NOT found');
    failed++;
}
console.log('');

// Test 2: Batch DOM writes - dataset
console.log('Test 2: Batch DOM Writes - Dataset');
console.log('-'.repeat(60));
if (code.includes('row.dataset.taskId')) {
    console.log('✅ Dataset assignment found: row.dataset.taskId');
    passed++;
} else {
    console.log('❌ Dataset assignment NOT found');
    failed++;
}

if (code.includes('row.dataset.index')) {
    console.log('✅ Dataset assignment found: row.dataset.index');
    passed++;
} else {
    console.log('❌ Dataset assignment NOT found');
    failed++;
}
console.log('');

// Test 3: Batch DOM writes - className
console.log('Test 3: Batch DOM Writes - ClassName');
console.log('-'.repeat(60));
if (code.includes('const classes = [\'vsg-row\', \'grid-row\']')) {
    console.log('✅ ClassName batching found: const classes = [...]');
    passed++;
} else {
    console.log('❌ ClassName batching NOT found');
    failed++;
}

if (code.includes('row.className = classes.join(\' \')')) {
    console.log('✅ ClassName assignment found: row.className = classes.join()');
    passed++;
} else {
    console.log('❌ ClassName assignment NOT found');
    failed++;
}

// Check that we're NOT using multiple toggle calls
const toggleCount = (code.match(/classList\.toggle/g) || []).length;
if (toggleCount === 0) {
    console.log('✅ No classList.toggle calls found (good - using className instead)');
    passed++;
} else {
    console.log(`⚠️  Found ${toggleCount} classList.toggle calls (may be in other methods)`);
    // Check if they're in _bindRowData
    const bindRowDataMatch = code.match(/private _bindRowData[\s\S]*?row\.className = classes\.join/);
    if (bindRowDataMatch && bindRowDataMatch[0].includes('classList.toggle')) {
        console.log('❌ classList.toggle found in _bindRowData (should use className)');
        failed++;
    } else {
        console.log('✅ No classList.toggle in _bindRowData (correct)');
        passed++;
    }
}
console.log('');

// Test 4: Read/Write separation
console.log('Test 4: Read/Write Separation');
console.log('-'.repeat(60));
if (code.includes('// PHASE 1: Compute everything (reads only')) {
    console.log('✅ Phase 1 comment found (reads only)');
    passed++;
} else {
    console.log('❌ Phase 1 comment NOT found');
    failed++;
}

if (code.includes('// PHASE 2: All DOM writes together')) {
    console.log('✅ Phase 2 comment found (writes together)');
    passed++;
} else {
    console.log('❌ Phase 2 comment NOT found');
    failed++;
}

// Check that isCritical is computed before DOM writes
const bindRowDataCode = code.match(/private _bindRowData[\s\S]*?row\.className = classes\.join/);
if (bindRowDataCode && bindRowDataCode[0].includes('const isCritical = task._isCritical')) {
    const isCriticalBeforeWrites = bindRowDataCode[0].indexOf('const isCritical') < bindRowDataCode[0].indexOf('row.dataset');
    if (isCriticalBeforeWrites) {
        console.log('✅ isCritical computed before DOM writes');
        passed++;
    } else {
        console.log('❌ isCritical computed after DOM writes');
        failed++;
    }
} else {
    console.log('⚠️  Could not verify isCritical computation order');
}
console.log('');

// Summary
console.log('📊 Verification Summary');
console.log('='.repeat(60));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('');

if (failed === 0) {
    console.log('🎉 All code verifications passed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Start the app: npm run dev');
    console.log('2. Open browser console (F12)');
    console.log('3. Run PHASE1_TEST_SCRIPT.js');
    console.log('4. Follow PHASE1_TEST_GUIDE.md for manual testing');
    process.exit(0);
} else {
    console.log('⚠️  Some verifications failed. Please review the code.');
    process.exit(1);
}

