/**
 * @fileoverview Gantt Renderer for Unified Scheduler V2
 * @module ui/components/scheduler/GanttRenderer
 * 
 * Renders Canvas-based Gantt chart.
 * NO vertical scroll handling (handled by SchedulerViewport).
 * Owns horizontal scroll for timeline.
 * Header scroll syncs with main canvas.
 */

import type { Task, LinkType } from '../../../types';
import type { ViewportState, GanttRendererOptions } from './types';

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
 * Gantt Renderer - Canvas-based renderer
 */
export class GanttRenderer {
    private container: HTMLElement;
    private options: Required<GanttRendererOptions>;
    private rowHeight: number;
    private headerHeight: number;
    private data: Task[] = [];
    private taskMap: Map<string, Task> = new Map();
    private selectedIds: Set<string> = new Set();
    private hoveredTaskId: string | null = null;
    private dragState: DragState | null = null;

    // Pan state
    private isPanning: boolean = false;
    private panStartX: number = 0;
    private panStartY: number = 0;
    private panStartScrollLeft: number = 0;
    private panStartScrollTop: number = 0;
    private _spacePressed: boolean = false;

    // View state
    private viewMode: string = 'Week';
    private scrollX: number = 0;
    private viewportWidth: number = 0;
    private viewportHeight: number = 0;
    private totalContentHeight: number = 0;

    // Time range
    private projectStart: Date | null = null;
    private projectEnd: Date | null = null;
    private timelineStart: Date | null = null;
    private timelineEnd: Date | null = null;
    private pixelsPerDay: number = 20;

    // Canvas elements
    private dom!: CanvasGanttDOM;

    // Render state
    private dirty: boolean = true;
    private resizeObserver: ResizeObserver | null = null;

    // Cached calculations
    private barPositions: BarPosition[] = [];

    // View mode configurations
    private static readonly VIEW_MODES: Readonly<Record<string, ViewModeConfig>> = {
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

    // Zoom configuration
    private static readonly ZOOM_LEVELS = {
        min: 1,      // Most zoomed out (1 pixel per day)
        max: 80,     // Most zoomed in (80 pixels per day)
        default: 20, // Default (Week view)
        step: 1.5,   // Zoom multiplier per step
    };

    // Milliseconds per day
    private static readonly MS_PER_DAY = 86400000;

    // Default colors
    private static readonly COLORS = {
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
    } as const;

    constructor(options: GanttRendererOptions) {
        this.container = options.container;
        this.rowHeight = options.rowHeight;
        this.headerHeight = options.headerHeight;

        // Merge with defaults
        this.options = {
            container: options.container,
            rowHeight: options.rowHeight,
            headerHeight: options.headerHeight,
            onBarClick: options.onBarClick ?? (() => {}),
            onBarDoubleClick: options.onBarDoubleClick ?? (() => {}),
            onBarDrag: options.onBarDrag ?? (() => {}),
            onDependencyClick: options.onDependencyClick ?? (() => {}),
            onNeedsRender: options.onNeedsRender ?? (() => {}),
            isParent: options.isParent ?? (() => false),
        } as Required<GanttRendererOptions>;

        this._buildDOM();
        
        // Bind pan methods for proper event listener removal
        this._onPanMove = this._onPanMove.bind(this);
        this._onPanEnd = this._onPanEnd.bind(this);
        this._onSpaceDown = this._onSpaceDown.bind(this);
        this._onSpaceUp = this._onSpaceUp.bind(this);
        
        this._bindEvents();
        this._measure();
    }

    /**
     * Build DOM structure
     * Preserves existing container structure - only adds canvas elements
     */
    private _buildDOM(): void {
        // Clear container but preserve parent structure
        // The container (#gantt-container) should be empty and ready for canvas
        this.container.innerHTML = '';
        
        // Ensure container has proper overflow
        // Both horizontal and vertical scroll are handled by the inner scroll container
        this.container.style.cssText = `
            overflow: hidden;
            height: 100%;
            position: relative;
        `;

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
            height: 50px;
            flex-shrink: 0;
            overflow-x: hidden;
            overflow-y: hidden;
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
        // Horizontal and vertical scroll handled here
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'cg-scroll-container';
        scrollContainer.style.cssText = `
            flex: 1;
            overflow-x: auto;
            overflow-y: auto;
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
            position: absolute;
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

        // Sync header scroll with main canvas scroll
        scrollContainer.addEventListener('scroll', () => {
            if (headerWrapper) {
                headerWrapper.scrollLeft = scrollContainer.scrollLeft;
            }
            this.scrollX = scrollContainer.scrollLeft;
            this._renderHeader();
            this.dirty = true;
        }, { passive: true });
        
        // Store reference to inner scroll container for vertical scroll sync
        // The viewport will sync scrollTop on this element
        (this.container as any).__ganttScrollContainer = scrollContainer;
    }

    /**
     * Bind event listeners
     */
    private _bindEvents(): void {
        // Mouse interactions on main canvas
        this.dom.mainCanvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.dom.mainCanvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.dom.mainCanvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.dom.mainCanvas.addEventListener('mouseleave', () => this._onMouseLeave());
        this.dom.mainCanvas.addEventListener('click', (e) => this._onClick(e));
        this.dom.mainCanvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));

        // Mouse wheel zoom (Ctrl + scroll)
        this.dom.scrollContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                
                if (e.deltaY < 0) {
                    this.zoomIn();
                } else {
                    this.zoomOut();
                }
            }
        }, { passive: false });

        // Pan navigation (middle mouse button or Space + drag or Alt + drag)
        this.dom.mainCanvas.addEventListener('mousedown', (e) => this._onPanStart(e));
        this.dom.scrollContainer.addEventListener('mousedown', (e) => this._onPanStart(e));
        document.addEventListener('mousemove', this._onPanMove);
        document.addEventListener('mouseup', this._onPanEnd);
        document.addEventListener('keydown', this._onSpaceDown);
        document.addEventListener('keyup', this._onSpaceUp);

        // Prevent context menu on middle click
        this.dom.scrollContainer.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
            }
        });

        // Resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this._measure();
            this.dirty = true;
        });
        this.resizeObserver.observe(this.container);
    }

    /**
     * Measure and size canvases
     */
    private _measure(): void {
        const rect = this.container.getBoundingClientRect();
        this.viewportWidth = rect.width;
        this.viewportHeight = rect.height - this.headerHeight;

        const dpr = window.devicePixelRatio || 1;

        if (!this.dom.headerCtx || !this.dom.mainCtx) return;

        // Calculate total content HEIGHT (all tasks)
        const totalContentHeight = Math.max(this.viewportHeight, this.data.length * this.rowHeight);

        // Calculate total content WIDTH (full timeline)
        let totalContentWidth = this.viewportWidth;
        if (this.timelineStart && this.timelineEnd) {
            const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);
            // FIX: Add 1 to ensure last gridline has room to render
            totalContentWidth = Math.max(this.viewportWidth, (totalDays + 1) * this.pixelsPerDay);
        }

        // Check if resize is needed (avoid unnecessary resets)
        const currentMainWidth = this.dom.mainCanvas.width;
        const currentMainHeight = this.dom.mainCanvas.height;
        const newMainWidth = Math.round(totalContentWidth * dpr);
        const newMainHeight = Math.round(totalContentHeight * dpr);
        
        if (currentMainWidth === newMainWidth && currentMainHeight === newMainHeight) {
            return; // No resize needed
        }

        // Size header canvas to FULL timeline width
        this.dom.headerCanvas.width = totalContentWidth * dpr;
        this.dom.headerCanvas.height = this.headerHeight * dpr;
        this.dom.headerCanvas.style.width = `${totalContentWidth}px`;
        this.dom.headerCanvas.style.height = `${this.headerHeight}px`;
        this.dom.headerCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.dom.headerCtx.scale(dpr, dpr);

        // Size main canvas to FULL content dimensions
        this.dom.mainCanvas.width = totalContentWidth * dpr;
        this.dom.mainCanvas.height = totalContentHeight * dpr;
        this.dom.mainCanvas.style.width = `${totalContentWidth}px`;
        this.dom.mainCanvas.style.height = `${totalContentHeight}px`;
        this.dom.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.dom.mainCtx.scale(dpr, dpr);

        // Update scroll content size
        this.totalContentHeight = totalContentHeight;
        this._updateScrollContentSize();
    }

    /**
     * Update scroll content dimensions
     */
    private _updateScrollContentSize(): void {
        if (!this.timelineStart || !this.timelineEnd) return;

        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);
        // FIX: Add 1 to match _measure() and ensure last gridline has room
        const totalWidth = (totalDays + 1) * this.pixelsPerDay;
        const totalHeight = this.data.length * this.rowHeight;

        this.dom.scrollContent.style.width = `${Math.max(totalWidth, this.viewportWidth)}px`;
        this.dom.scrollContent.style.height = `${Math.max(totalHeight, this.viewportHeight)}px`;
    }

    /**
     * Render based on viewport state
     */
    render(state: ViewportState): void {
        const { visibleRange } = state;
        let { start, end } = visibleRange;

        const ctx = this.dom.mainCtx;
        if (!ctx) return;

        // Always render header first (timeline at top)
        // Header renders independently of task data - only needs timelineStart
        this._renderHeader();

        // Fill with background color instead of clearing (reduces flash)
        const width = this.dom.mainCanvas.width / (window.devicePixelRatio || 1);
        const height = this.dom.mainCanvas.height / (window.devicePixelRatio || 1);
        ctx.fillStyle = GanttRenderer.COLORS.background;
        ctx.fillRect(0, 0, width, height);

        if (this.data.length === 0 || !this.timelineStart) {
            this._renderEmptyState(ctx);
            return;
        }

        // Clamp visible range to valid data bounds (defensive check)
        const dataLength = this.data.length;
        start = Math.max(0, Math.min(start, dataLength - 1));
        end = Math.max(start, Math.min(end, dataLength - 1));
        
        // Ensure we have a valid range
        if (start > end || start >= dataLength || dataLength === 0) {
            // Header already rendered above, just log warning
            console.warn('[GanttRenderer] Invalid visible range:', { start, end, dataLength });
            return;
        }

        // Render layers (back to front) - using absolute Y positioning
        // Canvas is inside scrolling container, so no scrollTop offset needed
        this._renderGridLines(ctx, start, end);
        this._renderWeekendShading(ctx, start, end);
        this._renderTodayLine(ctx);
        this._renderDependencies(ctx, start, end);
        this._renderBars(ctx, start, end);
        this._renderSelectionHighlight(ctx, start, end);
    }

    /**
     * Render header (timeline)
     */
    private _renderHeader(): void {
        const ctx = this.dom.headerCtx;
        if (!ctx) return;

        const width = this.dom.headerCanvas.width / (window.devicePixelRatio || 1);
        const height = this.headerHeight;

        // Clear
        ctx.fillStyle = GanttRenderer.COLORS.headerBg;
        ctx.fillRect(0, 0, width, height);

        // Draw border
        ctx.strokeStyle = GanttRenderer.COLORS.gridLineMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 0.5);
        ctx.lineTo(width, height - 0.5);
        ctx.stroke();

        if (!this.timelineStart) return;

        const viewMode = GanttRenderer.VIEW_MODES[this.viewMode];
        if (!viewMode) return;

        // Render full timeline (no scroll offset needed - canvas scrolls with container)
        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd || this.timelineStart);

        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw based on view mode
        if (this.viewMode === 'Day') {
            this._renderHeaderDays(ctx, this.timelineStart, totalDays);
        } else if (this.viewMode === 'Week') {
            this._renderHeaderWeeks(ctx, this.timelineStart, totalDays);
        } else {
            this._renderHeaderMonths(ctx, this.timelineStart, totalDays);
        }
    }

    /**
     * Render day-level header
     */
    private _renderHeaderDays(ctx: CanvasRenderingContext2D, startDate: Date, totalDays: number): void {
        const ppd = this.pixelsPerDay;
        const height = this.headerHeight;

        for (let i = 0; i <= totalDays; i++) {
            const date = this._addDays(startDate, i);
            const x = i * ppd;
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // Draw cell background
            if (isWeekend) {
                ctx.fillStyle = GanttRenderer.COLORS.weekendBg;
                ctx.fillRect(x, 0, ppd, height);
            }

            // Draw vertical line
            ctx.strokeStyle = dayOfWeek === 1 ? GanttRenderer.COLORS.gridLineMajor : GanttRenderer.COLORS.gridLine;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
            ctx.stroke();

            // Draw label
            ctx.fillStyle = GanttRenderer.COLORS.headerText;
            const label = this._formatDate(date, 'day');
            ctx.fillText(label, x + ppd / 2, height / 2);
        }
    }

    /**
     * Render week-level header
     */
    private _renderHeaderWeeks(ctx: CanvasRenderingContext2D, startDate: Date, totalDays: number): void {
        const ppd = this.pixelsPerDay;
        const height = this.headerHeight;

        for (let i = 0; i <= totalDays; i++) {
            const date = this._addDays(startDate, i);
            const x = i * ppd;
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isMonday = dayOfWeek === 1;

            // Weekend background
            if (isWeekend) {
                ctx.fillStyle = GanttRenderer.COLORS.weekendBg;
                ctx.fillRect(x, 0, ppd, height);
            }

            // Vertical grid lines
            ctx.strokeStyle = isMonday ? GanttRenderer.COLORS.gridLineMajor : GanttRenderer.COLORS.gridLine;
            ctx.lineWidth = isMonday ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, height);
            ctx.stroke();

            // Week label on Monday
            if (isMonday) {
                ctx.fillStyle = GanttRenderer.COLORS.headerText;
                const weekWidth = 7 * ppd;
                const label = this._formatDate(date, 'week');
                ctx.fillText(label, x + weekWidth / 2, height / 2);
            }
        }
    }

    /**
     * Render month-level header
     */
    private _renderHeaderMonths(ctx: CanvasRenderingContext2D, startDate: Date, totalDays: number): void {
        const ppd = this.pixelsPerDay;
        const height = this.headerHeight;

        let lastMonth = -1;
        let monthStartX = 0;

        for (let i = 0; i <= totalDays; i++) {
            const date = this._addDays(startDate, i);
            const x = i * ppd;
            const month = date.getMonth();
            const isFirstOfMonth = date.getDate() === 1;

            // Draw month separator
            if (isFirstOfMonth || month !== lastMonth) {
                if (lastMonth !== -1) {
                    const prevDate = this._addDays(date, -1);
                    const label = this._formatDate(prevDate, 'month');
                    ctx.fillStyle = GanttRenderer.COLORS.headerText;
                    ctx.fillText(label, (monthStartX + x) / 2, height / 2);
                }

                ctx.strokeStyle = GanttRenderer.COLORS.gridLineMajor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, height);
                ctx.stroke();

                lastMonth = month;
                monthStartX = x;
            }
        }

        // Draw label for last month
        const lastX = totalDays * ppd;
        const label = this._formatDate(this._addDays(startDate, totalDays), 'month');
        ctx.fillStyle = GanttRenderer.COLORS.headerText;
        ctx.fillText(label, (monthStartX + lastX) / 2, height / 2);
    }

    /**
     * Render empty state
     */
    private _renderEmptyState(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = GanttRenderer.COLORS.headerText;
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No tasks with dates', this.viewportWidth / 2, this.viewportHeight / 2);
    }

    /**
     * Render grid lines
     */
    private _renderGridLines(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
        const ppd = this.pixelsPerDay;
        const width = this.dom.mainCanvas.width / (window.devicePixelRatio || 1);

        if (!this.timelineStart || !this.timelineEnd) return;

        ctx.strokeStyle = GanttRenderer.COLORS.gridLine;
        ctx.lineWidth = 0.5;

        // Horizontal row lines - absolute positioning (canvas scrolls with container)
        ctx.beginPath();
        for (let i = firstRow; i <= lastRow + 1; i++) {
            const y = Math.floor(i * this.rowHeight + 0.5);
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();

        // Vertical day lines - render full timeline
        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);

        ctx.beginPath();
        for (let i = 0; i <= totalDays; i++) {
            const date = this._addDays(this.timelineStart, i);
            const x = i * ppd + 0.5;
            const dayOfWeek = date.getDay();

            if (dayOfWeek === 1) {
                ctx.stroke();
                ctx.strokeStyle = GanttRenderer.COLORS.gridLineMajor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.totalContentHeight);
                ctx.stroke();
                ctx.strokeStyle = GanttRenderer.COLORS.gridLine;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
            } else {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.totalContentHeight);
            }
        }
        ctx.stroke();
    }

    /**
     * Render weekend shading
     */
    private _renderWeekendShading(ctx: CanvasRenderingContext2D, _firstRow: number, _lastRow: number): void {
        const ppd = this.pixelsPerDay;
        const height = this.totalContentHeight;

        if (!this.timelineStart || !this.timelineEnd) return;

        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);

        ctx.fillStyle = GanttRenderer.COLORS.weekendBg;

        for (let i = 0; i <= totalDays; i++) {
            const date = this._addDays(this.timelineStart, i);
            const dayOfWeek = date.getDay();

            if (dayOfWeek === 0 || dayOfWeek === 6) {
                const x = i * ppd;
                ctx.fillRect(x, 0, ppd, height);
            }
        }
    }

    /**
     * Render today line
     */
    private _renderTodayLine(ctx: CanvasRenderingContext2D): void {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!this.timelineStart || !this.timelineEnd) return;
        if (today < this.timelineStart || today > this.timelineEnd) return;

        const x = this._dateToX(today);
        const width = this.dom.mainCanvas.width / (window.devicePixelRatio || 1);
        if (x < 0 || x > width) return;

        ctx.strokeStyle = GanttRenderer.COLORS.todayLine;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, this.totalContentHeight);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * Render dependencies
     */
    private _renderDependencies(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
        const rowHeight = this.rowHeight;
        const barHeight = 20;
        const barPadding = 9;

        ctx.strokeStyle = GanttRenderer.COLORS.dependency;
        ctx.fillStyle = GanttRenderer.COLORS.dependencyArrow;
        ctx.lineWidth = 1.5;

        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (!task.dependencies || task.dependencies.length === 0) continue;

            // Absolute Y coordinate (canvas scrolls with container)
            const taskY = Math.floor(i * rowHeight + barPadding + barHeight / 2);
            const taskStart = this._parseDate(task.start);
            if (!taskStart) continue;
            const taskX = this._dateToX(taskStart);

            task.dependencies.forEach(dep => {
                const predTask = this.taskMap.get(dep.id);
                if (!predTask) return;

                const predIndex = this.data.indexOf(predTask);
                if (predIndex === -1) return;

                // Draw dependency even if predecessor is outside visible range (for arrows)
                // Absolute Y coordinate (canvas scrolls with container)
                const predY = Math.floor(predIndex * rowHeight + barPadding + barHeight / 2);
                const predEnd = this._parseDate(predTask.end);
                if (!predEnd) return;
                const predEndX = this._dateToX(predEnd) + this.pixelsPerDay;

                this._drawDependencyArrow(ctx, predEndX, predY, taskX, taskY, dep.type);
            });
        }
    }

    /**
     * Draw dependency arrow
     */
    private _drawDependencyArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, type: LinkType = 'FS'): void {
        const arrowSize = 6;
        const cornerRadius = 5;

        ctx.beginPath();

        if (type === 'FS') {
            const midX = x1 + 10;
            ctx.moveTo(x1, y1);
            ctx.lineTo(midX, y1);

            if (y2 > y1) {
                ctx.lineTo(midX, y2 - cornerRadius);
                ctx.quadraticCurveTo(midX, y2, midX + cornerRadius, y2);
            } else if (y2 < y1) {
                ctx.lineTo(midX, y2 + cornerRadius);
                ctx.quadraticCurveTo(midX, y2, midX + cornerRadius, y2);
            }

            ctx.lineTo(x2 - arrowSize, y2);
        } else if (type === 'SS') {
            const startX = Math.min(x1 - 15, x2 - 15);
            ctx.moveTo(x1, y1);
            ctx.lineTo(startX, y1);
            ctx.lineTo(startX, y2);
            ctx.lineTo(x2 - arrowSize, y2);
        } else if (type === 'FF') {
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
     */
    private _renderBars(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
        const rowHeight = this.rowHeight;
        const barHeight = 20;
        const barPadding = 9;
        const barRadius = 3;

        // Clear bar positions cache
        this.barPositions = [];

        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (!task.start || !task.end) continue;

            const startX = this._dateToX(this._parseDate(task.start));
            const endX = this._dateToX(this._parseDate(task.end)) + this.pixelsPerDay;
            // Absolute Y coordinate (canvas scrolls with container)
            const y = Math.floor(i * rowHeight + barPadding);
            const width = Math.max(10, endX - startX);

            // Skip if not visible horizontally (check against full canvas width)
            const canvasWidth = this.dom.mainCanvas.width / (window.devicePixelRatio || 1);
            if (endX < 0 || startX > canvasWidth) continue;

            // Cache bar position for hit testing (absolute Y coordinates)
            this.barPositions.push({
                taskId: task.id,
                x: startX,
                y: y,
                width: width,
                height: barHeight,
                rowIndex: i,
            });

            // Determine bar color
            const isParent = this.options.isParent(task.id);
            const isCritical = task._isCritical;
            const isSelected = this.selectedIds.has(task.id);
            const isHovered = this.hoveredTaskId === task.id;

            let barColor: string = GanttRenderer.COLORS.barNormal;
            let strokeColor: string | null = null;

            if (isParent) {
                this._drawParentBar(ctx, startX, y, width, barHeight);
                continue;
            }

            if (isCritical) {
                barColor = GanttRenderer.COLORS.barCritical;
                strokeColor = GanttRenderer.COLORS.barCriticalStroke;
            }

            if (isSelected) {
                barColor = GanttRenderer.COLORS.barSelected;
            } else if (isHovered) {
                barColor = GanttRenderer.COLORS.barHover;
            }

            // Draw bar background
            ctx.fillStyle = barColor;
            this._roundRect(ctx, startX, y, width, barHeight, barRadius);
            ctx.fill();

            // Draw progress fill
            const progress = task.progress || 0;
            if (progress > 0) {
                const progressWidth = width * (progress / 100);
                ctx.fillStyle = GanttRenderer.COLORS.barProgress;
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
                ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const label = this._truncateText(ctx, task.name, width - 10);
                ctx.fillText(label, startX + 5, y + barHeight / 2);
            }
        }
    }

    /**
     * Draw parent bar
     */
    private _drawParentBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
        const parentBarHeight = 8;
        const yOffset = (height - parentBarHeight) / 2;

        ctx.fillStyle = GanttRenderer.COLORS.barParent;
        ctx.globalAlpha = 0.8;

        ctx.fillRect(x, y + yOffset, width, parentBarHeight);

        // Draw end caps
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
     */
    private _renderSelectionHighlight(ctx: CanvasRenderingContext2D, firstRow: number, lastRow: number): void {
        if (this.selectedIds.size === 0) return;

        ctx.fillStyle = GanttRenderer.COLORS.selectionBg;
        const width = this.dom.mainCanvas.width / (window.devicePixelRatio || 1);

        for (let i = firstRow; i <= lastRow; i++) {
            const task = this.data[i];
            if (this.selectedIds.has(task.id)) {
                // Absolute Y coordinate (canvas scrolls with container)
                const y = Math.floor(i * this.rowHeight);
                ctx.fillRect(0, y, width, this.rowHeight);
            }
        }
    }

    /**
     * Draw rounded rectangle
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
     */
    private _truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
        if (ctx.measureText(text).width <= maxWidth) return text;

        let truncated = text;
        while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + '...';
    }

    /**
     * Handle mouse move
     */
    private _onMouseMove(e: MouseEvent): void {
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const hitBar = this._hitTestBar(x, y);
        const newHoveredId = hitBar?.taskId || null;

        if (newHoveredId !== this.hoveredTaskId) {
            this.hoveredTaskId = newHoveredId;
            this.dirty = true;

            this.dom.mainCanvas.style.cursor = hitBar ? 'pointer' : 'default';
        }

        if (this.dragState) {
            this._handleDrag(x, y);
        }
    }

    /**
     * Handle mouse down
     */
    private _onMouseDown(e: MouseEvent): void {
        // Don't start bar drag if panning should occur (space or alt held)
        // This allows panning to take precedence over bar dragging
        if (e.button === 0 && (this._spacePressed || e.altKey)) {
            return;
        }
        
        // Don't start bar drag if middle mouse button (used for panning)
        if (e.button === 1) {
            return;
        }
        
        const rect = this.dom.mainCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const hitBar = this._hitTestBar(x, y);
        if (hitBar) {
            const task = this.taskMap.get(hitBar.taskId);
            if (!task) return;

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
     * Handle mouse up
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
     */
    private _onMouseLeave(): void {
        if (this.hoveredTaskId) {
            this.hoveredTaskId = null;
            this.dirty = true;
        }

        if (this.dragState) {
            this.dragState = null;
            this.dirty = true;
        }
    }

    /**
     * Handle click
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
     * Handle double-click
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
     * Check if an input element is currently focused
     */
    private _isInputFocused(): boolean {
        const activeElement = document.activeElement;
        return activeElement instanceof HTMLInputElement || 
               activeElement instanceof HTMLTextAreaElement ||
               activeElement instanceof HTMLSelectElement ||
               activeElement?.getAttribute('contenteditable') === 'true';
    }

    /**
     * Start panning
     */
    private _onPanStart(e: MouseEvent): void {
        // Pan with middle mouse button (button 1) or space+left click or Alt+left click
        const shouldPan = e.button === 1 || // Middle mouse
                          (e.button === 0 && this._spacePressed) || // Space + left click
                          (e.button === 0 && e.altKey); // Alt + left click
        
        if (!shouldPan) return;
        
        e.preventDefault();
        
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panStartScrollLeft = this.dom.scrollContainer.scrollLeft;
        this.panStartScrollTop = this.dom.scrollContainer.scrollTop;
        
        // Change cursor
        this.dom.scrollContainer.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        
        // Add panning class for CSS styling
        this.dom.scrollContainer.classList.add('panning');
        
        // Prevent text selection while panning
        document.body.style.userSelect = 'none';
    }

    /**
     * Handle pan movement
     */
    private _onPanMove = (e: MouseEvent): void => {
        if (!this.isPanning) return;
        
        e.preventDefault();
        
        const deltaX = e.clientX - this.panStartX;
        const deltaY = e.clientY - this.panStartY;
        
        // Scroll in opposite direction of drag (natural panning)
        this.dom.scrollContainer.scrollLeft = this.panStartScrollLeft - deltaX;
        this.dom.scrollContainer.scrollTop = this.panStartScrollTop - deltaY;
    };

    /**
     * End panning
     */
    private _onPanEnd = (_e: MouseEvent): void => {
        if (!this.isPanning) return;
        
        this.isPanning = false;
        
        // Reset cursor
        this.dom.scrollContainer.style.cursor = this._spacePressed ? 'grab' : 'default';
        document.body.style.cursor = 'default';
        
        // Remove panning class
        this.dom.scrollContainer.classList.remove('panning');
        
        if (this._spacePressed) {
            this.dom.scrollContainer.classList.add('pan-ready');
        } else {
            this.dom.scrollContainer.classList.remove('pan-ready');
        }
        
        // Re-enable text selection
        document.body.style.userSelect = '';
    };

    /**
     * Handle space key down
     */
    private _onSpaceDown = (e: KeyboardEvent): void => {
        if (e.code === 'Space' && !this._isInputFocused()) {
            e.preventDefault(); // Prevent page scroll
            this._spacePressed = true;
            this.dom.scrollContainer.style.cursor = 'grab';
            this.dom.scrollContainer.classList.add('pan-ready');
        }
    };

    /**
     * Handle space key up
     */
    private _onSpaceUp = (e: KeyboardEvent): void => {
        if (e.code === 'Space') {
            this._spacePressed = false;
            if (!this.isPanning) {
                this.dom.scrollContainer.style.cursor = 'default';
                this.dom.scrollContainer.classList.remove('pan-ready');
            }
        }
    };

    /**
     * Handle drag
     */
    private _handleDrag(x: number, _y: number): void {
        if (!this.dragState) return;

        const deltaX = x - this.dragState.startX;
        const deltaDays = Math.round(deltaX / this.pixelsPerDay);

        if (deltaDays === 0) return;

        const task = this.taskMap.get(this.dragState.taskId);
        if (!task || !this.dragState.originalStart || !this.dragState.originalEnd) return;

        const newStart = this._addDays(this.dragState.originalStart, deltaDays);
        const newEnd = this._addDays(this.dragState.originalEnd, deltaDays);

        task.start = this._formatDateISO(newStart);
        task.end = this._formatDateISO(newEnd);

        this.dirty = true;
    }

    /**
     * Hit test for bar
     */
    private _hitTestBar(x: number, y: number): BarPosition | null {
        for (const bar of this.barPositions) {
            if (x >= bar.x && x <= bar.x + bar.width &&
                y >= bar.y && y <= bar.y + bar.height) {
                return bar;
            }
        }
        return null;
    }

    /**
     * Set task data
     */
    setData(tasks: Task[]): void {
        this.data = tasks;

        this.taskMap.clear();
        tasks.forEach(t => this.taskMap.set(t.id, t));

        this._calculateTimelineRange();
        
        // IMPORTANT: Re-measure to resize canvas for new data length
        this._measure();
        
        this._renderHeader();
        this.dirty = true;
    }

    /**
     * Calculate timeline range
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

        if (minDate && maxDate) {
            this.timelineStart = this._addDays(minDate, -14);
            this.timelineEnd = this._addDays(maxDate, 30);
        }
    }

    /**
     * Set selection state
     */
    setSelection(selectedIds: Set<string>): void {
        this.selectedIds = selectedIds;
        this.dirty = true;
    }

    /**
     * Set view mode - ONLY changes header format and gridline intervals, NOT zoom
     * @param mode - 'Day', 'Week', or 'Month'
     */
    setViewMode(mode: string): void {
        const viewModeConfig = GanttRenderer.VIEW_MODES[mode];
        if (!viewModeConfig) return;

        const previousMode = this.viewMode;
        this.viewMode = mode;
        
        // ✅ FIX: Do NOT reset pixelsPerDay here
        // Keep current zoom level, only change header format
        
        this._measure();
        this._updateScrollContentSize();
        this._renderHeader();
        this.dirty = true;
        
        // FIX: Notify viewport that we need a render
        this.options.onNeedsRender();
        
        console.log(`[GanttRenderer] View mode: ${previousMode} → ${mode} (zoom unchanged: ${this.pixelsPerDay} ppd)`);
    }

    /**
     * Get current view mode
     */
    getViewMode(): string {
        return this.viewMode;
    }

    /**
     * Set zoom level - ONLY changes visual scale, NOT view mode
     * @param pixelsPerDay - Pixels per day (1-80 range)
     */
    setZoom(pixelsPerDay: number): void {
        const newPixelsPerDay = Math.max(
            GanttRenderer.ZOOM_LEVELS.min,
            Math.min(GanttRenderer.ZOOM_LEVELS.max, pixelsPerDay)
        );
        
        if (this.pixelsPerDay === newPixelsPerDay) return;
        
        const previousZoom = this.pixelsPerDay;
        this.pixelsPerDay = newPixelsPerDay;
        
        // ✅ FIX: Do NOT change viewMode here
        // View mode is controlled separately by setViewMode()
        
        this._measure();
        this._updateScrollContentSize();
        this._renderHeader();
        this.dirty = true;
        
        // FIX: Notify viewport that we need a render
        this.options.onNeedsRender();
        
        console.log(`[GanttRenderer] Zoom: ${previousZoom} → ${newPixelsPerDay} ppd (view mode unchanged: ${this.viewMode})`);
    }

    /**
     * Get current zoom level
     */
    getZoom(): number {
        return this.pixelsPerDay;
    }

    /**
     * Zoom in (increase pixelsPerDay)
     */
    zoomIn(): void {
        const newZoom = Math.min(
            this.pixelsPerDay * GanttRenderer.ZOOM_LEVELS.step,
            GanttRenderer.ZOOM_LEVELS.max
        );
        this.setZoom(newZoom);
    }

    /**
     * Zoom out (decrease pixelsPerDay)
     */
    zoomOut(): void {
        const newZoom = Math.max(
            this.pixelsPerDay / GanttRenderer.ZOOM_LEVELS.step,
            GanttRenderer.ZOOM_LEVELS.min
        );
        this.setZoom(newZoom);
    }

    /**
     * Fit entire timeline to view
     */
    fitToView(): void {
        if (!this.timelineStart || !this.timelineEnd) return;
        
        const totalDays = this._daysBetween(this.timelineStart, this.timelineEnd);
        if (totalDays <= 0) return;
        
        // Calculate pixelsPerDay to fit content in viewport with padding
        const availableWidth = this.viewportWidth - 40; // 20px padding each side
        const newPixelsPerDay = Math.max(
            GanttRenderer.ZOOM_LEVELS.min,
            Math.min(GanttRenderer.ZOOM_LEVELS.max, availableWidth / totalDays)
        );
        
        this.setZoom(newPixelsPerDay);
        
        // Reset scroll to start
        if (this.dom.scrollContainer) {
            this.dom.scrollContainer.scrollLeft = 0;
        }
    }

    /**
     * Reset zoom to default for current view mode
     */
    resetZoom(): void {
        const defaultZoom = GanttRenderer.VIEW_MODES[this.viewMode]?.pixelsPerDay 
            ?? GanttRenderer.ZOOM_LEVELS.default;
        this.setZoom(defaultZoom);
    }

    /**
     * Convert date to X coordinate (absolute position, no scroll offset)
     */
    private _dateToX(date: Date | null): number {
        if (!date || !this.timelineStart) return 0;
        const days = this._daysBetween(this.timelineStart, date);
        return days * this.pixelsPerDay;
    }

    /**
     * Parse date string
     */
    private _parseDate(dateStr: string | Date | null | undefined): Date | null {
        if (!dateStr) return null;
        if (dateStr instanceof Date) return dateStr;
        return new Date(dateStr + 'T12:00:00');
    }

    /**
     * Format date to ISO string
     */
    private _formatDateISO(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Format date for display
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
     */
    private _daysBetween(date1: Date, date2: Date): number {
        const d1 = date1 instanceof Date ? date1 : new Date(date1);
        const d2 = date2 instanceof Date ? date2 : new Date(date2);
        return Math.round((d2.getTime() - d1.getTime()) / GanttRenderer.MS_PER_DAY);
    }

    /**
     * Add days to a date
     */
    private _addDays(date: Date, days: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    /**
     * Destroy the renderer
     */
    destroy(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        
        // Remove document-level pan listeners
        document.removeEventListener('mousemove', this._onPanMove);
        document.removeEventListener('mouseup', this._onPanEnd);
        document.removeEventListener('keydown', this._onSpaceDown);
        document.removeEventListener('keyup', this._onSpaceUp);
        
        this.container.innerHTML = '';
    }
}

