/**
 * @fileoverview ModalCoordinator - Manages modal dialogs and panels
 * @module services/scheduler/ModalCoordinator
 * 
 * Phase 5 of SchedulerService decomposition.
 * Extracts modal and drawer management from SchedulerService
 * into a focused, single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { Calendar, Dependency, ColumnPreferences } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import { DependenciesModal } from '../../ui/components/DependenciesModal';
import { CalendarModal } from '../../ui/components/CalendarModal';
import { ColumnSettingsModal } from '../../ui/components/ColumnSettingsModal';
import { SideDrawer } from '../../ui/components/SideDrawer';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by ModalCoordinator
 */
export interface ModalCoordinatorDeps {
    /** ProjectController for task data access */
    projectController: ProjectController;
    /** SelectionModel for selection state */
    selectionModel: SelectionModel;
    /** ColumnRegistry for column definitions */
    columnRegistry: ColumnRegistry;
    /** Callbacks for opening panels in RightSidebarManager */
    getOpenPanelCallbacks: () => Array<(panelId: string) => void>;
    /** Handler for dependencies save */
    onDependenciesSave: (taskId: string, deps: Dependency[]) => void;
    /** Handler for calendar save */
    onCalendarSave: (calendar: Calendar) => void;
    /** Handler for column preferences save */
    onColumnPreferencesSave: (prefs: ColumnPreferences) => void;
    /** Get current column preferences */
    getColumnPreferences: () => ColumnPreferences;
    /** Update selection UI */
    updateSelection: () => void;
}

// =========================================================================
// MODAL COORDINATOR
// =========================================================================

/**
 * ModalCoordinator - Manages modal dialogs and panels
 * 
 * This service handles:
 * - Opening/closing the drawer panel
 * - Opening the dependencies modal/panel
 * - Opening the calendar modal
 * - Opening the column settings modal
 * - Opening the properties panel
 * 
 * @example
 * ```typescript
 * const modalCoordinator = new ModalCoordinator({
 *     projectController,
 *     selectionModel,
 *     columnRegistry,
 *     getOpenPanelCallbacks: () => openPanelCallbacks,
 *     onDependenciesSave: (taskId, deps) => handleDepsSave(taskId, deps),
 *     onCalendarSave: (calendar) => handleCalendarSave(calendar),
 *     onColumnPreferencesSave: (prefs) => handlePrefsSave(prefs),
 *     getColumnPreferences: () => getPrefs(),
 *     updateSelection: () => updateSelection()
 * });
 * 
 * // Open a modal
 * modalCoordinator.openDependencies(taskId);
 * ```
 */
export class ModalCoordinator {
    private deps: ModalCoordinatorDeps;
    
    /** Side drawer instance */
    private drawer: SideDrawer | null = null;
    
    /** Dependencies modal instance */
    private dependenciesModal: DependenciesModal | null = null;
    
    /** Calendar modal instance */
    private calendarModal: CalendarModal | null = null;
    
    /** Column settings modal instance */
    private columnSettingsModal: ColumnSettingsModal | null = null;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: ModalCoordinatorDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize modal instances
     * @param container - Container element for modals
     */
    initialize(container: HTMLElement): void {
        // Create dependencies modal
        this.dependenciesModal = new DependenciesModal({
            container,
            getTasks: () => this.deps.projectController.getTasks(),
            isParent: (id) => this.deps.projectController.isParent(id),
            onSave: (taskId, deps) => this.deps.onDependenciesSave(taskId, deps),
        });

        // Create calendar modal
        this.calendarModal = new CalendarModal({
            container,
            onSave: (calendar) => this.deps.onCalendarSave(calendar),
        });

        // Create column settings modal
        this.columnSettingsModal = new ColumnSettingsModal({
            container,
            onSave: (preferences) => this.deps.onColumnPreferencesSave(preferences),
            getColumns: () => this.deps.columnRegistry.getGridColumns(),
            getPreferences: () => this.deps.getColumnPreferences(),
        });
    }

    // =========================================================================
    // DRAWER OPERATIONS
    // =========================================================================

    /**
     * Open the drawer/details panel for a task
     * Uses callback system to work with RightSidebarManager
     * 
     * @param taskId - Task ID to show details for
     */
    openDrawer(taskId: string): void {
        const callbacks = this.deps.getOpenPanelCallbacks();
        
        // 1. Ensure selection is synced first
        if (this.deps.selectionModel.getFocusedId() !== taskId) {
            this.deps.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
            this.deps.updateSelection();
        }
        
        // 2. Request the UI to open the 'details' panel
        callbacks.forEach(cb => {
            try {
                cb('details');
            } catch (e) {
                console.error('[ModalCoordinator] Panel open callback error:', e);
            }
        });
    }

    /**
     * Close the drawer
     */
    closeDrawer(): void {
        if (this.drawer) {
            this.drawer.close();
        }
    }

    /**
     * Check if drawer is open
     * @returns True if drawer is open
     */
    isDrawerOpen(): boolean {
        return this.drawer?.isDrawerOpen() ?? false;
    }

    // =========================================================================
    // PROPERTIES PANEL
    // =========================================================================

    /**
     * Open properties panel for a task
     * @param taskId - Task ID to show properties for
     */
    openProperties(taskId: string): void {
        const callbacks = this.deps.getOpenPanelCallbacks();
        
        // Trigger right sidebar with details panel
        callbacks.forEach(cb => {
            try {
                cb('details');
            } catch (e) {
                console.error('[ModalCoordinator] Panel open callback error:', e);
            }
        });
        
        // Ensure task is selected
        this.deps.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
        this.deps.updateSelection();
    }

    // =========================================================================
    // DEPENDENCIES MODAL/PANEL
    // =========================================================================

    /**
     * Open dependencies modal or panel
     * @param taskId - Task ID
     */
    openDependencies(taskId: string): void {
        const task = this.deps.projectController.getTaskById(taskId);
        if (!task) return;
        
        const callbacks = this.deps.getOpenPanelCallbacks();
        
        // Try to open via panel system first (if RightSidebarManager is available)
        if (callbacks.length > 0) {
            callbacks.forEach(cb => {
                try {
                    cb('links');
                } catch (e) {
                    console.error('[ModalCoordinator] Panel open callback error:', e);
                }
            });
            
            // Ensure the task is selected
            if (this.deps.selectionModel.getFocusedId() !== taskId) {
                this.deps.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
                this.deps.updateSelection();
            }
            return;
        }
        
        // Fallback to modal mode if no panel system available
        if (this.dependenciesModal) {
            this.dependenciesModal.open(task);
        }
    }

    // =========================================================================
    // CALENDAR MODAL
    // =========================================================================

    /**
     * Open calendar modal
     */
    openCalendar(): void {
        if (!this.calendarModal) return;
        this.calendarModal.open(this.deps.projectController.getCalendar());
    }

    // =========================================================================
    // COLUMN SETTINGS MODAL
    // =========================================================================

    /**
     * Open column settings modal
     */
    openColumnSettings(): void {
        if (!this.columnSettingsModal) return;
        this.columnSettingsModal.open();
    }

    // =========================================================================
    // ACCESSORS
    // =========================================================================

    /**
     * Get the dependencies modal instance
     * @returns DependenciesModal or null
     */
    getDependenciesModal(): DependenciesModal | null {
        return this.dependenciesModal;
    }

    /**
     * Get the calendar modal instance
     * @returns CalendarModal or null
     */
    getCalendarModal(): CalendarModal | null {
        return this.calendarModal;
    }

    /**
     * Get the column settings modal instance
     * @returns ColumnSettingsModal or null
     */
    getColumnSettingsModal(): ColumnSettingsModal | null {
        return this.columnSettingsModal;
    }

    // =========================================================================
    // DISPOSAL
    // =========================================================================

    /**
     * Dispose of all modal instances
     */
    dispose(): void {
        // Note: These modals may not have destroy methods
        // Clean up references
        this.dependenciesModal = null;
        this.calendarModal = null;
        this.columnSettingsModal = null;
        this.drawer = null;
    }
}
