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
import type { Task, Calendar, CPMResult, ConstraintType, SchedulingMode } from '../types';
import type { WorkerCommand, WorkerResponse } from '../workers/types';
import type { PersistenceService } from '../data/PersistenceService';
import type { HistoryManager, QueuedEvent } from '../data/HistoryManager';
import type { ToastService } from '../ui/services/ToastService';

/**
 * ProjectController
 * 
 * The "brain" interface for the UI. All task operations go through here,
 * which delegates to the WASM Worker running in a background thread.
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - getInstance() retained for backward compatibility during migration
 * - Use setInstance() in Composition Root or inject directly
 * - This is the LARGEST singleton with 166+ callers
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class ProjectController {
    private worker: Worker | null = null;
    private static instance: ProjectController | null = null;

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
    
    /** HistoryManager for undo/redo functionality */
    private historyManager: HistoryManager | null = null;
    
    /** ToastService for error notifications (optional - injected) */
    private toastService: ToastService | null = null;
    
    /** Pending operation tracking for rollback on worker errors */
    private pendingOperation: {
        type: 'ADD' | 'UPDATE' | 'DELETE';
        taskId: string;
        snapshot: Task[];
        wasComposite: boolean;
    } | null = null;

    // ========================================================================
    // Constructor & Singleton
    // ========================================================================

    /**
     * Constructor is public for Pure DI compatibility.
     * Creates and initializes the WASM worker.
     * 
     * @param options - Optional dependencies (ToastService for error notifications)
     */
    public constructor(options?: { toastService?: ToastService }) {
        this.toastService = options?.toastService || null;
        this.initializeWorker();
    }

    /**
     * @deprecated Use constructor injection instead. This method exists for backward
     * compatibility and testing only.
     * 
     * **Preferred:** Pass ProjectController via constructor
     * ```typescript
     * constructor(private controller: ProjectController) {}
     * ```
     * 
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static getInstance(): ProjectController {
        if (!ProjectController.instance) {
            ProjectController.instance = new ProjectController();
        }
        return ProjectController.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * This method exists for Composition Root wiring and legacy test support.
     * 
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static setInstance(instance: ProjectController): void {
        ProjectController.instance = instance;
    }
    
    /**
     * @deprecated Create fresh instances in tests instead.
     * This method exists for legacy test isolation.
     * 
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static resetInstance(): void {
        ProjectController.instance = null;
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
     * Get the persistence service (for shared access by other services)
     * Used by SchedulerService for trade partner persistence
     */
    public getPersistenceService(): PersistenceService | null {
        return this.persistenceService;
    }

    /**
     * Check if persistence service is already attached
     * Used to prevent duplicate initialization
     */
    public hasPersistenceService(): boolean {
        return this.persistenceService !== null;
    }

    /**
     * Set the history manager for undo/redo functionality
     * Called during app initialization
     */
    public setHistoryManager(manager: HistoryManager): void {
        this.historyManager = manager;
        console.log('[ProjectController] HistoryManager attached');
    }
    
    /**
     * Set the toast service for error notifications
     * Called during app initialization (optional)
     */
    public setToastService(service: ToastService): void {
        this.toastService = service;
        console.log('[ProjectController] ToastService attached');
    }

    /**
     * Check if history manager is already attached
     */
    public hasHistoryManager(): boolean {
        return this.historyManager !== null;
    }

    /**
     * Get the history manager instance
     * @returns HistoryManager instance or null if not set
     */
    public getHistoryManager(): HistoryManager | null {
        return this.historyManager;
    }

    // ========================================================================
    // History Recording Helpers
    // ========================================================================

    /**
     * Create a QueuedEvent object
     */
    private createEvent(type: string, targetId: string | null, payload: Record<string, unknown>): QueuedEvent {
        return {
            type,
            targetId,
            payload,
            timestamp: new Date()
        };
    }

    /**
     * Record an action to history (for undo/redo)
     * @param forwardEvent - Event that performs the action
     * @param backwardEvent - Event that undoes the action
     * @param label - Human-readable label for the action
     */
    private recordToHistory(forwardEvent: QueuedEvent, backwardEvent: QueuedEvent, label?: string): void {
        if (this.historyManager) {
            this.historyManager.recordAction(forwardEvent, backwardEvent, label);
        }
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
                
                // Clear pending operation on success
                this.pendingOperation = null;
                
                console.log(
                    `[ProjectController] CPM complete: ${response.payload.stats.taskCount} tasks, ` +
                    `${response.payload.stats.criticalCount} critical, ` +
                    `${response.payload.stats.calcTime.toFixed(2)}ms`
                );
                break;

            case 'TASKS_SYNCED':
                console.log('[ProjectController] Tasks synced');
                // Clear pending operation on sync success
                this.pendingOperation = null;
                break;

            case 'ERROR':
                console.error('[ProjectController] Worker error:', response.message);
                this.errors$.next(response.message);
                this.isCalculating$.next(false);
                
                // Rollback optimistic update on error
                this._rollbackPendingOperation(response.message);
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
     * Uses optimistic update: local state updated immediately, then worker calculates
     */
    public addTask(task: Task): void {
        // Store snapshot before optimistic update (for rollback on error)
        const wasComposite = this.historyManager?.isInComposite() || false;
        this.pendingOperation = {
            type: 'ADD',
            taskId: task.id,
            snapshot: [...this.tasks$.value],
            wasComposite
        };
        
        // OPTIMISTIC UPDATE: Add to local state immediately for instant UI response
        const currentTasks = [...this.tasks$.value, task];
        this.tasks$.next(currentTasks);
        
        // Send to worker for CPM calculation
        this.isCalculating$.next(true);
        this.send({ type: 'ADD_TASK', payload: task });

        // Build the event payload
        const eventPayload = {
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
        };

        // Queue TASK_CREATED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_CREATED', task.id, eventPayload);
        }

        // Record to history for undo/redo
        // Forward: TASK_CREATED, Backward: TASK_DELETED
        this.recordToHistory(
            this.createEvent('TASK_CREATED', task.id, eventPayload),
            this.createEvent('TASK_DELETED', task.id, {}),
            `Add ${task.rowType === 'blank' ? 'Row' : 'Task'}`
        );
    }

    /**
     * Update an existing task
     * Uses optimistic update: local state updated immediately, then worker calculates
     */
    public updateTask(id: string, updates: Partial<Task>): void {
        // Sanitize name field: trim whitespace, reject empty names
        if (updates.name !== undefined) {
            const trimmedName = String(updates.name).trim();
            if (trimmedName === '') {
                delete updates.name; // Don't update name if it would be empty
            } else {
                updates.name = trimmedName;
            }
        }

        // Get current task to capture old values for undo
        const currentTasks = this.tasks$.value;
        const taskIndex = currentTasks.findIndex(t => t.id === id);
        const oldTask = taskIndex >= 0 ? currentTasks[taskIndex] : null;
        
        // Store snapshot before optimistic update (for rollback on error)
        const wasComposite = this.historyManager?.isInComposite() || false;
        this.pendingOperation = {
            type: 'UPDATE',
            taskId: id,
            snapshot: [...currentTasks],
            wasComposite
        };
        
        // OPTIMISTIC UPDATE: Apply updates to local state immediately
        if (taskIndex >= 0) {
            const updatedTasks = [...currentTasks];
            updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], ...updates };
            this.tasks$.next(updatedTasks);
        }
        
        // Send to worker for CPM calculation
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id, updates } });

        // Map task property names to DB field names for persistence
        const propToFieldMap: Record<string, string> = {
            parentId: 'parent_id',
            sortKey: 'sort_key',
            rowType: 'row_type',
            constraintType: 'constraint_type',
            constraintDate: 'constraint_date',
            actualStart: 'actual_start',
            actualFinish: 'actual_finish',
            remainingDuration: 'remaining_duration',
            baselineStart: 'baseline_start',
            baselineFinish: 'baseline_finish',
            baselineDuration: 'baseline_duration',
            _collapsed: 'is_collapsed',
            schedulingMode: 'scheduling_mode',
        };

        // Filter to persistable fields only
        const calculatedFields = ['start', 'end', 'level', 'lateStart', 'lateFinish', 
                                 'totalFloat', 'freeFloat', '_isCritical', '_health'];
        const persistableUpdates = Object.entries(updates).filter(
            ([prop]) => !calculatedFields.includes(prop)
        );

        // Filter out updates where value hasn't actually changed
        // This prevents recording no-op changes (e.g., blur on unchanged field)
        const changedUpdates = persistableUpdates.filter(([prop, newValue]) => {
            if (!oldTask) return true; // New task - all values are changes
            const oldValue = (oldTask as unknown as Record<string, unknown>)[prop];
            // Use JSON.stringify for deep comparison (handles arrays, objects)
            return JSON.stringify(newValue) !== JSON.stringify(oldValue);
        });

        // If no actual changes, skip history recording
        if (changedUpdates.length === 0) {
            return;
        }

        // FIX: Wrap multi-field updates in a composite action for single undo
        // This prevents needing to click undo multiple times for one logical edit
        const needsComposite = changedUpdates.length > 1 && this.historyManager;
        if (needsComposite) {
            this.historyManager!.beginComposite('Update Task');
        }

        // Queue TASK_UPDATED events for persistence (one per field for granular persistence)
        for (const [prop, newValue] of changedUpdates) {
            const field = propToFieldMap[prop] || prop;
            const oldValue = oldTask ? (oldTask as unknown as Record<string, unknown>)[prop] : null;

            if (this.persistenceService) {
                this.persistenceService.queueEvent('TASK_UPDATED', id, {
                    field,
                    new_value: newValue,
                });
            }

            // Record to history for undo/redo
            // Forward: TASK_UPDATED with new value, Backward: TASK_UPDATED with old value
            this.recordToHistory(
                this.createEvent('TASK_UPDATED', id, { field, new_value: newValue }),
                this.createEvent('TASK_UPDATED', id, { field, new_value: oldValue }),
                `Update ${prop}`
            );
        }

        // End composite if we started one
        if (needsComposite) {
            this.historyManager!.endComposite();
        }
    }

    /**
     * Delete a task
     * Uses optimistic update: local state updated immediately, then worker calculates
     */
    public deleteTask(id: string): void {
        // Capture task snapshot BEFORE deletion for undo
        const taskToDelete = this.getTaskById(id);
        const descendants = this.getDescendants(id);
        
        // Store snapshot before optimistic update (for rollback on error)
        const wasComposite = this.historyManager?.isInComposite() || false;
        this.pendingOperation = {
            type: 'DELETE',
            taskId: id,
            snapshot: [...this.tasks$.value],
            wasComposite
        };
        
        // OPTIMISTIC UPDATE: Remove from local state immediately
        // Also remove all descendants to maintain hierarchy integrity
        const idsToRemove = new Set([id, ...descendants.map(d => d.id)]);
        const currentTasks = this.tasks$.value.filter(t => !idsToRemove.has(t.id));
        this.tasks$.next(currentTasks);
        
        // Send to worker for CPM calculation
        this.isCalculating$.next(true);
        this.send({ type: 'DELETE_TASK', payload: { id } });

        // Queue TASK_DELETED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_DELETED', id, {});
        }

        // Record to history for undo/redo
        // Forward: TASK_DELETED, Backward: TASK_CREATED with full snapshot
        if (taskToDelete) {
            const restorePayload = {
                id: taskToDelete.id,
                parent_id: taskToDelete.parentId,
                sort_key: taskToDelete.sortKey,
                row_type: taskToDelete.rowType || 'task',
                name: taskToDelete.name,
                notes: taskToDelete.notes || '',
                duration: taskToDelete.duration,
                constraint_type: taskToDelete.constraintType,
                constraint_date: taskToDelete.constraintDate,
                scheduling_mode: taskToDelete.schedulingMode || 'Auto',
                dependencies: taskToDelete.dependencies || [],
                progress: taskToDelete.progress || 0,
                actual_start: taskToDelete.actualStart,
                actual_finish: taskToDelete.actualFinish,
                remaining_duration: taskToDelete.remainingDuration,
                baseline_start: taskToDelete.baselineStart,
                baseline_finish: taskToDelete.baselineFinish,
                baseline_duration: taskToDelete.baselineDuration,
                is_collapsed: taskToDelete._collapsed || false,
            };

            this.recordToHistory(
                this.createEvent('TASK_DELETED', id, {}),
                this.createEvent('TASK_CREATED', id, restorePayload),
                `Delete ${taskToDelete.rowType === 'blank' ? 'Row' : 'Task'}`
            );
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
    // Public API - Event Application (for Undo/Redo)
    // ========================================================================

    /**
     * Apply an array of events from undo/redo
     * Does NOT record to history (avoids infinite loop)
     * @param events - Array of events to apply
     * @param skipPersistence - If true, don't queue persistence events (for undo/redo)
     */
    public applyEvents(events: Array<{ type: string; targetId: string | null; payload: Record<string, unknown> }>): void {
        for (const event of events) {
            this.applyEvent(event, true); // Skip persistence for undo/redo events
        }
    }

    /**
     * Apply a single event from undo/redo
     * @param event - Event to apply
     * @param skipPersistence - If true, don't queue persistence events
     */
    public applyEvent(
        event: { type: string; targetId: string | null; payload: Record<string, unknown> },
        skipPersistence: boolean = false
    ): void {
        switch (event.type) {
            case 'TASK_CREATED':
                this._applyTaskCreated(event.payload, skipPersistence);
                break;
            case 'TASK_UPDATED':
                this._applyTaskUpdated(event.targetId!, event.payload, skipPersistence);
                break;
            case 'TASK_DELETED':
                this._applyTaskDeleted(event.targetId!, skipPersistence);
                break;
            case 'TASK_MOVED':
                this._applyTaskMoved(event.targetId!, event.payload, skipPersistence);
                break;
            case 'CALENDAR_UPDATED':
                this._applyCalendarUpdated(event.payload, skipPersistence);
                break;
            default:
                console.warn(`[ProjectController] Unknown event type: ${event.type}`);
        }
    }

    private _applyTaskCreated(payload: Record<string, unknown>, skipPersistence: boolean): void {
        const task: Task = {
            id: payload.id as string,
            parentId: (payload.parent_id as string | null) ?? null,
            sortKey: (payload.sort_key as string) || '',
            rowType: (payload.row_type as 'task' | 'blank' | 'phantom') || 'task',
            name: (payload.name as string) || 'New Task',
            notes: (payload.notes as string) || '',
            duration: (payload.duration as number) || 1,
            constraintType: ((payload.constraint_type as string) || 'asap') as ConstraintType,
            constraintDate: (payload.constraint_date as string | null) ?? null,
            dependencies: this._parseDependencies(payload.dependencies),
            progress: (payload.progress as number) || 0,
            actualStart: (payload.actual_start as string | null) ?? null,
            actualFinish: (payload.actual_finish as string | null) ?? null,
            remainingDuration: (payload.remaining_duration as number | null) ?? undefined,
            baselineStart: (payload.baseline_start as string | null) ?? null,
            baselineFinish: (payload.baseline_finish as string | null) ?? null,
            baselineDuration: (payload.baseline_duration as number | null) ?? undefined,
            _collapsed: Boolean(payload.is_collapsed),
            schedulingMode: ((payload.scheduling_mode as string) || 'Auto') as SchedulingMode,
            level: 0,
            start: '',
            end: '',
        };

        // Optimistic update
        const currentTasks = [...this.tasks$.value];
        const existingIndex = currentTasks.findIndex(t => t.id === task.id);
        if (existingIndex < 0) {
            currentTasks.push(task);
            this.tasks$.next(currentTasks);
        }

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'ADD_TASK', payload: task });

        // Queue persistence if not from undo/redo
        if (!skipPersistence && this.persistenceService) {
            this.persistenceService.queueEvent('TASK_CREATED', task.id, payload);
        }
    }

    private _applyTaskUpdated(taskId: string, payload: Record<string, unknown>, skipPersistence: boolean): void {
        const field = payload.field as string;
        const newValue = payload.new_value;

        // Map DB field names to Task property names
        const fieldMap: Record<string, string> = {
            parent_id: 'parentId',
            sort_key: 'sortKey',
            row_type: 'rowType',
            constraint_type: 'constraintType',
            constraint_date: 'constraintDate',
            actual_start: 'actualStart',
            actual_finish: 'actualFinish',
            remaining_duration: 'remainingDuration',
            baseline_start: 'baselineStart',
            baseline_finish: 'baselineFinish',
            baseline_duration: 'baselineDuration',
            is_collapsed: '_collapsed',
            scheduling_mode: 'schedulingMode',
        };

        const propName = fieldMap[field] || field;
        const updates = { [propName]: newValue } as Partial<Task>;

        // Optimistic update
        const currentTasks = [...this.tasks$.value];
        const taskIndex = currentTasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
            currentTasks[taskIndex] = { ...currentTasks[taskIndex], ...updates };
            this.tasks$.next(currentTasks);
        }

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id: taskId, updates } });

        // Queue persistence if not from undo/redo
        if (!skipPersistence && this.persistenceService) {
            this.persistenceService.queueEvent('TASK_UPDATED', taskId, payload);
        }
    }

    private _applyTaskDeleted(taskId: string, skipPersistence: boolean): void {
        // Optimistic update - remove task and descendants
        const descendants = this.getDescendants(taskId);
        const idsToRemove = new Set([taskId, ...descendants.map(d => d.id)]);
        const currentTasks = this.tasks$.value.filter(t => !idsToRemove.has(t.id));
        this.tasks$.next(currentTasks);

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'DELETE_TASK', payload: { id: taskId } });

        // Queue persistence if not from undo/redo
        if (!skipPersistence && this.persistenceService) {
            this.persistenceService.queueEvent('TASK_DELETED', taskId, {});
        }
    }

    private _applyTaskMoved(taskId: string, payload: Record<string, unknown>, skipPersistence: boolean): void {
        // TASK_MOVED events update parentId and sortKey
        const updates: Partial<Task> = {};
        if ('new_parent_id' in payload) {
            updates.parentId = payload.new_parent_id as string | null;
        }
        if ('new_sort_key' in payload) {
            updates.sortKey = payload.new_sort_key as string;
        }

        // Optimistic update
        const currentTasks = [...this.tasks$.value];
        const taskIndex = currentTasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
            currentTasks[taskIndex] = { ...currentTasks[taskIndex], ...updates };
            this.tasks$.next(currentTasks);
        }

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id: taskId, updates } });

        // Queue persistence if not from undo/redo
        if (!skipPersistence && this.persistenceService) {
            this.persistenceService.queueEvent('TASK_MOVED', taskId, payload);
        }
    }

    private _applyCalendarUpdated(payload: Record<string, unknown>, skipPersistence: boolean): void {
        const calendar: Calendar = {
            workingDays: (payload.new_working_days as number[]) || this.calendar$.value.workingDays,
            exceptions: (payload.new_exceptions as Calendar['exceptions']) || this.calendar$.value.exceptions,
        };

        // Update local calendar
        this.calendar$.next(calendar);

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_CALENDAR', payload: calendar });

        // Queue persistence if not from undo/redo
        if (!skipPersistence && this.persistenceService) {
            this.persistenceService.queueEvent('CALENDAR_UPDATED', null, payload);
        }
    }

    private _parseDependencies(deps: unknown): Task['dependencies'] {
        if (!deps || !Array.isArray(deps)) return [];
        return deps.map((d: unknown) => {
            if (typeof d === 'object' && d !== null) {
                const dep = d as Record<string, unknown>;
                return {
                    id: String(dep.id || ''),
                    type: (String(dep.type || 'FS')) as 'FS' | 'SS' | 'FF' | 'SF',
                    lag: Number(dep.lag || 0),
                };
            }
            return { id: String(d), type: 'FS' as const, lag: 0 };
        });
    }

    // ========================================================================
    // Public API - Calendar Operations
    // ========================================================================

    /**
     * Update calendar configuration
     */
    public updateCalendar(calendar: Calendar): void {
        // Capture old calendar for undo
        const oldCalendar = this.calendar$.value;
        
        // Store calendar locally for snapshot access
        this.calendar$.next(calendar);
        
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_CALENDAR', payload: calendar });

        const forwardPayload = {
            new_working_days: calendar.workingDays,
            new_exceptions: calendar.exceptions,
        };

        const backwardPayload = {
            new_working_days: oldCalendar.workingDays,
            new_exceptions: oldCalendar.exceptions,
        };

        // Queue CALENDAR_UPDATED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('CALENDAR_UPDATED', null, forwardPayload);
        }

        // Record to history for undo/redo
        this.recordToHistory(
            this.createEvent('CALENDAR_UPDATED', null, forwardPayload),
            this.createEvent('CALENDAR_UPDATED', null, backwardPayload),
            'Update Calendar'
        );
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
    // Helper Methods (replaces TaskStore methods for migration)
    // ========================================================================

    /**
     * Get task by ID
     */
    public getTaskById(id: string): Task | undefined {
        return this.tasks$.value.find(t => t.id === id);
    }

    /**
     * Check if a task has children (is a parent/summary task)
     */
    public isParent(id: string): boolean {
        return this.tasks$.value.some(t => t.parentId === id);
    }

    /**
     * Get depth of task in hierarchy (0 = root level)
     */
    public getDepth(id: string, depth: number = 0): number {
        const task = this.tasks$.value.find(t => t.id === id);
        if (!task || !task.parentId) return depth;
        return this.getDepth(task.parentId, depth + 1);
    }

    /**
     * Get children of a parent, sorted by sortKey
     */
    public getChildren(parentId: string | null): Task[] {
        return this.tasks$.value
            .filter(t => (t.parentId ?? null) === parentId)
            .sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
    }

    /**
     * Get visible tasks (respecting collapse state)
     * @param isCollapsed - Function to check if a task is collapsed
     */
    public getVisibleTasks(isCollapsed: (id: string) => boolean): Task[] {
        const result: Task[] = [];
        const addVisibleChildren = (parentId: string | null) => {
            const children = this.getChildren(parentId);
            for (const child of children) {
                result.push(child);
                if (!isCollapsed(child.id)) {
                    addVisibleChildren(child.id);
                }
            }
        };
        addVisibleChildren(null);
        return result;
    }

    /**
     * Get last sort key for siblings of a parent
     */
    public getLastSortKey(parentId: string | null): string | null {
        const siblings = this.getChildren(parentId);
        if (siblings.length === 0) return null;
        return siblings[siblings.length - 1].sortKey ?? null;
    }

    /**
     * Get first sort key for siblings of a parent
     */
    public getFirstSortKey(parentId: string | null): string | null {
        const siblings = this.getChildren(parentId);
        if (siblings.length === 0) return null;
        return siblings[0].sortKey ?? null;
    }

    /**
     * Check if a task is a blank row
     */
    public isBlankRow(id: string): boolean {
        const task = this.getTaskById(id);
        return task?.rowType === 'blank';
    }

    /**
     * Get all schedulable tasks (exclude blank/phantom rows)
     */
    public getSchedulableTasks(): Task[] {
        return this.tasks$.value.filter(t => !t.rowType || t.rowType === 'task');
    }

    /**
     * Get all descendants of a task (recursive children)
     */
    public getDescendants(id: string): Task[] {
        const descendants: Task[] = [];
        const collectDescendants = (parentId: string) => {
            const children = this.tasks$.value.filter(t => t.parentId === parentId);
            for (const child of children) {
                descendants.push(child);
                collectDescendants(child.id);
            }
        };
        collectDescendants(id);
        return descendants;
    }

    // ========================================================================
    // Additional Helper Methods (for SchedulerService migration)
    // ========================================================================

    /**
     * Create a blank row (visual spacer/placeholder)
     * @param sortKey - Position in the list
     * @param parentId - Parent task ID (for hierarchy)
     * @returns The created blank row task
     */
    public createBlankRow(sortKey: string, parentId: string | null = null): Task {
        const blankRow: Task = {
            id: `blank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            rowType: 'blank',
            name: '',
            parentId: parentId,
            sortKey: sortKey,
            duration: 0,
            constraintType: 'asap',
            constraintDate: null,
            dependencies: [],
            progress: 0,
            level: parentId ? this.getDepth(parentId) + 1 : 0,
            start: '',
            end: '',
            notes: '',
        };

        // Add to local state (optimistic update)
        const currentTasks = [...this.tasks$.value, blankRow];
        this.tasks$.next(currentTasks);

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'ADD_TASK', payload: blankRow });

        const eventPayload = {
            id: blankRow.id,
            parent_id: blankRow.parentId,
            sort_key: blankRow.sortKey,
            row_type: 'blank',
            name: '',
            duration: 0,
            constraint_type: 'asap',
            dependencies: [],
            progress: 0,
        };

        // Queue persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_CREATED', blankRow.id, eventPayload);
        }

        // Record to history for undo/redo
        this.recordToHistory(
            this.createEvent('TASK_CREATED', blankRow.id, eventPayload),
            this.createEvent('TASK_DELETED', blankRow.id, {}),
            'Add Row'
        );

        return blankRow;
    }

    /**
     * Convert a blank row to a regular task (wake up)
     * @param taskId - ID of the blank row to convert
     * @param name - Name for the new task
     * @returns The converted task, or undefined if not found/not blank
     */
    public wakeUpBlankRow(taskId: string, name: string = 'New Task'): Task | undefined {
        const task = this.getTaskById(taskId);
        if (!task || task.rowType !== 'blank') return undefined;

        // Capture old values for undo
        const oldRowType = task.rowType;
        const oldName = task.name;
        const oldDuration = task.duration;

        const updates: Partial<Task> = {
            rowType: 'task',
            name: name,
            duration: 1, // Default duration for new tasks
        };

        // Optimistic update
        const currentTasks = [...this.tasks$.value];
        const taskIndex = currentTasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
            currentTasks[taskIndex] = { ...currentTasks[taskIndex], ...updates };
            this.tasks$.next(currentTasks);
        }

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id: taskId, updates } });

        // Queue persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_UPDATED', taskId, { field: 'row_type', new_value: 'task' });
            this.persistenceService.queueEvent('TASK_UPDATED', taskId, { field: 'name', new_value: name });
            this.persistenceService.queueEvent('TASK_UPDATED', taskId, { field: 'duration', new_value: 1 });
        }

        // Record to history as composite action (group all 3 updates for single undo)
        if (this.historyManager) {
            this.historyManager.beginComposite('Create Task');
            this.recordToHistory(
                this.createEvent('TASK_UPDATED', taskId, { field: 'row_type', new_value: 'task' }),
                this.createEvent('TASK_UPDATED', taskId, { field: 'row_type', new_value: oldRowType })
            );
            this.recordToHistory(
                this.createEvent('TASK_UPDATED', taskId, { field: 'name', new_value: name }),
                this.createEvent('TASK_UPDATED', taskId, { field: 'name', new_value: oldName })
            );
            this.recordToHistory(
                this.createEvent('TASK_UPDATED', taskId, { field: 'duration', new_value: 1 }),
                this.createEvent('TASK_UPDATED', taskId, { field: 'duration', new_value: oldDuration })
            );
            this.historyManager.endComposite();
        }

        return currentTasks[taskIndex];
    }

    /**
     * Move a task (change parent and/or sortKey)
     * Used for indent/outdent and drag-drop operations
     * @param taskId - ID of task to move
     * @param newParentId - New parent ID (null for root level)
     * @param newSortKey - New sort key for ordering
     * @returns true if successful
     */
    public moveTask(taskId: string, newParentId: string | null, newSortKey: string): boolean {
        const task = this.getTaskById(taskId);
        if (!task) return false;

        const oldParentId = task.parentId ?? null;
        const oldSortKey = task.sortKey;

        // Skip if no change
        if (oldParentId === newParentId && oldSortKey === newSortKey) return true;

        const updates: Partial<Task> = {
            parentId: newParentId,
            sortKey: newSortKey,
        };

        // Optimistic update
        const currentTasks = [...this.tasks$.value];
        const taskIndex = currentTasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
            currentTasks[taskIndex] = { ...currentTasks[taskIndex], ...updates };
            this.tasks$.next(currentTasks);
        }

        // Send to worker
        this.isCalculating$.next(true);
        this.send({ type: 'UPDATE_TASK', payload: { id: taskId, updates } });

        const forwardPayload = {
            old_parent_id: oldParentId,
            new_parent_id: newParentId,
            old_sort_key: oldSortKey,
            new_sort_key: newSortKey,
        };

        const backwardPayload = {
            old_parent_id: newParentId,
            new_parent_id: oldParentId,
            old_sort_key: newSortKey,
            new_sort_key: oldSortKey,
        };

        // Queue TASK_MOVED event for persistence
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_MOVED', taskId, forwardPayload);
        }

        // Record to history for undo/redo
        this.recordToHistory(
            this.createEvent('TASK_MOVED', taskId, forwardPayload),
            this.createEvent('TASK_MOVED', taskId, backwardPayload),
            'Move Task'
        );

        return true;
    }

    /**
     * Update just the sort key of a task
     * Used for reordering within siblings
     * @param taskId - ID of task to update
     * @param newSortKey - New sort key
     * @returns true if successful
     */
    public updateSortKey(taskId: string, newSortKey: string): boolean {
        const task = this.getTaskById(taskId);
        if (!task) return false;

        const oldSortKey = task.sortKey;
        if (oldSortKey === newSortKey) return true;

        // Use updateTask for consistency
        this.updateTask(taskId, { sortKey: newSortKey });

        return true;
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
        this.toastService = null;
        this.pendingOperation = null;
    }
    
    // ========================================================================
    // Rollback Mechanism (Phase 2)
    // ========================================================================
    
    /**
     * Rollback pending optimistic update on worker error
     * Reverts state, cancels history, and shows error notification
     * 
     * @private
     */
    private _rollbackPendingOperation(errorMessage: string): void {
        if (!this.pendingOperation) {
            return; // No pending operation to rollback
        }
        
        const { type, taskId, snapshot, wasComposite } = this.pendingOperation;
        
        console.log(`[ProjectController] Rolling back ${type} operation for task ${taskId}`);
        
        // 1. Revert state to snapshot
        this.tasks$.next(snapshot);
        
        // 2. Cancel history (if composite active, cancel it; otherwise undo last action)
        if (this.historyManager) {
            if (wasComposite && this.historyManager.isInComposite()) {
                this.historyManager.cancelComposite();
                console.log('[ProjectController] Cancelled composite action');
            } else if (!wasComposite && this.historyManager.canUndo()) {
                // Undo the last action (which was the failed operation)
                const backwardEvents = this.historyManager.undo();
                if (backwardEvents && backwardEvents.length > 0) {
                    // Apply backward events to sync worker state (skip persistence since we're rolling back)
                    // Note: applyEvents already skips persistence for undo/redo events
                    this.applyEvents(backwardEvents);
                    console.log('[ProjectController] Undone failed operation');
                }
            }
        }
        
        // 3. Note: Persistence events are queued but not flushed immediately
        // If they haven't been flushed yet, they'll be inconsistent but harmless
        // If they have been flushed, we'd need compensation events (future enhancement)
        
        // 4. Show error notification
        const userMessage = this._formatErrorMessage(type, errorMessage);
        if (this.toastService) {
            this.toastService.error(userMessage);
        } else {
            // Fallback to console if toast service not available
            console.error(`[ProjectController] ${userMessage}`);
        }
        
        // 5. Clear pending operation
        this.pendingOperation = null;
    }
    
    /**
     * Format error message for user display
     * 
     * @private
     */
    private _formatErrorMessage(operationType: 'ADD' | 'UPDATE' | 'DELETE', errorMessage: string): string {
        const operationLabels: Record<'ADD' | 'UPDATE' | 'DELETE', string> = {
            ADD: 'Adding task',
            UPDATE: 'Updating task',
            DELETE: 'Deleting task'
        };
        
        // Extract meaningful error message (remove technical details if present)
        let message = errorMessage;
        if (message.includes('WASM')) {
            message = 'Calculation engine error';
        } else if (message.includes('not found')) {
            message = 'Task not found';
        } else if (message.includes('circular') || message.includes('dependency')) {
            message = 'Invalid dependency detected';
        }
        
        return `${operationLabels[operationType]} failed: ${message}`;

        // Clear singleton for potential re-initialization
        ProjectController.instance = null as any;
    }
}
