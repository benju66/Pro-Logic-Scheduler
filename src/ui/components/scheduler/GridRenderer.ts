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
            onToggleCollapse: options.onToggleCollapse ?? (() => {}),
            onSelectionChange: options.onSelectionChange ?? (() => {}),
            onRowMove: options.onRowMove ?? (() => {}),
            onEnterLastRow: options.onEnterLastRow,
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
            console.log('[GridRenderer] Column structure changed, rebuilding pool');
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

        // Check for collapse toggle FIRST
        const collapseBtn = target.closest('.vsg-collapse-btn') as HTMLElement | null;
        if (collapseBtn) {
            e.stopPropagation();
            if (this.options.onToggleCollapse) {
                this.options.onToggleCollapse(taskId);
            }
            return;
        }

        // Check for action button clicks
        const actionBtn = target.closest('[data-action]') as HTMLElement | null;
        if (actionBtn && !actionBtn.classList.contains('vsg-collapse-btn')) {
            const action = actionBtn.getAttribute('data-action');
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
            return;
        }

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
            this._saveDateInput(input as HTMLInputElement, taskId, field, false);
        }
        // For text/number inputs, fire change on blur
        else if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
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
            
            // Save current edit (handle date inputs)
            if (target.classList.contains('vsg-date-input')) {
                this._saveDateInput(target as HTMLInputElement, taskId, currentField, true);
            } else if (this.options.onCellChange) {
                this.options.onCellChange(taskId, currentField, (target as HTMLInputElement).value);
            }
            
            target.blur();
            
            // Update state manager
            const editingManager = getEditingStateManager();
            const task = this.data.find(t => t.id === nextTaskId);
            const originalValue = task ? getTaskFieldValue(task, nextField as GridColumn['field']) : undefined;
            editingManager.moveToCell({ taskId: nextTaskId, field: nextField }, e.shiftKey ? 'shift-tab' : 'tab', originalValue);
            
            // Update local state
            this.editingCell = { taskId: nextTaskId, field: nextField };
            this.editingRows.delete(taskId);
            this.editingRows.add(nextTaskId);
            
            setTimeout(() => this.focusCell(nextTaskId, nextField), 50);
            return;
        }

        // ========================================
        // ENTER / SHIFT+ENTER: Vertical navigation
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
            
            // For date inputs, parse and save
            if (target.classList.contains('vsg-date-input')) {
                this._saveDateInput(target as HTMLInputElement, taskId, currentField, true);
            } else {
                // Save current edit for non-date inputs
                if (this.options.onCellChange) {
                    this.options.onCellChange(taskId, currentField, (target as HTMLInputElement).value);
                }
            }
            
            target.blur();
            
            const taskIndex = this.data.findIndex(t => t.id === taskId);
            let nextTaskId: string | null = null;
            
            if (e.shiftKey) {
                // Shift+Enter: move to previous row
                if (taskIndex > 0) {
                    nextTaskId = this.data[taskIndex - 1].id;
                }
            } else {
                // Enter: move to next row
                if (taskIndex < this.data.length - 1) {
                    nextTaskId = this.data[taskIndex + 1].id;
                } else if (taskIndex === this.data.length - 1) {
                    // ON LAST ROW - trigger callback to create new task
                    if (this.options.onEnterLastRow) {
                        this.options.onEnterLastRow(taskId, currentField);
                    }
                }
            }
            
            if (nextTaskId) {
                const nextTask = this.data.find(t => t.id === nextTaskId);
                const originalValue = nextTask ? getTaskFieldValue(nextTask, currentField as GridColumn['field']) : undefined;
                const editingManager = getEditingStateManager();
                editingManager.moveToCell({ taskId: nextTaskId, field: currentField }, 'enter', originalValue);
                
                // Update local state
                this.editingCell = { taskId: nextTaskId, field: currentField };
                this.editingRows.delete(taskId);
                this.editingRows.add(nextTaskId);
                
                setTimeout(() => this.focusCell(nextTaskId, currentField), 50);
            } else {
                // No next cell, exit edit mode
                const editingManager = getEditingStateManager();
                editingManager.exitEditMode('enter');
                this.editingCell = null;
                this.editingRows.delete(taskId);
                if (this.options.onEditEnd) {
                    this.options.onEditEnd();
                }
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
        
        // Clean up shared date picker
        if (this.sharedDatePicker) {
            this.sharedDatePicker.destroy();
            this.sharedDatePicker = null;
        }
        
        this.pool.destroy();
        this.container.innerHTML = '';
    }
}

