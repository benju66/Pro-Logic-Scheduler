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

// Default calendar for tests
const defaultCalendar = {
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri
  exceptions: {}
};

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
    // Test mode allows the app to run without Tauri APIs
    await page.goto('/?test=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for ProjectController to be available (Phase 6+ architecture)
    await page.waitForFunction(() => {
      return typeof (window as any).projectController !== 'undefined';
    }, { timeout: 30000 }).catch(async () => {
      // Fallback: check for legacy scheduler
      const hasScheduler = await page.evaluate(() => typeof (window as any).scheduler !== 'undefined');
      if (hasScheduler) {
        console.log('ProjectController not found, but scheduler is available');
        return;
      }
      
      const bodyText = await page.textContent('body').catch(() => 'Could not read body');
      const windowKeys = await page.evaluate(() => Object.keys(window)).catch(() => []);
      console.log('ProjectController not found. Body content:', bodyText?.substring(0, 200));
      console.log('Window keys:', windowKeys.filter(k => k.includes('scheduler') || k.includes('project') || k.includes('Controller')));
      console.log('Console messages:', consoleMessages.slice(-10));
      throw new Error('ProjectController not available on window object');
    });
    
    // Wait for initialization to complete
    await page.waitForFunction(() => {
      const pc = (window as any).projectController;
      // Check if ProjectController is initialized (has emitted tasks)
      return pc && pc.isInitialized$.value === true;
    }, { timeout: 60000 }).catch(async () => {
      const state = await page.evaluate(() => {
        const pc = (window as any).projectController;
        return {
          exists: !!pc,
          isInitialized: pc?.isInitialized$?.value,
          taskCount: pc?.tasks$?.value?.length,
        };
      }).catch(() => ({}));
      
      console.log('Initialization timeout. State:', state);
      console.log('Recent console messages:', consoleMessages.slice(-20));
      throw new Error('ProjectController initialization timeout');
    });
  });

  test('CPM Calculation: Should calculate correct dates for chain', async ({ page }) => {
    // 1. Initialize ProjectController with reference data
    await page.evaluate(async ({ tasks, calendar }) => {
      const pc = (window as any).projectController;
      
      // Sync tasks to trigger calculation
      pc.syncTasks(tasks);
      
      // Wait a moment for calculation to complete
      await new Promise(resolve => setTimeout(resolve, 500));
    }, { tasks: referenceData, calendar: defaultCalendar });

    // 2. Wait for calculation to complete
    await page.waitForTimeout(500);

    // 3. Extract calculated tasks from ProjectController
    const tasks = await page.evaluate(() => {
      const pc = (window as any).projectController;
      return pc.tasks$.value;
    });
    
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

  test('CRUD: Update task and verify recalculation', async ({ page }) => {
    // 1. Load initial tasks
    const simpleTasks = referenceData.slice(0, 3);
    await page.evaluate(async ({ tasks, calendar }) => {
      const pc = (window as any).projectController;
      pc.syncTasks(tasks);
      await new Promise(resolve => setTimeout(resolve, 300));
    }, { tasks: simpleTasks, calendar: defaultCalendar });

    // Wait for initial calculation
    await page.waitForTimeout(300);

    // 2. Update a task's duration
    await page.evaluate(async () => {
      const pc = (window as any).projectController;
      // Update task 2's duration from 5 to 10
      pc.updateTask('2', { duration: 10 });
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    // Wait for recalculation
    await page.waitForTimeout(300);

    // 3. Verify the update was applied
    const tasks = await page.evaluate(() => {
      const pc = (window as any).projectController;
      return pc.tasks$.value;
    });
    
    const t2 = tasks.find((t: any) => t.id === '2');
    expect(t2.duration).toBe(10);
  });

  test('CRUD: Add and delete tasks', async ({ page }) => {
    // 1. Start with initial tasks
    const initialTasks = referenceData.slice(0, 2);
    await page.evaluate(async ({ tasks, calendar }) => {
      const pc = (window as any).projectController;
      pc.syncTasks(tasks);
      await new Promise(resolve => setTimeout(resolve, 300));
    }, { tasks: initialTasks, calendar: defaultCalendar });

    await page.waitForTimeout(300);

    // 2. Add a new task
    const newTask = {
      id: 'new-task-1',
      name: 'New Test Task',
      duration: 3,
      dependencies: [],
      parentId: null,
      sortKey: '003',
      constraintType: 'asap',
      progress: 0,
      notes: '',
      start: '',
      end: '',
      level: 0
    };

    await page.evaluate(async (task) => {
      const pc = (window as any).projectController;
      pc.addTask(task);
      await new Promise(resolve => setTimeout(resolve, 300));
    }, newTask);

    await page.waitForTimeout(300);

    // Verify task was added
    let tasks = await page.evaluate(() => {
      const pc = (window as any).projectController;
      return pc.tasks$.value;
    });
    
    expect(tasks.find((t: any) => t.id === 'new-task-1')).toBeTruthy();

    // 3. Delete the task
    await page.evaluate(async () => {
      const pc = (window as any).projectController;
      pc.deleteTask('new-task-1');
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    await page.waitForTimeout(300);

    // Verify task was deleted
    tasks = await page.evaluate(() => {
      const pc = (window as any).projectController;
      return pc.tasks$.value;
    });
    
    expect(tasks.find((t: any) => t.id === 'new-task-1')).toBeFalsy();
  });
});
