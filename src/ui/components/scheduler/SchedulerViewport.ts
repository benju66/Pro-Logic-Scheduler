/**
 * @fileoverview Scheduler Viewport - Master Controller for Unified Scheduler V2
 * @module ui/components/scheduler/SchedulerViewport
 * 
 * The single source of truth for vertical scroll position.
 * Owns the RAF loop. Drives both renderers.
 * Manages selection state.
 * NO SINGLETON PATTERN - constructor-based.
 */

import type { Task, GridColumn } from '../../../types';
import type { ViewportState, SchedulerViewportOptions, GridRendererOptions, GanttRendererOptions, PerformanceMetrics } from './types';
import { GridRenderer } from './GridRenderer';
import { GanttRenderer } from './GanttRenderer';
import { ROW_HEIGHT, HEADER_HEIGHT, DEFAULT_BUFFER_ROWS, ERROR_CONFIG } from './constants';

/**
 * Scheduler Viewport - Master Controller
 */
export class SchedulerViewport {
    // Configuration
    private rowHeight: number;
    private headerHeight: number;
    private bufferRows: number;

    // Scroll state (THE source of truth for vertical scroll)
    private scrollTop: number = 0;
    private viewportHeight: number = 0;
    private viewportWidth: number = 0;

    // Data
    private tasks: Task[] = [];
    private dataLength: number = 0;

    // Renderers
    private gridRenderer: GridRenderer | null = null;
    private ganttRenderer: GanttRenderer | null = null;

    // DOM
    private container: HTMLElement;
    private scrollElement: HTMLElement | null = null;
    private scrollContent: HTMLElement | null = null;
    private gridPane: HTMLElement | null = null;
    private ganttPane: HTMLElement | null = null;

    // RAF state
    private rafId: number | null = null;
    private dirty: boolean = false;
    private isRendering: boolean = false;

    // Selection state (owned by Viewport)
    private selectedIds: Set<string> = new Set();

    // Options
    private options: SchedulerViewportOptions;

    // Error handling
    private errorCount: number = 0;

    // Resize observer
    private resizeObserver: ResizeObserver | null = null;

    // Initialization state
    private gridReady: boolean = false;
    private ganttReady: boolean = false;

    // Performance metrics
    private performanceMetrics: PerformanceMetrics = {
        renderCount: 0,
        totalRenderTime: 0,
        maxRenderTime: 0,
        slowFrames: 0,
        avgRenderTime: 0,
    };

    /**
     * Constructor (NO SINGLETON)
     */
    constructor(container: HTMLElement, options: SchedulerViewportOptions = {}) {
        this.container = container;
        this.options = options;

        this.rowHeight = options.rowHeight ?? ROW_HEIGHT;
        this.headerHeight = options.headerHeight ?? HEADER_HEIGHT;
        this.bufferRows = options.bufferRows ?? DEFAULT_BUFFER_ROWS;

        this._buildDOM();
    }

    /**
     * Build DOM structure
     * Preserves existing HTML structure - syncs scroll on grid-container and gantt-container
     */
    private _buildDOM(): void {
        // Find existing containers
        const gridPane = this.container.querySelector('.grid-pane') as HTMLElement;
        const ganttPane = this.container.querySelector('.gantt-pane') as HTMLElement;
        const gridContainer = gridPane?.querySelector('.grid-container') as HTMLElement;
        const ganttContainer = ganttPane?.querySelector('.gantt-container') as HTMLElement;

        if (!gridPane || !ganttPane || !gridContainer || !ganttContainer) {
            throw new Error('Required containers not found. Expected: .grid-pane, .gantt-pane, .grid-container, .gantt-container');
        }

        // Store references to existing containers (will be used by renderers)
        this.gridPane = gridContainer;
        this.ganttPane = ganttContainer;

        // Make both containers scrollable vertically
        // They will be synced by the viewport
        gridContainer.style.cssText = `
            overflow-y: hidden;
            overflow-x: auto;
            height: 100%;
            position: relative;
        `;

        ganttContainer.style.cssText = `
            overflow-y: auto;
            overflow-x: auto;
            height: 100%;
            position: relative;
        `;

        // Create scroll content wrappers that define the scroll height
        // These will be inserted AFTER renderers build their DOM
        // Store references so we can update their height later
        this.scrollContent = document.createElement('div');
        this.scrollContent.className = 'scheduler-scroll-content';
        this.scrollContent.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            pointer-events: none;
            z-index: 0;
        `;

        // Insert scroll content wrappers into both containers
        // They define the scrollable height (will be updated when data is set)
        const gridScrollContent = this.scrollContent.cloneNode(true) as HTMLElement;
        gridScrollContent.className = 'scheduler-scroll-content';
        gridContainer.appendChild(gridScrollContent);
        
        const ganttScrollContent = this.scrollContent.cloneNode(true) as HTMLElement;
        ganttScrollContent.className = 'scheduler-scroll-content';
        ganttContainer.appendChild(ganttScrollContent);

        // Grid wheel event listener to support vertical scrolling without scrollbar
        gridContainer.addEventListener('wheel', (e) => {
            if (this.scrollElement) {
                // Forward wheel event to the master scroll element (Gantt)
                this.scrollElement.scrollTop += e.deltaY;
                // Note: We don't preventDefault here to allow native horizontal scrolling if needed
            }
        }, { passive: true });

        // Sync gantt scroll to grid scroll
        this._syncGanttScroll();
    }

    /**
     * Sync gantt container scroll to grid container scroll
     */
    private _syncGanttScroll(): void {
        if (!this.ganttPane) return;

        // Check if gantt has an inner scroll container (created by GanttRenderer)
        // The inner scroll container handles vertical scroll
        // Note: This will be set after GanttRenderer is initialized
        const checkAndSetup = () => {
            const ganttScrollContainer = (this.ganttPane as any)?.__ganttScrollContainer as HTMLElement | undefined;
            const ganttScrollTarget = ganttScrollContainer || this.ganttPane;
            
            if (ganttScrollTarget) {
                // DESIGNATE GANTT AS MASTER SCROLL ELEMENT
                this.scrollElement = ganttScrollTarget as HTMLElement;

                // Bind listener to the new master
                this.scrollElement.addEventListener('scroll', () => {
                    this._onScroll();
                }, { passive: true });
            }
        };
        
        // Try immediately, and also after a short delay in case GanttRenderer hasn't initialized yet
        checkAndSetup();
        setTimeout(checkAndSetup, 100);
    }

    /**
     * Initialize Grid renderer
     */
    initGrid(options: GridRendererOptions): void {
        if (!this.gridPane) {
            throw new Error('Grid pane not initialized. Call constructor first.');
        }

        // Override container with viewport's grid pane
        this.gridRenderer = new GridRenderer({
            ...options,
            container: this.gridPane,
            rowHeight: this.rowHeight,
            bufferRows: this.bufferRows,
        });

        this.gridReady = true;
        this._tryStart();
    }

    /**
     * Initialize Gantt renderer
     */
    initGantt(options: GanttRendererOptions): void {
        if (!this.ganttPane) {
            throw new Error('Gantt pane not initialized. Call constructor first.');
        }

        // Use the existing gantt container (preserved from HTML)
        this.ganttRenderer = new GanttRenderer({
            ...options,
            container: this.ganttPane, // This is the #gantt-container element
            rowHeight: this.rowHeight,
            headerHeight: this.headerHeight,
        });

        this.ganttReady = true;
        this._tryStart();
    }

    /**
     * Try to start render loop (if both ready)
     */
    private _tryStart(): void {
        if (this.gridReady && this.ganttReady && !this.rafId) {
            this.start();
        }
    }

    /**
     * Start the render loop
     */
    start(): void {
        if (!this.gridReady || !this.ganttReady) {
            throw new Error('Both Grid and Gantt must be initialized before start()');
        }

        this._setupResizeObserver();
        this._measure();
        this._scheduleRender();
    }

    /**
     * Setup resize observer
     */
    private _setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => {
            this._measure();
            this._scheduleRender();
        });

        if (this.container) {
            this.resizeObserver.observe(this.container);
        }
    }

    /**
     * Measure viewport dimensions
     */
    private _measure(): void {
        if (!this.scrollElement) return;

        const measuredHeight = this.scrollElement.clientHeight;
        const measuredWidth = this.scrollElement.clientWidth;
        
        // Only update if we got valid measurements (prevents 0 height issues)
        if (measuredHeight > 0) {
            this.viewportHeight = measuredHeight;
        }
        if (measuredWidth > 0) {
            this.viewportWidth = measuredWidth;
        }
        
        // If viewport height is still 0 or invalid, try alternative measurement
        if (this.viewportHeight === 0 && this.container) {
            const containerHeight = this.container.clientHeight;
            if (containerHeight > 0) {
                // Subtract header height if present
                const header = this.container.querySelector('.grid-header') as HTMLElement;
                const headerHeight = header ? header.offsetHeight : 0;
                this.viewportHeight = Math.max(0, containerHeight - headerHeight);
                console.log('[SchedulerViewport] Using fallback viewport height measurement:', this.viewportHeight);
            }
        }
    }

    /**
     * Handle scroll events
     */
    private _onScroll(): void {
        if (!this.scrollElement) return;

        const newScrollTop = this.scrollElement.scrollTop;
        if (newScrollTop === this.scrollTop) return;

        this.scrollTop = newScrollTop;
        
        // Sync Grid scroll to Gantt (Master) scroll
        if (this.gridPane) {
            this.gridPane.scrollTop = newScrollTop;
        }
        
        this._scheduleRender();
    }

    /**
     * Schedule render (RAF)
     */
    private _scheduleRender(): void {
        if (this.dirty) return;

        this.dirty = true;

        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => this._renderLoop());
        }
    }

    /**
     * Render loop (THE CORE)
     */
    private _renderLoop(): void {
        this.rafId = null;

        if (!this.dirty) return;
        this.dirty = false;

        const startTime = performance.now();

        // Calculate state ONCE
        const state = this._calculateViewportState();

        // Render both in same frame
        try {
            if (this.gridRenderer) {
                this.gridRenderer.render(state);
            }
        } catch (e) {
            console.error('[SchedulerViewport] Grid render error:', e);
            this._handleError('grid', e);
        }

        try {
            if (this.ganttRenderer) {
                this.ganttRenderer.render(state);
            }
        } catch (e) {
            console.error('[SchedulerViewport] Gantt render error:', e);
            this._handleError('gantt', e);
        }

        // Update performance metrics
        const renderTime = performance.now() - startTime;
        this.performanceMetrics.renderCount++;
        this.performanceMetrics.totalRenderTime += renderTime;
        this.performanceMetrics.maxRenderTime = Math.max(
            this.performanceMetrics.maxRenderTime,
            renderTime
        );

        if (renderTime > 16) {
            this.performanceMetrics.slowFrames++;
            console.warn(`[SchedulerViewport] Slow frame: ${renderTime.toFixed(2)}ms`);
        }

        this.performanceMetrics.avgRenderTime =
            this.performanceMetrics.totalRenderTime / this.performanceMetrics.renderCount;
    }

    /**
     * Calculate viewport state
     */
    private _calculateViewportState(): ViewportState {
        // Ensure viewport height is measured
        if (this.viewportHeight === 0) {
            this._measure();
        }
        
        // Use fallback if still 0 (prevents division by zero and incorrect calculations)
        const effectiveViewportHeight = this.viewportHeight > 0 ? this.viewportHeight : 800;
        
        const rawStart = Math.floor(this.scrollTop / this.rowHeight);
        const visibleCount = Math.ceil(effectiveViewportHeight / this.rowHeight);

        const start = Math.max(0, rawStart - this.bufferRows);
        const end = Math.min(this.dataLength - 1, rawStart + visibleCount + this.bufferRows);

        return {
            scrollTop: this.scrollTop,
            viewportHeight: effectiveViewportHeight,
            visibleRange: { start, end },
            rowHeight: this.rowHeight,
            totalHeight: this.dataLength * this.rowHeight,
        };
    }

    /**
     * Handle errors
     */
    private _handleError(source: 'grid' | 'gantt', error: unknown): void {
        this.errorCount++;

        console.error(`[SchedulerViewport] Error in ${source}:`, error);

        if (this.errorCount >= ERROR_CONFIG.maxErrors) {
            console.error(`[SchedulerViewport] Too many errors (${this.errorCount}), disabling render loop`);
            this._stopRenderLoop();

            if (this.options.onError) {
                this.options.onError(source, error);
            }

            // Reset error count after interval
            setTimeout(() => {
                this.errorCount = 0;
                console.log('[SchedulerViewport] Error count reset, re-enabling render loop');
                this._scheduleRender();
            }, ERROR_CONFIG.errorResetInterval);
        }
    }

    /**
     * Stop render loop
     */
    private _stopRenderLoop(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
    }

    /**
     * Set task data
     */
    setData(tasks: Task[]): void {
        this.tasks = tasks;
        this.dataLength = tasks.length;

        // Update scroll content height in both containers
        if (this.gridPane && this.ganttPane) {
            const height = `${Math.max(0, this.dataLength * this.rowHeight)}px`;
            const gridScrollContent = this.gridPane.querySelector('.scheduler-scroll-content') as HTMLElement;
            const ganttScrollContent = this.ganttPane.querySelector('.scheduler-scroll-content') as HTMLElement;
            if (gridScrollContent) gridScrollContent.style.height = height;
            if (ganttScrollContent) ganttScrollContent.style.height = height;
            
            // Reset scroll position if tasks are cleared
            if (this.dataLength === 0 && this.scrollElement) {
                this.scrollElement.scrollTop = 0;
                this.scrollTop = 0;
            }
        }

        if (this.gridRenderer) {
            this.gridRenderer.setData(tasks);
        }
        if (this.ganttRenderer) {
            this.ganttRenderer.setData(tasks);
        }

        this._scheduleRender();
    }

    /**
     * Set visible data (filtered)
     */
    setVisibleData(tasks: Task[]): void {
        this.setData(tasks);
    }

    /**
     * Set scroll position
     */
    setScrollTop(scrollTop: number): void {
        if (isNaN(scrollTop)) {
            scrollTop = 0;
        }

        const maxScroll = Math.max(0, (this.dataLength * this.rowHeight) - this.viewportHeight);
        scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));

        if (this.scrollElement) {
            this.scrollElement.scrollTop = scrollTop;
        }
    }

    /**
     * Get scroll position
     */
    getScrollTop(): number {
        return this.scrollTop;
    }

    /**
     * Scroll to a specific task
     */
    scrollToTask(taskId: string): void {
        const index = this.tasks.findIndex(t => t.id === taskId);
        if (index === -1) {
            console.warn('[SchedulerViewport] Task not found for scrolling:', taskId);
            return;
        }

        // Ensure viewport height is measured before calculating scroll position
        if (this.viewportHeight === 0) {
            this._measure();
        }
        
        // If still 0, use a fallback
        const effectiveViewportHeight = this.viewportHeight > 0 ? this.viewportHeight : 800;
        
        const taskTop = index * this.rowHeight;
        const viewportMiddle = effectiveViewportHeight / 2;
        const targetScrollTop = taskTop - viewportMiddle + (this.rowHeight / 2);

        this.setScrollTop(targetScrollTop);
    }

    /**
     * Set selection state
     */
    setSelection(taskIds: string[]): void {
        this.selectedIds = new Set(taskIds);

        // Update both renderers
        if (this.gridRenderer) {
            this.gridRenderer.setSelection(taskIds);
        }
        if (this.ganttRenderer) {
            this.ganttRenderer.setSelection(this.selectedIds);
        }

        // Notify SchedulerService
        if (this.options.onSelectionChange) {
            this.options.onSelectionChange(taskIds);
        }

        // Trigger re-render
        this._scheduleRender();
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
        this.setSelection([]);
    }

    /**
     * Refresh (force re-render)
     */
    refresh(): void {
        this._measure();
        this._scheduleRender();
    }

    /**
     * Update a single row
     */
    updateRow(taskId: string): void {
        if (this.gridRenderer) {
            this.gridRenderer.updateRow(taskId);
        }
        this._scheduleRender();
    }

    /**
     * Update grid columns
     */
    updateGridColumns(columns: GridColumn[]): void {
        if (this.gridRenderer) {
            this.gridRenderer.updateColumns(columns);
        }
        this._scheduleRender();
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    /**
     * Get task data
     */
    getData(): Task[] {
        return this.tasks;
    }

    /**
     * Destroy the viewport
     */
    destroy(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.gridRenderer) {
            this.gridRenderer.destroy();
            this.gridRenderer = null;
        }

        if (this.ganttRenderer) {
            this.ganttRenderer.destroy();
            this.ganttRenderer = null;
        }

        this.container.innerHTML = '';
    }
}

