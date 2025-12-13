// @ts-check
/**
 * ============================================================================
 * CanvasGantt.js
 * ============================================================================
 * 
 * A high-performance Gantt chart renderer using HTML5 Canvas API.
 * Designed to render 10,000+ tasks at 60 FPS.
 * 
 * ARCHITECTURE:
 * â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 * â”‚  Container                                                      â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
 * â”‚  â”‚  Header Canvas (fixed position - timeline/dates)          â”‚  â”‚
 * â”‚  â”‚  [Mon 1/6] [Tue 1/7] [Wed 1/8] [Thu 1/9] [Fri 1/10] ...  â”‚  â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
 * â”‚  â”‚  Main Canvas (scrollable - bars, dependencies, grid)      â”‚  â”‚
 * â”‚  â”‚  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘                                    â”‚  â”‚
 * â”‚  â”‚      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ                             â”‚  â”‚
 * â”‚  â”‚          â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘                                 â”‚  â”‚
 * â”‚  â”‚              â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ                         â”‚  â”‚
 * â”‚  â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”‚  â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
 * â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 * 
 * COORDINATE SYSTEM:
 * - X axis: Time (pixels from project start)
 *   x = (date - projectStart) * pixelsPerDay
 * - Y axis: Task index (row number)
 *   y = rowIndex * rowHeight
 * 
 * RENDERING PIPELINE:
 * 1. Clear canvas
 * 2. Draw grid lines (vertical date lines, horizontal row lines)
 * 3. Draw today marker
 * 4. Draw dependency arrows (behind bars)
 * 5. Draw task bars (with progress fill)
 * 6. Draw labels (task names on bars if space)
 * 7. Draw selection highlight
 * 
 * PERFORMANCE TECHNIQUES:
 * 1. Only draw visible viewport (culling)
 * 2. Use requestAnimationFrame for render loop
 * 3. Batch similar draw operations
 * 4. Cache computed values (date positions, colors)
 * 5. Use offscreen canvas for complex static elements
 * 6. Dirty flag to skip unnecessary redraws
 * 
 * USAGE:
 * ```javascript
 * const gantt = new CanvasGantt(containerElement, {
 *     rowHeight: 38,
 *     headerHeight: 50,
 *     onBarClick: (task, event) => {},
 *     onBarDrag: (task, newStart, newEnd) => {},
 * });
 * gantt.setData(tasks);
 * gantt.setViewMode('Week'); // 'Day', 'Week', 'Month'
 * ```
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

export class CanvasGantt {
    
    // =========================================================================
    // STATIC CONFIGURATION
    // =========================================================================
    
    /** View mode configurations */
    static VIEW_MODES = {
        Day: { 
            pixelsPerDay: 40,
            headerFormat: 'day',
            gridInterval: 1,
            majorInterval: 7,
        },
        Week: { 
            pixelsPerDay: 20,
            headerFormat: 'week',
            gridInterval: 1,
            majorInterval: 7,
        },
        Month: { 
            pixelsPerDay: 6,
            headerFormat: 'month',
            gridInterval: 7,
            majorInterval: 30,
        },
    };

    /** Default configuration */
    static DEFAULTS = {
        rowHeight: 38,
        headerHeight: 50,
        barHeight: 20,
        barPadding: 9,           // (rowHeight - barHeight) / 2
        barRadius: 3,
        minBarWidth: 10,
        
        // Colors
        colors: {
            background: '#f8fafc',
            gridLine: '#e2e8f0',
            gridLineMajor: '#cbd5e1',
            headerBg: '#f8fafc',
            headerText: '#64748b',
            barNormal: '#93c5fd',
            barCritical: '#f87171',
            barCriticalStroke: '#dc2626',
            barParent: '#334155',
            barProgress: '#3b82f6',
            barSelected: '#6366f1',
            barHover: '#a5b4fc',
            dependency: '#94a3b8',
            dependencyArrow: '#64748b',
            todayLine: '#ef4444',
            weekendBg: 'rgba(241, 245, 249, 0.5)',
            selectionBg: 'rgba(99, 102, 241, 0.1)',
        },
        
        // Fonts
        fonts: {
            header: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            barLabel: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
    };

    /** Milliseconds per day */
    static MS_PER_DAY = 86400000;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    /**
     * Create a new CanvasGantt instance
     * 
     * @param {HTMLElement} container - The container element
     * @param {Object} options - Configuration options
     */
    constructor(container, options = {}) {
        // Merge options with defaults
        this.options = this._mergeOptions(CanvasGantt.DEFAULTS, options);
        
        // Core state
        this.container = container;
        this.data = [];                          // Array of visible tasks
        this.taskMap = new Map();                // Quick lookup by ID
        this.selectedIds = new Set();
        this.hoveredTaskId = null;
        this.dragState = null;                   // Active drag operation
        
        // View state
        this.viewMode = 'Week';
        this.scrollX = 0;
        this.scrollY = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        
        // Time range
        this.projectStart = null;                // Earliest task start
        this.projectEnd = null;                  // Latest task end
        this.timelineStart = null;               // Visible timeline start
        this.timelineEnd = null;                 // Visible timeline end
        this.pixelsPerDay = 20;
        
        // Canvas elements
        this.dom = {
            wrapper: null,
            headerCanvas: null,
            headerCtx: null,
            mainCanvas: null,
            mainCtx: null,
            scrollContainer: null,
            scrollContent: null,
        };
        
        // Render state
        this._dirty = true;
        this._rafId = null;
        this._lastRenderTime = 0;
        
        // Cached calculations
        this._cache = {
            datePositions: new Map(),
            barPositions: [],
        };
        
        // Initialize
        this._init();
    }

    /**
     * Deep merge options with defaults
     * @private
     */
    _mergeOptions(defaults, options) {
        const result = { ...defaults };
        for (const key in options) {
            if (options[key] && typeof options[key] === 'object' && !Array.isArray(options[key])) {
                result[key] = this._mergeOptions(defaults[key] || {}, options[key]);
            } else {
                result[key] = options[key];
            }
        }
        return result;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize the Gantt chart
     * @private
     */
    _init() {
        this._buildDOM();
        this._bindEvents();
        this._measure();
        this._startRenderLoop();
        
        console.log('[CanvasGantt] Initialized', {
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
        });
    }

    /**
     * Build the DOM structure
     * @private
     */
    _buildDOM() {
        this.container.innerHTML = '';
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';
        
        // Create wrapper
        this.dom.wrapper = document.createElement('div');
        this.dom.wrapper.className = 'cg-wrapper';
        this.dom.wrapper.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
        `;
        
        // Create header canvas (fixed at top)
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'cg-header-wrapper';
        headerWrapper.style.cssText = `
            position: relative;
            height: ${this.options.headerHeight}px;
            flex-shrink: 0;
            overflow: hidden;
        `;
        
        this.dom.headerCanvas = document.createElement('canvas');
        this.dom.headerCanvas.className = 'cg-header-canvas';
        this.dom.headerCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
        `;
        headerWrapper.appendChild(this.dom.headerCanvas);
        this.dom.headerCtx = this.dom.headerCanvas.getContext('2d');
        
        // Create scroll container for main canvas
        this.dom.scrollContainer = document.createElement('div');
        this.dom.scrollContainer.className = 'cg-scroll-container';
        this.dom.scrollContainer.style.cssText = `
            flex: 1;
            overflow: auto;
            position: relative;
        `;
        
        // Create scroll content (sized to full timeline/tasks)
        this.dom.scrollContent = document.createElement('div');
        this.dom.scrollContent.className = 'cg-scroll-content';
        this.dom.scrollContent.style.cssText = `
            position: relative;
        `;
        
        // Create main canvas
        this.dom.mainCanvas = document.createElement('canvas');
        this.dom.mainCanvas.className = 'cg-main-canvas';
        this.dom.mainCanvas.style.cssText = `
            position: sticky;
            top: 0;
            left: 0;
        `;
        this.dom.mainCtx = this.dom.mainCanvas.getContext('2d');
        
        // Assemble structure
        this.dom.scrollContent.appendChild(this.dom.mainCanvas);
        this.dom.scrollContainer.appendChild(this.dom.scrollContent);
        this.dom.wrapper.appendChild(headerWrapper);
        this.dom.wrapper.appendChild(this.dom.scrollContainer);
        this.container.appendChild(this.dom.wrapper);
    }

    /**
     * Bind event listeners
     * @private
     */
    _bindEvents() {
        // Scroll handling
        this.dom.scrollContainer.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
        
        // Mouse interactions on main canvas
        this.dom.mainCanvas.addEventListener('mousemove', this._onMouseMove.bind(this));
        this.dom.mainCanvas.addEventListener('mousedown', this._onMouseDown.bind(this));
        this.dom.mainCanvas.addEventListener('mouseup', this._onMouseUp.bind(this));
        this.dom.mainCanvas.addEventListener('mouseleave', this._onMouseLeave.bind(this));
        this.dom.mainCanvas.addEventListener('click', this._onClick.bind(this));
        this.dom.mainCanvas.addEventListener('dblclick', this._onDoubleClick.bind(this));
        
        // Resize observer
        this._resizeObserver = new ResizeObserver(() => {
            this._measure();
            this._dirty = true;
        });
        this._resizeObserver.observe(this.container);
    }

    /**
     * Measure and size canvases
     * @private
     */
    _measure() {
        const rect = this.container.getBoundingClientRect();
        this.viewportWidth = rect.width;
        this.viewportHeight = rect.height - this.options.headerHeight;
        
        // Account for device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        
        // Size header canvas
        this.dom.headerCanvas.width = this.viewportWidth * dpr;
        this.dom.headerCanvas.height = this.options.headerHeight * dpr;
        this.dom.headerCanvas.style.width = `${this.viewportWidth}px`;
        this.dom.headerCanvas.style.height = `${this.options.headerHeight}px`;
        this.dom.headerCtx.scale(dpr, dpr);
        
        // Size main canvas
        this.dom.mainCanvas.width = this.viewportWidth * dpr;
        this.dom.mainCanvas.height = this.viewportHeight * dpr;
        this.dom.mainCanvas.style.width = `${this.viewportWidth}px`;
        this.dom.mainCanvas.style.height = `${this.viewportHeight}px`;
        this.dom.mainCtx.scale(dpr, dpr);
        
        // Update scroll content size
        this._updateScrollContentSize();
    }

    /**
     * Update scroll content dimensions based on data
     * @private
     */
    _updateScrollContentSize() {
        if (!this.timelineStart || !this.timelineEnd) return;
        
        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);
        const totalWidth = totalDays * this.pixelsPerDay;
        const totalHeight = this.data.length * this.options.rowHeight;
        
        this.dom.scrollContent.style.width = `${Math.max(totalWidth, this.viewportWidth)}px`;
        this.dom.scrollContent.style.height = `${Math.max(totalHeight, this.viewportHeight)}px`;
    }

    // =========================================================================
    // RENDER LOOP
    // =========================================================================
    
    /**
     * Start the render loop
     * @private
     */
    _startRenderLoop() {
        const loop = (timestamp) => {
            if (this._dirty) {
                this._render(timestamp);
                this._dirty = false;
            }
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    /**
     * Main render function
     * @private
     */
    _render(timestamp) {
        const startTime = performance.now();
        
        this._renderHeader();
        this._renderMain();
        
        this._lastRenderTime = performance.now() - startTime;
    }

    /**
     * Render the header (timeline)
     * @private
     */
    _renderHeader() {
        const ctx = this.dom.headerCtx;
        const width = this.viewportWidth;
        const height = this.options.headerHeight;
        const colors = this.options.colors;
        
        // Clear
        ctx.fillStyle = colors.headerBg;
        ctx.fillRect(0, 0, width, height);
        
        // Draw border
        ctx.strokeStyle = colors.gridLineMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 0.5);
        ctx.lineTo(width, height - 0.5);
        ctx.stroke();
        
        if (!this.timelineStart) return;
        
        const viewMode = CanvasGantt.VIEW_MODES[this.viewMode];
        const startDate = this._addDays(this.timelineStart, Math.floor(this.scrollX / this.pixelsPerDay));
        const visibleDays = Math.ceil(width / this.pixelsPerDay) + 2;
        
        ctx.font = this.options.fonts.header;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw based on view mode
        if (this.viewMode === 'Day') {
            this._renderHeaderDays(ctx, startDate, visibleDays);
        } else if (this.viewMode === 'Week') {
            this._renderHeaderWeeks(ctx, startDate, visibleDays);
        } else {
            this._renderHeaderMonths(ctx, startDate, visibleDays);
        }
    }

    /**
     * Render day-level header
     * @private
     */
    _renderHeaderDays(ctx, startDate, visibleDays) {
        const colors = this.options.colors;
        const height = this.options.headerHeight;
        const ppd = this.pixelsPerDay;
        const offsetX = this.scrollX % ppd;
        
        for (let i = -1; i < visibleDays; i++) {
            const date = this._addDays(startDate, i);
            const x = (i * ppd) - offsetX;
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            // Draw cell background
            if (isWeekend) {
                ctx.fillStyle = colors.weekendBg;
                ctx.fillRect(x, 0, ppd, height);
            }
            
            // Draw vertical line
            ctx.strokeStyle = dayOfWeek === 1 ? colors.gridLineMajor : colors.gridLine;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
            ctx.stroke();
            
            // Draw label
            ctx.fillStyle = colors.headerText;
            const label = this._formatDate(date, 'day');
            ctx.fillText(label, x + ppd / 2, height / 2);
        }
    }

    /**
     * Render week-level header
     * @private
     */
    _renderHeaderWeeks(ctx, startDate, visibleDays) {
        const colors = this.options.colors;
        const height = this.options.headerHeight;
        const ppd = this.pixelsPerDay;
        const offsetX = this.scrollX % ppd;
        
        // Draw day lines and weekend shading
        for (let i = -1; i < visibleDays; i++) {
            const date = this._addDays(startDate, i);
            const x = (i * ppd) - offsetX;
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isMonday = dayOfWeek === 1;
            
            // Weekend background
            if (isWeekend) {
                ctx.fillStyle = colors.weekendBg;
                ctx.fillRect(x, 0, ppd, height);
            }
            
            // Vertical grid lines
            ctx.strokeStyle = isMonday ? colors.gridLineMajor : colors.gridLine;
            ctx.lineWidth = isMonday ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
            ctx.stroke();
            
            // Week label on Monday
            if (isMonday) {
                ctx.fillStyle = colors.headerText;
                const weekWidth = 7 * ppd;
                const label = this._formatDate(date, 'week');
                ctx.fillText(label, x + weekWidth / 2, height / 2);
            }
        }
    }

    /**
     * Render month-level header
     * @private
     */
    _renderHeaderMonths(ctx, startDate, visibleDays) {
        const colors = this.options.colors;
        const height = this.options.headerHeight;
        const ppd = this.pixelsPerDay;
        const offsetX = this.scrollX % ppd;
        
        let lastMonth = -1;
        let monthStartX = 0;
        
        for (let i = -1; i < visibleDays; i++) {
            const date = this._addDays(startDate, i);
            const x = (i * ppd) - offsetX;
            const month = date.getMonth();
            const isFirstOfMonth = date.getDate() === 1;
            
            // Draw month separator
            if (isFirstOfMonth || month !== lastMonth) {
                if (lastMonth !== -1) {
                    // Draw label for previous month
                    const prevDate = this._addDays(date, -1);
                    const label = this._formatDate(prevDate, 'month');
                    ctx.fillStyle = colors.headerText;
                    ctx.fillText(label, (monthStartX + x) / 2, height / 2);
                }
                
                ctx.strokeStyle = colors.gridLineMajor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, height);
                ctx.stroke();
                
                lastMonth = month;
                monthStartX = x;
            }
        }
        
        // Draw label for last visible month
        const lastX = (visibleDays * ppd) - offsetX;
        const label = this._formatDate(this._addDays(startDate, visibleDays - 1), 'month');
        ctx.fillStyle = colors.headerText;
        ctx.fillText(label, (monthStartX + lastX) / 2, height / 2);
    }

    /**
     * Render the main canvas (bars, grid, dependencies)
     * @private
     */
    _renderMain() {
        const ctx = this.dom.mainCtx;
        const width = this.viewportWidth;
        const height = this.viewportHeight;
        const colors = this.options.colors;
        
        // Clear
        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, width, height);
        
        if (this.data.length === 0 || !this.timelineStart) {
            this._renderEmptyState(ctx);
            return;
        }
        
        // Calculate visible range
        const firstVisibleRow = Math.floor(this.scrollY / this.options.rowHeight);
        const lastVisibleRow = Math.min(
            this.data.length - 1,
            Math.ceil((this.scrollY + height) / this.options.rowHeight)
        );
        
        // Render layers (back to front)
        this._renderGridLines(ctx, firstVisibleRow, lastVisibleRow);
        this._renderWeekendShading(ctx, firstVisibleRow, lastVisibleRow);
        this._renderTodayLine(ctx);
        this._renderDependencies(ctx, firstVisibleRow, lastVisibleRow);
        this._renderBars(ctx, firstVisibleRow, lastVisibleRow);
        this._renderSelectionHighlight(ctx, firstVisibleRow, lastVisibleRow);
    }

    /**
     * Render empty state message
     * @private
     */
    _renderEmptyState(ctx) {
        ctx.fillStyle = this.options.colors.headerText;
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No tasks with dates', this.viewportWidth / 2, this.viewportHeight / 2);
    }

    /**
     * Render horizontal and vertical grid lines
     * @private
     */
    _renderGridLines(ctx, firstRow, lastRow) {
        const colors = this.options.colors;
        const rowHeight = this.options.rowHeight;
        const ppd = this.pixelsPerDay;
        const width = this.viewportWidth;
        const offsetY = this.scrollY % rowHeight;
        const offsetX = this.scrollX % ppd;
        
        ctx.strokeStyle = colors.gridLine;
        ctx.lineWidth = 0.5;
        
        // Horizontal row lines
        ctx.beginPath();
        for (let i = 0; i <= lastRow - firstRow + 1; i++) {
            const y = (i * rowHeight) - offsetY + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
        
        // Vertical day lines
        const visibleDays = Math.ceil(width / ppd) + 2;
        const startDate = this._addDays(this.timelineStart, Math.floor(this.scrollX / ppd));
        
        ctx.beginPath();
        for (let i = 0; i < visibleDays; i++) {
            const date = this._addDays(startDate, i);
            const x = (i * ppd) - offsetX + 0.5;
            const dayOfWeek = date.getDay();
            
            // Thicker line on Mondays
            if (dayOfWeek === 1) {
                ctx.stroke(); // Finish thin lines
                ctx.strokeStyle = colors.gridLineMajor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.viewportHeight);
                ctx.stroke();
                ctx.strokeStyle = colors.gridLine;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
            } else {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.viewportHeight);
            }
        }
        ctx.stroke();
    }

    /**
     * Render weekend shading
     * @private
     */
    _renderWeekendShading(ctx, firstRow, lastRow) {
        const colors = this.options.colors;
        const ppd = this.pixelsPerDay;
        const height = this.viewportHeight;
        const offsetX = this.scrollX % ppd;
        const visibleDays = Math.ceil(this.viewportWidth / ppd) + 2;
        const startDate = this._addDays(this.timelineStart, Math.floor(this.scrollX / ppd));
        
        ctx.fillStyle = colors.weekendBg;
        
        for (let i = 0; i < visibleDays; i++) {
            const date = this._addDays(startDate, i);
            const dayOfWeek = date.getDay();
            
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                const x = (i * ppd) - offsetX;
                ctx.fillRect(x, 0, ppd, height);
            }
        }
    }

    /**
     * Render today marker line
     * @private
     */
    _renderTodayLine(ctx) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (today < this.timelineStart || today > this.timelineEnd) return;
        
        const x = this._dateToX(today);
        if (x < 0 || x > this.viewportWidth) return;
        
        ctx.strokeStyle = this.options.colors.todayLine;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, this.viewportHeight);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * Render dependency arrows
     * @private
     */
    _renderDependencies(ctx, firstRow, lastRow) {
        const colors = this.options.colors;
        const rowHeight = this.options.rowHeight;
        const barHeight = this.options.barHeight;
        const barPadding = this.options.barPadding;
        
        ctx.strokeStyle = colors.dependency;
        ctx.fillStyle = colors.dependencyArrow;
        ctx.lineWidth = 1.5;
        
        // Only render dependencies for visible tasks
        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (!task.dependencies || task.dependencies.length === 0) continue;
            
            const taskY = (i * rowHeight) - this.scrollY + barPadding + barHeight / 2;
            const taskX = this._dateToX(this._parseDate(task.start));
            
            task.dependencies.forEach(dep => {
                const predTask = this.taskMap.get(dep.id);
                if (!predTask) return;
                
                const predIndex = this.data.indexOf(predTask);
                if (predIndex === -1) return;
                
                const predY = (predIndex * rowHeight) - this.scrollY + barPadding + barHeight / 2;
                const predEndX = this._dateToX(this._parseDate(predTask.end)) + this.pixelsPerDay;
                
                // Draw based on dependency type
                this._drawDependencyArrow(ctx, predEndX, predY, taskX, taskY, dep.type);
            });
        }
    }

    /**
     * Draw a dependency arrow
     * @private
     */
    _drawDependencyArrow(ctx, x1, y1, x2, y2, type = 'FS') {
        const arrowSize = 6;
        const cornerRadius = 5;
        
        ctx.beginPath();
        
        if (type === 'FS') {
            // Finish-to-Start: horizontal then vertical, then horizontal
            const midX = x1 + 10;
            
            ctx.moveTo(x1, y1);
            ctx.lineTo(midX, y1);
            
            if (y2 > y1) {
                // Going down
                ctx.lineTo(midX, y2 - cornerRadius);
                ctx.quadraticCurveTo(midX, y2, midX + cornerRadius, y2);
            } else if (y2 < y1) {
                // Going up
                ctx.lineTo(midX, y2 + cornerRadius);
                ctx.quadraticCurveTo(midX, y2, midX + cornerRadius, y2);
            }
            
            ctx.lineTo(x2 - arrowSize, y2);
        } else if (type === 'SS') {
            // Start-to-Start
            const startX = Math.min(x1 - 15, x2 - 15);
            ctx.moveTo(x1, y1);
            ctx.lineTo(startX, y1);
            ctx.lineTo(startX, y2);
            ctx.lineTo(x2 - arrowSize, y2);
        } else if (type === 'FF') {
            // Finish-to-Finish
            const endX = Math.max(x1 + 15, x2 + 15);
            ctx.moveTo(x1, y1);
            ctx.lineTo(endX, y1);
            ctx.lineTo(endX, y2);
            ctx.lineTo(x2 + arrowSize, y2);
        }
        
        ctx.stroke();
        
        // Draw arrow head
        ctx.beginPath();
        if (type === 'FF') {
            ctx.moveTo(x2 + arrowSize, y2);
            ctx.lineTo(x2 + arrowSize - 4, y2 - 4);
            ctx.lineTo(x2 + arrowSize - 4, y2 + 4);
        } else {
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - arrowSize, y2 - 4);
            ctx.lineTo(x2 - arrowSize, y2 + 4);
        }
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Render task bars
     * @private
     */
    _renderBars(ctx, firstRow, lastRow) {
        const colors = this.options.colors;
        const rowHeight = this.options.rowHeight;
        const barHeight = this.options.barHeight;
        const barPadding = this.options.barPadding;
        const barRadius = this.options.barRadius;
        
        // Clear bar positions cache
        this._cache.barPositions = [];
        
        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (!task.start || !task.end) continue;
            
            const startX = this._dateToX(this._parseDate(task.start));
            const endX = this._dateToX(this._parseDate(task.end)) + this.pixelsPerDay;
            const y = (i * rowHeight) - this.scrollY + barPadding;
            const width = Math.max(this.options.minBarWidth, endX - startX);
            
            // Skip if not visible horizontally
            if (endX < 0 || startX > this.viewportWidth) continue;
            
            // Cache bar position for hit testing
            this._cache.barPositions.push({
                taskId: task.id,
                x: startX,
                y: y,
                width: width,
                height: barHeight,
                rowIndex: i,
            });
            
            // Determine bar color
            const isParent = this.options.isParent ? this.options.isParent(task.id) : false;
            const isCritical = task._isCritical;
            const isSelected = this.selectedIds.has(task.id);
            const isHovered = this.hoveredTaskId === task.id;
            
            let barColor = colors.barNormal;
            let strokeColor = null;
            
            if (isParent) {
                // Parent bars are thinner and darker
                this._drawParentBar(ctx, startX, y, width, barHeight, colors.barParent);
                continue;
            }
            
            if (isCritical) {
                barColor = colors.barCritical;
                strokeColor = colors.barCriticalStroke;
            }
            
            if (isSelected) {
                barColor = colors.barSelected;
            } else if (isHovered) {
                barColor = colors.barHover;
            }
            
            // Draw bar background
            ctx.fillStyle = barColor;
            this._roundRect(ctx, startX, y, width, barHeight, barRadius);
            ctx.fill();
            
            // Draw progress fill
            const progress = task.progress || 0;
            if (progress > 0) {
                const progressWidth = width * (progress / 100);
                ctx.fillStyle = colors.barProgress;
                ctx.globalAlpha = 0.3;
                this._roundRect(ctx, startX, y, progressWidth, barHeight, barRadius);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            
            // Draw stroke for critical tasks
            if (strokeColor) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1;
                this._roundRect(ctx, startX, y, width, barHeight, barRadius);
                ctx.stroke();
            }
            
            // Draw bar label if there's room
            if (width > 60) {
                ctx.fillStyle = '#fff';
                ctx.font = this.options.fonts.barLabel;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const label = this._truncateText(ctx, task.name, width - 10);
                ctx.fillText(label, startX + 5, y + barHeight / 2);
            }
        }
    }

    /**
     * Draw a parent (summary) bar
     * @private
     */
    _drawParentBar(ctx, x, y, width, height, color) {
        const parentBarHeight = 8;
        const yOffset = (height - parentBarHeight) / 2;
        
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        
        // Draw main bar
        ctx.fillRect(x, y + yOffset, width, parentBarHeight);
        
        // Draw end caps (triangles)
        ctx.beginPath();
        ctx.moveTo(x, y + yOffset);
        ctx.lineTo(x + 5, y + yOffset + parentBarHeight);
        ctx.lineTo(x, y + yOffset + parentBarHeight);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(x + width, y + yOffset);
        ctx.lineTo(x + width - 5, y + yOffset + parentBarHeight);
        ctx.lineTo(x + width, y + yOffset + parentBarHeight);
        ctx.closePath();
        ctx.fill();
        
        ctx.globalAlpha = 1;
    }

    /**
     * Render selection highlight
     * @private
     */
    _renderSelectionHighlight(ctx, firstRow, lastRow) {
        if (this.selectedIds.size === 0) return;
        
        const colors = this.options.colors;
        const rowHeight = this.options.rowHeight;
        
        ctx.fillStyle = colors.selectionBg;
        
        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (this.selectedIds.has(task.id)) {
                const y = (i * rowHeight) - this.scrollY;
                ctx.fillRect(0, y, this.viewportWidth, rowHeight);
            }
        }
    }

    /**
     * Draw a rounded rectangle
     * @private
     */
    _roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    /**
     * Truncate text to fit width
     * @private
     */
    _truncateText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        
        let truncated = text;
        while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + '...';
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================
    
    /**
     * Handle scroll events
     * @private
     */
    _onScroll(e) {
        this.scrollX = this.dom.scrollContainer.scrollLeft;
        this.scrollY = this.dom.scrollContainer.scrollTop;
        this._dirty = true;
        
        // Sync with grid
        if (this.options.onScroll) {
            this.options.onScroll(this.scrollY);
        }
    }

    /**
     * Handle mouse move for hover effects
     * @private
     */
    _onMouseMove(e) {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Find hovered bar
        const hitBar = this._hitTestBar(x, y);
        const newHoveredId = hitBar?.taskId || null;
        
        if (newHoveredId !== this.hoveredTaskId) {
            this.hoveredTaskId = newHoveredId;
            this._dirty = true;
            
            // Update cursor
            this.dom.mainCanvas.style.cursor = hitBar ? 'pointer' : 'default';
        }
        
        // Handle dragging
        if (this.dragState) {
            this._handleDrag(x, y);
        }
    }

    /**
     * Handle mouse down for drag start
     * @private
     */
    _onMouseDown(e) {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const hitBar = this._hitTestBar(x, y);
        if (hitBar) {
            // Start drag
            this.dragState = {
                taskId: hitBar.taskId,
                startX: x,
                startY: y,
                originalStart: this._parseDate(this.taskMap.get(hitBar.taskId)?.start),
                originalEnd: this._parseDate(this.taskMap.get(hitBar.taskId)?.end),
            };
        }
    }

    /**
     * Handle mouse up for drag end
     * @private
     */
    _onMouseUp(e) {
        if (this.dragState) {
            const task = this.taskMap.get(this.dragState.taskId);
            if (task && this.options.onBarDrag) {
                this.options.onBarDrag(task, task.start, task.end);
            }
            this.dragState = null;
        }
    }

    /**
     * Handle mouse leave
     * @private
     */
    _onMouseLeave(e) {
        if (this.hoveredTaskId) {
            this.hoveredTaskId = null;
            this._dirty = true;
        }
        
        if (this.dragState) {
            // Cancel drag on leave
            this.dragState = null;
            this._dirty = true;
        }
    }

    /**
     * Handle click events
     * @private
     */
    _onClick(e) {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const hitBar = this._hitTestBar(x, y);
        if (hitBar && this.options.onBarClick) {
            this.options.onBarClick(hitBar.taskId, e);
        }
    }

    /**
     * Handle double-click events
     * @private
     */
    _onDoubleClick(e) {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const hitBar = this._hitTestBar(x, y);
        if (hitBar && this.options.onBarDoubleClick) {
            this.options.onBarDoubleClick(hitBar.taskId, e);
        }
    }

    /**
     * Handle drag operation
     * @private
     */
    _handleDrag(x, y) {
        if (!this.dragState) return;
        
        const deltaX = x - this.dragState.startX;
        const deltaDays = Math.round(deltaX / this.pixelsPerDay);
        
        if (deltaDays === 0) return;
        
        const task = this.taskMap.get(this.dragState.taskId);
        if (!task) return;
        
        // Update task dates
        const newStart = this._addDays(this.dragState.originalStart, deltaDays);
        const newEnd = this._addDays(this.dragState.originalEnd, deltaDays);
        
        task.start = this._formatDateISO(newStart);
        task.end = this._formatDateISO(newEnd);
        
        this._dirty = true;
    }

    /**
     * Hit test for bar at position
     * @private
     */
    _hitTestBar(x, y) {
        for (const bar of this._cache.barPositions) {
            if (x >= bar.x && x <= bar.x + bar.width &&
                y >= bar.y && y <= bar.y + bar.height) {
                return bar;
            }
        }
        return null;
    }

    // =========================================================================
    // DATE UTILITIES
    // =========================================================================
    
    /**
     * Convert date to X coordinate
     * @private
     */
    _dateToX(date) {
        if (!date || !this.timelineStart) return 0;
        const days = this._daysBetween(this.timelineStart, date);
        return (days * this.pixelsPerDay) - this.scrollX;
    }

    /**
     * Convert X coordinate to date
     * @private
     */
    _xToDate(x) {
        const days = (x + this.scrollX) / this.pixelsPerDay;
        return this._addDays(this.timelineStart, Math.round(days));
    }

    /**
     * Parse date string to Date object
     * @private
     */
    _parseDate(dateStr) {
        if (!dateStr) return null;
        if (dateStr instanceof Date) return dateStr;
        return new Date(dateStr + 'T12:00:00');
    }

    /**
     * Format date to ISO string (YYYY-MM-DD)
     * @private
     */
    _formatDateISO(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * Format date for display
     * @private
     */
    _formatDate(date, format) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        switch (format) {
            case 'day':
                return `${days[date.getDay()]} ${date.getDate()}`;
            case 'week':
                return `${months[date.getMonth()]} ${date.getDate()}`;
            case 'month':
                return `${months[date.getMonth()]} ${date.getFullYear()}`;
            default:
                return `${date.getMonth() + 1}/${date.getDate()}`;
        }
    }

    /**
     * Calculate days between two dates
     * @private
     */
    _daysBetween(date1, date2) {
        const d1 = date1 instanceof Date ? date1 : new Date(date1);
        const d2 = date2 instanceof Date ? date2 : new Date(date2);
        return Math.round((d2 - d1) / CanvasGantt.MS_PER_DAY);
    }

    /**
     * Add days to a date
     * @private
     */
    _addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    /**
     * Set the task data
     * @param {Array} tasks - Array of task objects
     */
    setData(tasks) {
        this.data = tasks;
        
        // Build task map for quick lookup
        this.taskMap.clear();
        tasks.forEach(t => this.taskMap.set(t.id, t));
        
        // Calculate timeline range
        this._calculateTimelineRange();
        
        // Update scroll content size
        this._updateScrollContentSize();
        
        // Trigger re-render
        this._dirty = true;
    }

    /**
     * Calculate the timeline range from task data
     * @private
     */
    _calculateTimelineRange() {
        if (this.data.length === 0) {
            this.projectStart = null;
            this.projectEnd = null;
            this.timelineStart = null;
            this.timelineEnd = null;
            return;
        }
        
        let minDate = null;
        let maxDate = null;
        
        this.data.forEach(task => {
            if (task.start) {
                const start = this._parseDate(task.start);
                if (!minDate || start < minDate) minDate = start;
            }
            if (task.end) {
                const end = this._parseDate(task.end);
                if (!maxDate || end > maxDate) maxDate = end;
            }
        });
        
        this.projectStart = minDate;
        this.projectEnd = maxDate;
        
        // Add padding to timeline (2 weeks before and after)
        if (minDate && maxDate) {
            this.timelineStart = this._addDays(minDate, -14);
            this.timelineEnd = this._addDays(maxDate, 30);
        }
    }

    /**
     * Set the view mode
     * @param {string} mode - 'Day', 'Week', or 'Month'
     */
    setViewMode(mode) {
        if (!CanvasGantt.VIEW_MODES[mode]) return;
        
        this.viewMode = mode;
        this.pixelsPerDay = CanvasGantt.VIEW_MODES[mode].pixelsPerDay;
        
        this._updateScrollContentSize();
        this._dirty = true;
    }

    /**
     * Set selection state
     * @param {Set} selectedIds - Set of selected task IDs
     */
    setSelection(selectedIds) {
        this.selectedIds = selectedIds;
        this._dirty = true;
    }

    /**
     * Set scroll position (for sync with grid)
     * @param {number} scrollY - Vertical scroll position
     */
    setScrollTop(scrollY) {
        if (Math.abs(this.dom.scrollContainer.scrollTop - scrollY) > 1) {
            this.dom.scrollContainer.scrollTop = scrollY;
        }
    }

    /**
     * Get current scroll position
     * @returns {number} Current scrollTop
     */
    getScrollTop() {
        return this.scrollY;
    }

    /**
     * Scroll to a specific task
     * @param {string} taskId - The task ID to scroll to
     */
    scrollToTask(taskId) {
        const index = this.data.findIndex(t => t.id === taskId);
        if (index === -1) return;
        
        const taskY = index * this.options.rowHeight;
        const viewportMiddle = this.viewportHeight / 2;
        
        this.dom.scrollContainer.scrollTop = Math.max(0, taskY - viewportMiddle);
    }

    /**
     * Force a re-render
     */
    refresh() {
        this._dirty = true;
    }

    /**
     * Get render statistics
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            taskCount: this.data.length,
            viewMode: this.viewMode,
            pixelsPerDay: this.pixelsPerDay,
            lastRenderTime: `${this._lastRenderTime.toFixed(2)}ms`,
            scrollX: this.scrollX,
            scrollY: this.scrollY,
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        this.container.innerHTML = '';
    }
}

// Export for module systems
