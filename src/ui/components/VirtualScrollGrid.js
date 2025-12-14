// @ts-check
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
 * USAGE:
 * ```javascript
 * const grid = new VirtualScrollGrid(containerElement, {
 *     rowHeight: 38,
 *     columns: [...],
 *     onRowClick: (task, event) => {},
 *     onCellChange: (taskId, field, value) => {},
 * });
 * grid.setData(tasks);
 * grid.setSelection(selectedIds);
 * ```
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

export class VirtualScrollGrid {
    
    // =========================================================================
    // STATIC CONFIGURATION
    // =========================================================================
    
    /** Default configuration values */
    static DEFAULTS = {
        rowHeight: 38,
        headerHeight: 50,
        bufferRows: 10,           // Extra rows above/below viewport
        scrollThrottle: 16,       // ~60fps throttle for scroll events
        editDebounce: 150,        // Debounce for input changes
    };

    /** Column type renderers */
    static COLUMN_TYPES = {
        TEXT: 'text',
        NUMBER: 'number',
        DATE: 'date',
        SELECT: 'select',
        CHECKBOX: 'checkbox',
        READONLY: 'readonly',
        ACTIONS: 'actions',
        DRAG: 'drag',             // Drag handle for row reordering
    };

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    /**
     * Create a new VirtualScrollGrid instance
     * 
     * @param {HTMLElement} container - The container element for the grid
     * @param {Object} [options={}] - Configuration options
     * @param {number} [options.rowHeight=38] - Height of each row in pixels
     * @param {Array} options.columns - Column definitions
     * @param {Function} [options.onRowClick] - Callback for row click
     * @param {Function} [options.onRowDoubleClick] - Callback for row double-click
     * @param {Function} [options.onCellChange] - Callback for cell value change
     * @param {Function} [options.onSelectionChange] - Callback for selection change
     * @param {Function} [options.onAction] - Callback for action button clicks
     * @param {Function} [options.onToggleCollapse] - Callback for collapse/expand toggle
     * @param {Function} [options.onScroll] - Callback for scroll events
     * @param {Function} [options.onRowMove] - Callback for row drag-and-drop reordering
     * @param {Function} [options.getRowClass] - Function to get additional row classes
     * @param {Function} [options.isParent] - Function to check if task is a parent
     * @param {Function} [options.getDepth] - Function to get task hierarchy depth
     */
    constructor(container, options = {}) {
        // Merge options with defaults
        this.options = { ...VirtualScrollGrid.DEFAULTS, ...options };
        
        // Core state
        this.container = container;
        this.data = [];                      // Flat array of visible tasks
        this.allData = [];                   // All tasks (for filtering)
        this.selectedIds = new Set();        // Currently selected task IDs
        this.focusedId = null;               // Currently focused task ID
        this.editingCell = null;             // Currently editing cell {taskId, field}
        this.editingRows = new Set();        // Set of task IDs being edited (preserved during scroll)
        
        // Scroll state
        this.scrollTop = 0;
        this.viewportHeight = 0;
        this.totalHeight = 0;
        this.firstVisibleIndex = 0;
        this.lastVisibleIndex = 0;
        
        // DOM element cache
        this.dom = {
            viewport: null,
            scrollContent: null,
            topSpacer: null,
            bottomSpacer: null,
            rowContainer: null,
            rows: [],                        // Pool of reusable row elements
        };
        
        // Performance tracking
        this._scrollRAF = null;              // requestAnimationFrame ID
        this._lastScrollTime = 0;
        this._renderCount = 0;               // Debug: track render calls
        
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
    _init() {
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
    _buildDOM() {
        // Clear container
        this.container.innerHTML = '';
        this.container.classList.add('vsg-container');
        
        // Create viewport (the visible scrolling area)
        this.dom.viewport = document.createElement('div');
        this.dom.viewport.className = 'vsg-viewport';
        this.dom.viewport.style.cssText = `
            height: 100%;
            overflow-y: auto;
            overflow-x: auto;
            position: relative;
        `;
        
        // Create scroll content wrapper (holds spacers + rows)
        this.dom.scrollContent = document.createElement('div');
        this.dom.scrollContent.className = 'vsg-scroll-content';
        this.dom.scrollContent.style.cssText = `
            position: relative;
            min-width: fit-content;
        `;
        
        // Create top phantom spacer
        this.dom.topSpacer = document.createElement('div');
        this.dom.topSpacer.className = 'vsg-spacer-top';
        this.dom.topSpacer.style.cssText = `
            height: 0px;
            pointer-events: none;
        `;
        
        // Create row container (holds the recycled rows)
        this.dom.rowContainer = document.createElement('div');
        this.dom.rowContainer.className = 'vsg-row-container';
        this.dom.rowContainer.style.cssText = `
            position: relative;
        `;
        
        // Create bottom phantom spacer
        this.dom.bottomSpacer = document.createElement('div');
        this.dom.bottomSpacer.className = 'vsg-spacer-bottom';
        this.dom.bottomSpacer.style.cssText = `
            height: 0px;
            pointer-events: none;
        `;
        
        // Assemble structure
        this.dom.scrollContent.appendChild(this.dom.topSpacer);
        this.dom.scrollContent.appendChild(this.dom.rowContainer);
        this.dom.scrollContent.appendChild(this.dom.bottomSpacer);
        this.dom.viewport.appendChild(this.dom.scrollContent);
        this.container.appendChild(this.dom.viewport);
        
        // Pre-create row pool
        this._createRowPool();
    }

    /**
     * Create the pool of reusable row elements
     * @private
     */
    _createRowPool() {
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
     * @returns {HTMLElement} The row element
     */
    _createRowElement() {
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
     * @param {Object} col - Column definition
     * @returns {HTMLElement} The cell element
     */
    _createCellElement(col) {
        const cell = document.createElement('div');
        cell.className = `vsg-cell col-cell`;
        cell.dataset.field = col.field;
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
     * @param {Object} col - Column definition
     * @returns {string} HTML template
     */
    _getCellTemplate(col) {
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
                const options = (col.options || []).map(o => 
                    `<option value="${o.value}">${o.label}</option>`
                ).join('');
                return `<select class="vsg-select cell-input" data-field="${col.field}">${options}</select>`;
                
            case VirtualScrollGrid.COLUMN_TYPES.READONLY:
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
    _bindEvents() {
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
        this._resizeObserver = new ResizeObserver(entries => {
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
     * @param {Event} e - Scroll event
     */
    _onScroll(e) {
        // Cancel any pending RAF
        if (this._scrollRAF) {
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
     * @param {Event} e - Click event
     */
    _onClick(e) {
        const row = e.target.closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        
        // Check for action button clicks
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (this.options.onAction) {
                this.options.onAction(taskId, action, e);
            }
            return;
        }
        
        // Check for collapse toggle
        const collapseBtn = e.target.closest('.vsg-collapse-btn');
        if (collapseBtn) {
            if (this.options.onToggleCollapse) {
                this.options.onToggleCollapse(taskId);
            }
            return;
        }
        
        // Check for checkbox - toggle selection
        const checkbox = e.target.closest('.vsg-checkbox');
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
                    };
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
        if (e.target.classList.contains('vsg-input') || 
            e.target.classList.contains('vsg-select')) {
            const field = e.target.dataset.field;
            if (field) {
                e.target.focus();
                if (e.target.type === 'text' || e.target.type === 'number') {
                    e.target.select();
                }
                this.editingCell = { taskId, field };
                this.editingRows.add(taskId);
            }
            return;
        }
        
        // If clicking on a cell (but not the input), focus the input
        const cell = e.target.closest('[data-field]');
        if (cell) {
            const field = cell.dataset.field;
            const input = cell.querySelector('.vsg-input, .vsg-select');
            if (input && !input.disabled) {
                input.focus();
                if (input.type === 'text' || input.type === 'number') {
                    input.select();
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
     * @param {Event} e - Double-click event
     */
    _onDoubleClick(e) {
        const row = e.target.closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        
        // Don't trigger if double-clicking on input
        if (e.target.classList.contains('vsg-input') || 
            e.target.classList.contains('vsg-select')) {
            return;
        }
        
        if (this.options.onRowDoubleClick) {
            this.options.onRowDoubleClick(taskId, e);
        }
    }

    /**
     * Handle input/select change events
     * @private
     * @param {Event} e - Change event
     */
    _onChange(e) {
        const input = e.target;
        if (!input.dataset.field) return;
        
        const row = input.closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        const field = input.dataset.field;
        
        // Skip checkbox changes - they're handled by row click for selection
        if (input.type === 'checkbox') {
            return;
        }
        
        let value = input.value;
        
        if (this.options.onCellChange) {
            this.options.onCellChange(taskId, field, value);
        }
    }

    /**
     * Handle blur events for text inputs
     * @private
     * @param {Event} e - Blur event
     */
    _onBlur(e) {
        const input = e.target;
        if (!input.classList.contains('vsg-input') && !input.classList.contains('vsg-select')) return;
        if (!input.dataset.field) return;
        
        const row = input.closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        const field = input.dataset.field;
        
        // For text/number inputs, fire change on blur
        if (input.type === 'text' || input.type === 'number') {
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
     * @param {Event} e - Keydown event
     */
    _onKeyDown(e) {
        const input = e.target;
        
        // Tab navigation between cells
        if (e.key === 'Tab' && (input.classList.contains('vsg-input') || input.classList.contains('vsg-select'))) {
            e.preventDefault();
            
            const row = input.closest('.vsg-row');
            if (!row) return;
            
            const taskId = row.dataset.taskId;
            const currentField = input.dataset.field;
            
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
            const row = input.closest('.vsg-row');
            const taskId = row?.dataset.taskId;
            const field = input.dataset.field;
            
            if (this.options.onCellChange && field) {
                this.options.onCellChange(taskId, field, input.value);
            }
            
            input.blur();
            
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
            const row = input.closest('.vsg-row');
            const taskId = row?.dataset.taskId;
            const field = input.dataset.field;
            const task = this.data.find(t => t.id === taskId);
            if (task && field) {
                input.value = task[field] ?? '';
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
    _onDragStart(e) {
        const handle = e.target.closest('.vsg-drag-handle');
        if (!handle) {
            e.preventDefault();
            return;
        }
        
        const row = handle.closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
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
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', taskId);
        
        // Use custom ghost
        if (this._dragGhost) {
            e.dataTransfer.setDragImage(this._dragGhost, 10, 10);
        }
    }
    
    /**
     * Create a custom drag ghost element
     * @private
     */
    _createDragGhost(task, count) {
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
    _removeDragGhost() {
        if (this._dragGhost && this._dragGhost.parentNode) {
            this._dragGhost.parentNode.removeChild(this._dragGhost);
        }
        this._dragGhost = null;
    }
    
    /**
     * Handle drag end
     * @private
     */
    _onDragEnd(e) {
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
    _onDragOver(e) {
        if (!this._dragState) return;
        
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const row = e.target.closest('.vsg-row');
        if (!row) return;
        
        const targetTaskId = row.dataset.taskId;
        
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
    _onDragLeave(e) {
        const row = e.target.closest('.vsg-row');
        if (!row) return;
        
        // Only remove if actually leaving the row
        const relatedTarget = e.relatedTarget?.closest('.vsg-row');
        if (relatedTarget !== row) {
            row.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
        }
    }
    
    /**
     * Handle drop
     * @private
     */
    _onDrop(e) {
        e.preventDefault();
        
        if (!this._dragState || !this._dragState.targetTaskId) return;
        
        const { taskIds, targetTaskId, dropPosition } = this._dragState;
        
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
    _measure() {
        this.viewportHeight = this.dom.viewport.clientHeight;
        this.totalHeight = this.data.length * this.options.rowHeight;
        
        // Update scroll content height
        this.dom.scrollContent.style.height = `${this.totalHeight}px`;
    }

    /**
     * Calculate how many rows fit in the viewport
     * @private
     * @returns {number} Number of visible rows
     */
    _getVisibleRowCount() {
        return Math.ceil(this.viewportHeight / this.options.rowHeight) || 20;
    }

    /**
     * Update which rows are visible based on scroll position
     * @private
     */
    _updateVisibleRows() {
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
    _hideAllRows() {
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
    _recycleRows() {
        const visibleCount = this.lastVisibleIndex - this.firstVisibleIndex + 1;
        
        // Find rows that are being edited and should be preserved
        const editingRowElements = new Set();
        this.editingRows.forEach(taskId => {
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`);
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
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`);
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
     * @param {HTMLElement} row - The row element
     * @param {Object} task - The task data
     * @param {number} index - The data index
     */
    _bindRowData(row, task, index) {
        // Update row attributes
        row.dataset.taskId = task.id;
        row.dataset.index = index;
        
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
            const cell = row.querySelector(`[data-field="${col.field}"]`);
            if (!cell) return;
            
            this._bindCellData(cell, col, task, { isParent, depth, isCollapsed, index });
        });
    }

    /**
     * Bind data to a specific cell
     * @private
     * @param {HTMLElement} cell - The cell element (or input inside)
     * @param {Object} col - Column definition
     * @param {Object} task - Task data
     * @param {Object} meta - Metadata (isParent, depth, etc.)
     */
    _bindCellData(cell, col, task, meta) {
        // Handle special column: actions FIRST (before early return)
        if (col.type === VirtualScrollGrid.COLUMN_TYPES.ACTIONS && col.actions) {
            this._bindActionsCell(cell, col, task, meta);
            return; // Actions column doesn't need input handling
        }
        
        const value = task[col.field];
        const input = cell.classList.contains('vsg-input') || 
                     cell.classList.contains('vsg-select') ||
                     cell.classList.contains('vsg-checkbox')
                     ? cell 
                     : cell.querySelector('.vsg-input, .vsg-select, .vsg-checkbox, .vsg-readonly, .vsg-text');
        
        if (!input) return;
        
        // Handle different input types
        if (input.classList.contains('vsg-checkbox')) {
            // Checkbox reflects selection state, not task data
            input.checked = this.selectedIds.has(task.id);
        } else if (input.classList.contains('vsg-input') || input.classList.contains('vsg-select')) {
            // Don't update if this cell is being edited
            if (this.editingCell?.taskId === task.id && this.editingCell?.field === col.field) {
                return;
            }
            input.value = value ?? '';
            
            // Handle readonly state for parent tasks
            if (col.readonlyForParent && meta.isParent) {
                input.classList.add('cell-readonly');
                input.disabled = true;
            } else {
                input.classList.remove('cell-readonly');
                input.disabled = false;
            }
        } else {
            // Text/readonly display
            input.textContent = value ?? '';
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
        if (col.render) {
            const container = cell.querySelector('.vsg-text, .vsg-readonly') || cell;
            const rendered = col.render(task, meta);
            if (typeof rendered === 'string') {
                container.innerHTML = rendered;
            }
        }
    }

    /**
     * Bind the name cell with indent and collapse button
     * @private
     */
    _bindNameCell(cell, task, meta) {
        const input = cell.querySelector('.vsg-input');
        if (!input) return;
        
        // Calculate indent padding
        const indent = meta.depth * 20;
        const collapseWidth = 24;
        
        // Find or create prefix container
        let prefix = cell.querySelector('.vsg-name-prefix');
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
    _bindConstraintIcon(cell, col, task, meta) {
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
        let icon = null;
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
        const input = cell.querySelector('.vsg-input');
        if (input) {
            input.style.paddingRight = '22px';
        }
    }

    /**
     * Bind action buttons to a cell
     * @private
     */
    _bindActionsCell(cell, col, task, meta) {
        const container = cell.querySelector('.vsg-actions');
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
     * @param {Array} tasks - Array of task objects
     */
    setData(tasks) {
        this.allData = tasks;
        this.data = tasks;
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Set filtered/visible data (after applying visibility rules)
     * @param {Array} tasks - Array of visible task objects
     */
    setVisibleData(tasks) {
        this.data = tasks;
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Update selection state
     * @param {Set} selectedIds - Set of selected task IDs
     * @param {string} focusedId - Currently focused task ID
     */
    setSelection(selectedIds, focusedId = null) {
        this.selectedIds = selectedIds;
        this.focusedId = focusedId;
        this._updateVisibleRows(); // Re-render to show selection
    }

    /**
     * Scroll to a specific task
     * @param {string} taskId - The task ID to scroll to
     */
    scrollToTask(taskId) {
        const index = this.data.findIndex(t => t.id === taskId);
        if (index === -1) return;
        
        const targetScroll = index * this.options.rowHeight;
        const viewportMiddle = this.viewportHeight / 2;
        
        this.dom.viewport.scrollTop = Math.max(0, targetScroll - viewportMiddle);
    }

    /**
     * Focus a specific cell for editing
     * @param {string} taskId - The task ID
     * @param {string} field - The field/column name to focus
     */
    focusCell(taskId, field) {
        // Check if already visible - immediate focus
        const existingRow = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`);
        if (existingRow && existingRow.style.display !== 'none') {
            const cell = existingRow.querySelector(`[data-field="${field}"]`);
            const input = cell?.querySelector('.vsg-input, .vsg-select');
            
            if (input && !input.disabled) {
                input.focus();
                if (input.type === 'text' || input.type === 'number') {
                    input.select();
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
            const row = this.dom.rowContainer.querySelector(`[data-task-id="${taskId}"]`);
            if (!row) return;
            
            const cell = row.querySelector(`[data-field="${field}"]`);
            if (!cell) return;
            
            const input = cell.querySelector('.vsg-input, .vsg-select');
            if (input && !input.disabled) {
                input.focus();
                if (input.type === 'text' || input.type === 'number') {
                    input.select();
                }
                this.editingCell = { taskId, field };
                this.editingRows.add(taskId);
            }
        });
    }

    /**
     * Force a full re-render
     */
    refresh() {
        this._measure();
        this._updateVisibleRows();
    }

    /**
     * Update a single row without full re-render
     * @param {string} taskId - The task ID to update
     */
    updateRow(taskId) {
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
     * @param {number} scrollTop - The scroll position
     */
    setScrollTop(scrollTop) {
        if (Math.abs(this.dom.viewport.scrollTop - scrollTop) > 1) {
            this.dom.viewport.scrollTop = scrollTop;
        }
    }

    /**
     * Get current scroll position
     * @returns {number} Current scrollTop
     */
    getScrollTop() {
        return this.scrollTop;
    }

    /**
     * Get render statistics (for debugging)
     * @returns {Object} Stats object
     */
    getStats() {
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
    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this._scrollRAF) {
            cancelAnimationFrame(this._scrollRAF);
        }
        this.container.innerHTML = '';
    }
}

// Export for module systems
