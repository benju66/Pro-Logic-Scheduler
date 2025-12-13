#!/usr/bin/env node
/**
 * Quick Verification Script for Pro Logic Scheduler
 * Checks code structure and basic functionality
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = __dirname;

const checks = [];
let passed = 0;
let failed = 0;

function check(name, condition, details = '') {
    checks.push({ name, condition, details });
    if (condition) {
        console.log(`✅ ${name}`);
        passed++;
    } else {
        console.log(`❌ ${name}${details ? ` - ${details}` : ''}`);
        failed++;
    }
}

console.log('🔍 Pro Logic Scheduler - Code Verification\n');
console.log('='.repeat(60));

// Check 1: Required files exist
console.log('\n📁 File Structure:');
const requiredFiles = [
    'package.json',
    'index.html',
    'vite.config.js',
    'src/main.js',
    'src/SchedulerEngine.js',
    'src/VirtualScrollGrid.js',
    'src/CanvasGantt.js',
    'src/CPM.js',
    'src/DateUtils.js',
    'src/SideDrawer.js',
    'src/DependenciesModal.js',
    'src/CalendarModal.js',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
    'src-tauri/src/main.rs',
];

requiredFiles.forEach(file => {
    check(`File exists: ${file}`, existsSync(join(projectRoot, file)));
});

// Check 2: Package.json structure
console.log('\n📦 Package Configuration:');
try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    check('Package name defined', !!pkg.name);
    check('Version defined', !!pkg.version);
    check('Has dev script', !!pkg.scripts?.dev);
    check('Has tauri:dev script', !!pkg.scripts?.['tauri:dev']);
    check('Has vite dependency', !!pkg.devDependencies?.vite);
    check('Has tauri CLI', !!pkg.devDependencies?.['@tauri-apps/cli']);
} catch (e) {
    check('package.json valid', false, e.message);
}

// Check 3: Source file syntax (basic checks)
console.log('\n📝 Source Code Structure:');
const srcFiles = [
    'src/main.js',
    'src/SchedulerEngine.js',
    'src/VirtualScrollGrid.js',
    'src/CanvasGantt.js',
    'src/CPM.js',
    'src/DateUtils.js',
];

srcFiles.forEach(file => {
    try {
        const content = readFileSync(join(projectRoot, file), 'utf-8');
        check(`${file} is readable`, content.length > 0);
        check(`${file} has exports`, 
            content.includes('export') || content.includes('module.exports'));
        // Basic syntax check - just verify it's valid JavaScript structure
        const hasValidStructure = content.includes('function') || content.includes('class') || content.includes('export');
        check(`${file} has valid structure`, hasValidStructure);
    } catch (e) {
        check(`${file} readable`, false, e.message);
    }
});

// Check 4: HTML structure
console.log('\n🌐 HTML Structure:');
try {
    const html = readFileSync(join(projectRoot, 'index.html'), 'utf-8');
    check('HTML has title', html.includes('<title>'));
    check('HTML has main container', html.includes('id="grid-container"'));
    check('HTML has gantt container', html.includes('id="gantt-container"'));
    check('HTML loads main.js', html.includes('src="/src/main.js"'));
} catch (e) {
    check('index.html readable', false, e.message);
}

// Check 5: Tauri configuration
console.log('\n🦀 Tauri Configuration:');
try {
    const tauriConfig = JSON.parse(readFileSync(join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf-8'));
    check('Tauri config valid JSON', !!tauriConfig);
    check('Has build config', !!tauriConfig.build);
    check('Has package config', !!tauriConfig.package);
    check('Has windows config', !!tauriConfig.tauri?.windows);
} catch (e) {
    check('tauri.conf.json valid', false, e.message);
}

// Check 6: Import/Export consistency
console.log('\n🔗 Module Dependencies:');
try {
    const mainJs = readFileSync(join(projectRoot, 'src/main.js'), 'utf-8');
    const schedulerServiceJs = readFileSync(join(projectRoot, 'src/services/SchedulerService.js'), 'utf-8');
    
    check('main.js imports SchedulerService', mainJs.includes('SchedulerService'));
    check('main.js imports CanvasGantt', mainJs.includes('CanvasGantt'));
    check('main.js imports VirtualScrollGrid', mainJs.includes('VirtualScrollGrid'));
    check('SchedulerService imports CPM', schedulerServiceJs.includes('CPM'));
    check('SchedulerService imports DateUtils', schedulerServiceJs.includes('DateUtils'));
    check('SchedulerService imports TaskStore', schedulerServiceJs.includes('TaskStore'));
} catch (e) {
    check('Module imports check', false, e.message);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 Summary:');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Total: ${checks.length}`);

if (failed === 0) {
    console.log('\n🎉 All checks passed! The code structure looks good.');
    console.log('\n💡 Next steps:');
    console.log('   1. Run: npm run dev (for web testing)');
    console.log('   2. Run: npm run tauri:dev (for desktop app)');
    console.log('   3. Follow TEST_PLAN.md for functional testing');
    process.exit(0);
} else {
    console.log('\n⚠️  Some checks failed. Please review the errors above.');
    process.exit(1);
}

