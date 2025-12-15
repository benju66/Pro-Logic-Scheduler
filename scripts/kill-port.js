#!/usr/bin/env node
/**
 * Kill process on port 1420 (Windows)
 */

import { execSync } from 'child_process';
import * as os from 'os';

if (os.platform() === 'win32') {
    try {
        // Find process on port 1420
        const result = execSync('netstat -ano | findstr :1420', { 
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        
        const lines = result.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const processId = parts[parts.length - 1];
            if (processId && /^\d+$/.test(processId) && processId !== '0') {
                try {
                    execSync(`taskkill /F /PID ${processId}`, { stdio: 'ignore' });
                    console.log(`Killed process ${processId} on port 1420`);
                } catch (e) {
                    // Process might already be gone
                }
            }
        }
    } catch (error) {
        // Port not in use - that's fine
        console.log('Port 1420 is free');
    }
} else {
    try {
        execSync('lsof -ti:1420 | xargs kill -9 2>/dev/null', { stdio: 'ignore' });
        console.log('Killed process on port 1420');
    } catch (e) {
        console.log('Port 1420 is free');
    }
}

