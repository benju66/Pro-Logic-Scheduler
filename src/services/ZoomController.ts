/**
 * @fileoverview ZoomController - Manages zoom state and operations for the Gantt chart
 * @module services/ZoomController
 * 
 * Extracted from SchedulerService as part of the architectural refactoring.
 * Follows Single Responsibility Principle - only handles zoom-related functionality.
 * 
 * Key responsibilities:
 * - Zoom state management (pixelsPerDay)
 * - Zoom operations (in, out, fit, reset)
 * - Reactive state via RxJS observable
 * - Keyboard shortcut handling
 */

import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Zoom configuration constants
 * Matches industry standards for canvas-based applications
 */
export const ZOOM_CONFIG = {
    /** Minimum zoom level (most zoomed out) - 1 pixel per day */
    MIN: 1,
    /** Maximum zoom level (most zoomed in) - 80 pixels per day */
    MAX: 80,
    /** Default zoom level (100%) - 20 pixels per day */
    DEFAULT: 20,
    /** Zoom multiplier per step - 1.5x is industry standard for smooth progression */
    STEP: 1.5,
} as const;

/**
 * View mode presets with their default zoom levels
 */
export const VIEW_MODE_ZOOM = {
    Day: 40,
    Week: 20,  // This is the 100% baseline
    Month: 6,
} as const;

/**
 * Zoom state interface
 */
export interface ZoomState {
    /** Current zoom level in pixels per day */
    pixelsPerDay: number;
    /** Zoom percentage (relative to DEFAULT) */
    percentage: number;
    /** Current view mode */
    viewMode: string;
}

/**
 * Interface for the Gantt renderer that ZoomController controls
 * Allows loose coupling - any renderer implementing this works
 */
export interface IZoomableGantt {
    setZoom(pixelsPerDay: number): void;
    getZoom(): number;
    zoomIn(): void;
    zoomOut(): void;
    fitToView(): void;
    resetZoom(): void;
    getViewMode(): string;
    setViewMode(mode: string): void;
}

/**
 * ZoomController - Manages Gantt chart zoom operations
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is public for DI compatibility
 * - getInstance() retained for backward compatibility
 * - Use setInstance() in Composition Root or inject directly
 * 
 * @see docs/adr/001-dependency-injection.md
 * 
 * Usage:
 * ```typescript
 * const controller = new ZoomController();
 * controller.setGanttRenderer(ganttRenderer);
 * 
 * // Subscribe to zoom changes
 * controller.zoomState$.subscribe(state => {
 *     console.log(`Zoom: ${state.percentage}%`);
 * });
 * 
 * // Perform zoom operations
 * controller.zoomIn();
 * controller.zoomOut();
 * controller.fitToView();
 * controller.resetZoom();
 * ```
 */
export class ZoomController {
    // Singleton pattern for easy access
    private static _instance: ZoomController | null = null;
    
    // State management
    private _zoomState$ = new BehaviorSubject<ZoomState>({
        pixelsPerDay: ZOOM_CONFIG.DEFAULT,
        percentage: 100,
        viewMode: 'Week',
    });
    
    // Renderer reference (set via injection)
    private _ganttRenderer: IZoomableGantt | null = null;
    
    // Keyboard handler reference (for cleanup)
    private _keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
    
    // Disposed flag
    private _disposed = false;
    
    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static getInstance(): ZoomController {
        if (!ZoomController._instance) {
            ZoomController._instance = new ZoomController();
        }
        return ZoomController._instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static setInstance(instance: ZoomController): void {
        ZoomController._instance = instance;
    }
    
    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static resetInstance(): void {
        if (ZoomController._instance) {
            ZoomController._instance.destroy();
            ZoomController._instance = null;
        }
    }
    
    constructor() {
        // Bind keyboard handler
        this._keyboardHandler = this._handleKeyDown.bind(this);
    }
    
    /**
     * Observable for zoom state changes
     * Subscribe to get notified of zoom changes (replaces polling)
     */
    get zoomState$(): Observable<ZoomState> {
        return this._zoomState$.asObservable();
    }
    
    /**
     * Get current zoom state snapshot
     */
    get currentState(): ZoomState {
        return this._zoomState$.getValue();
    }
    
    /**
     * Get current zoom level in pixels per day
     */
    get pixelsPerDay(): number {
        return this._zoomState$.getValue().pixelsPerDay;
    }
    
    /**
     * Get current zoom percentage (100% = default)
     */
    get percentage(): number {
        return this._zoomState$.getValue().percentage;
    }
    
    /**
     * Set the Gantt renderer to control
     * @param renderer - The GanttRenderer instance (or any IZoomableGantt)
     */
    setGanttRenderer(renderer: IZoomableGantt | null): void {
        this._ganttRenderer = renderer;
        
        // Sync state from renderer if available
        if (renderer) {
            this._syncFromRenderer();
        }
    }
    
    /**
     * Initialize keyboard shortcuts
     * Call this once after the controller is set up
     */
    initKeyboardShortcuts(): void {
        if (this._keyboardHandler && typeof document !== 'undefined') {
            document.addEventListener('keydown', this._keyboardHandler);
        }
    }
    
    /**
     * Check if an input element is currently focused
     */
    private _isInputFocused(): boolean {
        if (typeof document === 'undefined') return false;
        const activeElement = document.activeElement;
        return activeElement instanceof HTMLInputElement || 
               activeElement instanceof HTMLTextAreaElement ||
               activeElement instanceof HTMLSelectElement ||
               activeElement?.getAttribute('contenteditable') === 'true';
    }
    
    /**
     * Handle keyboard shortcuts
     */
    private _handleKeyDown(e: KeyboardEvent): void {
        // Don't handle if input is focused
        if (this._isInputFocused()) return;
        
        // Check for Ctrl/Cmd modifier without Shift
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this.zoomIn();
            } else if (e.key === '-') {
                e.preventDefault();
                this.zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                this.resetZoom();
            }
        }
    }
    
    /**
     * Zoom in (increase pixelsPerDay)
     */
    zoomIn(): void {
        if (this._disposed) return;
        
        if (this._ganttRenderer) {
            this._ganttRenderer.zoomIn();
            this._syncFromRenderer();
        } else {
            // Fallback: calculate locally
            const newZoom = Math.min(
                this.pixelsPerDay * ZOOM_CONFIG.STEP,
                ZOOM_CONFIG.MAX
            );
            this._updateState(newZoom);
        }
    }
    
    /**
     * Zoom out (decrease pixelsPerDay)
     */
    zoomOut(): void {
        if (this._disposed) return;
        
        if (this._ganttRenderer) {
            this._ganttRenderer.zoomOut();
            this._syncFromRenderer();
        } else {
            // Fallback: calculate locally
            const newZoom = Math.max(
                this.pixelsPerDay / ZOOM_CONFIG.STEP,
                ZOOM_CONFIG.MIN
            );
            this._updateState(newZoom);
        }
    }
    
    /**
     * Set zoom to a specific level
     * @param pixelsPerDay - Target zoom level in pixels per day
     */
    setZoom(pixelsPerDay: number): void {
        if (this._disposed) return;
        
        // Clamp to valid range
        const clampedZoom = Math.max(
            ZOOM_CONFIG.MIN,
            Math.min(ZOOM_CONFIG.MAX, pixelsPerDay)
        );
        
        if (this._ganttRenderer) {
            this._ganttRenderer.setZoom(clampedZoom);
            this._syncFromRenderer();
        } else {
            this._updateState(clampedZoom);
        }
    }
    
    /**
     * Fit entire timeline to view
     */
    fitToView(): void {
        if (this._disposed) return;
        
        if (this._ganttRenderer) {
            this._ganttRenderer.fitToView();
            this._syncFromRenderer();
        }
        // No fallback for fit-to-view - requires timeline data
    }
    
    /**
     * Reset zoom to default for current view mode
     */
    resetZoom(): void {
        if (this._disposed) return;
        
        if (this._ganttRenderer) {
            this._ganttRenderer.resetZoom();
            this._syncFromRenderer();
        } else {
            this._updateState(ZOOM_CONFIG.DEFAULT);
        }
    }
    
    /**
     * Set view mode (Day, Week, Month)
     * Note: This doesn't change zoom level - view mode and zoom are independent
     * @param mode - The view mode to set
     */
    setViewMode(mode: string): void {
        if (this._disposed) return;
        
        if (this._ganttRenderer) {
            this._ganttRenderer.setViewMode(mode);
            this._syncFromRenderer();
        } else {
            const currentState = this._zoomState$.getValue();
            this._zoomState$.next({
                ...currentState,
                viewMode: mode,
            });
        }
    }
    
    /**
     * Sync state from the renderer
     */
    private _syncFromRenderer(): void {
        if (!this._ganttRenderer || this._disposed) return;
        
        const pixelsPerDay = this._ganttRenderer.getZoom();
        const viewMode = this._ganttRenderer.getViewMode();
        const percentage = Math.round((pixelsPerDay / ZOOM_CONFIG.DEFAULT) * 100);
        
        this._zoomState$.next({
            pixelsPerDay,
            percentage,
            viewMode,
        });
    }
    
    /**
     * Update internal state
     */
    private _updateState(pixelsPerDay: number): void {
        if (this._disposed) return;
        
        const percentage = Math.round((pixelsPerDay / ZOOM_CONFIG.DEFAULT) * 100);
        const currentState = this._zoomState$.getValue();
        
        this._zoomState$.next({
            ...currentState,
            pixelsPerDay,
            percentage,
        });
    }
    
    /**
     * Force state refresh from renderer
     * Call this if you suspect state is out of sync
     */
    refresh(): void {
        this._syncFromRenderer();
    }
    
    /**
     * Clean up resources
     */
    destroy(): void {
        this._disposed = true;
        
        // Remove keyboard handler
        if (this._keyboardHandler && typeof document !== 'undefined') {
            document.removeEventListener('keydown', this._keyboardHandler);
            this._keyboardHandler = null;
        }
        
        // Complete the subject
        this._zoomState$.complete();
        
        // Clear renderer reference
        this._ganttRenderer = null;
    }
}
