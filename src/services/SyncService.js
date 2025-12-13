/**
 * @fileoverview Synchronization service - syncs scrolling between grid and Gantt
 * @module services/SyncService
 */

/**
 * Service for synchronizing scrolling between grid and Gantt views
 * @class
 */
export class SyncService {
    /**
     * @param {Object} options - Configuration
     * @param {Object} options.grid - Grid component instance
     * @param {Object} options.gantt - Gantt component instance
     */
    constructor(options = {}) {
        this.grid = options.grid;
        this.gantt = options.gantt;
        this._isSyncing = false;
    }

    /**
     * Sync scroll from grid to Gantt
     * @param {number} scrollTop - Scroll position from grid
     */
    syncGridToGantt(scrollTop) {
        if (this._isSyncing) return;
        this._isSyncing = true;

        if (this.gantt && typeof this.gantt.setScrollTop === 'function') {
            this.gantt.setScrollTop(scrollTop);
        }

        requestAnimationFrame(() => {
            this._isSyncing = false;
        });
    }

    /**
     * Sync scroll from Gantt to grid
     * @param {number} scrollTop - Scroll position from Gantt
     */
    syncGanttToGrid(scrollTop) {
        if (this._isSyncing) return;
        this._isSyncing = true;

        if (this.grid && typeof this.grid.setScrollTop === 'function') {
            this.grid.setScrollTop(scrollTop);
        }

        requestAnimationFrame(() => {
            this._isSyncing = false;
        });
    }

    /**
     * Check if currently syncing
     * @returns {boolean} True if syncing
     */
    isSyncing() {
        return this._isSyncing;
    }
}

