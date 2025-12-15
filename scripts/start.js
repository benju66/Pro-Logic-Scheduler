#!/usr/bin/env node
/**
 * Start script - starts Tauri dev server
 * Kills port 1420 if in use, then starts Tauri
 */

import { spawn, execSync } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🧹 Clearing port 1420...');
try {
    execSync('node scripts/kill-port.js', { stdio: 'inherit' });
} catch (e) {
    // Ignore errors
}
console.log('');

console.log('🚀 Starting Tauri dev server...');
console.log('   (This will compile Rust on first run - may take 2-5 minutes)');
console.log('   (The desktop window will open automatically when ready)');
console.log('   (Press Ctrl+C to stop)\n');

// Small delay to let port clear
await setTimeout(1000);

// Start Tauri dev - spawn doesn't care about exit codes from child processes
const proc = spawn('npm', ['run', 'tauri:dev'], {
    stdio: 'inherit',
    shell: true
});

proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
        console.log(`\nProcess exited with code ${code}`);
    }
});

proc.on('error', (error) => {
    console.error('Error starting Tauri:', error.message);
    process.exit(1);
});

// Keep the script running until Tauri exits
process.on('SIGINT', () => {
    proc.kill('SIGINT');
    process.exit(0);
});
