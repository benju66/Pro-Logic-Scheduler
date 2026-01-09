/**
 * @fileoverview ColumnPreferencesService - Column management, header rendering, CSS variables
 * @module services/scheduler/ColumnPreferencesService
 * 
 * Phase 9 of SchedulerService decomposition.
 * Extracts column management operations from SchedulerService into a focused,
 * single-responsibility service.
 * 
 * ⚠️ ARCHITECTURAL NOTE: Encapsulated Legacy
 * 
 * This service contains **direct DOM manipulation** (`buildGridHeader`) which is an
 * imperative pattern. In a modern application, header rendering should be part of
 * `GridRenderer` or a reactive component.
 * 
 * **Strategy:** Extract as planned (cleans up SchedulerService), but mark this service
 * internally as "Encapsulated Legacy". This isolates the imperative code so that when
 * the Grid Rendering engine is rewritten (e.g., to React/Solid), this one service can
 * be replaced without touching the rest of the application.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { ColumnPreferences, GridColumn } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ToastService } from '../../ui/services/ToastService';
import type { GridAccessor } from './types';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by ColumnPreferencesService
 */
export interface ColumnPreferencesServiceDeps {
    /** ProjectController for task data access */
    projectController: ProjectController;
    /** SelectionModel for selection state */
    selectionModel: SelectionModel;
    /** ColumnRegistry for column definitions */
    columnRegistry: ColumnRegistry;
    /** ToastService for user notifications */
    toastService: ToastService;
    /** Get the grid component accessor */
    getGrid: () => GridAccessor | null;
    /** Render callback for UI updates */
    render: () => void;
    /** Update selection state callback */
    updateSelection: () => void;
}

/** Local storage key for column preferences */
const STORAGE_KEY_PREFERENCES = 'pro_scheduler_column_preferences';
/** Local storage key for column widths */
const STORAGE_KEY_WIDTHS = 'pro_scheduler_column_widths';

// =========================================================================
// COLUMN PREFERENCES SERVICE
// =========================================================================

/**
 * ColumnPreferencesService - Handles column management, header rendering, CSS variables
 * 
 * This service handles:
 * - Getting column definitions from registry
 * - Loading/saving column preferences from localStorage
 * - Building the grid header dynamically
 * - Managing CSS variables for column widths
 * - Header scroll synchronization
 * - Select-all checkbox state
 * 
 * @example
 * ```typescript
 * const columnPrefsService = new ColumnPreferencesService({
 *     projectController,
 *     selectionModel,
 *     columnRegistry,
 *     toastService,
 *     getGrid: () => scheduler.grid,
 *     render: () => scheduler.render(),
 *     updateSelection: () => scheduler._updateSelection()
 * });
 * 
 * // Build header
 * columnPrefsService.buildGridHeader();
 * 
 * // Update preferences
 * columnPrefsService.updatePreferences(newPrefs);
 * ```
 */
export class ColumnPreferencesService {
    private deps: ColumnPreferencesServiceDeps;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: ColumnPreferencesServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // COLUMN DEFINITIONS
    // =========================================================================

    /**
     * Get column definitions with preferences applied
     * @returns Array of grid columns
     */
    getColumnDefinitions(): GridColumn[] {
        const prefs = this.getPreferences();
        return this.deps.columnRegistry.getGridColumns(prefs);
    }

    // =========================================================================
    // PREFERENCES MANAGEMENT
    // =========================================================================

    /**
     * Get column preferences from localStorage
     * @returns Column preferences
     */
    getPreferences(): ColumnPreferences {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_PREFERENCES);
            if (saved) {
                const parsed = JSON.parse(saved) as ColumnPreferences;
                // Validate structure
                if (parsed.visible && parsed.order && Array.isArray(parsed.order) && 
                    parsed.pinned && Array.isArray(parsed.pinned)) {
                    return parsed;
                }
            }
        } catch (err) {
            console.warn('[ColumnPreferencesService] Failed to load column preferences:', err);
        }
        
        // Return defaults
        return this.getDefaultPreferences();
    }

    /**
     * Get default column preferences from registry
     * @returns Default column preferences
     */
    getDefaultPreferences(): ColumnPreferences {
        return this.deps.columnRegistry.getDefaultPreferences();
    }

    /**
     * Save column preferences to localStorage
     * @param prefs - Column preferences to save
     */
    savePreferences(prefs: ColumnPreferences): void {
        try {
            localStorage.setItem(STORAGE_KEY_PREFERENCES, JSON.stringify(prefs));
        } catch (err) {
            console.warn('[ColumnPreferencesService] Failed to save column preferences:', err);
        }
    }

    /**
     * Update column preferences and rebuild grid
     * @param preferences - New column preferences
     */
    updatePreferences(preferences: ColumnPreferences): void {
        // Validate: at least one column must be visible
        const visibleCount = Object.values(preferences.visible).filter(v => v).length;
        if (visibleCount === 0) {
            this.deps.toastService?.show('At least one column must be visible', 'error');
            return;
        }
        
        // Validate: order must contain all visible columns
        const visibleIds = Object.keys(preferences.visible).filter(id => preferences.visible[id]);
        const orderSet = new Set(preferences.order);
        const missingInOrder = visibleIds.filter(id => !orderSet.has(id));
        if (missingInOrder.length > 0) {
            // Add missing columns to end of order
            preferences.order.push(...missingInOrder);
        }
        
        // Save preferences
        this.savePreferences(preferences);
        
        // Rebuild grid with new preferences
        this.rebuildGridColumns();
        
        // Re-initialize column resizers (columns may have changed)
        setTimeout(() => {
            const uiEventManager = (window as any).uiEventManager;
            if (uiEventManager?.initColumnResizers) {
                uiEventManager.initColumnResizers();
            }
        }, 100);
        
        this.deps.toastService?.show('Column preferences saved', 'success');
    }

    // =========================================================================
    // HEADER MANAGEMENT
    // =========================================================================

    /**
     * Build the grid header dynamically from column definitions
     * 
     * ⚠️ LEGACY DOM MANIPULATION - Future: Move to GridRenderer or reactive component
     */
    buildGridHeader(): void {
        const headerContent = document.getElementById('grid-header-content');
        if (!headerContent) {
            console.warn('[ColumnPreferencesService] Grid header content container not found');
            return;
        }

        const columns = this.getColumnDefinitions();
        
        // Clear existing header
        headerContent.innerHTML = '';

        // Build header cells from column definitions
        columns.forEach(col => {
            // Check if column should be visible
            const isVisible = col.visible === undefined 
                ? true 
                : typeof col.visible === 'function' 
                    ? col.visible() 
                    : col.visible;

            if (!isVisible) return;

            const headerCell = document.createElement('div');
            headerCell.className = 'grid-header-cell';
            headerCell.setAttribute('data-field', col.field);
            
            // Set width using CSS variable
            headerCell.style.width = `var(--w-${col.field}, ${col.width}px)`;
            
            // Set alignment
            if (col.align === 'center' || col.align === 'right') {
                headerCell.style.justifyContent = col.align === 'center' ? 'center' : 'flex-end';
            } else {
                headerCell.style.justifyContent = 'flex-start';
            }

            // Add header class if specified
            if (col.headerClass) {
                headerCell.classList.add(...col.headerClass.split(' '));
            }

            // Build header content based on column type
            if (col.type === 'drag') {
                headerCell.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                        <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                        <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                    </svg>
                `;
            } else if (col.type === 'checkbox') {
                // Create functional checkbox for select/deselect all
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'header-checkbox-select-all';
                checkbox.title = 'Select/Deselect all visible tasks';
                checkbox.style.cssText = `
                    width: 14px;
                    height: 14px;
                    cursor: pointer;
                    accent-color: #6366f1;
                    outline: none;
                    border: none;
                `;
                
                // Update checkbox state based on current selection
                this.updateHeaderCheckboxState(checkbox);
                
                // Handle click to select/deselect all visible tasks
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleSelectAllClick(checkbox);
                });
                
                headerCell.appendChild(checkbox);
            } else {
                // Text columns: wrap in span for truncation
                const textSpan = document.createElement('span');
                textSpan.className = 'grid-header-cell-text';
                textSpan.textContent = col.label;
                headerCell.appendChild(textSpan);
                
                // Check truncation after render and add tooltip if needed
                requestAnimationFrame(() => {
                    if (textSpan.scrollWidth > textSpan.clientWidth) {
                        headerCell.setAttribute('title', col.label);
                    }
                });
            }

            // Add resizer if column is resizable
            const isResizable = col.resizable !== undefined ? col.resizable : (col.type !== 'drag' && col.type !== 'checkbox');
            if (isResizable) {
                const resizer = document.createElement('div');
                resizer.className = 'col-resizer';
                resizer.setAttribute('data-field', col.field);
                headerCell.appendChild(resizer);
            }

            // Apply sticky positioning for pinned columns
            if (col.headerClass?.includes('pinned')) {
                const pinnedIndex = columns.slice(0, columns.indexOf(col))
                    .filter(c => c.headerClass?.includes('pinned')).length;
                const leftOffset = this.calculateStickyLeft(pinnedIndex, columns);
                headerCell.style.left = leftOffset;
            }

            headerContent.appendChild(headerCell);
        });

        console.log('[ColumnPreferencesService] ✅ Grid header built with', columns.length, 'columns');
        
        // Set up bidirectional scroll sync: header → grid
        this.initHeaderScrollSync();
    }

    /**
     * Initialize CSS variables for column widths from column definitions
     * 
     * ⚠️ LEGACY DOM MANIPULATION - Future: Move to GridRenderer or reactive component
     */
    initializeColumnCSSVariables(): void {
        const gridPane = document.getElementById('grid-pane');
        if (!gridPane) {
            console.warn('[ColumnPreferencesService] Grid pane not found for CSS variable initialization');
            return;
        }

        const columns = this.getColumnDefinitions();
        
        // Load saved widths from localStorage first
        try {
            const saved = localStorage.getItem(STORAGE_KEY_WIDTHS);
            if (saved) {
                const savedWidths = JSON.parse(saved) as Record<string, number>;
                columns.forEach(col => {
                    if (savedWidths[col.field]) {
                        gridPane.style.setProperty(`--w-${col.field}`, `${savedWidths[col.field]}px`);
                        return;
                    }
                });
            }
        } catch (err) {
            console.warn('[ColumnPreferencesService] Failed to load saved column widths:', err);
        }

        // Set default widths for columns that don't have saved values
        columns.forEach(col => {
            const varName = `--w-${col.field}`;
            const currentValue = gridPane.style.getPropertyValue(varName);
            if (!currentValue) {
                gridPane.style.setProperty(varName, `${col.width}px`);
            }
        });
    }

    /**
     * Initialize header scroll sync (header → grid)
     * 
     * ⚠️ LEGACY DOM MANIPULATION - Future: Move to GridRenderer or reactive component
     */
    initHeaderScrollSync(): void {
        const header = document.getElementById('grid-header');
        const gridContainer = document.getElementById('grid-container');
        if (!header || !gridContainer) return;
        
        // Sync header horizontal scroll with grid-container horizontal scroll
        let isSyncing = false;
        
        gridContainer.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            header.scrollLeft = gridContainer.scrollLeft;
            isSyncing = false;
        }, { passive: true });
        
        header.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            gridContainer.scrollLeft = header.scrollLeft;
            isSyncing = false;
        }, { passive: true });
    }

    /**
     * Rebuild grid columns when preferences change
     * Updates header and grid to show/hide columns
     */
    rebuildGridColumns(): void {
        // Rebuild header with updated column definitions
        this.buildGridHeader();
        
        // Update grid columns if grid exists
        const grid = this.deps.getGrid();
        if (grid && grid.updateColumns) {
            const columns = this.getColumnDefinitions();
            grid.updateColumns(columns);
        }
        
        // Re-render to show new columns
        this.deps.render();
        
        // Re-initialize column resizers
        setTimeout(() => {
            if ((window as any).uiEventManager) {
                (window as any).uiEventManager.initColumnResizers();
            }
        }, 100);
    }

    // =========================================================================
    // SELECTION CHECKBOX
    // =========================================================================

    /**
     * Update header checkbox state (checked/unchecked/indeterminate)
     * @param checkbox - Optional checkbox element (if not provided, finds it)
     */
    updateHeaderCheckboxState(checkbox?: HTMLInputElement): void {
        if (!checkbox) {
            const headerCheckbox = document.querySelector('.header-checkbox-select-all') as HTMLInputElement | null;
            if (!headerCheckbox) return;
            checkbox = headerCheckbox;
        }

        // Get visible tasks (respecting collapse state)
        const visibleTasks = this.deps.projectController.getVisibleTasks((id) => {
            const task = this.deps.projectController.getTaskById(id);
            return task?._collapsed || false;
        });

        if (visibleTasks.length === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            return;
        }

        // Count how many visible tasks are selected
        const selectedCount = visibleTasks.filter(t => this.deps.selectionModel.isSelected(t.id)).length;

        if (selectedCount === 0) {
            // None selected
            checkbox.checked = false;
            checkbox.indeterminate = false;
        } else if (selectedCount === visibleTasks.length) {
            // All selected
            checkbox.checked = true;
            checkbox.indeterminate = false;
        } else {
            // Some selected (indeterminate state)
            checkbox.checked = false;
            checkbox.indeterminate = true;
        }
    }

    /**
     * Handle select all checkbox click
     * @param checkbox - The header checkbox element
     */
    handleSelectAllClick(checkbox: HTMLInputElement): void {
        // Get visible tasks (respecting collapse state)
        const visibleTasks = this.deps.projectController.getVisibleTasks((id) => {
            const task = this.deps.projectController.getTaskById(id);
            return task?._collapsed || false;
        });

        if (checkbox.checked) {
            // Select all visible tasks
            visibleTasks.forEach(task => {
                this.deps.selectionModel.addToSelection([task.id]);
            });
        } else {
            // Deselect all visible tasks
            visibleTasks.forEach(task => {
                this.deps.selectionModel.removeFromSelection([task.id]);
            });
        }

        // Update selection state
        this.deps.updateSelection();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Calculate left offset for sticky column
     * @param pinnedIndex - Index of the pinned column
     * @param columns - All column definitions
     * @returns CSS calc() expression for left offset
     */
    calculateStickyLeft(pinnedIndex: number, columns: GridColumn[]): string {
        const prefs = this.getPreferences();
        const pinnedColumns = columns.filter(c => prefs.pinned.includes(c.id)).slice(0, pinnedIndex);
        
        if (pinnedColumns.length === 0) return '0px';
        
        // Build calc() expression using CSS variables
        const widths = pinnedColumns.map(col => `var(--w-${col.field}, ${col.width || 100}px)`);
        return `calc(${widths.join(' + ')})`;
    }
}
