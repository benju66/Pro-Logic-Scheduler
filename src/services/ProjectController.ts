/**
 * ProjectController
 * 
 * The primary interface between the UI and the WASM Worker.
 * 
 * Responsibilities:
 * 1. Worker instantiation and lifecycle management
 * 2. Sending commands to the worker
 * 3. Exposing state changes via RxJS Observables
 * 4. Triggering persistence events for SQLite storage
 * 
 * This decouples the UI completely from the calculation engine.
 * The UI subscribes to observables and reacts to state changes.
 */

import { BehaviorSubject, Subject, filter, firstValueFrom, timeout } from 'rxjs';
import type { Task, Calendar, CPMResult } from '../types';
import type { WorkerCommand, WorkerResponse } from '../workers/types';
import type { PersistenceService } from '../data/PersistenceService';

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
    
    /** Current calendar configuration - updated on init and calendar changes */
    public readonly calendar$ = new BehaviorSubject<Calendar>({
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {}
    });
    
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
    // Persistence Integration
    // ========================================================================
    
    /** PersistenceService for event sourcing to SQLite */
    private persistenceService: PersistenceService | null = null;

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
     * Set the persistence service for event sourcing
     * Called during app initialization to enable SQLite persistence
     */
    public setPersistenceService(service: PersistenceService): void {
        this.persistenceService = service;
        console.log('[ProjectController] PersistenceService attached');
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
                    `[ProjectController] CPM complete: ${response.payload.stats.taskCount} tasks, ` +
                    `${response.payload.stats.criticalCount} critical, ` +
                    `${response.payload.stats.calcTime.toFixed(2)}ms`
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
        
        // Store calendar locally for snapshot access
        this.calendar$.next(calendar);
        
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

        // Queue TASK_CREATED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_CREATED', task.id, {
                id: task.id,
                parent_id: task.parentId,
                sort_key: task.sortKey,
                row_type: task.rowType || 'task',
                name: task.name,
                notes: task.notes || '',
                duration: task.duration,
                constraint_type: task.constraintType,
                constraint_date: task.constraintDate,
                scheduling_mode: task.schedulingMode || 'Auto',
                dependencies: task.dependencies || [],
                progress: task.progress || 0,
                actual_start: task.actualStart,
                actual_finish: task.actualFinish,
                remaining_duration: task.remainingDuration,
                baseline_start: task.baselineStart,
                baseline_finish: task.baselineFinish,
                baseline_duration: task.baselineDuration,
                is_collapsed: task._collapsed || false,
            });
        }
    }

    /**
     * Update an existing task
     */
    public updateTask(id: string, updates: Partial<Task>): void {
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id, updates } });

        // Queue TASK_UPDATED events for persistence (one per field for granular undo/redo)
        if (this.persistenceService) {
            for (const [field, value] of Object.entries(updates)) {
                // Skip calculated fields - they're not persisted
                const calculatedFields = ['start', 'end', 'level', 'lateStart', 'lateFinish', 
                                         'totalFloat', 'freeFloat', '_isCritical', '_health'];
                if (calculatedFields.includes(field)) continue;

                this.persistenceService.queueEvent('TASK_UPDATED', id, {
                    field,
                    new_value: value,
                });
            }
        }
    }

    /**
     * Delete a task
     */
    public deleteTask(id: string): void {
        this.isCalculating$.next(true);
        this.send({ type: 'DELETE_TASK', payload: { id } });

        // Queue TASK_DELETED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_DELETED', id, {});
        }
    }

    /**
     * Bulk sync all tasks (replaces entire task list)
     * Note: This does NOT queue individual events - use for initial load or import only
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
        // Store calendar locally for snapshot access
        this.calendar$.next(calendar);
        
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_CALENDAR', payload: calendar });

        // Queue CALENDAR_UPDATED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('CALENDAR_UPDATED', null, {
                new_working_days: calendar.workingDays,
                new_exceptions: calendar.exceptions,
            });
        }
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
     * Get current calendar (snapshot)
     */
    public getCalendar(): Calendar {
        return this.calendar$.value;
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
        this.calendar$.complete();
        this.stats$.complete();
        this.isInitialized$.complete();
        this.isCalculating$.complete();
        this.errors$.complete();
        this.workerResponses$.complete();

        // Clear persistence reference
        this.persistenceService = null;

        // Clear singleton for potential re-initialization
        ProjectController.instance = null as any;
    }
}
