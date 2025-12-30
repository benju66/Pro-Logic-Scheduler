/**
 * IOManager
 * 
 * Orchestrates persistence between the Worker (source of truth for calculations)
 * and the Rust Backend (file system / SQLite database).
 * 
 * Responsibilities:
 * 1. Auto-save task changes to backend with debouncing
 * 2. Load data from backend on startup
 * 3. Export/import project files
 * 4. Handle save conflicts and errors
 * 
 * This bridges the gap between the WASM Worker (which holds the live state)
 * and the Tauri Rust backend (which handles persistence).
 */

import { ProjectController } from './ProjectController';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import type { Task, Calendar, TradePartner } from '../types';

// Conditional import for Tauri - allows running in browser for testing
let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

/**
 * IOManager
 * 
 * Handles all persistence operations between the WASM Worker and Tauri backend.
 */
export class IOManager {
    private controller: ProjectController;
    private subscriptions: Subscription[] = [];
    private isAutoSaveEnabled = true;
    private isSaving = false;
    private pendingSave = false;
    private lastSavedHash = '';

    // ========================================================================
    // Constructor
    // ========================================================================

    constructor(controller?: ProjectController) {
        this.controller = controller || ProjectController.getInstance();
        this.initializeTauriApi();
    }

    /**
     * Initialize Tauri API (conditional for test mode)
     */
    private async initializeTauriApi(): Promise<void> {
        try {
            if (typeof window !== 'undefined' && (window as any).__TAURI__) {
                const tauri = await import('@tauri-apps/api/core');
                invoke = tauri.invoke;
                console.log('[IOManager] Tauri API available');
                this.setupAutoSave();
            } else {
                console.log('[IOManager] Running without Tauri (test mode)');
            }
        } catch (err) {
            console.warn('[IOManager] Tauri API not available:', err);
        }
    }

    // ========================================================================
    // Auto-Save
    // ========================================================================

    /**
     * Set up auto-save subscription
     * Debounces task changes and saves to backend
     */
    private setupAutoSave(): void {
        // Subscribe to task changes with debouncing
        const taskSub = this.controller.tasks$
            .pipe(
                skip(1), // Skip initial empty state
                debounceTime(2000), // Wait 2s after last change
                distinctUntilChanged((prev, curr) => {
                    // Simple hash comparison to avoid unnecessary saves
                    const hash = this.hashTasks(curr);
                    if (hash === this.lastSavedHash) return true;
                    this.lastSavedHash = hash;
                    return false;
                })
            )
            .subscribe(async (tasks) => {
                if (this.isAutoSaveEnabled && tasks.length > 0) {
                    await this.saveToBackend(tasks);
                }
            });

        this.subscriptions.push(taskSub);
        console.log('[IOManager] Auto-save enabled');
    }

    /**
     * Generate a simple hash of tasks for change detection
     */
    private hashTasks(tasks: Task[]): string {
        // Simple hash based on task count and modification indicators
        return `${tasks.length}-${tasks.map(t => `${t.id}:${t.start}:${t.end}`).join(',')}`;
    }

    /**
     * Save tasks to backend
     */
    private async saveToBackend(tasks: Task[]): Promise<void> {
        if (!invoke) {
            console.log('[IOManager] Skipping save (no Tauri)');
            return;
        }

        if (this.isSaving) {
            this.pendingSave = true;
            return;
        }

        this.isSaving = true;

        try {
            console.log(`[IOManager] Saving ${tasks.length} tasks...`);
            
            // Serialize tasks for Rust backend
            const tasksJson = JSON.stringify(tasks);
            
            // Call Tauri command
            await invoke('sync_engine_tasks', { tasksJson });
            
            console.log('[IOManager] ✅ Save complete');
        } catch (err) {
            console.error('[IOManager] ❌ Save failed:', err);
        } finally {
            this.isSaving = false;
            
            // Process any pending save
            if (this.pendingSave) {
                this.pendingSave = false;
                const currentTasks = this.controller.getTasks();
                if (currentTasks.length > 0) {
                    await this.saveToBackend(currentTasks);
                }
            }
        }
    }

    // ========================================================================
    // Load Operations
    // ========================================================================

    /**
     * Load project data from backend
     */
    public async loadFromBackend(): Promise<{
        tasks: Task[];
        calendar: Calendar;
        tradePartners: TradePartner[];
    } | null> {
        if (!invoke) {
            console.log('[IOManager] Cannot load (no Tauri)');
            return null;
        }

        try {
            console.log('[IOManager] Loading from backend...');
            
            const result = await invoke('load_project_data') as {
                tasks: Task[];
                calendar: Calendar;
                trade_partners: TradePartner[];
            };

            console.log(`[IOManager] ✅ Loaded ${result.tasks?.length || 0} tasks`);
            
            return {
                tasks: result.tasks || [],
                calendar: result.calendar || { workingDays: [1, 2, 3, 4, 5], exceptions: {} },
                tradePartners: result.trade_partners || []
            };
        } catch (err) {
            console.error('[IOManager] ❌ Load failed:', err);
            return null;
        }
    }

    // ========================================================================
    // Manual Save/Export Operations
    // ========================================================================

    /**
     * Force save immediately (bypasses debounce)
     */
    public async forceSave(): Promise<boolean> {
        const tasks = this.controller.getTasks();
        if (tasks.length === 0) return true;

        try {
            await this.saveToBackend(tasks);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Export project to JSON
     */
    public exportToJson(): string {
        const tasks = this.controller.getTasks();
        const stats = this.controller.getStats();
        
        return JSON.stringify({
            version: '2.0.0',
            exportDate: new Date().toISOString(),
            tasks,
            stats
        }, null, 2);
    }

    /**
     * Import tasks from JSON
     */
    public async importFromJson(json: string): Promise<boolean> {
        try {
            const data = JSON.parse(json);
            
            if (!data.tasks || !Array.isArray(data.tasks)) {
                throw new Error('Invalid JSON format: missing tasks array');
            }

            // Sync imported tasks to the worker
            this.controller.syncTasks(data.tasks);
            
            console.log(`[IOManager] Imported ${data.tasks.length} tasks`);
            return true;
        } catch (err) {
            console.error('[IOManager] Import failed:', err);
            return false;
        }
    }

    // ========================================================================
    // Settings
    // ========================================================================

    /**
     * Enable/disable auto-save
     */
    public setAutoSave(enabled: boolean): void {
        this.isAutoSaveEnabled = enabled;
        console.log(`[IOManager] Auto-save ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if auto-save is enabled
     */
    public isAutoSave(): boolean {
        return this.isAutoSaveEnabled;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Dispose and clean up subscriptions
     */
    public dispose(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        console.log('[IOManager] Disposed');
    }
}
