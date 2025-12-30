import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load our reference data
const referenceData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/reference_project.json'), 'utf-8')
);

test.describe('Scheduling Logic Black Box', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console messages to help debug
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') {
        console.log(`[Browser Console Error] ${text}`);
      }
    });
    
    // Listen for page errors
    page.on('pageerror', error => {
      console.log(`[Page Error] ${error.message}`);
      consoleMessages.push(`[PageError] ${error.message}`);
    });
    
    // Navigate to the app with test mode enabled
    // Test mode allows the app to run without Tauri APIs, using MockRustEngine instead
    await page.goto('/?test=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // First, wait for scheduler to be available on window
    await page.waitForFunction(() => {
      return typeof (window as any).scheduler !== 'undefined';
    }, { timeout: 30000 }).catch(async () => {
      // If scheduler isn't available, log what we can see
      const bodyText = await page.textContent('body').catch(() => 'Could not read body');
      const windowKeys = await page.evaluate(() => Object.keys(window)).catch(() => []);
      console.log('Scheduler not found. Body content:', bodyText?.substring(0, 200));
      console.log('Window keys:', windowKeys.filter(k => k.includes('scheduler') || k.includes('app')));
      console.log('Console messages:', consoleMessages.slice(-10));
      throw new Error('Scheduler not available on window object');
    });
    
    // Then wait for initialization - check scheduler.isInitialized
    await page.waitForFunction(() => {
      const scheduler = (window as any).scheduler;
      return scheduler && scheduler.isInitialized === true;
    }, { timeout: 60000 }).catch(async () => {
      // On failure, get diagnostic info
      const schedulerState = await page.evaluate(() => {
        const s = (window as any).scheduler;
        const a = (window as any).appInitializer;
        return {
          schedulerExists: !!s,
          schedulerInitialized: s?.isInitialized,
          appInitializerExists: !!a,
          appInitializerInitialized: a?.isInitialized,
          schedulerKeys: s ? Object.keys(s).slice(0, 10) : []
        };
      }).catch(() => ({}));
      
      console.log('Initialization timeout. State:', schedulerState);
      console.log('Recent console messages:', consoleMessages.slice(-20));
      throw new Error('Scheduler initialization timeout');
    });
  });

  test('CPM Calculation: Should calculate correct dates for chain', async ({ page }) => {
    // 1. Inject Data via the internal API (simulating a file load)
    await page.evaluate((tasks) => {
      const s = (window as any).scheduler;
      s.tasks = tasks;
    }, referenceData);
    
    // 2. Sync tasks to engine
    await page.evaluate((tasks) => {
      const s = (window as any).scheduler;
      if (s.engine) {
        return s.engine.syncTasks(tasks);
      }
    }, referenceData);
    
    // 3. Trigger CPM recalculation
    await page.evaluate(() => {
      const s = (window as any).scheduler;
      return s.recalculateAll();
    });

    // 4. Wait for calculation to complete (small delay for async render updates)
    await page.waitForTimeout(200);

    // 5. Extract calculated tasks
    const tasks = await page.evaluate(() => (window as any).scheduler.tasks);
    
    const t2 = tasks.find((t: any) => t.id === '2'); // Foundation
    const t3 = tasks.find((t: any) => t.id === '3'); // Framing
    const t5 = tasks.find((t: any) => t.id === '5'); // Finish

    // Assertion: Foundation duration is 5
    expect(t2.duration).toBe(5);
    
    // Assertion: Framing Start must be > Foundation End (FS relationship)
    // Using string comparison for ISO dates works: "2024-01-08" > "2024-01-07"
    expect(t3.start > t2.end).toBeTruthy();

    // Assertion: Project Finish exists
    expect(t5.start).toBeTruthy();
    
    console.log(`Verified Chain: ${t2.name} (${t2.end}) -> ${t3.name} (${t3.start})`);
  });

  test('CRUD: Hierarchy remains intact after indentation', async ({ page }) => {
     // Inject just two tasks
     const simpleTasks = referenceData.slice(0, 2);
     await page.evaluate(async (tasks) => {
        const s = (window as any).scheduler;
        s.tasks = tasks;
        // Sync engine with new tasks
        if (s.engine) {
          await s.engine.syncTasks(tasks);
        }
     }, simpleTasks);

     // Wait for render
     await page.waitForTimeout(200);

     // Perform Indent Operation on the second task via Service API
     await page.evaluate(() => {
        (window as any).scheduler.indent('2'); 
     });

     // Check Parent/Child relationship
     const tasks = await page.evaluate(() => (window as any).scheduler.tasks);
     const child = tasks.find((t: any) => t.id === '2');
     
     expect(child.parentId).toBe('1');
  });
});
