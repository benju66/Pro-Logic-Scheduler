/**
 * @fileoverview Scheduler Viewport - Master Controller for Unified Scheduler V2
 * @module ui/components/scheduler/SchedulerViewport
 * 
 * The single source of truth for vertical scroll position.
 * Owns the RAF loop. Drives both renderers.
 * Manages selection state.
 * NO SINGLETON PATTERN - constructor-based.
 */

import type { Task, GridColumn, Calendar } from '../../../types';
import type { ViewportState, SchedulerViewportOptions, GridRendererOptions, GanttRendererOptions, PerformanceMetrics } from './types';
import { GridRenderer } from './GridRenderer';
import { GanttRenderer } from './GanttRenderer';
import { ProjectController } from '../../../services/ProjectController';
import { SelectionModel } from '../../../services/SelectionModel';
import { Subscription } from 'rxjs';
import { ROW_HEIGHT, HEADER_HEIGHT, DEFAULT_BUFFER_ROWS, ERROR_CONFIG } from './constants';

/**
 * Options for setSelection behavior
 */
export interface SetSelectionOptions {
    /** If true, focus the cell for editing (scroll to task and focus input). Default: false */
    focusCell?: boolean;
    /** The field to focus when focusCell is true. Default: 'name' */
    focusField?: string;
}

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
    private errorRecoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Resize observer
    private resizeObserver: ResizeObserver | null = null;

    // Destroy state
    private isDestroyed: boolean = false;

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

    // Services (singletons)
    private controller: ProjectController;
    private selectionModel: SelectionModel;

    // Subscriptions (for cleanup)
    private subscriptions: Subscription[] = [];
    
    // Flag to prevent circular selection updates
    private isUpdatingFromSubscription: boolean = false;

    /**
     * Constructor (NO SINGLETON)
     */
    constructor(container: HTMLElement, options: SchedulerViewportOptions = {}) {
        this.container = container;
        this.options = options;

        // Initialize services (singletons ensure shared state across app)
        this.controller = ProjectController.getInstance();
        this.selectionModel = SelectionModel.getInstance();

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
            overflow-y: auto;
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
        // CRITICAL: Must be position: absolute (not relative) to prevent pushing rows down
        this.scrollContent = document.createElement('div');
        this.scrollContent.className = 'scheduler-scroll-content';
        this.scrollContent.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            width: 100%;
            min-height: 0;
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

        // Use grid-container as the primary scroll element (we'll sync gantt to it)
        this.scrollElement = gridContainer;

        // Bind scroll listener on grid-container (passive)
        this.scrollElement.addEventListener('scroll', () => this._onScroll(), { passive: true });

        // Sync gantt scroll to grid scroll
        this._syncGanttScroll();
    }

    /**
     * Sync gantt container scroll to grid container scroll
     */
    private _syncGanttScroll(): void {
        if (!this.scrollElement || !this.ganttPane) return;

        let isSyncing = false;

        // Sync gantt -> grid (vertical only)
        // Check if gantt has an inner scroll container (created by GanttRenderer)
        // The inner scroll container handles vertical scroll
        // Note: This will be set after GanttRenderer is initialized
        // We'll set up the listener after initGantt is called
        const checkAndSetup = () => {
            const ganttScrollContainer = (this.ganttPane as any)?.__ganttScrollContainer as HTMLElement | undefined;
            const ganttScrollTarget = ganttScrollContainer || this.ganttPane;
            
            if (ganttScrollTarget) {
                ganttScrollTarget.addEventListener('scroll', () => {
                    if (isSyncing || !this.scrollElement) return;
                    isSyncing = true;
                    this.scrollElement.scrollTop = (ganttScrollTarget as HTMLElement).scrollTop;
                    // Trigger render since scroll changed
                    this._onScroll();
                    isSyncing = false;
                }, { passive: true });
            }
        };
        
        // Try immediately, and also after a short delay in case GanttRenderer hasn't initialized yet
        checkAndSetup();
        setTimeout(() => {
            // Guard: Don't setup if destroyed
            if (this.isDestroyed) return;
            checkAndSetup();
        }, 100);
    }

    /**
     * Initialize Grid renderer
     */
    initGrid(options: GridRendererOptions): void {
        if (!this.gridPane) {
            throw new Error('Grid pane not initialized. Call constructor first.');
        }

        // Pass services to renderer for direct communication
        this.gridRenderer = new GridRenderer(
            {
                ...options,
                container: this.gridPane,
                rowHeight: this.rowHeight,
                bufferRows: this.bufferRows,
            },
            this.controller,
            this.selectionModel
        );

        // Propagate existing data to the newly created renderer
        // This ensures data is available even if setData() was called before initGrid()
        if (this.tasks.length > 0) {
            this.gridRenderer.setData(this.tasks);
        }

        this.gridReady = true;
        this._tryStart();
    }

    /**
     * Initialize Gantt renderer
     */
    initGantt(options: GanttRendererOptions): void {
        console.log('[SchedulerViewport] initGantt() called');
        if (!this.ganttPane) {
            throw new Error('Gantt pane not initialized. Call constructor first.');
        }

        // Pass services to renderer for direct communication
        console.log('[SchedulerViewport] Creating GanttRenderer...');
        this.ganttRenderer = new GanttRenderer(
            {
                ...options,
                container: this.ganttPane, // This is the #gantt-container element
                rowHeight: this.rowHeight,
                headerHeight: this.headerHeight,
                onNeedsRender: () => this._scheduleRender(), // FIX: Notify viewport when gantt needs render
            },
            this.controller,
            this.selectionModel
        );

        // Propagate existing data to the newly created renderer
        // This ensures data is available even if setData() was called before initGantt()
        if (this.tasks.length > 0) {
            this.ganttRenderer.setData(this.tasks);
        }

        this.ganttReady = true;
        console.log('[SchedulerViewport] GanttRenderer created, ganttReady=true');
        this._tryStart();
    }

    /**
     * Try to start render loop (if both ready)
     */
    private _tryStart(): void {
        console.log(`[SchedulerViewport] _tryStart() - gridReady=${this.gridReady}, ganttReady=${this.ganttReady}, rafId=${this.rafId}`);
        if (this.gridReady && this.ganttReady && !this.rafId) {
            this.start();
        }
    }

    /**
     * Track if start() has been called to prevent duplicate subscriptions
     */
    private isStarted: boolean = false;

    /**
     * Start the render loop
     */
    start(): void {
        console.log('[SchedulerViewport] start() called');
        
        // CRITICAL FIX: Prevent duplicate subscriptions
        if (this.isStarted) {
            console.log('[SchedulerViewport] start() already called - skipping duplicate');
            return;
        }
        
        if (!this.gridReady || !this.ganttReady) {
            throw new Error('Both Grid and Gantt must be initialized before start()');
        }
        
        this.isStarted = true;

        // Subscribe to ProjectController for task data updates (Worker -> UI)
        // IMPORTANT: Transform to visible hierarchy order for correct navigation/display
        console.log('[SchedulerViewport] Subscribing to ProjectController.tasks$...');
        this.subscriptions.push(
            this.controller.tasks$.subscribe(_tasks => {
                // Get tasks in HIERARCHY ORDER (matching navigation expectations)
                // This ensures index-based navigation (up/down arrows) works correctly
                const visibleTasks = this.controller.getVisibleTasks((id) => {
                    const task = this.controller.getTaskById(id);
                    return task?._collapsed || false;
                });
                console.log(`[SchedulerViewport] Received ${visibleTasks.length} visible tasks from ProjectController`);
                this.setData(visibleTasks);
            })
        );

        // Subscribe to SelectionModel for selection state updates (UI -> UI, synchronous)
        // CRITICAL: Set flag to prevent circular callback loop
        this.subscriptions.push(
            this.selectionModel.state$.subscribe(state => {
                // Convert Set to Array for setSelection signature
                const selectedArray = Array.from(state.selectedIds);
                
                // Set flag to prevent callback loop:
                // SelectionModel → setSelection() → onSelectionChange → _handleSelectionChange → SelectionModel (LOOP!)
                this.isUpdatingFromSubscription = true;
                this.setSelection(selectedArray, state.focusedId);
                this.isUpdatingFromSubscription = false;
            })
        );

        this._setupResizeObserver();
        this._measure();
        this._scheduleRender();
    }

    /**
     * Setup resize observer
     */
    private _setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => {
            // Guard: Don't process resize if destroyed
            if (this.isDestroyed) return;
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
        // Guard: Don't process scroll if destroyed
        if (this.isDestroyed) return;

        if (!this.scrollElement) return;

        const newScrollTop = this.scrollElement.scrollTop;
        if (newScrollTop === this.scrollTop) return;

        this.scrollTop = newScrollTop;
        
        // Sync gantt scroll to grid scroll (vertical only)
        // Check if gantt has an inner scroll container (created by GanttRenderer)
        const ganttScrollContainer = (this.ganttPane as any)?.__ganttScrollContainer as HTMLElement | undefined;
        const ganttScrollTarget = ganttScrollContainer || this.ganttPane;
        
        if (ganttScrollTarget && ganttScrollTarget instanceof HTMLElement) {
            if (Math.abs(ganttScrollTarget.scrollTop - newScrollTop) > 1) {
                ganttScrollTarget.scrollTop = newScrollTop;
            }
        }
        
        this._scheduleRender();
    }

    /**
     * Schedule render (RAF)
     */
    private _scheduleRender(): void {
        // Guard: Don't schedule if destroyed
        if (this.isDestroyed) return;

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
        console.log(`[SchedulerViewport] _renderLoop() called, isDestroyed=${this.isDestroyed}, dirty=${this.dirty}`);

        // Guard 1: Early exit if destroyed (prevents post-destroy execution)
        if (this.isDestroyed) return;

        if (!this.dirty) return;
        this.dirty = false;

        // Guard 2: Capture renderer references atomically (prevents mid-render nullification)
        const grid = this.gridRenderer;
        const gantt = this.ganttRenderer;

        // Guard 3: Both renderers must exist for synchronized rendering
        // Critical for MS Project-style apps - both views must update together
        if (!grid || !gantt) {
            // Don't render if either is missing (prevents desync)
            return;
        }

        // Guard 4: Double-check destroy state after capturing references
        // Handles race condition where destroy() called between guards
        if (this.isDestroyed) return;

        const startTime = performance.now();

        // Calculate state ONCE (shared by both renderers)
        const state = this._calculateViewportState();

        // Render both in same frame with captured references (atomic)
        try {
            grid.render(state);
        } catch (e) {
            console.error('[SchedulerViewport] Grid render error:', e);
            this._handleError('grid', e);
        }

        try {
            gantt.render(state);
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

            // Clear any existing error recovery timeout
            if (this.errorRecoveryTimeoutId !== null) {
                clearTimeout(this.errorRecoveryTimeoutId);
                this.errorRecoveryTimeoutId = null;
            }

            // Reset error count after interval
            // Store timeout ID for cleanup in destroy()
            this.errorRecoveryTimeoutId = setTimeout(() => {
                // Guard: Don't re-enable if destroyed
                if (this.isDestroyed) return;

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
        console.log(`[SchedulerViewport] setData() called with ${tasks.length} tasks, isDestroyed=${this.isDestroyed}`);
        // Guard: Don't process data if destroyed
        if (this.isDestroyed) return;

        this.tasks = tasks;
        this.dataLength = tasks.length;

        // Update scroll content height in grid container
        // Note: GanttRenderer manages its own scroll content (cg-scroll-content), so we don't update gantt here
        if (this.gridPane) {
            const height = `${Math.max(0, this.dataLength * this.rowHeight)}px`;
            const gridScrollContent = this.gridPane.querySelector('.scheduler-scroll-content') as HTMLElement;
            if (gridScrollContent) {
                gridScrollContent.style.height = height;
                gridScrollContent.style.minHeight = height; // Ensure minimum height for scroll calculation
            }
            
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
     * @param taskIds - Array of selected task IDs
     * @param focusedId - The task ID that should be considered "focused" (for keyboard navigation anchor)
     * @param options - Optional behavior configuration
     */
    setSelection(taskIds: string[], focusedId?: string | null, options?: SetSelectionOptions): void {
        // Guard: Don't process selection if destroyed
        if (this.isDestroyed) return;

        this.selectedIds = new Set(taskIds);

        // Update both renderers
        if (this.gridRenderer) {
            this.gridRenderer.setSelection(taskIds);
            
            // Only focus cell if explicitly requested (e.g., after adding a task or pressing F2)
            if (options?.focusCell && focusedId && taskIds.includes(focusedId)) {
                const field = options.focusField ?? 'name';
                requestAnimationFrame(() => {
                    this.gridRenderer?.focusCell(focusedId, field);
                });
            }
        }
        if (this.ganttRenderer) {
            this.ganttRenderer.setSelection(this.selectedIds);
        }

        // Notify SchedulerService - BUT NOT if this came from SelectionModel subscription
        // This prevents the circular loop: SelectionModel → setSelection → callback → SelectionModel
        if (this.options.onSelectionChange && !this.isUpdatingFromSubscription) {
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
        // Guard: Don't refresh if destroyed
        if (this.isDestroyed) return;

        this._measure();
        this._scheduleRender();
    }

    /**
     * Update a single row
     */
    updateRow(taskId: string): void {
        // Guard: Don't update if destroyed
        if (this.isDestroyed) return;

        if (this.gridRenderer) {
            this.gridRenderer.updateRow(taskId);
        }
        this._scheduleRender();
    }

    /**
     * Update grid columns
     */
    updateGridColumns(columns: GridColumn[]): void {
        // Guard: Don't update if destroyed
        if (this.isDestroyed) return;

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
     * Sets isDestroyed flag FIRST to prevent all new operations
     * Then cleans up all resources in proper order
     */
    destroy(): void {
        // Set flag FIRST (prevents all new operations and queued callbacks)
        this.isDestroyed = true;

        // Unsubscribe from all observables (prevents memory leaks)
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];

        // Clear error recovery timeout (prevents post-destroy render scheduling)
        if (this.errorRecoveryTimeoutId !== null) {
            clearTimeout(this.errorRecoveryTimeoutId);
            this.errorRecoveryTimeoutId = null;
        }

        // Cancel pending RAF (prevents queued render callbacks)
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Disconnect observers (callbacks will check isDestroyed flag)
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Destroy renderers (cleanup their resources)
        if (this.gridRenderer) {
            this.gridRenderer.destroy();
            this.gridRenderer = null;
        }

        if (this.ganttRenderer) {
            this.ganttRenderer.destroy();
            this.ganttRenderer = null;
        }

        // Clear DOM last (ensures no render can access DOM after this point)
        this.container.innerHTML = '';
    }
}

