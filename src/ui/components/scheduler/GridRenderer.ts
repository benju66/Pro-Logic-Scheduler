/**
 * @fileoverview Grid Renderer for Unified Scheduler V2
 * @module ui/components/scheduler/GridRenderer
 * 
 * Renders DOM rows efficiently using pooling.
 * Handles user interactions via event delegation.
 * NO vertical scroll handling (handled by SchedulerViewport).
 * Owns horizontal scroll for columns.
 */

import type { Task, GridColumn } from '../../../types';
import type { ViewportState, GridRendererOptions, BindingContext } from './types';
import { PoolSystem } from './pool/PoolSystem';
import { BindingSystem } from './pool/BindingSystem';
import { ROW_HEIGHT } from './constants';

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
    private rowContainer: HTMLElement;
    private options: Required<GridRendererOptions>;
    private rowHeight: number;
    private data: Task[] = [];
    private selectedIds: Set<string> = new Set();
    private editingCell: EditingCell | null = null;
    private editingRows: Set<string> = new Set();
    private isScrolling: boolean = false;

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

        // Create row container for virtual scrolling
        this.rowContainer = document.createElement('div');
        this.rowContainer.className = 'vsg-row-container';
        this.rowContainer.style.cssText = `
            position: absolute;
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
        const { scrollTop, visibleRange } = state;
        const { start, end } = visibleRange;

        // 1. Apply transform (compositor-only, no layout)
        const offset = Math.floor(start * this.rowHeight);
        this.rowContainer.style.transform = `translateY(${offset}px)`;

        // 2. Release rows outside range
        this.pool.releaseRowsOutsideRange(start, end);

        // 3. Bind rows in range
        for (let i = start; i <= end && i < this.data.length; i++) {
            const task = this.data[i];
            if (!task) continue;

            try {
                const row = this.pool.acquireRow(i);

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
     */
    updateColumns(columns: GridColumn[]): void {
        this.options.columns = columns;
        this.binder.updateColumns(columns);
        // Note: Pool would need to be rebuilt for new columns - this is expensive
        // For now, we assume columns don't change structure, only data
    }

    /**
     * Focus a specific cell
     */
    focusCell(taskId: string, field: string): void {
        const row = this.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
        if (!row) return;

        const cell = row.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
        if (!cell) return;

        const input = cell.querySelector('.vsg-input, .vsg-select') as HTMLInputElement | HTMLSelectElement | null;
        if (input && !input.disabled) {
            input.focus();
            if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
                (input as HTMLInputElement).select();
            }
            this.editingCell = { taskId, field };
            this.editingRows.add(taskId);
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

        // If clicking directly on an input, focus it
        if (target.classList.contains('vsg-input') || target.classList.contains('vsg-select')) {
            const field = target.getAttribute('data-field');
            if (field) {
                (target as HTMLInputElement | HTMLSelectElement).focus();
                if ((target as HTMLInputElement).type === 'text' || (target as HTMLInputElement).type === 'number') {
                    (target as HTMLInputElement).select();
                }
                this.editingCell = { taskId, field };
                this.editingRows.add(taskId);
            }
            return;
        }

        // If clicking on a cell (but not the input), focus the input
        const cell = target.closest('[data-field]') as HTMLElement | null;
        if (cell) {
            const field = cell.getAttribute('data-field');
            const input = cell.querySelector('.vsg-input, .vsg-select') as HTMLInputElement | HTMLSelectElement | null;
            if (input && !input.disabled && field) {
                input.focus();
                if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
                    (input as HTMLInputElement).select();
                }
                this.editingCell = { taskId, field };
                this.editingRows.add(taskId);
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

        // Skip checkbox changes
        if ((input as HTMLInputElement).type === 'checkbox') {
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

        // For text/number inputs, fire change on blur
        if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
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
                this.editingCell = null;
                this.editingRows.delete(taskId);
            }
        }, 100);
    }

    /**
     * Handle keydown events
     */
    private _onKeyDown(e: KeyboardEvent): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;

        // Tab navigation between cells
        if (e.key === 'Tab' && (input.classList.contains('vsg-input') || input.classList.contains('vsg-select'))) {
            e.preventDefault();

            const row = input.closest('.vsg-row') as HTMLElement | null;
            if (!row) return;

            const taskId = row.dataset.taskId;
            if (!taskId) return;

            const currentField = input.getAttribute('data-field');
            if (!currentField) return;

            // Get all editable columns
            const editableColumns = this.options.columns.filter(col =>
                col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select'
            );

            const currentIndex = editableColumns.findIndex(col => col.field === currentField);

            if (e.shiftKey) {
                // Shift+Tab: move to previous cell
                if (currentIndex > 0) {
                    const prevField = editableColumns[currentIndex - 1].field;
                    this.focusCell(taskId, prevField);
                } else {
                    // Move to previous row, last cell
                    const taskIndex = this.data.findIndex(t => t.id === taskId);
                    if (taskIndex > 0) {
                        const prevTaskId = this.data[taskIndex - 1].id;
                        const lastField = editableColumns[editableColumns.length - 1].field;
                        this.focusCell(prevTaskId, lastField);
                    }
                }
            } else {
                // Tab: move to next cell
                if (currentIndex < editableColumns.length - 1) {
                    const nextField = editableColumns[currentIndex + 1].field;
                    this.focusCell(taskId, nextField);
                } else {
                    // Move to next row, first cell
                    const taskIndex = this.data.findIndex(t => t.id === taskId);
                    if (taskIndex < this.data.length - 1) {
                        const nextTaskId = this.data[taskIndex + 1].id;
                        const firstField = editableColumns[0].field;
                        this.focusCell(nextTaskId, firstField);
                    }
                }
            }
            return;
        }

        // Enter key: blur input and move to next/previous row
        if (e.key === 'Enter' && input.classList.contains('vsg-input')) {
            e.preventDefault();

            const row = input.closest('.vsg-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            const field = input.getAttribute('data-field');

            if (this.options.onCellChange && field && taskId) {
                this.options.onCellChange(taskId, field, input.value);
            }

            input.blur();

            if (!taskId) return;
            const taskIndex = this.data.findIndex(t => t.id === taskId);

            if (e.shiftKey) {
                // Shift+Enter: move to same cell in previous row
                if (taskIndex > 0 && field) {
                    const prevTaskId = this.data[taskIndex - 1].id;
                    setTimeout(() => this.focusCell(prevTaskId, field), 50);
                }
            } else {
                // Enter: move to same cell in next row
                if (taskIndex < this.data.length - 1 && field) {
                    const nextTaskId = this.data[taskIndex + 1].id;
                    setTimeout(() => this.focusCell(nextTaskId, field), 50);
                }
            }
            return;
        }

        // Escape key cancels edit
        if (e.key === 'Escape' && input.classList.contains('vsg-input')) {
            const row = input.closest('.vsg-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            const field = input.getAttribute('data-field');
            const task = this.data.find(t => t.id === taskId);
            if (task && field) {
                const value = this._getTaskFieldValue(task, field);
                (input as HTMLInputElement).value = value ? String(value) : '';
            }
            input.blur();
            return;
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
    }

    /**
     * Handle drag over
     */
    private _onDragOver(e: DragEvent): void {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }

        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;

        const targetTaskId = row.dataset.taskId;
        if (!targetTaskId) return;

        // Clear previous drop indicators
        const rows = this.rowContainer.querySelectorAll('.vsg-row');
        rows.forEach(r => {
            r.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        });

        // Determine drop position
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        if (y < height * 0.25) {
            row.classList.add('drag-over-before');
        } else if (y > height * 0.75) {
            row.classList.add('drag-over-after');
        } else {
            row.classList.add('drag-over-child');
        }
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

        let position: 'before' | 'after' = 'after';
        if (y < height * 0.25) {
            position = 'before';
        } else if (y > height * 0.75) {
            position = 'after';
        }

        if (this.options.onRowMove) {
            const taskIds = this.selectedIds.has(dragData) ? [...this.selectedIds] : [dragData];
            this.options.onRowMove(taskIds, targetTaskId, position);
        }
    }

    /**
     * Destroy the renderer
     */
    destroy(): void {
        this.pool.destroy();
        this.container.innerHTML = '';
    }
}

