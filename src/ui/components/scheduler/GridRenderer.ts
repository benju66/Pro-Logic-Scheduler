/**
 * @fileoverview Grid Renderer for Unified Scheduler V2
 * @module ui/components/scheduler/GridRenderer
 * 
 * Renders DOM rows efficiently using pooling.
 * Handles user interactions via event delegation.
 * NO vertical scroll handling (handled by SchedulerViewport).
 * Owns horizontal scroll for columns.
 */

import type { Task, GridColumn, Calendar } from '../../../types';
import type { ViewportState, GridRendererOptions, BindingContext } from './types';
import { PoolSystem } from './pool/PoolSystem';
import { BindingSystem } from './pool/BindingSystem';
import flatpickr from 'flatpickr';
import type { Instance } from 'flatpickr/dist/types/instance';
import { createSharedPickerOptions, destroyDatePicker, parseFlexibleDate, formatDateISO, formatDateForDisplay } from './datepicker/DatePickerConfig';
import { getEditingStateManager } from '../../../services/EditingStateManager';
import { getTaskFieldValue } from '../../../types';

/**
 * Reserved ID for the phantom row (virtual, not in TaskStore)
 * Used to prevent undefined errors when renderer tries to look up this row
 */
export const PHANTOM_ROW_ID = '__PHANTOM_ROW__';

/**
 * Editing cell state
 */
interface EditingCell {
    taskId: string;
    field: string;
}

/**
 * Grid Renderer - DOM-based row renderer
 */
export class GridRenderer {
    private pool: PoolSystem;
    private binder: BindingSystem;
    private container: HTMLElement;
    private rowContainer!: HTMLElement;
    private options: Required<GridRendererOptions>;
    private rowHeight: number;
    private data: Task[] = [];
    private selectedIds: Set<string> = new Set();
    private editingCell: EditingCell | null = null;
    private editingRows: Set<string> = new Set();
    private isScrolling: boolean = false;
    
    // Shared date picker popup
    private sharedDatePicker: Instance | null = null;
    private activeDatePickerContext: { taskId: string; field: string } | null = null;
    private calendar: Calendar | null = null;
    
    // Flag to prevent double-save on Tab/Enter + blur
    private _dateSaveInProgress: Set<string> = new Set(); // key: "taskId:field"
    
    // Drag UX state
    private _lastDropPosition: 'before' | 'after' | 'child' | null = null;
    private _lastDropTargetId: string | null = null;
    private _lastDragOverTime: number = 0;
    private readonly _dragThrottleMs: number = 32;
    private readonly _hysteresisPixels: number = 6;
    
    // Container keyboard handler for navigation mode
    private _boundContainerKeyDown: ((e: KeyboardEvent) => void) | null = null;
    
    // CRITICAL: Separate from editingCell which gets cleared on blur
    // This tracks the last focused/highlighted cell for navigation mode
    private _focusedCell: { taskId: string; field: string } | null = null;

    constructor(options: GridRendererOptions) {
        this.container = options.container;
        this.rowHeight = options.rowHeight;

        // Merge with defaults
        this.options = {
            container: options.container,
            rowHeight: options.rowHeight,
            bufferRows: options.bufferRows,
            columns: options.columns,
            onCellChange: options.onCellChange ?? (() => {}),
            onRowClick: options.onRowClick ?? (() => {}),
            onRowDoubleClick: options.onRowDoubleClick ?? (() => {}),
            onAction: options.onAction ?? (() => {}),
            onRowMenu: options.onRowMenu,
            onToggleCollapse: options.onToggleCollapse ?? (() => {}),
            onSelectionChange: options.onSelectionChange ?? (() => {}),
            onRowMove: options.onRowMove ?? (() => {}),
            onEnterLastRow: options.onEnterLastRow,
            onTradePartnerClick: options.onTradePartnerClick,
            isParent: options.isParent ?? (() => false),
            getDepth: options.getDepth ?? (() => 0),
        } as Required<GridRendererOptions>;

        // Build DOM
        this._buildDOM();

        // Calculate pool size
        const viewportHeight = this.container.clientHeight || 800;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);
        const poolSize = visibleRows + (options.bufferRows * 2) + 5;

        // Initialize subsystems
        this.pool = new PoolSystem({
            container: this.rowContainer,
            columns: options.columns,
            poolSize,
            rowHeight: this.rowHeight,
            maxActionButtons: 4,
        });

        this.binder = new BindingSystem(options.columns);
        
        // Wire up date change callback
        this.binder.setOnDateChange((taskId, field, value) => {
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, value);
            }
        });

        // Set up shared date picker callback
        this.binder.setOnOpenDatePicker((taskId, field, anchorEl, currentValue) => {
            this._openSharedDatePicker(taskId, field, anchorEl, currentValue);
        });

        // Event delegation
        this._bindEventListeners();
    }

    /**
     * Build DOM structure
     * Preserves existing container structure - only adds row container
     */
    private _buildDOM(): void {
        // Preserve existing container - don't clear it
        // The container should already have proper styling from HTML/CSS
        
        // Ensure container has proper overflow
        // Vertical scroll is handled by SchedulerViewport, but we need overflow-y: auto for it to work
        // Horizontal scroll is independent
        this.container.style.cssText = `
            overflow-x: auto;
            overflow-y: auto;
            height: 100%;
            position: relative;
        `;
        
        // Make container focusable so keyboard events can be captured after exiting edit mode
        this.container.setAttribute('tabindex', '-1');

        // Create row container for virtual scrolling
        this.rowContainer = document.createElement('div');
        this.rowContainer.className = 'vsg-row-container';
        this.rowContainer.style.cssText = `
            position: relative;
            top: 0;
            left: 0;
            right: 0;
            will-change: transform;
        `;

        this.container.appendChild(this.rowContainer);

        // Listen to horizontal scroll for header sync
        this.container.addEventListener('scroll', () => {
            // Horizontal scroll is independent - header sync handled by SchedulerService
            
            // v3.0: Close any open context menus when scrolling to prevent detachment
            const openMenu = document.querySelector('.context-menu');
            if (openMenu) {
                openMenu.remove();
                // Also remove backdrop
                const backdrop = document.querySelector('.context-menu-backdrop');
                if (backdrop) backdrop.remove();
            }
        }, { passive: true });
    }

    /**
     * Render visible rows based on viewport state
     * Called every frame during scroll by SchedulerViewport
     */
    render(state: ViewportState): void {
        const { visibleRange } = state;
        const { start, end } = visibleRange;

        // Set container height to hold all rows (enables proper scrolling)
        this.rowContainer.style.height = `${this.data.length * this.rowHeight}px`;

        // REMOVE the translateY - rows will self-position
        this.rowContainer.style.transform = 'none';

        // Release rows outside visible range
        this.pool.releaseRowsOutsideRange(start, end);

        // Bind and position rows in visible range
        for (let i = start; i <= end && i < this.data.length; i++) {
            const task = this.data[i];
            if (!task) continue;

            try {
                const row = this.pool.acquireRow(i);

                // Position ABSOLUTE from top of container (not relative to visible range)
                row.element.style.position = 'absolute';
                row.element.style.top = `${i * this.rowHeight}px`;
                row.element.style.left = '0';
                row.element.style.right = '0';

                const context: BindingContext = {
                    task,
                    index: i,
                    isSelected: this.selectedIds.has(task.id),
                    isParent: this.options.isParent(task.id),
                    isCollapsed: task._collapsed ?? false,
                    isCritical: task._isCritical ?? false,
                    depth: this.options.getDepth(task.id),
                };

                this.binder.bindRow(row, context);
            } catch (e) {
                console.error(`[GridRenderer] Error binding row ${i}:`, e);
            }
        }
        
        // LAST: Render phantom row AFTER all pool operations
        // This ensures it's not occluded by recycled pooled elements
        this._renderPhantomRow(state);
    }

    /**
     * Set task data
     */
    setData(tasks: Task[]): void {
        this.data = tasks;
    }

    /**
     * Get task data
     */
    getData(): Task[] {
        return this.data;
    }

    /**
     * Set selection state
     */
    setSelection(taskIds: string[]): void {
        this.selectedIds = new Set(taskIds);
    }

    /**
     * Get selection
     */
    getSelection(): string[] {
        return [...this.selectedIds];
    }

    /**
     * Clear selection
     */
    clearSelection(): void {
        this.selectedIds.clear();
    }

    /**
     * Update a single row
     */
    updateRow(taskId: string): void {
        const index = this.data.findIndex(t => t.id === taskId);
        if (index === -1) return;

        const row = this.pool.acquireRow(index);
        const task = this.data[index];
        if (!task) return;

        // Position row correctly
        row.element.style.position = 'absolute';
        row.element.style.top = `${index * this.rowHeight}px`;
        row.element.style.left = '0';
        row.element.style.right = '0';

        const context: BindingContext = {
            task,
            index,
            isSelected: this.selectedIds.has(task.id),
            isParent: this.options.isParent(task.id),
            isCollapsed: task._collapsed ?? false,
            isCritical: task._isCritical ?? false,
            depth: this.options.getDepth(task.id),
        };

        this.binder.bindRow(row, context);
    }

    /**
     * Update columns
     * Rebuilds pool if column structure changed (columns added/removed)
     */
    updateColumns(columns: GridColumn[]): void {
        const oldColumnIds = new Set(this.options.columns.map(c => c.id));
        const newColumnIds = new Set(columns.map(c => c.id));
        
        // Check if columns structurally changed (added or removed)
        const structureChanged = 
            oldColumnIds.size !== newColumnIds.size ||
            [...newColumnIds].some(id => !oldColumnIds.has(id)) ||
            [...oldColumnIds].some(id => !newColumnIds.has(id));
        
        // Update options
        this.options.columns = columns;
        
        // Update binder's column map
        this.binder.updateColumns(columns);
        
        if (structureChanged) {
            // Rebuild pool with new column structure
            this.pool.rebuildPool(columns);
        }
    }
    
    /**
     * Update the calendar for working day integration
     */
    setCalendar(calendar: Calendar): void {
        this.calendar = calendar;
        this.binder.setCalendar(calendar);
    }

    /**
     * Focus a specific cell (enters edit mode)
     */
    focusCell(taskId: string, field: string): void {
        // ADDED: Track focused cell for navigation mode
        this._focusedCell = { taskId, field };
        
        const editingManager = getEditingStateManager();
        
        const row = this.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
        if (!row) return;

        const cell = row.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
        if (!cell) return;

        const input = cell?.querySelector('.vsg-input, .vsg-select') as HTMLInputElement | HTMLSelectElement | null;
        if (input && !input.disabled) {
            input.focus();
            if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
                (input as HTMLInputElement).select();
            }
            
            // Update local state for scroll preservation
            this.editingCell = { taskId, field };
            this.editingRows.add(taskId);
            
            // Update state manager
            const task = this.data.find(t => t.id === taskId);
            const originalValue = task ? getTaskFieldValue(task, field as GridColumn['field']) : undefined;
            editingManager.enterEditMode({ taskId, field }, 'click', originalValue);
            
            return;
        }
    }

    /**
     * Highlight a cell visually without entering edit mode
     * Used for keyboard navigation - shows which cell will be edited on F2/Enter
     * @param taskId - Task ID
     * @param field - Column field name
     */
    highlightCell(taskId: string, field: string): void {
        // ADDED: Track focused cell for navigation mode
        this._focusedCell = { taskId, field };
        
        // Remove previous highlight
        const prevHighlight = this.rowContainer.querySelector('.vsg-cell-selected');
        if (prevHighlight) {
            prevHighlight.classList.remove('vsg-cell-selected');
        }
        
        // Find the row
        const row = this.rowContainer.querySelector(`.vsg-row[data-task-id="${taskId}"]`) as HTMLElement | null;
        if (!row) return;
        
        // Find the cell by field
        const cell = row.querySelector(`[data-field="${field}"]`)?.closest('.vsg-cell') as HTMLElement;
        if (!cell) {
            // Try finding by input data-field
            const input = row.querySelector(`input[data-field="${field}"], select[data-field="${field}"]`);
            const cellEl = input?.closest('.vsg-cell') as HTMLElement;
            if (cellEl) {
                cellEl.classList.add('vsg-cell-selected');
            }
            return;
        }
        
        cell.classList.add('vsg-cell-selected');
    }

    /**
     * Clear all cell highlights
     */
    clearCellHighlight(): void {
        const highlighted = this.rowContainer.querySelectorAll('.vsg-cell-selected');
        highlighted.forEach(el => el.classList.remove('vsg-cell-selected'));
    }

    /**
     * Focus the grid container element
     * This allows keyboard events to be properly captured after exiting edit mode
     */
    focus(): void {
        // Focus the scrollable container
        // The container has tabindex="-1" to be focusable but not in tab order
        if (this.container) {
            this.container.focus();
        }
    }

    /**
     * Bind event listeners
     */
    private _bindEventListeners(): void {
        // Click events
        this.rowContainer.addEventListener('click', (e) => this._onClick(e));
        
        // Double-click events
        this.rowContainer.addEventListener('dblclick', (e) => this._onDoubleClick(e));
        
        // Change events
        this.rowContainer.addEventListener('change', (e) => this._onChange(e));
        
        // Input event for real-time feedback on date typing
        this.rowContainer.addEventListener('input', (e) => this._onInput(e));
        
        // Blur events
        this.rowContainer.addEventListener('blur', (e) => this._onBlur(e), true);
        
        // Keydown events
        this.rowContainer.addEventListener('keydown', (e) => this._onKeyDown(e));
        
        // Navigation mode keyboard handler (when container is focused, not input)
        this._boundContainerKeyDown = this._onContainerKeyDown.bind(this);
        this.container.addEventListener('keydown', this._boundContainerKeyDown);
        
        // Drag and drop events
        this.rowContainer.addEventListener('dragstart', (e) => this._onDragStart(e));
        this.rowContainer.addEventListener('dragend', (e) => this._onDragEnd(e));
        this.rowContainer.addEventListener('dragover', (e) => this._onDragOver(e));
        this.rowContainer.addEventListener('dragleave', (e) => this._onDragLeave(e));
        this.rowContainer.addEventListener('drop', (e) => this._onDrop(e));
    }

    /**
     * Handle click events
     */
    private _onClick(e: MouseEvent): void {
        // Ignore clicks during scroll
        if (this.isScrolling) {
            e.preventDefault();
            return;
        }

        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const taskId = row.dataset.taskId;
        if (!taskId) return;
        
        // CRITICAL: Handle phantom row click - prevent TaskStore lookup errors
        if (taskId === PHANTOM_ROW_ID) {
            this._activatePhantom();
            return;
        }

        // Check for trade partner chip click FIRST
        const chip = target.closest('.trade-chip') as HTMLElement | null;
        if (chip) {
            const partnerId = chip.getAttribute('data-partner-id');
            if (partnerId && this.options.onTradePartnerClick) {
                e.stopPropagation();
                this.options.onTradePartnerClick(taskId, partnerId, e);
            }
            return;
        }

        // Check for collapse toggle
        const collapseBtn = target.closest('.vsg-collapse-btn') as HTMLElement | null;
        if (collapseBtn) {
            e.stopPropagation();
            if (this.options.onToggleCollapse) {
                this.options.onToggleCollapse(taskId);
            }
            return;
        }

        // =========================================================================
        // v3.0 FIX: EXPLICIT ROW-MENU ACTION HANDLING
        // This was the "missing link" in v2 - the action was detected but fell
        // through to the generic onAction handler instead of onRowMenu
        // =========================================================================
        
        // Check for row menu button clicks FIRST
        const menuBtn = target.closest('.vsg-row-menu-btn') as HTMLElement | null;
        if (menuBtn) {
            e.stopPropagation(); // CRITICAL: Prevent row selection change
            e.preventDefault();
            
            // Logic to find task and isBlank
            const menuTaskId = menuBtn.getAttribute('data-task-id') || taskId;
            const isBlank = menuBtn.getAttribute('data-is-blank') === 'true' || row.classList.contains('blank-row');
            
            if (this.options.onRowMenu) {
                // v3.0: Route to the dedicated menu handler
                this.options.onRowMenu(menuTaskId, isBlank, menuBtn, e);
            }
            return; // CRITICAL: Return early to prevent fall-through
        }
        
        // Also check by data-action attribute (belt and suspenders)
        const actionBtn = target.closest('[data-action]') as HTMLElement | null;
        if (actionBtn && !actionBtn.classList.contains('vsg-collapse-btn')) {
            const action = actionBtn.getAttribute('data-action');
            
            // v3.0 FIX: Explicit row-menu check before generic handler
            if (action === 'row-menu') {
                e.stopPropagation();
                e.preventDefault();
                
                // Logic to find task and isBlank
                const menuTaskId = actionBtn.getAttribute('data-task-id') || taskId;
                const isBlank = actionBtn.getAttribute('data-is-blank') === 'true' || row.classList.contains('blank-row');
                
                if (this.options.onRowMenu) {
                    this.options.onRowMenu(menuTaskId, isBlank, actionBtn, e);
                }
                return; // CRITICAL: Return early
            }
            
            // Generic action handler for other actions (if any remain)
            if (action && this.options.onAction) {
                this.options.onAction(taskId, action, e);
            }
            return;
        }

        // Check for checkbox
        const checkbox = target.closest('.vsg-checkbox') as HTMLInputElement | null;
        if (checkbox) {
            e.stopPropagation();
            if (this.options.onRowClick) {
                const event = {
                    ...e,
                    shiftKey: e.shiftKey,
                    ctrlKey: !e.shiftKey,
                    metaKey: false,
                } as MouseEvent;
                this.options.onRowClick(taskId, event);
            }
            
            // ADDED: Set _focusedCell so Enter navigation works after checkbox selection
            // Default to first editable column (typically 'name')
            const editableColumns = this.options.columns.filter(col => 
                col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select'
            );
            if (editableColumns.length > 0 && taskId) {
                this._focusedCell = { taskId, field: editableColumns[0].field };
                this.highlightCell(taskId, editableColumns[0].field);
            }
            
            return;
        }

        // Helper to check if Properties panel is open
        const isPropertiesPanelOpen = (): boolean => {
            const panelContainer = document.getElementById('right-panel-container');
            if (!panelContainer) return false;
            const detailsPanel = panelContainer.querySelector('.sidebar-panel-wrapper[data-panel="details"]');
            return detailsPanel !== null && detailsPanel.classList.contains('active');
        };

        // If clicking directly on an input, select the task and focus the cell
        if (target.classList.contains('vsg-input') || target.classList.contains('vsg-select')) {
            const field = target.getAttribute('data-field');
            if (field) {
                // First, ensure the task is selected (this will update checkbox and trigger callbacks)
                if (this.options.onRowClick) {
                    const event = {
                        ...e,
                        shiftKey: false,
                        ctrlKey: false,
                        metaKey: false,
                    } as MouseEvent;
                    this.options.onRowClick(taskId, event);
                }
                
                // Only focus grid input if Properties panel is NOT open
                // If panel is open, let it handle the focus instead
                if (!isPropertiesPanelOpen()) {
                    // Then focus the input
                    (target as HTMLInputElement | HTMLSelectElement).focus();
                    if ((target as HTMLInputElement).type === 'text' || (target as HTMLInputElement).type === 'number') {
                        (target as HTMLInputElement).select();
                    }
                    
                    // Update local state for scroll preservation
                    this.editingCell = { taskId, field };
                    this.editingRows.add(taskId);
                    
                    // Update EditingStateManager
                    const editingManager = getEditingStateManager();
                    const task = this.data.find(t => t.id === taskId);
                    const originalValue = task ? getTaskFieldValue(task, field as GridColumn['field']) : undefined;
                    editingManager.enterEditMode({ taskId, field }, 'click', originalValue);
                }
            }
            return;
        }

        // If clicking on a cell (but not the input), select the task and focus the input
        const cell = target.closest('[data-field]') as HTMLElement | null;
        if (cell) {
            const field = cell.getAttribute('data-field');
            const input = cell.querySelector('.vsg-input, .vsg-select') as HTMLInputElement | HTMLSelectElement | null;
            if (input && !input.disabled && field) {
                // First, ensure the task is selected (this will update checkbox and trigger callbacks)
                if (this.options.onRowClick) {
                    const event = {
                        ...e,
                        shiftKey: false,
                        ctrlKey: false,
                        metaKey: false,
                    } as MouseEvent;
                    this.options.onRowClick(taskId, event);
                }
                
                // Only focus grid input if Properties panel is NOT open
                // If panel is open, let it handle the focus instead
                if (!isPropertiesPanelOpen()) {
                    // Then focus the input
                    input.focus();
                    if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
                        (input as HTMLInputElement).select();
                    }
                    
                    // Update local state for scroll preservation
                    this.editingCell = { taskId, field };
                    this.editingRows.add(taskId);
                    
                    // Update EditingStateManager
                    const editingManager = getEditingStateManager();
                    const task = this.data.find(t => t.id === taskId);
                    const originalValue = task ? getTaskFieldValue(task, field as GridColumn['field']) : undefined;
                    editingManager.enterEditMode({ taskId, field }, 'click', originalValue);
                }
                
                return;
            }
        }

        // Row click for selection
        if (this.options.onRowClick) {
            this.options.onRowClick(taskId, e);
        }
    }

    /**
     * Handle double-click events
     */
    private _onDoubleClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const taskId = row.dataset.taskId;
        if (!taskId) return;

        // Don't trigger if double-clicking on input
        if (target.classList.contains('vsg-input') || target.classList.contains('vsg-select')) {
            return;
        }

        // Check if blank row - wake up
        if (row.classList.contains('blank-row')) {
            // Wake up the blank row
            if (this.options.onAction) {
                this.options.onAction(taskId, 'wake-up', e);
            }
            return;
        }

        if (this.options.onRowDoubleClick) {
            this.options.onRowDoubleClick(taskId, e);
        }
    }

    /**
     * Handle input events (real-time typing feedback)
     * Used for date inputs to show visual feedback without triggering full change
     */
    private _onInput(e: Event): void {
        const input = e.target as HTMLInputElement;
        if (!input.classList.contains('vsg-input')) return;
        if (!input.classList.contains('vsg-date-input')) return; // Only handle date inputs
        
        const row = input.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        
        // Add visual indicator that value is being edited (not yet saved)
        input.classList.add('editing');
        
        // Remove indicator after short delay if no more input
        clearTimeout((input as any)._editingTimeout);
        (input as any)._editingTimeout = setTimeout(() => {
            input.classList.remove('editing');
        }, 1000);
    }

    /**
     * Handle change events
     */
    private _onChange(e: Event): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;
        const field = input.getAttribute('data-field');
        if (!field) return;

        const row = input.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const taskId = row.dataset.taskId;
        if (!taskId) return;

        // Skip checkbox changes - they're handled by row click for selection
        if ((input as HTMLInputElement).type === 'checkbox') {
            return;
        }
        
        // Skip date inputs - handled by blur with format conversion
        if (input.classList.contains('vsg-date-input')) {
            return;
        }

        const value = input.value;

        if (this.options.onCellChange) {
            this.options.onCellChange(taskId, field, value);
        }
    }

    /**
     * Handle blur events
     */
    private _onBlur(e: FocusEvent): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;
        if (!input.classList.contains('vsg-input') && !input.classList.contains('vsg-select')) return;
        const field = input.getAttribute('data-field');
        if (!field) return;

        const row = input.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const taskId = row.dataset.taskId;
        if (!taskId) return;

        // For date inputs, save with format conversion (fromKeyboard: false)
        if (input.classList.contains('vsg-date-input')) {
            const editingManager = getEditingStateManager();
            const wasEditing = editingManager.isEditingCell(taskId, field);
            
            // FIX: Clear editing state immediately so the subsequent render 
            // (triggered by onCellChange) is allowed to update the DOM.
            this.editingCell = null; 
            this.editingRows.delete(taskId);
            
            // Also notify state manager immediately
            if (wasEditing) {
                editingManager.exitEditMode('blur');
            }

            this._saveDateInput(input as HTMLInputElement, taskId, field, false);
        }
        // For number inputs (duration), validate and coerce on commit
        else if ((input as HTMLInputElement).type === 'number') {
            // ═══════════════════════════════════════════════════════════════
            // COMMIT-TIME VALIDATION: Validate only when saving
            // User can type anything during editing; we fix it on blur
            // ═══════════════════════════════════════════════════════════════
            let value = input.value.trim();
            const parsedValue = parseInt(value);
            
            if (value === '' || isNaN(parsedValue) || parsedValue < 1) {
                // Invalid value - get current task value as fallback
                const task = this.data.find(t => t.id === taskId);
                const fallbackValue = task ? (task as any)[field] || 1 : 1;
                value = String(Math.max(1, fallbackValue));
                input.value = value; // Update DOM to show corrected value
            }
            
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, value);
            }
        }
        // For text inputs, fire change on blur
        else if ((input as HTMLInputElement).type === 'text') {
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, input.value);
            }
        }

        // Clear editing state after delay
        setTimeout(() => {
            const activeElement = document.activeElement;
            const isFocusingAnotherInput = activeElement &&
                activeElement.classList.contains('vsg-input') &&
                activeElement.closest('.vsg-row');

            if (!isFocusingAnotherInput) {
                // Clear local state
                this.editingCell = null;
                this.editingRows.delete(taskId);
                
                // Update state manager only if we're actually editing this cell
                const editingManager = getEditingStateManager();
                if (editingManager.isEditingCell(taskId, field)) {
                    editingManager.exitEditMode('blur');
                }
                
                // Notify service
                if (this.options.onEditEnd) {
                    this.options.onEditEnd();
                }
            }
        }, 100);
    }

    /**
     * Handle keydown events on grid container (navigation mode)
     * Processes Enter key when container is focused but not editing
     */
    private _onContainerKeyDown(e: KeyboardEvent): void {
        const target = e.target as HTMLElement;
        
        // Skip if from input - let _onKeyDown handle it
        if (target.classList.contains('vsg-input') || target.classList.contains('vsg-select')) {
            return;
        }
        
        // Handle Enter on blank row (wake up)
        if (e.key === 'Enter') {
            const editingManager = getEditingStateManager();
            if (!editingManager.isEditing()) {
                const focusedRow = this.rowContainer.querySelector(
                    `.vsg-row[data-task-id="${this._focusedCell?.taskId}"]`
                ) as HTMLElement;
                
                if (focusedRow?.classList.contains('blank-row')) {
                    e.preventDefault();
                    if (this.options.onAction && this._focusedCell) {
                        this.options.onAction(this._focusedCell.taskId, 'wake-up', e);
                    }
                    return;
                }
            }
        }
        
        // Only handle Enter
        if (e.key !== 'Enter') return;
        
        const editingManager = getEditingStateManager();
        
        // Only in navigation mode (not editing)
        if (editingManager.isEditing()) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // CRITICAL: Use _focusedCell (persists after blur), NOT editingCell (cleared on blur)
        const currentTaskId = this._focusedCell?.taskId;
        const currentField = this._focusedCell?.field;
        
        if (!currentTaskId || !currentField) return;
        
        const taskIndex = this.data.findIndex(t => t.id === currentTaskId);
        let nextTaskId: string | null = null;
        
        if (e.shiftKey) {
            // Shift+Enter: move UP
            if (taskIndex > 0) {
                nextTaskId = this.data[taskIndex - 1].id;
            }
        } else {
            // Enter: move DOWN
            if (taskIndex < this.data.length - 1) {
                nextTaskId = this.data[taskIndex + 1].id;
            } else if (this.options.onEnterLastRow) {
                this.options.onEnterLastRow(currentTaskId, currentField);
                return;
            }
        }
        
        if (nextTaskId) {
            // 1. Optimistic Visual Update: Move the blue focus border immediately
            // This makes it feel instant even if the full selection cycle takes a few ms
            // highlightCell updates _focusedCell automatically
            this.highlightCell(nextTaskId, currentField);
            
            // 2. Robust State Update: Delegate to the standard click handler
            // This ensures SchedulerService updates anchorId, selectionOrder, and panels correctly
            if (this.options.onRowClick) {
                // Create a lightweight synthetic event to pass modifier keys
                // This allows the Service to handle Shift/Ctrl logic if we ever add it to Enter
                const syntheticEvent = {
                    shiftKey: e.shiftKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    target: this.container,
                    currentTarget: this.container
                } as unknown as MouseEvent;

                this.options.onRowClick(nextTaskId, syntheticEvent);
            }
            // NOTE: Do NOT call onSelectionChange here - onRowClick will trigger it via _updateSelection()
        }
    }

    /**
     * Handle keydown events
     * Text inputs with smart date formatting - keyboard navigation works naturally
     */
    private _onKeyDown(e: KeyboardEvent): void {
        const target = e.target as HTMLInputElement | HTMLSelectElement;

        // Check if this is an editable input
        const isVsgInput = target.classList.contains('vsg-input');
        const isVsgSelect = target.classList.contains('vsg-select');
        
        if (!isVsgInput && !isVsgSelect) {
            return;
        }

        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        const currentField = target.getAttribute('data-field');
        
        if (!taskId || !currentField) return;

        // ========================================
        // TAB / SHIFT+TAB: Horizontal navigation
        // ========================================
        if (e.key === 'Tab' && (target.classList.contains('vsg-input') || target.classList.contains('vsg-select'))) {
            e.preventDefault();
            e.stopPropagation();
            
            const row = target.closest('.vsg-row') as HTMLElement | null;
            if (!row) return;
            
            const taskId = row.dataset.taskId;
            if (!taskId) return;
            
            const currentField = target.getAttribute('data-field');
            if (!currentField) return;
            
            // Get all editable columns
            const editableColumns = this.options.columns?.filter(col => 
                col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select'
            ) || [];
            
            const currentIndex = editableColumns.findIndex(col => col.field === currentField);
            
            let nextTaskId = taskId;
            let nextField = currentField;
            
            if (e.shiftKey) {
                // Shift+Tab: move to previous cell
                if (currentIndex > 0) {
                    nextField = editableColumns[currentIndex - 1].field;
                } else {
                    const taskIndex = this.data.findIndex(t => t.id === taskId);
                    if (taskIndex > 0) {
                        nextTaskId = this.data[taskIndex - 1].id;
                        nextField = editableColumns[editableColumns.length - 1].field;
                    }
                }
            } else {
                // Tab: move to next cell
                if (currentIndex < editableColumns.length - 1) {
                    nextField = editableColumns[currentIndex + 1].field;
                } else {
                    const taskIndex = this.data.findIndex(t => t.id === taskId);
                    if (taskIndex < this.data.length - 1) {
                        nextTaskId = this.data[taskIndex + 1].id;
                        nextField = editableColumns[0].field;
                    }
                }
            }
            
            // Save current edit (handle date inputs and number inputs with validation)
            if (target.classList.contains('vsg-date-input')) {
                // FIX: Clear editing state immediately so the subsequent render 
                // (triggered by onCellChange) is allowed to update the DOM.
                this.editingCell = null; 
                this.editingRows.delete(taskId);
                
                // Also notify state manager immediately
                const editingManager = getEditingStateManager();
                if (editingManager.isEditingCell(taskId, currentField)) {
                    editingManager.exitEditMode('tab');
                }
                
                this._saveDateInput(target as HTMLInputElement, taskId, currentField, true);
            } else if ((target as HTMLInputElement).type === 'number') {
                // Commit-time validation for number inputs
                let value = (target as HTMLInputElement).value.trim();
                const parsedValue = parseInt(value);
                
                if (value === '' || isNaN(parsedValue) || parsedValue < 1) {
                    const task = this.data.find(t => t.id === taskId);
                    const fallbackValue = task ? (task as any)[currentField] || 1 : 1;
                    value = String(Math.max(1, fallbackValue));
                    (target as HTMLInputElement).value = value;
                }
                
                if (this.options.onCellChange) {
                    this.options.onCellChange(taskId, currentField, value);
                }
            } else if (this.options.onCellChange) {
                this.options.onCellChange(taskId, currentField, (target as HTMLInputElement).value);
            }
            
            target.blur();
            
            // Update state manager - move to next cell
            // Note: For date inputs, editing state was already cleared above before save
            const editingManager = getEditingStateManager();
            const task = this.data.find(t => t.id === nextTaskId);
            const originalValue = task ? getTaskFieldValue(task, nextField as GridColumn['field']) : undefined;
            editingManager.moveToCell({ taskId: nextTaskId, field: nextField }, e.shiftKey ? 'shift-tab' : 'tab', originalValue);
            
            // Update local state
            this.editingCell = { taskId: nextTaskId, field: nextField };
            // For date inputs, editingRows.delete was already called above
            if (!target.classList.contains('vsg-date-input')) {
                this.editingRows.delete(taskId);
            }
            this.editingRows.add(nextTaskId);
            
            setTimeout(() => this.focusCell(nextTaskId, nextField), 50);
            return;
        }

        // ========================================
        // ENTER / SHIFT+ENTER: Commit and exit (stay on same cell)
        // Navigation to next row happens in _onContainerKeyDown when not editing
        // ========================================
        if (e.key === 'Enter' && target.classList.contains('vsg-input')) {
            e.preventDefault();
            e.stopPropagation();
            
            const row = target.closest('.vsg-row') as HTMLElement | null;
            if (!row) return;
            
            const taskId = row.dataset.taskId;
            if (!taskId) return;
            
            const currentField = target.getAttribute('data-field');
            if (!currentField) return;
            
            // ═══════════════════════════════════════════════════════════════
            // COMMIT-TIME VALIDATION: Same logic as blur for number inputs
            // ═══════════════════════════════════════════════════════════════
            
            // 1. Save current edit
            if (target.classList.contains('vsg-date-input')) {
                const editingManager = getEditingStateManager();
                const wasEditing = editingManager.isEditingCell(taskId, currentField);
                
                // FIX: Clear editing state immediately so the subsequent render 
                // (triggered by onCellChange) is allowed to update the DOM.
                this.editingCell = null; 
                this.editingRows.delete(taskId);
                
                // Also notify state manager immediately
                if (wasEditing) {
                    editingManager.exitEditMode('enter');
                }
                
                this._saveDateInput(target as HTMLInputElement, taskId, currentField, true);
            } else if ((target as HTMLInputElement).type === 'number') {
                let value = (target as HTMLInputElement).value.trim();
                const parsedValue = parseInt(value);
                
                if (value === '' || isNaN(parsedValue) || parsedValue < 1) {
                    const task = this.data.find(t => t.id === taskId);
                    const fallbackValue = task ? (task as any)[currentField] || 1 : 1;
                    value = String(Math.max(1, fallbackValue));
                    (target as HTMLInputElement).value = value;
                }
                
                if (this.options.onCellChange) {
                    this.options.onCellChange(taskId, currentField, value);
                }
            } else {
                if (this.options.onCellChange) {
                    this.options.onCellChange(taskId, currentField, (target as HTMLInputElement).value);
                }
            }
            
            // 2. Blur input (triggers blur handler cleanup)
            target.blur();
            
            // 3. Editing state already cleared above for date inputs
            // For non-date inputs, clear editing state here
            if (!target.classList.contains('vsg-date-input')) {
                this.editingRows.delete(taskId);
                this.editingCell = null;
                
                // Exit edit mode via state manager
                const editingManager = getEditingStateManager();
                if (editingManager.isEditingCell(taskId, currentField)) {
                    editingManager.exitEditMode('enter');
                }
            }
            
            // 5. Ensure cell stays highlighted and _focusedCell is set
            // (SchedulerService may already do this, but be explicit)
            this.highlightCell(taskId, currentField);
            
            // 6. Focus container for keyboard capture
            this.container.focus();
            
            // 7. Notify editing ended
            if (this.options.onEditEnd) {
                this.options.onEditEnd();
            }
            
            return;
        }

        // ========================================
        // ESCAPE: Exit edit mode (REVERT to original value - standard UX)
        // CRITICAL UX: Escape = Cancel (matches Excel, MS Project, Google Sheets)
        // Must restore originalValue before blurring to cancel user's changes
        // ========================================
        if (e.key === 'Escape' && target.classList.contains('vsg-input')) {
            e.preventDefault();
            e.stopPropagation();
            
            const row = target.closest('.vsg-row') as HTMLElement | null;
            if (!row) return;
            
            const taskId = row.dataset.taskId;
            const field = target.getAttribute('data-field');
            
            // Get original value from EditingStateManager context
            // Note: originalValue is stored when enterEditMode() is called (in click handlers, focusCell, etc.)
            const editingManager = getEditingStateManager();
            const context = editingManager.getContext();
            
            // Restore original value if available (standard UX - Escape = Cancel)
            if (context && context.originalValue !== undefined) {
                if (target.classList.contains('vsg-date-input')) {
                    // Date inputs: convert ISO to display format
                    const dateValue = context.originalValue ? formatDateForDisplay(String(context.originalValue)) : '';
                    (target as HTMLInputElement).value = dateValue;
                } else if (target.type === 'text' || target.type === 'number') {
                    (target as HTMLInputElement).value = String(context.originalValue || '');
                } else if (target.classList.contains('vsg-select')) {
                    (target as HTMLSelectElement).value = String(context.originalValue || '');
                }
            }
            
            // Clear internal editing state
            this.editingCell = null;
            if (taskId) {
                this.editingRows.delete(taskId);
            }
            
            // Blur input (now with reverted value)
            target.blur();
            
            // Update state manager
            editingManager.exitEditMode('escape');
            
            // Notify service
            if (this.options.onEditEnd) {
                this.options.onEditEnd();
            }
            return;
        }
    }

    /**
     * Parse and save a date input value
     * Converts from display format (flexible) to ISO format for storage
     * Uses a flag to prevent double-save when Tab/Enter triggers both keydown and blur
     */
    private _saveDateInput(input: HTMLInputElement, taskId: string, field: string, fromKeyboard: boolean = false): void {
        const saveKey = `${taskId}:${field}`;
        
        // If this is from blur and we already saved from keyboard, skip
        if (!fromKeyboard && this._dateSaveInProgress.has(saveKey)) {
            this._dateSaveInProgress.delete(saveKey);
            return;
        }
        
        // If this is from keyboard, mark as in progress (blur will skip)
        if (fromKeyboard) {
            this._dateSaveInProgress.add(saveKey);
            // Clear the flag after a short delay (in case blur doesn't fire)
            setTimeout(() => this._dateSaveInProgress.delete(saveKey), 100);
        }
        
        const displayValue = input.value.trim();
        
        if (!displayValue) {
            // Empty value - clear the date
            input.dataset.isoValue = '';
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, '');
            }
            return;
        }
        
        // Check if value actually changed from stored value
        const storedIso = input.dataset.isoValue || '';
        const storedDisplay = storedIso ? formatDateForDisplay(storedIso) : '';
        
        // If display value matches what's stored, no need to save
        if (displayValue === storedDisplay) {
            return;
        }
        
        // Try to parse the input (supports multiple formats)
        const parsed = parseFlexibleDate(displayValue);
        
        if (parsed) {
            const isoValue = formatDateISO(parsed);
            
            // Check if ISO value actually changed
            if (isoValue === storedIso) {
                // Same date, just reformat display
                input.value = formatDateForDisplay(isoValue);
                return;
            }
            
            // Update display to normalized format
            input.value = formatDateForDisplay(isoValue);
            input.dataset.isoValue = isoValue;
            
            // Save ISO value
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, isoValue);
            }
        } else {
            // Invalid date - revert to previous value
            const previousIso = input.dataset.isoValue || '';
            input.value = previousIso ? formatDateForDisplay(previousIso) : '';
            // Don't fire change - invalid input
        }
    }

    /**
     * Get task field value (helper)
     */
    private _getTaskFieldValue(task: Task, field: string): unknown {
        if (field === 'checkbox' || field === 'drag' || field === 'rowNum' || field === 'actions') {
            return undefined;
        }
        return (task as any)[field];
    }

    /**
     * Handle drag start
     */
    private _onDragStart(e: DragEvent): void {
        const target = e.target as HTMLElement;
        const handle = target.closest('.vsg-drag-handle') as HTMLElement | null;
        if (!handle) {
            e.preventDefault();
            return;
        }

        const row = handle.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const taskId = row.dataset.taskId;
        if (!taskId) return;

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', taskId);
        }

        row.classList.add('dragging');
    }

    /**
     * Handle drag end
     */
    private _onDragEnd(_e: DragEvent): void {
        const rows = this.rowContainer.querySelectorAll('.vsg-row');
        rows.forEach(row => {
            row.classList.remove('dragging', 'drag-over-before', 'drag-over-after', 'drag-over-child');
        });
        
        // Reset hysteresis state
        this._lastDropPosition = null;
        this._lastDropTargetId = null;
        this._lastDragOverTime = 0;
    }

    /**
     * Handle drag over
     * Enhanced with throttling and hysteresis for smoother UX
     */
    private _onDragOver(e: DragEvent): void {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }

        // Throttle updates
        const now = performance.now();
        if (now - this._lastDragOverTime < this._dragThrottleMs) {
            return;
        }
        this._lastDragOverTime = now;

        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const targetTaskId = row.dataset.taskId;
        if (!targetTaskId) return;

        // Get dragged task ID from dataTransfer
        const dragData = e.dataTransfer?.getData('text/plain');
        
        // Don't allow drop on self
        if (dragData && this.selectedIds.has(dragData) && this.selectedIds.has(targetTaskId)) {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'none';
            }
            this._clearDropIndicators();
            return;
        }

        // Calculate position
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        // Zone thresholds (15% / 70% / 15%)
        const beforeThreshold = height * 0.15;
        const afterThreshold = height * 0.85;

        // Determine raw position
        let rawPosition: 'before' | 'after' | 'child';
        if (y < beforeThreshold) {
            rawPosition = 'before';
        } else if (y > afterThreshold) {
            rawPosition = 'after';
        } else {
            rawPosition = 'child';
        }

        // Apply hysteresis
        const newPosition = this._applyHysteresis(
            rawPosition,
            y,
            height,
            beforeThreshold,
            afterThreshold,
            targetTaskId
        );

        // Only update if changed
        if (this._lastDropPosition !== newPosition || this._lastDropTargetId !== targetTaskId) {
            this._clearDropIndicators();
            row.classList.add(`drag-over-${newPosition}`);
            this._lastDropPosition = newPosition;
            this._lastDropTargetId = targetTaskId;
        }
    }
    
    /**
     * Apply hysteresis to prevent flickering
     * @private
     */
    private _applyHysteresis(
        rawPosition: 'before' | 'after' | 'child',
        y: number,
        _height: number,
        beforeThreshold: number,
        afterThreshold: number,
        targetTaskId: string
    ): 'before' | 'after' | 'child' {
        if (this._lastDropTargetId !== targetTaskId) {
            return rawPosition;
        }
        
        if (!this._lastDropPosition) {
            return rawPosition;
        }
        
        if (this._lastDropPosition === rawPosition) {
            return rawPosition;
        }
        
        const h = this._hysteresisPixels;
        
        switch (this._lastDropPosition) {
            case 'before':
                if (rawPosition === 'child' && y < beforeThreshold + h) {
                    return 'before';
                }
                if (rawPosition === 'after' && y < afterThreshold + h) {
                    return y < beforeThreshold + h ? 'before' : 'child';
                }
                break;
                
            case 'child':
                if (rawPosition === 'before' && y > beforeThreshold - h) {
                    return 'child';
                }
                if (rawPosition === 'after' && y < afterThreshold + h) {
                    return 'child';
                }
                break;
                
            case 'after':
                if (rawPosition === 'child' && y > afterThreshold - h) {
                    return 'after';
                }
                if (rawPosition === 'before' && y > beforeThreshold - h) {
                    return y > afterThreshold - h ? 'after' : 'child';
                }
                break;
        }
        
        return rawPosition;
    }
    
    /**
     * Clear all drop indicators
     * @private
     */
    private _clearDropIndicators(): void {
        const rows = this.rowContainer.querySelectorAll('.vsg-row');
        rows.forEach(r => {
            r.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        });
    }

    /**
     * Handle drag leave
     */
    private _onDragLeave(e: DragEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const relatedRow = relatedTarget?.closest('.vsg-row') as HTMLElement | null;
        
        if (relatedRow !== row) {
            row.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
            
            if (!relatedRow) {
                this._lastDropPosition = null;
                this._lastDropTargetId = null;
            }
        }
    }

    /**
     * Handle drop
     */
    private _onDrop(e: DragEvent): void {
        e.preventDefault();

        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const targetTaskId = row.dataset.taskId;
        if (!targetTaskId) return;

        const dragData = e.dataTransfer?.getData('text/plain');
        if (!dragData) return;

        // Clear drop indicators
        const rows = this.rowContainer.querySelectorAll('.vsg-row');
        rows.forEach(r => {
            r.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        });

        // Determine drop position
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        // Zone thresholds (15% / 70% / 15%)
        const beforeThreshold = height * 0.15;
        const afterThreshold = height * 0.85;

        let position: 'before' | 'after' | 'child';
        if (y < beforeThreshold) {
            position = 'before';
        } else if (y > afterThreshold) {
            position = 'after';
        } else {
            position = 'child';
        }

        if (this.options.onRowMove) {
            const taskIds = this.selectedIds.has(dragData) ? [...this.selectedIds] : [dragData];
            this.options.onRowMove(taskIds, targetTaskId, position);
        }
    }

    /**
     * Open the shared date picker popup positioned near an anchor element
     */
    private _openSharedDatePicker(taskId: string, field: string, anchorEl: HTMLElement, currentValue: string): void {
        // Close existing picker if open
        if (this.sharedDatePicker) {
            this.sharedDatePicker.destroy();
            this.sharedDatePicker = null;
        }
        
        // Store context for when user selects a date
        this.activeDatePickerContext = { taskId, field };
        
        // Create temporary invisible input for Flatpickr to attach to
        const tempInput = document.createElement('input');
        tempInput.type = 'text';
        tempInput.style.cssText = 'position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0;';
        tempInput.value = currentValue || '';
        anchorEl.appendChild(tempInput);
        
        // Create Flatpickr in static mode (popup only)
        this.sharedDatePicker = flatpickr(tempInput, createSharedPickerOptions({
            calendar: this.calendar || undefined,
            defaultDate: currentValue || undefined,
            positionElement: anchorEl,
            onChange: (selectedDates, dateStr) => {
                if (this.activeDatePickerContext && dateStr) {
                    const { taskId: ctxTaskId, field: ctxField } = this.activeDatePickerContext;
                    
                    // Update the input with display format
                    const row = this.rowContainer.querySelector(`[data-task-id="${ctxTaskId}"]`) as HTMLElement;
                    const cell = row?.querySelector(`[data-field="${ctxField}"]`) as HTMLElement;
                    const input = cell?.querySelector('.vsg-input') as HTMLInputElement;
                    if (input) {
                        // Update display value (MM/DD/YYYY)
                        input.value = formatDateForDisplay(dateStr);
                        // Update stored ISO value
                        input.dataset.isoValue = dateStr;
                    }
                    
                    // Trigger change callback with ISO format for storage
                    if (this.options.onCellChange) {
                        this.options.onCellChange(ctxTaskId, ctxField, dateStr);
                    }
                }
            },
            onClose: () => {
                // Clean up temp input
                if (tempInput.parentNode) {
                    tempInput.parentNode.removeChild(tempInput);
                }
                this.activeDatePickerContext = null;
                anchorEl.classList.remove('date-picker-open');
            },
        }));
        
        // Open immediately
        anchorEl.classList.add('date-picker-open');
        this.sharedDatePicker.open();
    }

    /**
     * Render the phantom row at the bottom of the list
     * MUST be called after all PoolSystem operations to avoid z-index conflicts
     */
    private _renderPhantomRow(state: ViewportState): void {
        // Get or create phantom row element
        let phantomEl = this.rowContainer.querySelector('.phantom-row') as HTMLElement;
        
        if (!phantomEl) {
            phantomEl = document.createElement('div');
            phantomEl.className = 'vsg-row phantom-row';
            // CRITICAL: Set data-task-id to PHANTOM_ROW_ID constant to prevent undefined errors
            phantomEl.dataset.taskId = PHANTOM_ROW_ID;
            // Ensure phantom is above pooled rows if they overlap
            phantomEl.style.zIndex = '10';
            phantomEl.innerHTML = `
                <div class="phantom-content">
                    <span class="phantom-placeholder">Click or type to add task...</span>
                </div>
            `;
            this.rowContainer.appendChild(phantomEl);
            
            // Add event listeners
            phantomEl.addEventListener('click', () => this._activatePhantom());
            phantomEl.addEventListener('keydown', (e) => {
                if (e.key !== 'Tab' && e.key !== 'Escape' && !e.ctrlKey && !e.metaKey) {
                    this._activatePhantom();
                }
            });
        }
        
        // Position phantom row below all real tasks
        const totalTasks = this.data.length;
        const phantomY = totalTasks * this.rowHeight;
        phantomEl.style.position = 'absolute';
        phantomEl.style.top = `${phantomY}px`;
        phantomEl.style.left = '0';
        phantomEl.style.right = '0';
    }

    /**
     * Activate phantom row - create real task
     * 
     * NOTE: This triggers SchedulerService.addTask() which already includes
     * `focusCell: true, focusField: 'name'` in its grid.setSelection() call.
     * This should automatically focus the name column for immediate typing.
     */
    private _activatePhantom(): void {
        if (this.options.onAction) {
            this.options.onAction(PHANTOM_ROW_ID, 'activate-phantom', new MouseEvent('click'));
        }
    }

    /**
     * Destroy the renderer
     */
    destroy(): void {
        // Clear editing state if this component was editing
        const editingManager = getEditingStateManager();
        if (this.editingCell && editingManager.isEditingCell(this.editingCell.taskId, this.editingCell.field)) {
            editingManager.exitEditMode('destroy');
        }
        this.editingCell = null;
        this.editingRows.clear();
        
        // Remove container keydown listener
        if (this._boundContainerKeyDown) {
            this.container.removeEventListener('keydown', this._boundContainerKeyDown);
            this._boundContainerKeyDown = null;
        }
        
        // Clean up shared date picker
        if (this.sharedDatePicker) {
            this.sharedDatePicker.destroy();
            this.sharedDatePicker = null;
        }
        
        this.pool.destroy();
        this.container.innerHTML = '';
    }
}

