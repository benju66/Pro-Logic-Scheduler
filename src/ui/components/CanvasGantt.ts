/**
 * ============================================================================
 * CanvasGantt.ts
 * ============================================================================
 * 
 * A high-performance Gantt chart renderer using HTML5 Canvas API.
 * Designed to render 10,000+ tasks at 60 FPS.
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import type { Task, CanvasGanttOptions, LinkType } from '../../types';

/**
 * View mode configuration
 */
interface ViewModeConfig {
    pixelsPerDay: number;
    headerFormat: 'day' | 'week' | 'month';
    gridInterval: number;
    majorInterval: number;
}

/**
 * Drag state
 */
interface DragState {
    taskId: string;
    startX: number;
    startY: number;
    originalStart: Date | null;
    originalEnd: Date | null;
}

/**
 * Bar position for hit testing
 */
interface BarPosition {
    taskId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rowIndex: number;
}

/**
 * Canvas DOM references
 */
interface CanvasGanttDOM {
    wrapper: HTMLElement;
    headerCanvas: HTMLCanvasElement;
    headerCtx: CanvasRenderingContext2D | null;
    mainCanvas: HTMLCanvasElement;
    mainCtx: CanvasRenderingContext2D | null;
    scrollContainer: HTMLElement;
    scrollContent: HTMLElement;
}

/**
 * Canvas Gantt options with defaults merged
 */
type MergedCanvasGanttOptions = Required<Pick<CanvasGanttOptions, 'rowHeight' | 'headerHeight'>> & CanvasGanttOptions & {
    colors: {
        background: string;
        gridLine: string;
        gridLineMajor: string;
        headerBg: string;
        headerText: string;
        barNormal: string;
        barCritical: string;
        barCriticalStroke: string;
        barParent: string;
        barProgress: string;
        barSelected: string;
        barHover: string;
        dependency: string;
        dependencyArrow: string;
        todayLine: string;
        weekendBg: string;
        selectionBg: string;
    };
    fonts: {
        header: string;
        barLabel: string;
    };
    barHeight: number;
    barPadding: number;
    barRadius: number;
    minBarWidth: number;
};

export class CanvasGantt {
    
    // =========================================================================
    // STATIC CONFIGURATION
    // =========================================================================
    
    /** View mode configurations */
    static readonly VIEW_MODES: Readonly<Record<string, ViewModeConfig>> = {
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
    static readonly DEFAULTS = {
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
    } as const;

    /** Milliseconds per day */
    static readonly MS_PER_DAY = 86400000;

    // =========================================================================
    // INSTANCE PROPERTIES
    // =========================================================================
    
    private options: MergedCanvasGanttOptions;
    private container: HTMLElement;
    private data: Task[] = [];                          // Array of visible tasks
    private taskMap: Map<string, Task> = new Map();                // Quick lookup by ID
    private selectedIds: Set<string> = new Set();
    private hoveredTaskId: string | null = null;
    private dragState: DragState | null = null;                   // Active drag operation
    
    // View state
    private viewMode: string = 'Week';
    private scrollX: number = 0;
    private scrollY: number = 0;
    private viewportWidth: number = 0;
    private viewportHeight: number = 0;
    
    // Time range
    private projectStart: Date | null = null;                // Earliest task start
    private projectEnd: Date | null = null;                  // Latest task end
    private timelineStart: Date | null = null;               // Visible timeline start
    private timelineEnd: Date | null = null;                 // Visible timeline end
    private pixelsPerDay: number = 20;
    
    // Canvas elements
    private dom!: CanvasGanttDOM; // Initialized in _buildDOM()
    
    // Render state
    private _dirty: boolean = true;
    private _rafId: number | null = null;
    private _lastRenderTime: number = 0;
    private _resizeObserver: ResizeObserver | null = null;
    
    // Cached calculations
    private _cache: {
        datePositions: Map<string, number>;
        barPositions: BarPosition[];
    } = {
        datePositions: new Map(),
        barPositions: [],
    };

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    /**
     * Create a new CanvasGantt instance
     * 
     * @param container - The container element
     * @param options - Configuration options
     */
    constructor(container: HTMLElement, options: CanvasGanttOptions = {} as CanvasGanttOptions) {
        // Merge options with defaults
        this.options = this._mergeOptions(CanvasGantt.DEFAULTS, options) as MergedCanvasGanttOptions;
        
        this.container = container;
        
        // Initialize
        this._init();
    }

    /**
     * Deep merge options with defaults
     * @private
     */
    private _mergeOptions(defaults: typeof CanvasGantt.DEFAULTS, options: CanvasGanttOptions): MergedCanvasGanttOptions {
        const result: any = { ...defaults };
        for (const key in options) {
            const optionKey = key as keyof CanvasGanttOptions;
            const optionValue = options[optionKey];
            
            // Skip null, undefined, and non-objects
            if (!optionValue || typeof optionValue !== 'object') {
                result[key] = optionValue;
                continue;
            }
            
            // Skip arrays, DOM elements, Date objects, and other non-plain objects
            if (Array.isArray(optionValue) || 
                optionValue instanceof HTMLElement ||
                optionValue instanceof Date ||
                optionValue instanceof RegExp ||
                optionValue instanceof Function) {
                result[key] = optionValue;
                continue;
            }
            
            // Only recursively merge plain objects (POJOs)
            // Check if it's a plain object by verifying constructor
            const isPlainObject = optionValue.constructor === Object || 
                                  Object.getPrototypeOf(optionValue) === Object.prototype ||
                                  Object.getPrototypeOf(optionValue) === null;
            
            if (isPlainObject) {
                const defaultValue = (defaults as any)[key] || {};
                result[key] = this._mergeOptions(defaultValue, optionValue as any);
            } else {
                // For other object types, just assign directly
                result[key] = optionValue;
            }
        }
        return result as MergedCanvasGanttOptions;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize the Gantt chart
     * @private
     */
    private _init(): void {
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
    private _buildDOM(): void {
        this.container.innerHTML = '';
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';
        
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'cg-wrapper';
        wrapper.style.cssText = `
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
        
        const headerCanvas = document.createElement('canvas');
        headerCanvas.className = 'cg-header-canvas';
        headerCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
        `;
        headerWrapper.appendChild(headerCanvas);
        const headerCtx = headerCanvas.getContext('2d');
        
        // Create scroll container for main canvas
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'cg-scroll-container';
        scrollContainer.style.cssText = `
            flex: 1;
            overflow: auto;
            position: relative;
        `;
        
        // Create scroll content (sized to full timeline/tasks)
        const scrollContent = document.createElement('div');
        scrollContent.className = 'cg-scroll-content';
        scrollContent.style.cssText = `
            position: relative;
        `;
        
        // Create main canvas
        const mainCanvas = document.createElement('canvas');
        mainCanvas.className = 'cg-main-canvas';
        mainCanvas.style.cssText = `
            position: sticky;
            top: 0;
            left: 0;
        `;
        const mainCtx = mainCanvas.getContext('2d');
        
        // Assemble structure
        scrollContent.appendChild(mainCanvas);
        scrollContainer.appendChild(scrollContent);
        wrapper.appendChild(headerWrapper);
        wrapper.appendChild(scrollContainer);
        this.container.appendChild(wrapper);
        
        // Store DOM references
        this.dom = {
            wrapper,
            headerCanvas,
            headerCtx,
            mainCanvas,
            mainCtx,
            scrollContainer,
            scrollContent,
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    private _bindEvents(): void {
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
    private _measure(): void {
        const rect = this.container.getBoundingClientRect();
        this.viewportWidth = rect.width;
        this.viewportHeight = rect.height - this.options.headerHeight;
        
        // Account for device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        
        if (!this.dom.headerCtx || !this.dom.mainCtx) return;
        
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
    private _updateScrollContentSize(): void {
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
    private _startRenderLoop(): void {
        const loop = (timestamp: number): void => {
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
    private _render(_timestamp: number): void {
        const startTime = performance.now();
        
        this._renderHeader();
        this._renderMain();
        
        this._lastRenderTime = performance.now() - startTime;
    }

    /**
     * Render the header (timeline)
     * @private
     */
    private _renderHeader(): void {
        const ctx = this.dom.headerCtx;
        if (!ctx) return;
        
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
        if (!viewMode) return;
        
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
    private _renderHeaderDays(ctx: CanvasRenderingContext2D, startDate: Date, visibleDays: number): void {
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
    private _renderHeaderWeeks(ctx: CanvasRenderingContext2D, startDate: Date, visibleDays: number): void {
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
    private _renderHeaderMonths(ctx: CanvasRenderingContext2D, startDate: Date, visibleDays: number): void {
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
    private _renderMain(): void {
        const ctx = this.dom.mainCtx;
        if (!ctx) return;
        
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
    private _renderEmptyState(ctx: CanvasRenderingContext2D): void {
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
    private _renderGridLines(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
        const colors = this.options.colors;
        const rowHeight = this.options.rowHeight;
        const ppd = this.pixelsPerDay;
        const width = this.viewportWidth;
        const offsetY = this.scrollY % rowHeight;
        const offsetX = this.scrollX % ppd;
        
        if (!this.timelineStart) return;
        
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
    private _renderWeekendShading(ctx: CanvasRenderingContext2D, _firstRow: number, _lastRow: number): void {
        const colors = this.options.colors;
        const ppd = this.pixelsPerDay;
        const height = this.viewportHeight;
        const offsetX = this.scrollX % ppd;
        const visibleDays = Math.ceil(this.viewportWidth / ppd) + 2;
        
        if (!this.timelineStart) return;
        
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
    private _renderTodayLine(ctx: CanvasRenderingContext2D): void {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (!this.timelineStart || !this.timelineEnd) return;
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
    private _renderDependencies(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
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
            const taskStart = this._parseDate(task.start);
            if (!taskStart) continue;
            const taskX = this._dateToX(taskStart);
            
            task.dependencies.forEach(dep => {
                const predTask = this.taskMap.get(dep.id);
                if (!predTask) return;
                
                const predIndex = this.data.indexOf(predTask);
                if (predIndex === -1) return;
                
                const predY = (predIndex * rowHeight) - this.scrollY + barPadding + barHeight / 2;
                const predEnd = this._parseDate(predTask.end);
                if (!predEnd) return;
                const predEndX = this._dateToX(predEnd) + this.pixelsPerDay;
                
                // Draw based on dependency type
                this._drawDependencyArrow(ctx, predEndX, predY, taskX, taskY, dep.type);
            });
        }
    }

    /**
     * Draw a dependency arrow
     * @private
     */
    private _drawDependencyArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, type: LinkType = 'FS'): void {
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
    private _renderBars(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
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
            let strokeColor: string | null = null;
            
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
    private _drawParentBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
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
    private _renderSelectionHighlight(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
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
    private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
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
    private _truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
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
    private _onScroll(_e: Event): void {
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
    private _onMouseMove(e: MouseEvent): void {
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
    private _onMouseDown(e: MouseEvent): void {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const hitBar = this._hitTestBar(x, y);
        if (hitBar) {
            const task = this.taskMap.get(hitBar.taskId);
            if (!task) return;
            
            // Start drag
            this.dragState = {
                taskId: hitBar.taskId,
                startX: x,
                startY: y,
                originalStart: this._parseDate(task.start),
                originalEnd: this._parseDate(task.end),
            };
        }
    }

    /**
     * Handle mouse up for drag end
     * @private
     */
    private _onMouseUp(_e: MouseEvent): void {
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
    private _onMouseLeave(_e: MouseEvent): void {
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
    private _onClick(e: MouseEvent): void {
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
    private _onDoubleClick(e: MouseEvent): void {
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
    private _handleDrag(x: number, y: number): void {
        if (!this.dragState) return;
        
        const deltaX = x - this.dragState.startX;
        const deltaDays = Math.round(deltaX / this.pixelsPerDay);
        
        if (deltaDays === 0) return;
        
        const task = this.taskMap.get(this.dragState.taskId);
        if (!task || !this.dragState.originalStart || !this.dragState.originalEnd) return;
        
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
    private _hitTestBar(x: number, y: number): BarPosition | null {
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
    private _dateToX(date: Date | null): number {
        if (!date || !this.timelineStart) return 0;
        const days = this._daysBetween(this.timelineStart, date);
        return (days * this.pixelsPerDay) - this.scrollX;
    }

    // _xToDate method removed - not currently used

    /**
     * Parse date string to Date object
     * @private
     */
    private _parseDate(dateStr: string | Date | null | undefined): Date | null {
        if (!dateStr) return null;
        if (dateStr instanceof Date) return dateStr;
        return new Date(dateStr + 'T12:00:00');
    }

    /**
     * Format date to ISO string (YYYY-MM-DD)
     * @private
     */
    private _formatDateISO(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Format date for display
     * @private
     */
    private _formatDate(date: Date, format: 'day' | 'week' | 'month'): string {
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
    private _daysBetween(date1: Date, date2: Date): number {
        const d1 = date1 instanceof Date ? date1 : new Date(date1);
        const d2 = date2 instanceof Date ? date2 : new Date(date2);
        return Math.round((d2.getTime() - d1.getTime()) / CanvasGantt.MS_PER_DAY);
    }

    /**
     * Add days to a date
     * @private
     */
    private _addDays(date: Date, days: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    /**
     * Set the task data
     * @param tasks - Array of task objects
     */
    setData(tasks: Task[]): void {
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
    private _calculateTimelineRange(): void {
        if (this.data.length === 0) {
            this.projectStart = null;
            this.projectEnd = null;
            this.timelineStart = null;
            this.timelineEnd = null;
            return;
        }
        
        let minDate: Date | null = null;
        let maxDate: Date | null = null;
        
        this.data.forEach(task => {
            if (task.start) {
                const start = this._parseDate(task.start);
                if (start && (!minDate || start < minDate)) minDate = start;
            }
            if (task.end) {
                const end = this._parseDate(task.end);
                if (end && (!maxDate || end > maxDate)) maxDate = end;
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
     * @param mode - 'Day', 'Week', or 'Month'
     */
    setViewMode(mode: string): void {
        const viewMode = CanvasGantt.VIEW_MODES[mode];
        if (!viewMode) return;
        
        this.viewMode = mode;
        this.pixelsPerDay = viewMode.pixelsPerDay;
        
        this._updateScrollContentSize();
        this._dirty = true;
    }

    /**
     * Set selection state
     * @param selectedIds - Set of selected task IDs
     */
    setSelection(selectedIds: Set<string>): void {
        this.selectedIds = selectedIds;
        this._dirty = true;
    }

    /**
     * Set scroll position (for sync with grid)
     * @param scrollY - Vertical scroll position
     */
    setScrollTop(scrollY: number): void {
        if (Math.abs(this.dom.scrollContainer.scrollTop - scrollY) > 1) {
            this.dom.scrollContainer.scrollTop = scrollY;
        }
    }

    /**
     * Get current scroll position
     * @returns Current scrollTop
     */
    getScrollTop(): number {
        return this.scrollY;
    }

    /**
     * Scroll to a specific task
     * @param taskId - The task ID to scroll to
     */
    scrollToTask(taskId: string): void {
        const index = this.data.findIndex(t => t.id === taskId);
        if (index === -1) return;
        
        const taskY = index * this.options.rowHeight;
        const viewportMiddle = this.viewportHeight / 2;
        
        this.dom.scrollContainer.scrollTop = Math.max(0, taskY - viewportMiddle);
    }

    /**
     * Force a re-render
     */
    refresh(): void {
        this._dirty = true;
    }

    /**
     * Get render statistics
     * @returns Stats object
     */
    getStats(): {
        taskCount: number;
        viewMode: string;
        pixelsPerDay: number;
        lastRenderTime: string;
        scrollX: number;
        scrollY: number;
    } {
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
    destroy(): void {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        this.container.innerHTML = '';
    }
}
