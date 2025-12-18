/**
 * @fileoverview Shared constants for Unified Scheduler V2
 * @module ui/components/scheduler/constants
 */

/**
 * Row height in pixels (must match CSS)
 */
export const ROW_HEIGHT = 38;

/**
 * Header height in pixels
 */
export const HEADER_HEIGHT = 50;

/**
 * Default buffer rows (extra rows above/below viewport)
 */
export const DEFAULT_BUFFER_ROWS = 5;

/**
 * Maximum pool size (safety limit)
 */
export const MAX_POOL_SIZE = 100;

/**
 * Performance budgets (in milliseconds)
 */
export const PERFORMANCE_BUDGETS = {
    /** Target frame time for 60 FPS */
    renderFrame: 16,
    /** Max time to bind a single row */
    bindRow: 0.1,
    /** Max time to draw a single bar */
    drawBar: 0.05,
    /** Max time to calculate visible range */
    calculateRange: 0.1,
} as const;

/**
 * Error handling constants
 */
export const ERROR_CONFIG = {
    /** Maximum errors before disabling render loop */
    maxErrors: 5,
    /** Time to wait before resetting error count (ms) */
    errorResetInterval: 60000, // 1 minute
} as const;

