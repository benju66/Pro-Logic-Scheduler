/**
 * @fileoverview High-performance virtualized grid component
 * @module ui/components/VirtualScrollGrid
 * 
 * A high-performance virtualized grid component that renders only visible rows.
 * Designed to handle 10,000+ tasks at 60 FPS using DOM recycling.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────┐
 * │  Container (viewport - fixed height)    │
 * │  ┌───────────────────────────────────┐  │
 * │  │  Scroll Content                   │  │
 * │  │  ┌─────────────────────────────┐  │  │
 * │  │  │  Phantom Spacer (top)       │  │  │
 * │  │  │  height = scrollTop offset  │  │  │
 * │  │  └─────────────────────────────┘  │  │
 * │  │  ┌─────────────────────────────┐  │  │
 * │  │  │  Row Pool (visible rows)    │  │  │
 * │  │  │  ~40 recycled DOM nodes     │  │  │
 * │  │  └─────────────────────────────┘  │  │
 * │  │  ┌─────────────────────────────┐  │  │
 * │  │  │  Phantom Spacer (bottom)    │  │  │
 * │  │  │  height = remaining space   │  │  │
 * │  │  └─────────────────────────────┘  │  │
 * │  └───────────────────────────────────┘  │
 * └─────────────────────────────────────────┘
 * 
 * PERFORMANCE TECHNIQUES:
 * 1. DOM Recycling - Reuse row elements instead of creating/destroying
 * 2. Phantom Spacers - Fake scroll height without rendering all rows
 * 3. Buffer Zones - Pre-render rows above/below viewport for smooth scroll
 * 4. RAF Throttling - Batch scroll updates to animation frames
 * 5. Event Delegation - Single listener on container, not per-row
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import type { Task, GridColumn, VirtualScrollGridOptions } from '../../types';
import { getTaskFieldValue } from '../../types';

/**
 * Editing cell state
 */
interface EditingCell {
  taskId: string;
  field: string;
}

/**
 * Drag state
 */
interface DragState {
  taskId: string;
  taskIds: string[];
  targetTaskId?: string;
  dropPosition?: 'before' | 'after' | 'child';
}

/**
 * Cell metadata
 */
interface CellMeta {
  isParent: boolean;
  depth: number;
  isCollapsed: boolean;
  index: number;
}

/**
 * DOM element references
 */
interface VirtualScrollGridDOM {
  viewport: HTMLElement;
  scrollContent: HTMLElement;
  topSpacer: HTMLElement;
  bottomSpacer: HTMLElement;
  rowContainer: HTMLElement;
  rows: HTMLElement[];
}

export class VirtualScrollGrid {
    
    // =========================================================================
    // STATIC CONFIGURATION
    // =========================================================================
    
    /** Default configuration values */
    static readonly DEFAULTS = {
        rowHeight: 38,
        headerHeight: 50,
        bufferRows: 10,           // Extra rows above/below viewport
        scrollThrottle: 16,       // ~60fps throttle for scroll events
        editDebounce: 150,        // Debounce for input changes
    };

    /** Column type renderers */
    static readonly COLUMN_TYPES = {
        TEXT: 'text',
        NUMBER: 'number',
        DATE: 'date',
        SELECT: 'select',
        CHECKBOX: 'checkbox',
        READONLY: 'readonly',
        ACTIONS: 'actions',
        DRAG: 'drag',             // Drag handle for row reordering
        VARIANCE: 'variance',     // Variance column (computed, readonly)
    } as const;

    // =========================================================================
    // INSTANCE PROPERTIES
    // =========================================================================
    
    private options: Required<Pick<VirtualScrollGridOptions, 'rowHeight' | 'headerHeight' | 'bufferRows' | 'scrollThrottle' | 'editDebounce'>> & VirtualScrollGridOptions;
    private container: HTMLElement;
    private data: Task[] = [];                      // Flat array of visible tasks
    private allData: Task[] = [];                   // All tasks (for filtering)
    private selectedIds: Set<string> = new Set();        // Currently selected task IDs
    private focusedId: string | null = null;               // Currently focused task ID
    private editingCell: EditingCell | null = null;             // Currently editing cell
    private editingRows: Set<string> = new Set();        // Set of task IDs being edited (preserved during scroll)
    
    // Scroll state
    private scrollTop: number = 0;
    private viewportHeight: number = 0;
    private totalHeight: number = 0;
    private firstVisibleIndex: number = 0;
    private lastVisibleIndex: number = 0;
    
    // DOM element cache
    private dom!: VirtualScrollGridDOM; // Initialized in _buildDOM()
    
    // Performance tracking
    private _scrollRAF: number | null = null;              // requestAnimationFrame ID
    private _renderCount: number = 0;               // Debug: track render calls
    private _resizeObserver: ResizeObserver | null = null;
    
    // Drag state
    private _dragState: DragState | null = null;
    private _dragGhost: HTMLElement | null = null;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    /**
     * Create a new VirtualScrollGrid instance
     * 
     * @param container - The container element for the grid
     * @param options - Configuration options
     */
    constructor(container: HTMLElement, options: VirtualScrollGridOptions = {} as VirtualScrollGridOptions) {
        // Merge options with defaults
        this.options = { 
            ...VirtualScrollGrid.DEFAULTS, 
            ...options 
        } as Required<Pick<VirtualScrollGridOptions, 'rowHeight' | 'headerHeight' | 'bufferRows' | 'scrollThrottle' | 'editDebounce'>> & VirtualScrollGridOptions;
        
        this.container = container;
        
        // Initialize the grid
        this._init();
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize the grid DOM structure and event listeners
     * @private
     */
    private _init(): void {
        // Build DOM structure
        this._buildDOM();
        
        // Set up event listeners
        this._bindEvents();
        
        // Initial measurement
        this._measure();
        
        // Debug logging
        console.log('[VirtualScrollGrid] Initialized', {
            viewportHeight: this.viewportHeight,
            rowHeight: this.options.rowHeight,
            visibleRowCount: this._getVisibleRowCount(),
        });
    }

    /**
     * Build the grid DOM structure
     * @private
     */
    private _buildDOM(): void {
        // Clear container
        this.container.innerHTML = '';
        this.container.classList.add('vsg-container');
        
        // Create viewport (the visible scrolling area)
        const viewport = document.createElement('div');
        viewport.className = 'vsg-viewport';
        viewport.style.cssText = `
            height: 100%;
            overflow-y: auto;
            overflow-x: auto;
            position: relative;
        `;
        
        // Create scroll content wrapper (holds spacers + rows)
        const scrollContent = document.createElement('div');
        scrollContent.className = 'vsg-scroll-content';
        scrollContent.style.cssText = `
            position: relative;
            min-width: fit-content;
        `;
        
        // Create top phantom spacer
        const topSpacer = document.createElement('div');
        topSpacer.className = 'vsg-spacer-top';
        topSpacer.style.cssText = `
            height: 0px;
            pointer-events: none;
        `;
        
        // Create row container (holds the recycled rows)
        const rowContainer = document.createElement('div');
        rowContainer.className = 'vsg-row-container';
        rowContainer.style.cssText = `
            position: relative;
        `;
        
        // Create bottom phantom spacer
        const bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'vsg-spacer-bottom';
        bottomSpacer.style.cssText = `
            height: 0px;
            pointer-events: none;
        `;
        
        // Assemble structure
        scrollContent.appendChild(topSpacer);
        scrollContent.appendChild(rowContainer);
        scrollContent.appendChild(bottomSpacer);
        viewport.appendChild(scrollContent);
        this.container.appendChild(viewport);
        
        // Store DOM references
        this.dom = {
            viewport,
            scrollContent,
            topSpacer,
            bottomSpacer,
            rowContainer,
            rows: [],
        };
        
        // Pre-create row pool
        this._createRowPool();
    }

    /**
     * Create the pool of reusable row elements
     * @private
     */
    private _createRowPool(): void {
        const poolSize = this._getVisibleRowCount() + (this.options.bufferRows * 2) + 5;
        
        for (let i = 0; i < poolSize; i++) {
            const row = this._createRowElement();
            row.style.display = 'none'; // Hidden until needed
            this.dom.rowContainer.appendChild(row);
            this.dom.rows.push(row);
        }
        
        console.log(`[VirtualScrollGrid] Created row pool: ${poolSize} rows`);
    }

    /**
     * Create a single row element with all column cells
     * @private
     * @returns The row element
     */
    private _createRowElement(): HTMLElement {
        const row = document.createElement('div');
        row.className = 'vsg-row grid-row';
        row.style.cssText = `
            display: flex;
            height: ${this.options.rowHeight}px;
            align-items: center;
            border-bottom: 1px solid #f1f5f9;
            background: white;
            min-width: fit-content;
        `;
        
        // Create cells for each column
        if (this.options.columns) {
            this.options.columns.forEach(col => {
                const cell = this._createCellElement(col);
                row.appendChild(cell);
            });
        }
        
        return row;
    }

    /**
     * Create a cell element for a column
     * @private
     * @param col - Column definition
     * @returns The cell element
     */
    private _createCellElement(col: GridColumn): HTMLElement {
        const cell = document.createElement('div');
        cell.className = `vsg-cell col-cell`;
        cell.setAttribute('data-field', col.field);
        cell.style.cssText = `
            width: var(--w-${col.field}, ${col.width || 100}px);
            flex-shrink: 0;
            height: 100%;
            display: flex;
            align-items: center;
            border-right: 1px solid #e2e8f0;
            ${col.align === 'center' ? 'justify-content: center;' : ''}
            ${col.align === 'right' ? 'justify-content: flex-end;' : ''}
            position: relative;
            overflow: hidden;
        `;
        
        // Create inner content based on column type
        cell.innerHTML = this._getCellTemplate(col);
        
        return cell;
    }

    /**
     * Get the HTML template for a cell based on column type
     * @private
     * @param col - Column definition
     * @returns HTML template
     */
    private _getCellTemplate(col: GridColumn): string {
        switch (col.type) {
            case VirtualScrollGrid.COLUMN_TYPES.CHECKBOX:
                return `<input type="checkbox" class="vsg-checkbox select-checkbox" data-field="${col.field}">`;
                
            case VirtualScrollGrid.COLUMN_TYPES.TEXT:
                return `<input type="text" class="vsg-input cell-input" data-field="${col.field}" autocomplete="off">`;
                
            case VirtualScrollGrid.COLUMN_TYPES.NUMBER:
                return `<input type="number" class="vsg-input cell-input" data-field="${col.field}" autocomplete="off">`;
                
            case VirtualScrollGrid.COLUMN_TYPES.DATE:
                return `<input type="date" class="vsg-input cell-input" data-field="${col.field}">`;
                
            case VirtualScrollGrid.COLUMN_TYPES.SELECT:
                const options = (col.options || []).map((o: string | { value: string; label: string }) => {
                    if (typeof o === 'string') {
                        return `<option value="${o}">${o}</option>`;
                    }
                    return `<option value="${o.value}">${o.label}</option>`;
                }).join('');
                return `<select class="vsg-select cell-input" data-field="${col.field}">${options}</select>`;
                
            case VirtualScrollGrid.COLUMN_TYPES.READONLY:
            case VirtualScrollGrid.COLUMN_TYPES.VARIANCE:
                return `<span class="vsg-readonly" data-field="${col.field}"></span>`;
                
            case VirtualScrollGrid.COLUMN_TYPES.ACTIONS:
                return `<div class="vsg-actions" data-field="${col.field}"></div>`;
            
            case VirtualScrollGrid.COLUMN_TYPES.DRAG:
                return `<div class="vsg-drag-handle" data-field="${col.field}" draggable="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>
                        <circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                    </svg>
                </div>`;
                
            default:
                return `<span class="vsg-text" data-field="${col.field}"></span>`;
        }
    }

    // =========================================================================
    // EVENT HANDLING
    // =========================================================================
    
    /**
     * Bind all event listeners
     * @private
     */
    private _bindEvents(): void {
        // Scroll handling with RAF throttling
        this.dom.viewport.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
        
        // Event delegation for row interactions
        this.dom.rowContainer.addEventListener('click', this._onClick.bind(this));
        this.dom.rowContainer.addEventListener('dblclick', this._onDoubleClick.bind(this));
        this.dom.rowContainer.addEventListener('change', this._onChange.bind(this));
        this.dom.rowContainer.addEventListener('blur', this._onBlur.bind(this), true);
        this.dom.rowContainer.addEventListener('keydown', this._onKeyDown.bind(this));
        
        // Drag and drop event handlers
        this.dom.rowContainer.addEventListener('dragstart', this._onDragStart.bind(this));
        this.dom.rowContainer.addEventListener('dragend', this._onDragEnd.bind(this));
        this.dom.rowContainer.addEventListener('dragover', this._onDragOver.bind(this));
        this.dom.rowContainer.addEventListener('dragleave', this._onDragLeave.bind(this));
        this.dom.rowContainer.addEventListener('drop', this._onDrop.bind(this));
        
        // Resize observer for viewport changes
        this._resizeObserver = new ResizeObserver(() => {
            this._measure();
            this._updateVisibleRows();
        });
        this._resizeObserver.observe(this.container);
        
        // Initialize drag state
        this._dragState = null;
        this._dragGhost = null;
    }

    /**
     * Handle scroll events with RAF throttling
     * @private
     */
    private _onScroll(_e: Event): void {
        // Cancel any pending RAF
        if (this._scrollRAF !== null) {
            cancelAnimationFrame(this._scrollRAF);
        }
        
        // Schedule update on next animation frame
        this._scrollRAF = requestAnimationFrame(() => {
            this.scrollTop = this.dom.viewport.scrollTop;
            this._updateVisibleRows();
            
            // Emit scroll event for sync with Gantt
            if (this.options.onScroll) {
                this.options.onScroll(this.scrollTop);
            }
        });
    }

    /**
     * Handle click events via delegation
     * @private
     */
    private _onClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        
        // Ignore clicks from resizers (defensive check)
        if (target.closest('.resizer, .col-resizer')) {
            return;
        }
        
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) return;
        
        // Check for action button clicks
        const actionBtn = target.closest('[data-action]') as HTMLElement | null;
        if (actionBtn) {
            const action = actionBtn.getAttribute('data-action');
            if (action && this.options.onAction) {
                this.options.onAction(taskId, action, e);
            }
            return;
        }
        
        // Check for collapse toggle
        const collapseBtn = target.closest('.vsg-collapse-btn') as HTMLElement | null;
        if (collapseBtn) {
            if (this.options.onToggleCollapse) {
                this.options.onToggleCollapse(taskId);
            }
            return;
        }
        
        // Check for checkbox - toggle selection
        const checkbox = target.closest('.vsg-checkbox') as HTMLInputElement | null;
        if (checkbox) {
            // If task is already selected, deselect it (toggle off)
            // Otherwise, select it (single selection)
            if (this.selectedIds.has(taskId)) {
                // Deselect this task - simulate Ctrl+click to toggle off
                if (this.options.onRowClick) {
                    // Create synthetic event object with ctrlKey set for toggle behavior
                    const toggleEvent = {
                        ...e,
                        ctrlKey: true,
                        metaKey: false,
                        shiftKey: false
                    } as MouseEvent;
                    this.options.onRowClick(taskId, toggleEvent);
                }
            } else {
                // Select this task (single selection)
                if (this.options.onRowClick) {
                    this.options.onRowClick(taskId, e);
                }
            }
            return;
        }
        
        // If clicking directly on an input, focus it immediately
        if (target.classList.contains('vsg-input') || 
            target.classList.contains('vsg-select')) {
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
                return; // Don't trigger row click when editing cell
            }
        }
        
        // Row click for selection
        if (this.options.onRowClick) {
            this.options.onRowClick(taskId, e);
        }
    }

    /**
     * Handle double-click events
     * @private
     */
    private _onDoubleClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) return;
        
        // Don't trigger if double-clicking on input
        if (target.classList.contains('vsg-input') || 
            target.classList.contains('vsg-select')) {
            return;
        }
        
        if (this.options.onRowDoubleClick) {
            this.options.onRowDoubleClick(taskId, e);
        }
    }

    /**
     * Handle input/select change events
     * @private
     */
    private _onChange(e: Event): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;
        const field = input.getAttribute('data-field');
        if (!field) return;
        
        const row = input.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) return;
        
        // Skip checkbox changes - they're handled by row click for selection
        if ((input as HTMLInputElement).type === 'checkbox') {
            return;
        }
        
        const value = input.value;
        
        if (this.options.onCellChange) {
            this.options.onCellChange(taskId, field, value);
        }
    }

    /**
     * Handle blur events for text inputs
     * @private
     */
    private _onBlur(e: FocusEvent): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;
        if (!input.classList.contains('vsg-input') && !input.classList.contains('vsg-select')) return;
        const field = input.getAttribute('data-field');
        if (!field) return;
        
        const row = input.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) return;
        
        // For text/number inputs, fire change on blur
        if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
            if (this.options.onCellChange) {
                this.options.onCellChange(taskId, field, input.value);
            }
        }
        
        // Clear editing state after a short delay (to allow focus to move to another input)
        setTimeout(() => {
            // Only clear if we're not focusing another input in this grid
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
     * @private
     */
    private _onKeyDown(e: KeyboardEvent): void {
        const input = e.target as HTMLInputElement | HTMLSelectElement;
        
        // Tab navigation between cells
        if (e.key === 'Tab' && (input.classList.contains('vsg-input') || input.classList.contains('vsg-select'))) {
            e.preventDefault();
            
            const row = input.closest('.vsg-row') as HTMLElement | null;
            if (!row) return;
            
            const taskId = row.getAttribute('data-task-id');
            if (!taskId) return;
            
            const currentField = input.getAttribute('data-field');
            if (!currentField) return;
            
            // Get all editable columns
            const editableColumns = this.options.columns?.filter(col => 
                col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select'
            ) || [];
            
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
            
            // Save current edit
            const row = input.closest('.vsg-row') as HTMLElement | null;
            const taskId = row?.getAttribute('data-task-id');
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
            // Restore original value
            const row = input.closest('.vsg-row') as HTMLElement | null;
            const taskId = row?.getAttribute('data-task-id');
            const field = input.getAttribute('data-field');
            const task = this.data.find(t => t.id === taskId);
            if (task && field) {
                const value = getTaskFieldValue(task, field as GridColumn['field']);
                (input as HTMLInputElement).value = value ? String(value) : '';
            }
            input.blur();
            return;
        }
    }
    
    // =========================================================================
    // DRAG AND DROP
    // =========================================================================
    
    /**
     * Handle drag start
     * @private
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
        
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) return;
        
        const task = this.data.find(t => t.id === taskId);
        if (!task) return;
        
        // Store drag state
        this._dragState = {
            taskId: taskId,
            taskIds: this.selectedIds.has(taskId) ? [...this.selectedIds] : [taskId],
        };
        
        // Mark row as dragging
        row.classList.add('dragging');
        
        // Create custom ghost element
        this._createDragGhost(task, this._dragState.taskIds.length);
        
        // Set drag data
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', taskId);
            
            // Use custom ghost
            if (this._dragGhost) {
                e.dataTransfer.setDragImage(this._dragGhost, 10, 10);
            }
        }
    }
    
    /**
     * Create a custom drag ghost element
     * @private
     */
    private _createDragGhost(task: Task, count: number): void {
        this._removeDragGhost();
        
        this._dragGhost = document.createElement('div');
        this._dragGhost.className = 'drag-ghost';
        this._dragGhost.innerHTML = `
            ${task.name}
            ${count > 1 ? `<span class="drag-count">+${count - 1}</span>` : ''}
        `;
        
        // Position off-screen initially
        this._dragGhost.style.position = 'fixed';
        this._dragGhost.style.left = '-1000px';
        this._dragGhost.style.top = '-1000px';
        
        document.body.appendChild(this._dragGhost);
    }
    
    /**
     * Remove the drag ghost element
     * @private
     */
    private _removeDragGhost(): void {
        if (this._dragGhost && this._dragGhost.parentNode) {
            this._dragGhost.parentNode.removeChild(this._dragGhost);
        }
        this._dragGhost = null;
    }
    
    /**
     * Handle drag end
     * @private
     */
    private _onDragEnd(_e: DragEvent): void {
        // Remove dragging class from all rows
        this.dom.rows.forEach(row => {
            row.classList.remove('dragging', 'drag-over-before', 'drag-over-after', 'drag-over-child');
        });
        
        // Clean up ghost
        this._removeDragGhost();
        
        // Clear drag state
        this._dragState = null;
    }
    
    /**
     * Handle drag over
     * @private
     */
    private _onDragOver(e: DragEvent): void {
        if (!this._dragState) return;
        
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        
        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        const targetTaskId = row.getAttribute('data-task-id');
        if (!targetTaskId) return;
        
        // Don't allow drop on self
        if (this._dragState.taskIds.includes(targetTaskId)) return;
        
        // Clear previous drop indicators
        this.dom.rows.forEach(r => {
            r.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        });
        
        // Determine drop position based on mouse position within row
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;
        
        if (y < height * 0.25) {
            // Top quarter - insert before
            row.classList.add('drag-over-before');
            this._dragState.dropPosition = 'before';
        } else if (y > height * 0.75) {
            // Bottom quarter - insert after
            row.classList.add('drag-over-after');
            this._dragState.dropPosition = 'after';
        } else {
            // Middle - make child
            row.classList.add('drag-over-child');
            this._dragState.dropPosition = 'child';
        }
        
        this._dragState.targetTaskId = targetTaskId;
    }
    
    /**
     * Handle drag leave
     * @private
     */
    private _onDragLeave(e: DragEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.vsg-row') as HTMLElement | null;
        if (!row) return;
        
        // Only remove if actually leaving the row
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const relatedRow = relatedTarget?.closest('.vsg-row') as HTMLElement | null;
        if (relatedRow !== row) {
            row.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        }
    }
    
    /**
     * Handle drop
     * @private
     */
    private _onDrop(e: DragEvent): void {
        e.preventDefault();
        
        if (!this._dragState || !this._dragState.targetTaskId) return;
        
        const { taskIds, targetTaskId, dropPosition } = this._dragState;
        
        if (!dropPosition) return;
        
        // Clear drop indicators
        this.dom.rows.forEach(row => {
            row.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        });
        
        // Emit move event
        if (this.options.onRowMove) {
            this.options.onRowMove(taskIds, targetTaskId, dropPosition);
        }
        
        // Clean up
        this._dragState = null;
        this._removeDragGhost();
    }

    // =========================================================================
    // VIRTUAL SCROLLING LOGIC
    // =========================================================================
    
    /**
     * Measure the viewport dimensions
     * @private
     */
    private _measure(): void {
        this.viewportHeight = this.dom.viewport.clientHeight;
        this.totalHeight = this.data.length * this.options.rowHeight;
        
        // Update scroll content height
        this.dom.scrollContent.style.height = `${this.totalHeight}px`;
    }

    /**
     * Calculate how many rows fit in the viewport
     * @private
     * @returns Number of visible rows
     */
    private _getVisibleRowCount(): number {
        return Math.ceil(this.viewportHeight / this.options.rowHeight) || 20;
    }

    /**
     * Update which rows are visible based on scroll position
     * @private
     */
    private _updateVisibleRows(): void {
        const rowHeight = this.options.rowHeight;
        const buffer = this.options.bufferRows;
        const dataLength = this.data.length;
        
        if (dataLength === 0) {
            this._hideAllRows();
            return;
        }
        
        // Calculate visible range
        const rawFirstVisible = Math.floor(this.scrollTop / rowHeight);
        const visibleCount = this._getVisibleRowCount();
        
        // Add buffer zones
        this.firstVisibleIndex = Math.max(0, rawFirstVisible - buffer);
        this.lastVisibleIndex = Math.min(dataLength - 1, rawFirstVisible + visibleCount + buffer);
        
        // Update phantom spacers
        const topSpacerHeight = this.firstVisibleIndex * rowHeight;
        const bottomSpacerHeight = Math.max(0, (dataLength - this.lastVisibleIndex - 1) * rowHeight);
        
        this.dom.topSpacer.style.height = `${topSpacerHeight}px`;
        this.dom.bottomSpacer.style.height = `${bottomSpacerHeight}px`;
        
        // Recycle rows
        this._recycleRows();
        
        this._renderCount++;
    }

    /**
     * Hide all row elements
     * @private
     */
    private _hideAllRows(): void {
        this.dom.rows.forEach(row => {
            row.style.display = 'none';
        });
        this.dom.topSpacer.style.height = '0px';
        this.dom.bottomSpacer.style.height = '0px';
    }

    /**
     * Recycle row elements for the visible range
     * @private
     */
    private _recycleRows(): void {
        const visibleCount = this.lastVisibleIndex - this.firstVisibleIndex + 1;
        
        // Find rows that are being edited and should be preserved
        const editingRowElements = new Set<HTMLElement>();
        this.editingRows.forEach(taskId => {
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
            if (row) {
                editingRowElements.add(row);
            }
        });
        
        // Hide rows that are no longer needed (but preserve editing rows)
        for (let i = visibleCount; i < this.dom.rows.length; i++) {
            const row = this.dom.rows[i];
            // Don't hide rows that are being edited
            if (!editingRowElements.has(row)) {
                row.style.display = 'none';
            }
        }
        
        // Update visible rows
        for (let i = 0; i <= this.lastVisibleIndex - this.firstVisibleIndex; i++) {
            const dataIndex = this.firstVisibleIndex + i;
            const task = this.data[dataIndex];
            const row = this.dom.rows[i];
            
            if (!task || !row) continue;
            
            row.style.display = 'flex';
            this._bindRowData(row, task, dataIndex);
        }
        
        // Ensure editing rows outside visible range are still rendered
        // (they're already in the DOM, just need to be positioned correctly)
        this.editingRows.forEach(taskId => {
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
            if (row && row.style.display === 'none') {
                // Find where this task should be in the data array
                const taskIndex = this.data.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    // Keep it visible even if outside viewport
                    row.style.display = 'flex';
                    this._bindRowData(row, this.data[taskIndex], taskIndex);
                }
            }
        });
    }

    /**
     * Bind task data to a row element
     * @private
     * @param row - The row element
     * @param task - The task data
     * @param index - The data index
     */
    private _bindRowData(row: HTMLElement, task: Task, index: number): void {
        // Update row attributes
        row.setAttribute('data-task-id', task.id);
        row.setAttribute('data-index', String(index));
        
        // Update selection state
        const isSelected = this.selectedIds.has(task.id);
        row.classList.toggle('row-selected', isSelected);
        
        // Get task metadata
        const isParent = this.options.isParent ? this.options.isParent(task.id) : false;
        const depth = this.options.getDepth ? this.options.getDepth(task.id) : 0;
        const isCollapsed = task._collapsed || false;
        const isCritical = task._isCritical || false;
        
        // Update row classes
        row.classList.toggle('is-parent', isParent);
        row.classList.toggle('is-collapsed', isCollapsed);
        row.classList.toggle('is-critical', isCritical);
        
        // Update each cell
        this.options.columns?.forEach(col => {
            const cell = row.querySelector(`[data-field="${col.field}"]`) as HTMLElement | null;
            if (!cell) return;
            
            this._bindCellData(cell, col, task, { isParent, depth, isCollapsed, index });
        });
    }

    /**
     * Bind data to a specific cell
     * @private
     * @param cell - The cell element (or input inside)
     * @param col - Column definition
     * @param task - Task data
     * @param meta - Metadata (isParent, depth, etc.)
     */
    private _bindCellData(cell: HTMLElement, col: GridColumn, task: Task, meta: CellMeta): void {
        // Handle special column: actions FIRST (before early return)
        if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS && col.actions) {
            this._bindActionsCell(cell, col, task, meta);
            return; // Actions column doesn't need input handling
        }
        
        const value = getTaskFieldValue(task, col.field);
        const input = cell.classList.contains('vsg-input') || 
                     cell.classList.contains('vsg-select') ||
                     cell.classList.contains('vsg-checkbox')
                     ? cell as HTMLInputElement | HTMLSelectElement
                     : cell.querySelector('.vsg-input, .vsg-select, .vsg-checkbox, .vsg-readonly, .vsg-text') as HTMLInputElement | HTMLSelectElement | HTMLElement | null;
        
        if (!input) return;
        
        // Handle different input types
        if (input.classList.contains('vsg-checkbox')) {
            // Checkbox reflects selection state, not task data
            (input as HTMLInputElement).checked = this.selectedIds.has(task.id);
        } else if (input.classList.contains('vsg-input') || input.classList.contains('vsg-select')) {
            // Don't update if this cell is being edited
            if (this.editingCell?.taskId === task.id && this.editingCell?.field === col.field) {
                return;
            }
            (input as HTMLInputElement | HTMLSelectElement).value = value ? String(value) : '';
            
            // Handle readonly state for parent tasks and readonly columns
            const isReadonly = col.editable === false || (col.readonlyForParent && meta.isParent);
            if (isReadonly) {
                input.classList.add('cell-readonly');
                (input as HTMLInputElement | HTMLSelectElement).disabled = true;
            } else {
                input.classList.remove('cell-readonly');
                (input as HTMLInputElement | HTMLSelectElement).disabled = false;
            }
        } else {
            // Text/readonly display
            input.textContent = value ? String(value) : '';
        }
        
        // Apply cell class if specified
        if (col.cellClass) {
            cell.classList.add(...col.cellClass.split(' '));
        }
        
        // Handle special column: name with indent and collapse
        if (col.field === 'name') {
            this._bindNameCell(cell, task, meta);
        }
        
        // Handle constraint icons on date cells
        if (col.showConstraintIcon && (col.field === 'start' || col.field === 'end')) {
            this._bindConstraintIcon(cell, col, task, meta);
        }
        
        // Handle custom renderer
        if (col.renderer) {
            const container = cell.querySelector('.vsg-text, .vsg-readonly') || cell;
            const rendered = col.renderer(task, meta);
            if (typeof rendered === 'string') {
                container.innerHTML = rendered;
            }
        }
    }

    /**
     * Bind the name cell with indent and collapse button
     * @private
     */
    private _bindNameCell(cell: HTMLElement, _task: Task, meta: CellMeta): void {
        const input = cell.querySelector('.vsg-input') as HTMLInputElement | null;
        if (!input) return;
        
        // Calculate indent padding
        const indent = meta.depth * 20;
        const collapseWidth = 24;
        
        // Find or create prefix container
        let prefix = cell.querySelector('.vsg-name-prefix') as HTMLElement | null;
        if (!prefix) {
            prefix = document.createElement('div');
            prefix.className = 'vsg-name-prefix';
            prefix.style.cssText = `
                display: flex;
                align-items: center;
                flex-shrink: 0;
            `;
            cell.insertBefore(prefix, input);
        }
        
        // Update prefix content
        prefix.style.paddingLeft = `${indent}px`;
        prefix.style.width = `${indent + collapseWidth}px`;
        
        if (meta.isParent) {
            const icon = meta.isCollapsed ? 'chevron-right' : 'chevron-down';
            prefix.innerHTML = `
                <button class="vsg-collapse-btn" style="
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 4px;
                    color: #64748b;
                " data-action="collapse">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${meta.isCollapsed 
                            ? '<path d="M9 18l6-6-6-6"/>'  // chevron-right
                            : '<path d="M6 9l6 6 6-6"/>'   // chevron-down
                        }
                    </svg>
                </button>
            `;
        } else {
            prefix.innerHTML = `<span style="width: 20px;"></span>`;
        }
    }

    /**
     * Bind constraint icon to a date cell
     * @private
     */
    private _bindConstraintIcon(cell: HTMLElement, col: GridColumn, task: Task, meta: CellMeta): void {
        // Remove existing icon if any
        const existingIcon = cell.querySelector('.vsg-constraint-icon');
        if (existingIcon) {
            existingIcon.remove();
        }
        
        // Don't show icons for parent tasks
        if (meta.isParent) return;
        
        const constraintType = task.constraintType || 'asap';
        const constraintDate = task.constraintDate || '';
        
        // Determine which icon to show based on field and constraint type
        let icon: string | null = null;
        let color = '';
        let title = '';
        
        if (col.field === 'start') {
            if (constraintType === 'snet') {
                icon = '<path d="M12 8v8m0 0l-4-4m4 4l4-4"/><circle cx="12" cy="5" r="1"/>'; // Anchor-like
                color = '#3b82f6'; // Blue
                title = `Start No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'snlt') {
                icon = '<circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>'; // Clock
                color = '#f59e0b'; // Amber
                title = `Start No Later Than ${constraintDate}`;
            }
        } else if (col.field === 'end') {
            if (constraintType === 'fnet') {
                icon = '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/>'; // Hourglass
                color = '#3b82f6'; // Blue
                title = `Finish No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'fnlt') {
                icon = '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'; // Flag
                color = '#f59e0b'; // Amber
                title = `Finish No Later Than ${constraintDate}`;
            } else if (constraintType === 'mfo') {
                icon = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>'; // Lock
                color = '#ef4444'; // Red
                title = `Must Finish On ${constraintDate}`;
            }
        }
        
        if (!icon) return;
        
        // Create and insert icon element
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-constraint-icon';
        iconEl.title = title;
        iconEl.style.cssText = `
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            color: ${color};
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>`;
        
        cell.style.position = 'relative';
        cell.appendChild(iconEl);
        
        // Add padding to input to avoid overlap with icon
        const input = cell.querySelector('.vsg-input') as HTMLInputElement | null;
        if (input) {
            input.style.paddingRight = '22px';
        }
    }

    /**
     * Bind action buttons to a cell
     * @private
     */
    private _bindActionsCell(cell: HTMLElement, col: GridColumn, task: Task, meta: CellMeta): void {
        const container = cell.querySelector('.vsg-actions') as HTMLElement | null;
        if (!container) return;
        
        if (!col.actions || !Array.isArray(col.actions) || col.actions.length === 0) {
            return;
        }
        
        let html = '<div style="display: flex; align-items: center; gap: 4px; padding: 2px;">';
        let renderedCount = 0;
        
        col.actions.forEach(action => {
            // Check if action should be shown
            if (action.showIf && !action.showIf(task, meta)) {
                return;
            }
            
            renderedCount++;
            const actionName = action.name || action.id;
            const actionContent = action.icon || action.label || actionName;
            
            html += `
                <button 
                    data-action="${actionName}"
                    class="vsg-action-btn"
                    title="${action.title || actionName}"
                    style="
                        padding: 4px 6px;
                        border: none;
                        background: transparent;
                        cursor: pointer;
                        border-radius: 4px;
                        color: ${action.color || '#64748b'};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 24px;
                        min-height: 24px;
                        line-height: 1;
                    "
                >
                    ${actionContent}
                </button>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    /**
     * Set the grid data
     * @param tasks - Array of task objects
     */
    setData(tasks: Task[]): void {
        this.allData = tasks;
        this.data = tasks;
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Set filtered/visible data (after applying visibility rules)
     * @param tasks - Array of visible task objects
     */
    setVisibleData(tasks: Task[]): void {
        this.data = tasks;
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Update selection state
     * @param selectedIds - Set of selected task IDs
     * @param focusedId - Currently focused task ID
     */
    setSelection(selectedIds: Set<string>, focusedId: string | null = null): void {
        this.selectedIds = selectedIds;
        this.focusedId = focusedId;
        this._updateVisibleRows(); // Re-render to show selection
    }

    /**
     * Scroll to a specific task
     * @param taskId - The task ID to scroll to
     */
    scrollToTask(taskId: string): void {
        const index = this.data.findIndex(t => t.id === taskId);
        if (index === -1) return;
        
        const targetScroll = index * this.options.rowHeight;
        const viewportMiddle = this.viewportHeight / 2;
        
        this.dom.viewport.scrollTop = Math.max(0, targetScroll - viewportMiddle);
    }

    /**
     * Focus a specific cell for editing
     * @param taskId - The task ID
     * @param field - The field/column name to focus
     */
    focusCell(taskId: string, field: string): void {
        // Check if already visible - immediate focus
        const existingRow = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
        if (existingRow && existingRow.style.display !== 'none') {
            const cell = existingRow.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
            const input = cell?.querySelector('.vsg-input, .vsg-select') as HTMLInputElement | HTMLSelectElement | null;
            
            if (input && !input.disabled) {
                input.focus();
                if ((input as HTMLInputElement).type === 'text' || (input as HTMLInputElement).type === 'number') {
                    (input as HTMLInputElement).select();
                }
                this.editingCell = { taskId, field };
                this.editingRows.add(taskId);
                return; // Done - immediate focus!
            }
        }
        
        // Not visible - scroll first, then focus
        this.scrollToTask(taskId);
        
        // Wait for scroll and render to complete
        requestAnimationFrame(() => {
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
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
        });
    }

    /**
     * Force a full re-render
     */
    refresh(): void {
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Update column definitions and rebuild grid structure
     * Used when columns change dynamically (e.g., baseline columns added/removed)
     * @param columns - New column definitions
     */
    updateColumns(columns: GridColumn[]): void {
        console.log('[VirtualScrollGrid] Updating columns:', columns.length);
        
        // Update options
        this.options.columns = columns;
        
        // Rebuild row pool with new column structure
        // Clear existing rows
        this.dom.rowContainer.innerHTML = '';
        this.dom.rows = [];
        
        // Recreate row pool with new column structure
        this._createRowPool();
        
        // Re-render visible rows
        this._measure();
        this._updateVisibleRows();
        
        console.log('[VirtualScrollGrid] ✅ Columns updated, row pool rebuilt');
    }

    /**
     * Update a single row without full re-render
     * @param taskId - The task ID to update
     */
    updateRow(taskId: string): void {
        const task = this.data.find(t => t.id === taskId);
        const dataIndex = this.data.findIndex(t => t.id === taskId);
        
        if (!task || dataIndex < this.firstVisibleIndex || dataIndex > this.lastVisibleIndex) {
            return; // Task not visible, no update needed
        }
        
        const rowIndex = dataIndex - this.firstVisibleIndex;
        const row = this.dom.rows[rowIndex];
        
        if (row) {
            this._bindRowData(row, task, dataIndex);
        }
    }

    /**
     * Set scroll position (for sync with Gantt)
     * @param scrollTop - The scroll position
     */
    setScrollTop(scrollTop: number): void {
        if (Math.abs(this.dom.viewport.scrollTop - scrollTop) > 1) {
            this.dom.viewport.scrollTop = scrollTop;
        }
    }

    /**
     * Get current scroll position
     * @returns Current scrollTop
     */
    getScrollTop(): number {
        return this.scrollTop;
    }

    /**
     * Get render statistics (for debugging)
     * @returns Stats object
     */
    getStats(): {
        totalTasks: number;
        visibleRange: string;
        renderedRows: number;
        poolSize: number;
        renderCount: number;
    } {
        return {
            totalTasks: this.data.length,
            visibleRange: `${this.firstVisibleIndex}-${this.lastVisibleIndex}`,
            renderedRows: this.lastVisibleIndex - this.firstVisibleIndex + 1,
            poolSize: this.dom.rows.length,
            renderCount: this._renderCount,
        };
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this._scrollRAF !== null) {
            cancelAnimationFrame(this._scrollRAF);
        }
        this.container.innerHTML = '';
    }
}
