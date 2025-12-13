// @ts-check
/**
 * @fileoverview Stats Service - Manages performance statistics display
 * @module services/StatsService
 * 
 * Handles updating the stats bar with performance metrics.
 */

/**
 * Stats Service
 * Manages the performance statistics bar updates
 * @class
 */
export class StatsService {
    /**
     * Create a new StatsService instance
     * @param {Object} options - Configuration
     * @param {Function} options.getScheduler - Function to get scheduler instance
     */
    constructor(options = {}) {
        this.getScheduler = options.getScheduler || (() => null);
        this.intervalId = null;
    }

    /**
     * Start updating stats periodically
     * @param {number} intervalMs - Update interval in milliseconds (default: 500)
     */
    start(intervalMs = 500) {
        this.stop(); // Stop any existing interval
        
        // Initial update
        this.update();
        
        // Set up periodic updates
        this.intervalId = setInterval(() => {
            this.update();
        }, intervalMs);
    }

    /**
     * Stop updating stats
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Update stats bar with current values
     */
    update() {
        const scheduler = this.getScheduler();
        if (!scheduler) return;
        
        const stats = scheduler.getStats();
        
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('stat-tasks', stats.taskCount?.toLocaleString() || '0');
        setEl('stat-visible', stats.visibleCount?.toLocaleString() || '0');
        setEl('stat-rendered', stats.gridStats?.renderedRows || '0');
        setEl('stat-calc', stats.lastCalcTime || '0ms');
        setEl('stat-gantt', stats.ganttStats?.lastRenderTime || '0ms');
        
        // Memory usage (if available)
        if (performance.memory) {
            const mb = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
            setEl('stat-memory', `${mb} MB`);
            
            const memEl = document.getElementById('stat-memory');
            if (memEl) {
                memEl.classList.remove('warning', 'error');
                if (mb > 200) memEl.classList.add('error');
                else if (mb > 100) memEl.classList.add('warning');
            }
        }
        
        // Update zoom label
        const zoomLabel = document.getElementById('zoom-label');
        if (zoomLabel && scheduler.viewMode) {
            zoomLabel.textContent = scheduler.viewMode;
        }
        
        // Update button count (for debugging)
        const buttonCount = document.querySelectorAll('[data-action]').length;
        setEl('stat-buttons', buttonCount);
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stop();
    }
}

