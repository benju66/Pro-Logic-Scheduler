/**
 * ProjectController
 * 
 * The primary interface between the UI and the WASM Worker.
 * 
 * Responsibilities:
 * 1. Worker instantiation and lifecycle management
 * 2. Sending commands to the worker
 * 3. Exposing state changes via RxJS Observables
 * 
 * This decouples the UI completely from the calculation engine.
 * The UI subscribes to observables and reacts to state changes.
 */

import { BehaviorSubject, Subject, filter, firstValueFrom, timeout } from 'rxjs';
import type { Task, Calendar, CPMResult } from '../types';
import type { WorkerCommand, WorkerResponse } from '../workers/types';

/**
 * ProjectController - Singleton
 * 
 * The "brain" interface for the UI. All task operations go through here,
 * which delegates to the WASM Worker running in a background thread.
 */
export class ProjectController {
    private worker: Worker | null = null;
    private static instance: ProjectController;

    // ========================================================================
    // Observable State (Hot streams that drive the UI)
    // ========================================================================
    
    /** Current task list - updated after every calculation */
    public readonly tasks$ = new BehaviorSubject<Task[]>([]);
    
    /** CPM statistics from last calculation */
    public readonly stats$ = new BehaviorSubject<CPMResult['stats'] | null>(null);
    
    /** Whether the worker/engine is initialized and ready */
    public readonly isInitialized$ = new BehaviorSubject<boolean>(false);
    
    /** Whether the worker is currently processing a calculation */
    public readonly isCalculating$ = new BehaviorSubject<boolean>(false);
    
    /** Error stream for error handling */
    public readonly errors$ = new Subject<string>();

    // Event stream for specific worker responses (for awaiting async operations)
    private readonly workerResponses$ = new Subject<WorkerResponse>();

    // ========================================================================
    // Constructor & Singleton
    // ========================================================================

    private constructor() {
        this.initializeWorker();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): ProjectController {
        if (!ProjectController.instance) {
            ProjectController.instance = new ProjectController();
        }
        return ProjectController.instance;
    }

    /**
     * Initialize the Web Worker
     */
    private initializeWorker(): void {
        try {
            // Create worker with module type for ES modules support
            this.worker = new Worker(
                new URL('../workers/scheduler.worker.ts', import.meta.url),
                { type: 'module' }
            );

            // Listen for messages from worker
            this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                const response = e.data;
                this.handleWorkerResponse(response);
                this.workerResponses$.next(response);
            };

            // Handle worker errors
            this.worker.onerror = (err) => {
                console.error('[ProjectController] Worker Error:', err);
                this.errors$.next(`Worker error: ${err.message}`);
            };

            console.log('[ProjectController] Worker initialized');
        } catch (err) {
            console.error('[ProjectController] Failed to create worker:', err);
            this.errors$.next(`Failed to create worker: ${err}`);
        }
    }

    // ========================================================================
    // Worker Response Handler
    // ========================================================================

    /**
     * Handle incoming messages from the worker and update observable state
     */
    private handleWorkerResponse(response: WorkerResponse): void {
        switch (response.type) {
            case 'READY':
                console.log('[ProjectController] Worker WASM ready');
                break;

            case 'INITIALIZED':
                console.log('[ProjectController] Engine initialized:', response.success);
                this.isInitialized$.next(response.success);
                break;

            case 'CALCULATION_RESULT':
                // Update the "hot" state that drives the UI
                this.tasks$.next(response.payload.tasks);
                this.stats$.next(response.payload.stats);
                this.isCalculating$.next(false);
                
                console.log(
                    `[ProjectController] CPM complete: ${response.payload.stats.task_count} tasks, ` +
                    `${response.payload.stats.critical_count} critical, ` +
                    `${response.payload.stats.calc_time.toFixed(2)}ms`
                );
                break;

            case 'TASKS_SYNCED':
                console.log('[ProjectController] Tasks synced');
                break;

            case 'ERROR':
                console.error('[ProjectController] Worker error:', response.message);
                this.errors$.next(response.message);
                this.isCalculating$.next(false);
                break;
        }
    }

    // ========================================================================
    // Command Sender
    // ========================================================================

    /**
     * Send a command to the worker
     */
    private send(command: WorkerCommand): void {
        if (!this.worker) {
            console.error('[ProjectController] Worker not initialized');
            this.errors$.next('Worker not initialized');
            return;
        }
        this.worker.postMessage(command);
    }

    // ========================================================================
    // Public API - Initialization
    // ========================================================================

    /**
     * Initialize the engine with tasks and calendar
     * 
     * @param tasks - Initial task list
     * @param calendar - Calendar configuration
     * @returns Promise that resolves when initialization is complete
     */
    public async initialize(tasks: Task[], calendar: Calendar): Promise<void> {
        console.log(`[ProjectController] Initializing with ${tasks.length} tasks`);
        
        this.send({ type: 'INITIALIZE', payload: { tasks, calendar } });
        
        // Wait for initialization to complete (with timeout)
        try {
            await firstValueFrom(
                this.workerResponses$.pipe(
                    filter(r => r.type === 'INITIALIZED' || r.type === 'ERROR'),
                    timeout(10000) // 10 second timeout
                )
            );
        } catch (err) {
            console.error('[ProjectController] Initialization timeout');
            this.errors$.next('Initialization timeout');
            throw err;
        }
    }

    // ========================================================================
    // Public API - Task Operations
    // ========================================================================

    /**
     * Add a new task
     */
    public addTask(task: Task): void {
        this.isCalculating$.next(true);
        this.send({ type: 'ADD_TASK', payload: task });
    }

    /**
     * Update an existing task
     */
    public updateTask(id: string, updates: Partial<Task>): void {
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id, updates } });
    }

    /**
     * Delete a task
     */
    public deleteTask(id: string): void {
        this.isCalculating$.next(true);
        this.send({ type: 'DELETE_TASK', payload: { id } });
    }

    /**
     * Bulk sync all tasks (replaces entire task list)
     */
    public syncTasks(tasks: Task[]): void {
        this.isCalculating$.next(true);
        this.send({ type: 'SYNC_TASKS', payload: { tasks } });
    }

    // ========================================================================
    // Public API - Calendar Operations
    // ========================================================================

    /**
     * Update calendar configuration
     */
    public updateCalendar(calendar: Calendar): void {
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_CALENDAR', payload: calendar });
    }

    // ========================================================================
    // Public API - Calculation
    // ========================================================================

    /**
     * Force a recalculation
     */
    public forceRecalculate(): void {
        this.isCalculating$.next(true);
        this.send({ type: 'CALCULATE' });
    }

    // ========================================================================
    // Public API - Getters (Synchronous access to current state)
    // ========================================================================

    /**
     * Get current tasks (snapshot)
     */
    public getTasks(): Task[] {
        return this.tasks$.value;
    }

    /**
     * Get current stats (snapshot)
     */
    public getStats(): CPMResult['stats'] | null {
        return this.stats$.value;
    }

    /**
     * Check if initialized
     */
    public isInitialized(): boolean {
        return this.isInitialized$.value;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Dispose the controller and terminate the worker
     */
    public dispose(): void {
        console.log('[ProjectController] Disposing...');
        
        if (this.worker) {
            this.send({ type: 'DISPOSE' });
            this.worker.terminate();
            this.worker = null;
        }

        // Complete subjects
        this.tasks$.complete();
        this.stats$.complete();
        this.isInitialized$.complete();
        this.isCalculating$.complete();
        this.errors$.complete();
        this.workerResponses$.complete();

        // Clear singleton for potential re-initialization
        ProjectController.instance = null as any;
    }
}
