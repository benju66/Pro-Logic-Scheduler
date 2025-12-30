/**
 * Scheduler WASM Worker
 * 
 * This Web Worker runs the WASM-based CPM scheduling engine in a background thread,
 * ensuring the main UI thread never blocks during calculations.
 * 
 * The worker:
 * 1. Loads the WASM module on startup
 * 2. Holds the SchedulerEngine instance (state lives in WASM memory)
 * 3. Processes commands from the main thread
 * 4. Returns calculation results asynchronously
 */

// Import WASM module - wasm-pack generates these bindings
import init, { SchedulerEngine } from '../../src-wasm/pkg/scheduler_wasm';
import type { WorkerCommand, WorkerResponse } from './types';

// The single source of truth - lives in WASM memory
let engine: SchedulerEngine | null = null;
let isWasmReady = false;

/**
 * Helper to send typed responses back to main thread
 */
function postResponse(response: WorkerResponse): void {
  self.postMessage(response);
}

/**
 * Initialize WASM module immediately when worker spawns
 */
async function initializeWasm(): Promise<void> {
  try {
    console.log('[Worker] Initializing WASM module...');
    await init();
    engine = new SchedulerEngine();
    isWasmReady = true;
    console.log('[Worker] ✅ WASM module ready');
    postResponse({ type: 'READY' });
  } catch (err) {
    console.error('[Worker] ❌ Failed to initialize WASM:', err);
    postResponse({ 
      type: 'ERROR', 
      message: `WASM initialization failed: ${err instanceof Error ? err.message : String(err)}` 
    });
  }
}

// Start WASM initialization immediately
initializeWasm();

/**
 * Wait for WASM to be ready (handles race conditions)
 */
async function waitForWasm(): Promise<boolean> {
  if (isWasmReady && engine) return true;
  
  // Wait up to 5 seconds for WASM to initialize
  const maxWait = 5000;
  const interval = 50;
  let waited = 0;
  
  while (!isWasmReady && waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, interval));
    waited += interval;
  }
  
  return isWasmReady && engine !== null;
}

/**
 * Handle incoming commands from main thread
 */
self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const command = e.data;
  
  // Wait for WASM if still loading
  const ready = await waitForWasm();
  if (!ready || !engine) {
    postResponse({ 
      type: 'ERROR', 
      message: 'WASM engine not available' 
    });
    return;
  }

  try {
    switch (command.type) {
      case 'INITIALIZE': {
        const { tasks, calendar } = command.payload;
        console.log(`[Worker] Initializing with ${tasks.length} tasks`);
        
        // Pass data to WASM engine
        engine.initialize(tasks, calendar);
        postResponse({ type: 'INITIALIZED', success: true });
        
        // Auto-calculate after initialization
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'ADD_TASK': {
        engine.add_task(command.payload);
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'UPDATE_TASK': {
        const { id, updates } = command.payload;
        engine.update_task(id, updates);
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'DELETE_TASK': {
        engine.delete_task(command.payload.id);
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'SYNC_TASKS': {
        const { tasks } = command.payload;
        engine.sync_tasks(tasks);
        postResponse({ type: 'TASKS_SYNCED', success: true });
        
        // Auto-calculate after sync
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'UPDATE_CALENDAR': {
        engine.update_calendar(command.payload);
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'CALCULATE': {
        const result = engine.calculate();
        postResponse({ type: 'CALCULATION_RESULT', payload: result });
        break;
      }

      case 'DISPOSE': {
        if (engine) {
          engine.dispose();
          engine = null;
        }
        console.log('[Worker] Engine disposed');
        break;
      }

      default: {
        console.warn('[Worker] Unknown command:', (command as any).type);
        postResponse({ 
          type: 'ERROR', 
          message: `Unknown command: ${(command as any).type}` 
        });
      }
    }
  } catch (err) {
    console.error('[Worker] Error processing command:', command.type, err);
    postResponse({ 
      type: 'ERROR', 
      message: `Command ${command.type} failed: ${err instanceof Error ? err.message : String(err)}` 
    });
  }
};

// Log worker startup
console.log('[Worker] Scheduler worker spawned');
