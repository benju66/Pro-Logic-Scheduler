/**
 * Worker Message Types
 * 
 * Strict typing for messages passed between Main Thread and WASM Worker.
 * This ensures type safety across the postMessage boundary.
 */

import type { Task, Calendar, CPMResult } from '../types';

/**
 * Commands sent TO the worker (Main → Worker)
 */
export type WorkerCommand = 
  | { type: 'INITIALIZE'; payload: { tasks: Task[]; calendar: Calendar } }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: { id: string; updates: Partial<Task> } }
  | { type: 'DELETE_TASK'; payload: { id: string } }
  | { type: 'SYNC_TASKS'; payload: { tasks: Task[] } }
  | { type: 'UPDATE_CALENDAR'; payload: Calendar }
  | { type: 'CALCULATE' }
  | { type: 'DISPOSE' };

/**
 * Responses sent FROM the worker (Worker → Main)
 */
export type WorkerResponse = 
  | { type: 'READY' }
  | { type: 'INITIALIZED'; success: boolean }
  | { type: 'CALCULATION_RESULT'; payload: CPMResult }
  | { type: 'TASKS_SYNCED'; success: boolean }
  | { type: 'ERROR'; message: string };

/**
 * Worker state for tracking initialization
 */
export interface WorkerState {
  isReady: boolean;
  isInitialized: boolean;
  taskCount: number;
}
