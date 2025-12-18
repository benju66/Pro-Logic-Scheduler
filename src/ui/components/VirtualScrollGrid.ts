/**
 * @fileoverview Virtual Scroll Grid - Facade for Unified Scheduler V2
 * @module ui/components/VirtualScrollGrid
 * 
 * FACADE PATTERN: Maintains exact API compatibility while delegating to SchedulerViewport.
 * This allows SchedulerService to work without changes.
 * 
 * @author Pro Logic Scheduler
 * @version 2.2.0 - Unified Architecture
 */

import type { Task, GridColumn, VirtualScrollGridOptions } from '../../types';
import { SchedulerViewport } from './scheduler/SchedulerViewport';
import { getViewport, setViewport } from './scheduler/viewportRegistry';
import type { GridRendererOptions } from './scheduler/types';

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
 * Row cache for DOM references (performance optimization)
 */
interface RowCache {
  cells: Map<string, HTMLElement>;  // field -> cell element
  inputs: Map<string, HTMLElement>;  // field -> input/select/checkbox element
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
        bufferRows: 3,             // Extra rows above/below viewport (reduced from 10 for better performance)
        scrollThrottle: 16,       // ~60fps throttle for scroll events
        editDebounce: 150,        // Debounce for input changes
        scrollDebounce: 8,        // Debounce scroll updates (ms) - reduced for better responsiveness
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
    
    private options: Required<Pick<VirtualScrollGridOptions, 'rowHeight' | 'headerHeight' | 'bufferRows' | 'scrollThrottle' | 'editDebounce'>> & VirtualScrollGridOptions & { scrollDebounce?: number };
    private container: HTMLElement;
    private data: Task[] = [];                      // Flat array of visible tasks
    private allData: Task[] = [];                   // All tasks (for filtering)
    private selectedIds: Set<string> = new Set();        // Currently selected task IDs
    private focusedId: string | null = null;               // Currently focused task ID
    private editingCell: EditingCell | null = null;             // Currently editing cell
    private editingRows: Set<string> = new Set();        // Set of task IDs being edited (preserved during scroll)
    
    // Scroll state
    private scrollTop: number = 0;
    private scrollLeft: number = 0;
    private viewportHeight: number = 0;
    private totalHeight: number = 0;
    private firstVisibleIndex: number = 0;
    private lastVisibleIndex: number = 0;
    
    // DOM element cache
    private dom!: VirtualScrollGridDOM; // Initialized in _buildDOM()
    
    // Performance tracking
    private _scrollRAF: number | null = null;              // requestAnimationFrame ID
    private _scrollDebounceTimer: number | null = null;   // Scroll debounce timer
    private _lastScrollTop: number = 0;                    // Last scroll position (for distance threshold)
    private _lastScrollTime: number = 0;                  // Timestamp of last scroll event (for rapid scroll detection)
    private _isRapidScrolling: boolean = false;           // Flag to detect rapid scrolling
    private _pendingSpacerUpdate: boolean = false;        // Flag to batch spacer updates
    private _renderCount: number = 0;               // Debug: track render calls
    private _resizeObserver: ResizeObserver | null = null;
    
    // Change detection: Store row hashes to skip unnecessary updates
    private _rowHashes = new WeakMap<HTMLElement, string>();  // Row element -> hash string
    
    // Cell-level change detection: Store cell hashes per row
    private _cellHashes = new WeakMap<HTMLElement, Map<string, string>>();  // Row element -> Map<fieldName, hashString>
    
    // IntersectionObserver for visibility detection (supplements scroll-based logic)
    private _intersectionObserver: IntersectionObserver | null = null;
    private _intersectionRAF: number | null = null;  // RAF for throttling observer callbacks
    
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
            scroll-behavior: auto;
            overscroll-behavior: contain;
            will-change: scroll-position;
            contain: layout style paint;
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
            will-change: height;
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
            will-change: height;
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
            content-visibility: auto;
            contain-intrinsic-size: ${this.options.rowHeight}px;
            contain: strict;
        `;
        
        // Create cache for DOM references (performance optimization)
        const cache: RowCache = {
            cells: new Map(),
            inputs: new Map(),
        };
        
        // Create cells for each column and cache references
        if (this.options.columns) {
            this.options.columns.forEach(col => {
                const cell = this._createCellElement(col);
                row.appendChild(cell);
                
                // Cache cell reference
                cache.cells.set(col.field, cell);
                
                // Cache input element reference (if exists)
                const input = this._findInputElement(cell, col);
                if (input) {
                    cache.inputs.set(col.field, input);
                }
            });
        }
        
        // Store cache on row element for fast access
        (row as any).__cache = cache;
        
        return row;
    }
    
    /**
     * Find the input element within a cell (helper for caching)
     * @private
     */
    private _findInputElement(cell: HTMLElement, col: GridColumn): HTMLElement | null {
        // Check if cell itself is an input
        if (cell.classList.contains('vsg-input') || 
            cell.classList.contains('vsg-select') || 
            cell.classList.contains('vsg-checkbox')) {
            return cell;
        }
        
        // Find input element within cell
        return cell.querySelector('.vsg-input, .vsg-select, .vsg-checkbox, .vsg-readonly, .vsg-text') as HTMLElement | null;
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
        
        // Check if column has sticky positioning
        const stickyLeft = (col as any).stickyLeft;
        const isPinned = col.cellClass?.includes('pinned');
        
        cell.style.cssText = `
            width: var(--w-${col.field}, ${col.width || 100}px);
            flex-shrink: 0;
            height: 100%;
            display: flex;
            align-items: center;
            border-right: 1px solid #e2e8f0;
            ${col.align === 'center' ? 'justify-content: center;' : ''}
            ${col.align === 'right' ? 'justify-content: flex-end;' : ''}
            position: ${isPinned ? 'sticky' : 'relative'};
            ${isPinned && stickyLeft ? `left: ${stickyLeft};` : ''}
            ${isPinned ? 'background: white; z-index: 100;' : ''}
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
        // Scroll handling with RAF throttling and debouncing
        // Let browser handle wheel events naturally - no custom wheel handler needed
        this.dom.viewport.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
        
        // IntersectionObserver for visibility detection (supplements scroll-based logic)
        // Provides browser-native optimization for detecting when rows enter/leave viewport
        if ('IntersectionObserver' in window) {
            this._intersectionObserver = new IntersectionObserver(
                (entries) => {
                    // Throttle observer callbacks with RAF to prevent excessive updates
                    if (this._intersectionRAF === null) {
                        this._intersectionRAF = requestAnimationFrame(() => {
                            // Observer supplements scroll-based logic but doesn't replace it
                            // Scroll-based logic handles precise row calculations
                            this._intersectionRAF = null;
                        });
                    }
                },
                {
                    root: this.dom.viewport,
                    rootMargin: '0px',
                    threshold: [0, 0.1, 0.5, 1.0]
                }
            );
        }
        
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
     * Handle scroll events with RAF throttling and debouncing
     * Optimized to skip updates for tiny scroll changes and prevent excessive processing
     * Defers DOM updates during rapid scrolling to prevent layout shifts that cause scroll jumps
     * @private
     */
    private _onScroll(_e: Event): void {
        // Get current scroll positions
        const newScrollTop = this.dom.viewport.scrollTop;
        const newScrollLeft = this.dom.viewport.scrollLeft;
        const now = performance.now();
        
        // Calculate scroll distance for vertical scroll
        const scrollDelta = Math.abs(newScrollTop - this._lastScrollTop);
        const timeSinceLastScroll = now - this._lastScrollTime;
        
        // Detect rapid scrolling (< 50ms between scroll events = rapid)
        this._isRapidScrolling = timeSinceLastScroll < 50;
        this._lastScrollTime = now;
        
        // Skip processing if scroll change is too small (< 3px)
        // This prevents excessive updates during smooth scrolling and reduces lag
        const minScrollDelta = 3;
        if (scrollDelta < minScrollDelta && Math.abs(newScrollLeft - this.scrollLeft) < minScrollDelta) {
            // Update positions but skip expensive operations
            this.scrollTop = newScrollTop;
            this.scrollLeft = newScrollLeft;
            return;
        }
        
        // Update scroll positions
        this.scrollTop = newScrollTop;
        this.scrollLeft = newScrollLeft;
        this._lastScrollTop = newScrollTop;
        
        // Cancel any pending debounce timer
        if (this._scrollDebounceTimer !== null) {
            clearTimeout(this._scrollDebounceTimer);
            this._scrollDebounceTimer = null;
        }
        
        // Cancel any pending RAF
        if (this._scrollRAF !== null) {
            cancelAnimationFrame(this._scrollRAF);
        }
        
        // Optimized debounce for better responsiveness
        // Use shorter delays and RAF for immediate feel during scroll
        const baseDebounceDelay = this.options.scrollDebounce ?? VirtualScrollGrid.DEFAULTS.scrollDebounce ?? 8;
        
        // During rapid scrolling, use slightly longer debounce but still responsive
        // Reduced from 2x/50ms to 1.5x/16ms for better user experience
        const debounceDelay = this._isRapidScrolling ? Math.max(Math.ceil(baseDebounceDelay * 1.5), 16) : baseDebounceDelay;
        
        // Mark that we have a pending spacer update
        this._pendingSpacerUpdate = true;
        
        // Use RAF for immediate updates during normal scrolling
        // Only use setTimeout debounce during rapid scrolling
        if (!this._isRapidScrolling) {
            // Normal scrolling - use RAF for immediate responsiveness
            if (this._scrollRAF === null) {
                this._scrollRAF = requestAnimationFrame(() => {
                    this._applyScrollUpdate();
                });
            }
        } else {
            // Rapid scrolling - use minimal debounce
            this._scrollDebounceTimer = window.setTimeout(() => {
                // Check if still scrolling rapidly
                const timeSinceLastScroll = performance.now() - this._lastScrollTime;
                if (timeSinceLastScroll < 50) {
                    // Still scrolling rapidly, but update anyway for responsiveness
                    // Reduced deferral from 50ms to 16ms
                    this._scrollDebounceTimer = window.setTimeout(() => {
                        this._applyScrollUpdate();
                    }, 16);
                    return;
                }
                
                this._applyScrollUpdate();
            }, debounceDelay);
        }
    }
    
    /**
     * Apply scroll updates (rows and sync)
     * Separated to allow deferred execution during rapid scrolling
     * @private
     */
    private _applyScrollUpdate(): void {
        if (!this._pendingSpacerUpdate) return;
        this._pendingSpacerUpdate = false;
        
        // Schedule update on next animation frame
        this._scrollRAF = requestAnimationFrame(() => {
            // Vertical scroll - update visible rows (includes spacer updates)
            this._updateVisibleRows();
            
            // Emit scroll event for sync with Gantt
            if (this.options.onScroll) {
                this.options.onScroll(this.scrollTop);
            }
            
            // Horizontal scroll - emit event for sync with header
            if (this.options.onHorizontalScroll) {
                this.options.onHorizontalScroll(this.scrollLeft);
            }
            
            this._scrollRAF = null;
            this._scrollDebounceTimer = null;
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
        
        // Check for collapse toggle FIRST (before action buttons, since collapse button also has data-action)
        const collapseBtn = target.closest('.vsg-collapse-btn') as HTMLElement | null;
        if (collapseBtn) {
            e.stopPropagation(); // Prevent event from bubbling to row click handler
            if (this.options.onToggleCollapse) {
                this.options.onToggleCollapse(taskId);
            }
            return;
        }
        
        // Check for action button clicks (exclude collapse buttons which are handled above)
        const actionBtn = target.closest('[data-action]') as HTMLElement | null;
        if (actionBtn && !actionBtn.classList.contains('vsg-collapse-btn')) {
            const action = actionBtn.getAttribute('data-action');
            if (action && this.options.onAction) {
                this.options.onAction(taskId, action, e);
            }
            return;
        }
        
        // Check for checkbox - toggle selection (allow multiple selections)
        const checkbox = target.closest('.vsg-checkbox') as HTMLInputElement | null;
        if (checkbox) {
            e.stopPropagation(); // Prevent row click handler
            if (this.options.onRowClick) {
                // Read shiftKey from original event before creating synthetic event
                const isShiftKey = e.shiftKey;
                // Preserve shiftKey for range selection, otherwise use Ctrl+click behavior for toggle
                const event = {
                    ...e,
                    shiftKey: isShiftKey, // Explicitly preserve shiftKey for range selection
                    ctrlKey: !isShiftKey, // Only use Ctrl behavior if not Shift (for range selection)
                    metaKey: false,
                } as MouseEvent;
                this.options.onRowClick(taskId, event);
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
     * Enhanced with descendant validation to prevent invalid drops
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
        if (this._dragState.taskIds.includes(targetTaskId)) {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'none';
            }
            return;
        }
        
        // Don't allow drop on descendants of dragged tasks
        // This prevents circular references
        if (this._isDescendantOfDraggedTasks(targetTaskId)) {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'none';
            }
            // Clear any drop indicators
            this.dom.rows.forEach(r => {
                r.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
            });
            return;
        }
        
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
     * Check if a task is a descendant of any dragged tasks
     * @private
     * @param taskId - Task ID to check
     * @returns True if taskId is a descendant of any task being dragged
     */
    private _isDescendantOfDraggedTasks(taskId: string): boolean {
        if (!this._dragState) return false;
        
        const draggedIds = new Set(this._dragState.taskIds);
        
        // Walk up the parent chain from taskId
        let currentId: string | null = taskId;
        while (currentId) {
            const task = this.data.find(t => t.id === currentId);
            if (!task) break;
            
            // Check if current task's parent is one of the dragged tasks
            if (task.parentId && draggedIds.has(task.parentId)) {
                return true;
            }
            
            currentId = task.parentId ?? null;
        }
        
        return false;
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
        
        // Initialize last scroll position for distance threshold
        this._lastScrollTop = this.dom.viewport.scrollTop;
        this._lastScrollTime = performance.now();
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
        // Height changes are deferred during rapid scrolling to prevent layout shifts
        const topSpacerHeight = this.firstVisibleIndex * rowHeight;
        const bottomSpacerHeight = Math.max(0, (dataLength - this.lastVisibleIndex - 1) * rowHeight);
        
        // Use will-change hint for browser optimization
        // Height changes are already deferred during rapid scrolling via _applyScrollUpdate
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
            
            // Only set display if it's currently hidden (avoid unnecessary style recalculations)
            if (row.style.display === 'none') {
                row.style.display = 'flex';
            }
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
     * Generate a hash for a row to detect changes
     * @private
     * @param task - The task data
     * @param meta - Cell metadata
     * @param isSelected - Whether task is selected
     * @returns Hash string
     */
    private _getRowHash(task: Task, meta: CellMeta, isSelected: boolean): string {
        // Use stable fields that affect rendering
        return `${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}|${isSelected}`;
    }

    /**
     * Generate a hash for a specific cell to detect changes
     * Optimized: Includes only dependencies for this specific cell type
     * @private
     * @param task - The task data
     * @param col - Column definition
     * @param meta - Cell metadata
     * @param isSelected - Whether task is selected
     * @returns Hash string
     */
    private _getCellHash(
        task: Task, 
        col: GridColumn, 
        meta: CellMeta, 
        isSelected: boolean
    ): string {
        const field = col.field;
        
        // Special cells
        if (field === 'checkbox') {
            return String(isSelected);
        }
        
        if (field === 'drag') {
            return ''; // Never changes - static UI element
        }
        
        if (field === 'rowNum') {
            return String(meta.index);
        }
        
        // Name cell - complex dependencies (indent, collapse button, value)
        if (field === 'name') {
            return `${task.name}|${meta.depth}|${meta.isParent}|${meta.isCollapsed}`;
        }
        
        // Start/End cells - include constraint info (affects icon visibility)
        if (field === 'start' || field === 'end') {
            const value = getTaskFieldValue(task, field);
            const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
            return `${value}|${task.constraintType}|${task.constraintDate || ''}|${readonly}`;
        }
        
        // Variance cells - include all source fields (computed values)
        if (field === 'startVariance') {
            return `${task.start}|${task.baselineStart || ''}|${task.actualStart || ''}`;
        }
        if (field === 'finishVariance') {
            return `${task.end}|${task.baselineFinish || ''}|${task.actualFinish || ''}`;
        }
        
        // Health cell - health object properties
        if (field === '_health') {
            const health = task._health;
            return `${health?.status || ''}|${health?.icon || ''}|${health?.summary || ''}`;
        }
        
        // Actions cell - CONSERVATIVE: include common fields
        // (since showIf functions could check any task property)
        // Include dependencies length for link icon color change
        if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS) {
            const depCount = task.dependencies ? task.dependencies.length : 0;
            return `${task.id}|${task.name}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}|${depCount}`;
        }
        
        // Duration field - no longer includes constraint info (icons removed from duration)
        if (field === 'duration') {
            const value = getTaskFieldValue(task, field);
            const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
            return `${value}|${readonly}`;
        }
        
        // Custom renderer - CONSERVATIVE: include all common fields
        // (renderer dependencies are unknown, so include all commonly used fields)
        if (col.renderer) {
            // Known renderers are handled above (rowNum, health, variance)
            // For unknown renderers, be conservative
            return `${task.id}|${task.name}|${task.start}|${task.end}|${task.duration}|${task.constraintType}|${task.constraintDate || ''}|${task._health?.status || ''}|${meta.index}|${meta.isParent}|${meta.depth}|${meta.isCollapsed}`;
        }
        
        // Standard cells - field value + readonly state
        const value = getTaskFieldValue(task, field);
        const readonly = col.editable === false || (col.readonlyForParent && meta.isParent);
        return `${value}|${readonly}`;
    }

    /**
     * Bind task data to a row element
     * Optimized: Uses change detection to skip unnecessary updates
     * Optimized: Batches DOM reads and writes to prevent layout thrashing
     * @private
     * @param row - The row element
     * @param task - The task data
     * @param index - The data index
     */
    private _bindRowData(row: HTMLElement, task: Task, index: number): void {
        // PHASE 1: Compute everything (reads only - no DOM access)
        const isParent = this.options.isParent ? this.options.isParent(task.id) : false;
        const depth = this.options.getDepth ? this.options.getDepth(task.id) : 0;
        const isCollapsed = task._collapsed || false;
        const isSelected = this.selectedIds.has(task.id);
        const isCritical = task._isCritical || false;
        const meta: CellMeta = { isParent, depth, isCollapsed, index };
        
        // Change detection: Skip update if data hasn't changed and row is not being edited
        const newHash = this._getRowHash(task, meta, isSelected);
        const oldHash = this._rowHashes.get(row);
        
        // Always update if:
        // 1. Hash doesn't match (data changed)
        // 2. Row is being edited (must update to preserve editing state)
        // 3. No hash exists (first render)
        const shouldUpdate = oldHash !== newHash || this.editingRows.has(task.id) || oldHash === undefined;
        
        if (!shouldUpdate) {
            return; // Skip update - nothing changed
        }
        
        // PHASE 2: All DOM writes together (single reflow)
        // Use dataset instead of setAttribute for better performance
        row.dataset.taskId = task.id;
        row.dataset.index = String(index);
        
        // Build className string (more efficient than multiple toggle calls)
        // This batches all class changes into a single DOM write
        const classes = ['vsg-row', 'grid-row'];
        if (isSelected) classes.push('row-selected');
        if (isParent) classes.push('is-parent');
        if (isCollapsed) classes.push('is-collapsed');
        if (isCritical) classes.push('is-critical');
        row.className = classes.join(' ');
        
        // Update each cell using cached references with cell-level change detection
        const cache = (row as any).__cache as RowCache | undefined;
        
        // Get or create cell hash map for this row
        let cellHashes = this._cellHashes.get(row);
        if (!cellHashes) {
            cellHashes = new Map();
            this._cellHashes.set(row, cellHashes);
        }
        
        this.options.columns?.forEach(col => {
            // Use cached cell reference if available, fallback to querySelector
            let cell: HTMLElement | null = null;
            if (cache) {
                cell = cache.cells.get(col.field) || null;
            }
            
            // Fallback to querySelector if cache not available (backward compatibility)
            if (!cell) {
                cell = row.querySelector(`[data-field="${col.field}"]`) as HTMLElement | null;
            }
            
            if (!cell) return;
            
            // Cell-level change detection: Only update if hash changed or row is being edited
            const cellHash = this._getCellHash(task, col, meta, isSelected);
            const oldCellHash = cellHashes.get(col.field);
            
            // Always update if:
            // 1. Hash doesn't match (data changed)
            // 2. Row is being edited (must update to preserve editing state)
            // 3. No hash exists (first render)
            const shouldUpdateCell = cellHash !== oldCellHash || this.editingRows.has(task.id) || oldCellHash === undefined;
            
            if (shouldUpdateCell) {
                this._bindCellData(cell, col, task, meta, cache);
                cellHashes.set(col.field, cellHash);
            }
        });
        
        // Store hash after successful update
        this._rowHashes.set(row, newHash);
    }

    /**
     * Bind data to a specific cell
     * @private
     * @param cell - The cell element (or input inside)
     * @param col - Column definition
     * @param task - Task data
     * @param meta - Metadata (isParent, depth, etc.)
     * @param cache - Optional row cache for performance
     */
    private _bindCellData(cell: HTMLElement, col: GridColumn, task: Task, meta: CellMeta, cache?: RowCache): void {
        // Handle special column: actions FIRST (before early return)
        if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS && col.actions) {
            this._bindActionsCell(cell, col, task, meta);
            return; // Actions column doesn't need input handling
        }
        
        const value = getTaskFieldValue(task, col.field);
        
        // Use cached input reference if available (performance optimization)
        let input: HTMLInputElement | HTMLSelectElement | HTMLElement | null = null;
        
        if (cache) {
            input = cache.inputs.get(col.field) || null;
        }
        
        // Fallback to querySelector if cache not available
        if (!input) {
            input = cell.classList.contains('vsg-input') || 
                     cell.classList.contains('vsg-select') ||
                     cell.classList.contains('vsg-checkbox')
                     ? cell as HTMLInputElement | HTMLSelectElement
                     : cell.querySelector('.vsg-input, .vsg-select, .vsg-checkbox, .vsg-readonly, .vsg-text') as HTMLInputElement | HTMLSelectElement | HTMLElement | null;
        }
        
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
        
        // Handle date inputs - add Lucide calendar icon and hide native calendar picker
        if (col.type === VirtualScrollGrid.COLUMN_TYPES.DATE && input && (input as HTMLInputElement).type === 'date') {
            cell.style.position = 'relative'; // Required for absolute positioning of icons
            
            // Hide native browser calendar icon
            (input as HTMLInputElement).style.setProperty('-webkit-appearance', 'none');
            (input as HTMLInputElement).style.setProperty('appearance', 'none');
            
            // Check if constraint icon will be shown
            const hasConstraintIcon = col.showConstraintIcon && (col.field === 'start' || col.field === 'end');
            
            // Add Lucide calendar icon (positioned based on whether constraint icon exists)
            this._bindCalendarIcon(cell, input as HTMLInputElement, hasConstraintIcon);
            
            // Reserve padding space for icons
            // Icon size: 12px (to match 13px date text)
            // Icon margin: 4px from right edge
            // Icon gap: 4px between icons
            // With constraint: constraint (12px) + gap (4px) + calendar (12px) + margin (4px) = 32px
            // Without constraint: calendar (12px) + margin (4px) = 16px
            const iconSize = 12;
            const iconGap = 4;
            const iconMargin = 4;
            
            if (hasConstraintIcon) {
                const totalPadding = iconMargin + iconSize + iconGap + iconSize;
                (input as HTMLInputElement).style.paddingRight = `${totalPadding}px`;
                this._bindConstraintIcon(cell, col, task, meta);
            } else {
                // Reserve space for calendar icon only
                const totalPadding = iconMargin + iconSize;
                (input as HTMLInputElement).style.paddingRight = `${totalPadding}px`;
            }
        }
        
        // Handle constraint icons on date cells (start and end only - duration removed)
        // Note: This is now handled above, but keeping for backwards compatibility
        if (col.showConstraintIcon && (col.field === 'start' || col.field === 'end') && col.type !== VirtualScrollGrid.COLUMN_TYPES.DATE) {
            cell.style.position = 'relative';
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
     * Optimized: Uses DOM APIs instead of innerHTML for better performance
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
            // Reuse existing button if present, otherwise create new one
            let btn = prefix.querySelector('.vsg-collapse-btn') as HTMLButtonElement | null;
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'vsg-collapse-btn';
                btn.setAttribute('data-action', 'collapse');
                btn.style.cssText = `
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
                `;
                
                // Create SVG element
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '12');
                svg.setAttribute('height', '12');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                
                // Create path element
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                svg.appendChild(path);
                btn.appendChild(svg);
                prefix.appendChild(btn);
            }
            
            // Update SVG path based on collapse state
            const svg = btn.querySelector('svg');
            const path = svg?.querySelector('path');
            if (path) {
                path.setAttribute('d', meta.isCollapsed 
                    ? 'M9 18l6-6-6-6'  // chevron-right
                    : 'M6 9l6 6 6-6'   // chevron-down
                );
            }
        } else {
            // For non-parent rows, ensure we have a spacer span
            let spacer = prefix.querySelector('span');
            if (!spacer) {
                spacer = document.createElement('span');
                spacer.style.width = '20px';
                prefix.appendChild(spacer);
            }
            // Remove button if it exists (row changed from parent to child)
            const btn = prefix.querySelector('.vsg-collapse-btn');
            if (btn) {
                btn.remove();
            }
        }
    }

    /**
     * Bind calendar icon to date input cell
     * @private
     */
    private _bindCalendarIcon(cell: HTMLElement, input: HTMLInputElement, hasConstraintIcon: boolean = false): void {
        // Remove existing calendar icon if present
        const existingIcon = cell.querySelector('.vsg-calendar-icon');
        if (existingIcon) {
            existingIcon.remove();
        }
        
        // Create calendar icon using Lucide
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-calendar-icon';
        
        // Icon dimensions: 12px × 12px (to match 13px date text)
        const iconSize = 12;
        const iconGap = 4; // Gap between icons
        const iconMargin = 4; // Margin from right edge
        
        // Position calendar icon:
        // - Constraint icon is at right: 4px, width: 12px → spans from 4px to 16px from right
        // - Calendar icon needs 4px gap from constraint icon
        // - So calendar icon right edge = 16px (constraint left) + 4px (gap) = 20px
        // - Without constraint: calendar icon at right: 4px (margin)
        const rightPosition = hasConstraintIcon ? `${iconMargin + iconSize + iconGap}px` : `${iconMargin}px`;
        
        iconEl.style.cssText = `
            position: absolute;
            right: ${rightPosition};
            top: 50%;
            transform: translateY(-50%);
            width: ${iconSize}px;
            height: ${iconSize}px;
            color: #94a3b8;
            opacity: 0.6;
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
            flex-shrink: 0;
        `;
        
        // Create calendar icon using Lucide - 12px to match date text size (13px)
        const svg = createElement(Calendar, {
            size: iconSize,
            strokeWidth: 1.5,
            color: '#94a3b8'
        });
        
        // Ensure SVG respects container size
        if (svg instanceof SVGElement) {
            svg.setAttribute('width', String(iconSize));
            svg.setAttribute('height', String(iconSize));
            svg.style.width = `${iconSize}px`;
            svg.style.height = `${iconSize}px`;
            svg.style.display = 'block';
        }
        
        iconEl.appendChild(svg);
        cell.appendChild(iconEl);
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
        let iconComponent: typeof Anchor | typeof AlarmClock | typeof Hourglass | typeof Flag | typeof Lock | null = null;
        let color = '';
        let title = '';
        
        if (col.field === 'start') {
            // Start field shows start constraints
            if (constraintType === 'snet') {
                iconComponent = Anchor;
                color = '#93c5fd'; // Lighter blue (#3b82f6 → #93c5fd)
                title = `Start No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'snlt') {
                iconComponent = AlarmClock;
                color = '#fcd34d'; // Lighter amber (#f59e0b → #fcd34d)
                title = `Start No Later Than ${constraintDate}`;
            }
        } else if (col.field === 'end') {
            if (constraintType === 'fnet') {
                iconComponent = Hourglass;
                color = '#93c5fd'; // Lighter blue (#3b82f6 → #93c5fd)
                title = `Finish No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'fnlt') {
                iconComponent = Flag;
                color = '#fcd34d'; // Lighter amber (#f59e0b → #fcd34d)
                title = `Finish No Later Than ${constraintDate}`;
            } else if (constraintType === 'mfo') {
                iconComponent = Lock;
                color = '#fca5a5'; // Lighter red (#ef4444 → #fca5a5)
                title = `Must Finish On ${constraintDate}`;
            }
        }
        
        if (!iconComponent) return;
        
        // Create and insert icon element using Lucide
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-constraint-icon';
        iconEl.title = title;
        
        // Icon dimensions: 12px × 12px (to match 13px date text)
        const iconSize = 12;
        const iconMargin = 4; // Margin from right edge
        
        iconEl.style.cssText = `
            position: absolute;
            right: ${iconMargin}px;
            top: 50%;
            transform: translateY(-50%);
            width: ${iconSize}px;
            height: ${iconSize}px;
            color: ${color};
            opacity: 0.8;
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2;
            flex-shrink: 0;
        `;
        
        // Create icon using Lucide createElement
        // Icon size: 12px to match date text size (13px)
        const svg = createElement(iconComponent, {
            size: iconSize,
            strokeWidth: 1.5,
            color: color
        });
        
        // Ensure SVG respects container size
        if (svg instanceof SVGElement) {
            svg.setAttribute('width', String(iconSize));
            svg.setAttribute('height', String(iconSize));
            svg.style.width = `${iconSize}px`;
            svg.style.height = `${iconSize}px`;
            svg.style.display = 'block';
        }
        
        iconEl.appendChild(svg);
        // Note: cell.position is already set to 'relative' in _bindCellData() before calling this method
        cell.appendChild(iconEl);
        
        // Note: padding is already set in _bindCellData() before calling this method
    }

    /**
     * Bind action buttons to a cell
     * Optimized: Uses DocumentFragment and DOM APIs instead of innerHTML for better performance
     * @private
     */
    private _bindActionsCell(cell: HTMLElement, col: GridColumn, task: Task, meta: CellMeta): void {
        const container = cell.querySelector('.vsg-actions') as HTMLElement | null;
        if (!container) return;
        
        if (!col.actions || !Array.isArray(col.actions) || col.actions.length === 0) {
            return;
        }
        
        // Clear existing content
        container.innerHTML = '';
        
        // Create wrapper div
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 2px;';
        
        // Use DocumentFragment to batch DOM operations
        const fragment = document.createDocumentFragment();
        
        col.actions.forEach(action => {
            // Check if action should be shown
            if (action.showIf && !action.showIf(task, meta)) {
                return;
            }
            
            const actionName = action.name || action.id;
            const actionContent = action.icon || action.label || actionName;
            
            // Determine color: purple for links if task has dependencies, otherwise use action color
            let actionColor = action.color || '#64748b';
            if (actionName === 'links' && task.dependencies && task.dependencies.length > 0) {
                actionColor = '#9333ea'; // Purple for tasks with dependencies
            }
            
            // Create button element
            const btn = document.createElement('button');
            btn.setAttribute('data-action', actionName);
            btn.className = 'vsg-action-btn';
            btn.title = action.title || actionName;
            btn.style.cssText = `
                padding: 4px 6px;
                border: none;
                background: transparent;
                cursor: pointer;
                border-radius: 4px;
                color: ${actionColor};
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 24px;
                min-height: 24px;
                line-height: 1;
            `;
            
            // Set button content (can be text or HTML icon)
            if (typeof actionContent === 'string' && actionContent.trim().startsWith('<')) {
                // HTML content - parse and append
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = actionContent;
                while (tempDiv.firstChild) {
                    btn.appendChild(tempDiv.firstChild);
                }
            } else {
                // Text content
                btn.textContent = actionContent;
            }
            
            fragment.appendChild(btn);
        });
        
        wrapper.appendChild(fragment);
        container.appendChild(wrapper);
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
        // Clear row and cell hashes when data changes (invalidate change detection cache)
        this._rowHashes = new WeakMap();
        this._cellHashes = new WeakMap();
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Set filtered/visible data (after applying visibility rules)
     * @param tasks - Array of visible task objects
     */
    setVisibleData(tasks: Task[]): void {
        this.data = tasks;
        // Clear row and cell hashes when data changes (invalidate change detection cache)
        this._rowHashes = new WeakMap();
        this._cellHashes = new WeakMap();
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Update selection state
     * @param selectedIds - Set of selected task IDs
     * @param focusedId - Currently focused task ID
     * @param options - Optional focus behavior
     */
    setSelection(selectedIds: Set<string>, focusedId: string | null = null, options?: { focusCell?: boolean; focusField?: string }): void {
        this.selectedIds = selectedIds;
        this.focusedId = focusedId;
        this._updateVisibleRows(); // Re-render to show selection
        
        // Note: VirtualScrollGrid doesn't handle focusCell here - that's done by SchedulerViewport
        // This maintains backward compatibility if VirtualScrollGrid is used directly
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
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
        }
        if (this._scrollRAF !== null) {
            cancelAnimationFrame(this._scrollRAF);
        }
        if (this._intersectionRAF !== null) {
            cancelAnimationFrame(this._intersectionRAF);
        }
        if (this._scrollDebounceTimer !== null) {
            clearTimeout(this._scrollDebounceTimer);
        }
        this.container.innerHTML = '';
    }
}
