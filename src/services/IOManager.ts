/**
 * IOManager
 * 
 * Monitors the ProjectController state and provides file export/import capabilities.
 * 
 * PHASE 6 UPDATE: Persistence is now handled by PersistenceService via event sourcing.
 * This class no longer syncs to Rust backend - it just monitors state and handles
 * file import/export operations.
 * 
 * Responsibilities:
 * 1. Monitor task state changes (logging/debugging)
 * 2. Export project to JSON file
 * 3. Import project from JSON file
 */

import { ProjectController } from './ProjectController';
import { debounceTime, skip } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import type { Task } from '../types';

/**
 * IOManager
 * 
 * Provides file I/O and state monitoring capabilities.
 * Actual persistence to SQLite is handled by PersistenceService.
 */
export class IOManager {
    private controller: ProjectController;
    private subscriptions: Subscription[] = [];
    private isAutoSaveEnabled = true;

    // ========================================================================
    // Constructor
    // ========================================================================

    constructor(controller?: ProjectController) {
        this.controller = controller || ProjectController.getInstance();
        this.setupMonitoring();
    }

    // ========================================================================
    // Monitoring
    // ========================================================================

    /**
     * Set up state monitoring
     * Note: Actual persistence is handled by PersistenceService.
     * This just logs state changes for debugging.
     */
    private setupMonitoring(): void {
        // Subscribe to task changes for monitoring/debugging
        const taskSub = this.controller.tasks$
            .pipe(
                skip(1), // Skip initial empty state
                debounceTime(5000) // Log every 5 seconds of inactivity
            )
            .subscribe((tasks) => {
                if (this.isAutoSaveEnabled && tasks.length > 0) {
                    console.log(`[IOManager] State checkpoint: ${tasks.length} tasks (events persisted via PersistenceService)`);
                }
            });

        this.subscriptions.push(taskSub);
        console.log('[IOManager] Monitoring initialized');
    }

    // ========================================================================
    // Export Operations
    // ========================================================================

    /**
     * Export project to JSON string
     * Includes tasks, calendar, and stats for full project export
     */
    public exportToJson(): string {
        const tasks = this.controller.getTasks();
        const calendar = this.controller.getCalendar();
        const stats = this.controller.getStats();
        
        return JSON.stringify({
            version: '2.0.0',
            exportDate: new Date().toISOString(),
            tasks,
            calendar,
            stats
        }, null, 2);
    }

    /**
     * Import tasks from JSON string
     * Note: This uses syncTasks which does NOT queue individual persistence events.
     * For proper persistence, the imported data should go through PersistenceService.
     */
    public async importFromJson(json: string): Promise<boolean> {
        try {
            const data = JSON.parse(json);
            
            if (!data.tasks || !Array.isArray(data.tasks)) {
                throw new Error('Invalid JSON format: missing tasks array');
            }

            // Sync imported tasks to the worker
            this.controller.syncTasks(data.tasks);
            
            // If calendar is present, update it
            if (data.calendar) {
                this.controller.updateCalendar(data.calendar);
            }
            
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
     * Enable/disable monitoring logs
     */
    public setAutoSave(enabled: boolean): void {
        this.isAutoSaveEnabled = enabled;
        console.log(`[IOManager] Monitoring ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if monitoring is enabled
     */
    public isAutoSave(): boolean {
        return this.isAutoSaveEnabled;
    }

    // ========================================================================
    // Deprecated Methods (kept for backwards compatibility)
    // ========================================================================

    /**
     * @deprecated Persistence is now handled by PersistenceService.
     * This method is kept for backwards compatibility but does nothing.
     */
    public async forceSave(): Promise<boolean> {
        console.log('[IOManager] forceSave() is deprecated - persistence handled by PersistenceService');
        return true;
    }

    /**
     * @deprecated Loading is now handled by DataLoader in AppInitializer.
     * This method is kept for backwards compatibility but returns null.
     */
    public async loadFromBackend(): Promise<{
        tasks: Task[];
        calendar: { workingDays: number[]; exceptions: Record<string, unknown> };
        tradePartners: unknown[];
    } | null> {
        console.log('[IOManager] loadFromBackend() is deprecated - use DataLoader instead');
        return null;
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
