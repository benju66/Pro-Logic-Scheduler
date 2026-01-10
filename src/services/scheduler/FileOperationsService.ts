/**
 * @fileoverview FileOperationsService - File open, save, import, export operations
 * @module services/scheduler/FileOperationsService
 * 
 * Phase 6 of SchedulerService decomposition.
 * Extracts file operations from SchedulerService into a focused,
 * single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { Task } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { FileService } from '../../ui/services/FileService';
import type { ToastService } from '../../ui/services/ToastService';
import type { PersistenceService } from '../../data/PersistenceService';
import { OrderingService } from '../OrderingService';
import { DateUtils } from '../../core/DateUtils';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by FileOperationsService
 */
export interface FileOperationsServiceDeps {
    /** ProjectController for task/calendar data access */
    projectController: ProjectController;
    /** FileService for file I/O operations */
    fileService: FileService;
    /** ToastService for user notifications */
    toastService: ToastService;
    /** PersistenceService for database operations (optional) */
    persistenceService: PersistenceService | null;
    /** Save checkpoint for undo/redo */
    saveCheckpoint: () => void;
    /** Save data to storage */
    saveData: () => void;
    /** Recalculate all tasks (after sample data creation) */
    recalculateAll: () => void;
    /** Storage key for localStorage */
    storageKey: string;
}

// =========================================================================
// FILE OPERATIONS SERVICE
// =========================================================================

/**
 * FileOperationsService - Handles file open, save, import, export
 * 
 * This service handles:
 * - Save/Open from native file dialogs
 * - Export as download
 * - Import from JSON files
 * - Import/Export MS Project XML
 * - Clear all data
 * - Sort key migration for imported tasks
 * 
 * @example
 * ```typescript
 * const fileOps = new FileOperationsService({
 *     projectController,
 *     fileService,
 *     toastService,
 *     persistenceService,
 *     saveCheckpoint: () => scheduler.saveCheckpoint(),
 *     saveData: () => scheduler.saveData(),
 *     recalculateAll: () => scheduler.recalculateAll(),
 *     storageKey: 'pro_scheduler_v10'
 * });
 * 
 * // Save to file
 * await fileOps.saveToFile();
 * 
 * // Import from MS Project
 * await fileOps.importFromMSProjectXML(file);
 * ```
 */
export class FileOperationsService {
    private deps: FileOperationsServiceDeps;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: FileOperationsServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // SAVE OPERATIONS
    // =========================================================================

    /**
     * Save to file using native dialog
     * @returns Promise that resolves when saved
     */
    async saveToFile(): Promise<void> {
        try {
            await this.deps.fileService.saveToFile({
                tasks: this.deps.projectController.getTasks(),
                calendar: this.deps.projectController.getCalendar(),
            });
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Export as download (browser download)
     */
    exportAsDownload(): void {
        this.deps.fileService.exportAsDownload({
            tasks: this.deps.projectController.getTasks(),
            calendar: this.deps.projectController.getCalendar(),
        });
    }

    /**
     * Export to MS Project XML format
     */
    exportToMSProjectXML(): void {
        this.deps.fileService.exportToMSProjectXML({
            tasks: this.deps.projectController.getTasks(),
            calendar: this.deps.projectController.getCalendar(),
        });
    }

    // =========================================================================
    // OPEN/IMPORT OPERATIONS
    // =========================================================================

    /**
     * Open from file using native dialog
     * @returns Promise that resolves when loaded
     */
    async openFromFile(): Promise<void> {
        try {
            const data = await this.deps.fileService.openFromFile();
            if (data) {
                this.deps.saveCheckpoint();
                this.deps.projectController.syncTasks(data.tasks || []);
                if (data.calendar) {
                    this.deps.projectController.updateCalendar(data.calendar);
                }
                // NOTE: ProjectController handles recalc/save via Worker
                this.deps.toastService.success(`Loaded ${this.deps.projectController.getTasks().length} tasks`);
            }
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Import from file
     * @param file - File object
     * @returns Promise that resolves when imported
     */
    async importFromFile(file: File): Promise<void> {
        try {
            const data = await this.deps.fileService.importFromFile(file);
            this.deps.saveCheckpoint();
            
            // Assign sortKeys to imported tasks
            const tasks = data.tasks || [];
            const tasksWithSortKeys = this.assignSortKeysToImportedTasks(tasks);
            
            this.deps.projectController.syncTasks(tasksWithSortKeys);
            if (data.calendar) {
                this.deps.projectController.updateCalendar(data.calendar);
            }
            // Note: recalculateAll() and render() will be triggered automatically
            this.deps.saveData();
            this.deps.toastService.success(`Imported ${tasksWithSortKeys.length} tasks`);
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Import from MS Project XML file
     * @param file - XML file
     * @returns Promise that resolves when imported
     */
    async importFromMSProjectXML(file: File): Promise<void> {
        try {
            const data = await this.deps.fileService.importFromMSProjectXML(file);
            this.deps.saveCheckpoint();
            
            // Assign sortKeys to imported tasks
            const tasks = data.tasks || [];
            const tasksWithSortKeys = this.assignSortKeysToImportedTasks(tasks);
            
            // Import calendar if provided
            if (data.calendar) {
                this.deps.projectController.updateCalendar(data.calendar);
            }
            
            this.deps.projectController.syncTasks(tasksWithSortKeys);
            // Note: recalculateAll() and render() will be triggered automatically
            this.deps.saveData();
            this.deps.toastService.success(`Imported ${tasksWithSortKeys.length} tasks`);
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Import from MS Project XML content (for Tauri native dialog)
     * @param content - XML file content as string
     */
    async importFromMSProjectXMLContent(content: string): Promise<void> {
        const result = await this.deps.fileService.importFromMSProjectXMLContent(content);
        this.deps.saveCheckpoint();
        
        const tasksWithSortKeys = this.assignSortKeysToImportedTasks(result.tasks);
        this.deps.projectController.syncTasks(tasksWithSortKeys);
        
        if (result.calendar) {
            this.deps.projectController.updateCalendar(result.calendar);
        }
        
        // NOTE: ProjectController handles recalc/save via Worker
        this.deps.toastService.success(`Imported ${result.tasks.length} tasks from MS Project`);
    }

    // =========================================================================
    // DATA MANAGEMENT
    // =========================================================================

    /**
     * Clear all saved data and start fresh
     * Use when data is corrupted or user wants to reset
     */
    async clearAllData(): Promise<void> {
        if (!confirm('This will delete all your tasks and settings. Continue?')) {
            return;
        }
        
        // Purge SQLite database if persistence service is available
        if (this.deps.persistenceService) {
            try {
                await this.deps.persistenceService.purgeDatabase();
            } catch (error) {
                console.error('[FileOperationsService] Failed to purge database:', error);
                this.deps.toastService.error('Failed to clear database - some data may remain');
            }
        }
        
        // Clear localStorage (backup/fallback)
        localStorage.removeItem(this.deps.storageKey);
        localStorage.removeItem('pro_scheduler_column_widths');
        localStorage.removeItem('pro_scheduler_column_preferences');
        
        // Reset in-memory state
        this.deps.projectController.syncTasks([]);
        this.createSampleData();
        
        // NOTE: ProjectController handles recalc/save via Worker
        
        this.deps.toastService.success('All data cleared - starting fresh');
    }

    // =========================================================================
    // SORT KEY MIGRATION
    // =========================================================================

    /**
     * Assign sortKeys to imported tasks that may not have them
     * 
     * This handles legacy data migration where tasks may have:
     * 1. sortKey field (new) - preserved as-is
     * 2. displayOrder field (legacy) - second priority  
     * 3. Original array position - fallback
     * 
     * @param tasks - Tasks to migrate
     * @returns Tasks with sortKey assigned, preserving intended order
     */
    assignSortKeysToImportedTasks(tasks: Task[]): Task[] {
        // Guard: empty or null input
        if (!tasks || tasks.length === 0) {
            return tasks;
        }
        
        // Check if migration is needed
        const needsMigration = tasks.some(t => !t.sortKey);
        if (!needsMigration) {
            console.log('[FileOperationsService] All tasks have sortKey, no migration needed');
            return tasks;
        }
        
        console.log('[FileOperationsService] Migrating tasks to sortKey...', {
            total: tasks.length,
            withSortKey: tasks.filter(t => t.sortKey).length,
            withDisplayOrder: tasks.filter(t => (t as any).displayOrder !== undefined).length
        });
        
        // Step 1: Create a tracking structure that preserves all ordering info
        interface TaskWithMeta {
            task: Task;
            originalIndex: number;
            displayOrder: number;
            hasSortKey: boolean;
        }
        
        const tasksWithMeta: TaskWithMeta[] = tasks.map((task, index) => ({
            task,
            originalIndex: index,
            displayOrder: (task as any).displayOrder ?? Number.MAX_SAFE_INTEGER,
            hasSortKey: !!task.sortKey
        }));
        
        // Step 2: Group by parentId
        const tasksByParent = new Map<string | null, TaskWithMeta[]>();
        
        tasksWithMeta.forEach(item => {
            const parentId = item.task.parentId ?? null;
            if (!tasksByParent.has(parentId)) {
                tasksByParent.set(parentId, []);
            }
            tasksByParent.get(parentId)!.push(item);
        });
        
        // Step 3: Sort each group by intended display order
        // Priority: existing sortKey > displayOrder > original array index
        tasksByParent.forEach((group) => {
            group.sort((a, b) => {
                // If both have sortKey, use string comparison
                if (a.hasSortKey && b.hasSortKey) {
                    const keyA = a.task.sortKey || '';
                    const keyB = b.task.sortKey || '';
                    if (keyA < keyB) return -1;
                    if (keyA > keyB) return 1;
                    return 0;
                }
                
                // If only one has sortKey, it comes first (preserve existing order)
                if (a.hasSortKey && !b.hasSortKey) return -1;
                if (!a.hasSortKey && b.hasSortKey) return 1;
                
                // Neither has sortKey - use displayOrder if available
                if (a.displayOrder !== b.displayOrder) {
                    return a.displayOrder - b.displayOrder;
                }
                
                // Fallback: original array position
                return a.originalIndex - b.originalIndex;
            });
        });
        
        // Step 4: Assign sortKeys to each group
        // Tasks that already have sortKey keep them (unless they conflict)
        tasksByParent.forEach((group, parentId) => {
            // Check if we need to regenerate all sortKeys for this group
            // (necessary if some have sortKey and some don't, to ensure consistency)
            const hasMissingSortKeys = group.some(item => !item.hasSortKey);
            
            if (hasMissingSortKeys) {
                // Generate fresh sortKeys for entire group to ensure consistency
                const sortKeys = OrderingService.generateBulkKeys(null, null, group.length);
                
                group.forEach((item, index) => {
                    item.task = {
                        ...item.task,
                        sortKey: sortKeys[index]
                    };
                    item.hasSortKey = true;
                });
                
                console.log(`[FileOperationsService] Assigned sortKeys to ${group.length} tasks with parentId: ${parentId}`);
            }
            // If all have sortKey, keep them as-is (they're already sorted correctly)
        });
        
        // Step 5: Reconstruct result array maintaining original positions
        // This ensures the array structure matches what was saved
        const result: Task[] = new Array(tasks.length);
        
        tasksByParent.forEach((group) => {
            group.forEach((item) => {
                result[item.originalIndex] = item.task;
            });
        });
        
        // Verify no undefined slots (defensive)
        const undefinedCount = result.filter(t => t === undefined).length;
        if (undefinedCount > 0) {
            console.error('[FileOperationsService] Migration error: undefined slots in result', {
                undefinedCount,
                totalTasks: tasks.length
            });
            // Fallback: return original with simple sequential sortKeys
            return tasks.map((task, index) => ({
                ...task,
                sortKey: task.sortKey || OrderingService.generateBulkKeys(null, null, tasks.length)[index]
            }));
        }
        
        console.log('[FileOperationsService] ✅ Migration complete', {
            totalMigrated: result.length,
            sampleSortKeys: result.slice(0, 5).map(t => ({ id: t.id, sortKey: t.sortKey }))
        });
        
        return result;
    }

    // =========================================================================
    // SAMPLE DATA
    // =========================================================================

    /**
     * Create sample data for new/empty projects
     * 
     * P2a Enhancement: Moved from SchedulerService._createSampleData()
     * to consolidate all data creation logic in FileOperationsService.
     */
    createSampleData(): void {
        const today = DateUtils.today();
        const calendar = this.deps.projectController.getCalendar();
        
        const tasks: Task[] = [
            {
                id: 'sample_1',
                name: 'Project Setup',
                start: today,
                end: DateUtils.addWorkDays(today, 2, calendar),
                duration: 3,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                notes: 'Initial project setup and planning',
                level: 0,
                sortKey: OrderingService.generateAppendKey(null),
                _collapsed: false,
            },
            {
                id: 'sample_2',
                name: 'Design Phase',
                start: DateUtils.addWorkDays(today, 3, calendar),
                end: DateUtils.addWorkDays(today, 7, calendar),
                duration: 5,
                parentId: null,
                dependencies: [{ id: 'sample_1', type: 'FS', lag: 0 }],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                level: 0,
                sortKey: OrderingService.generateAppendKey(OrderingService.generateAppendKey(null)),
                _collapsed: false,
            },
        ];
        
        // NOTE: disableNotifications removed - ProjectController handles via reactive streams
        this.deps.projectController.syncTasks(tasks);
        
        // Recalculate after a brief delay to ensure everything is set up
        setTimeout(() => {
            try {
                this.deps.recalculateAll();
            } catch (error) {
                console.error('[FileOperationsService] Error recalculating sample data:', error);
            }
        }, 100);
    }
}
