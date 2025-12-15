/**
 * @fileoverview Synchronization service - syncs scrolling between grid and Gantt
 * @module services/SyncService
 */

/**
 * Sync service options
 */
export interface SyncServiceOptions {
  grid?: {
    setScrollTop: (scrollTop: number) => void;
  };
  gantt?: {
    setScrollTop: (scrollTop: number) => void;
  };
}

/**
 * Service for synchronizing scrolling between grid and Gantt views
 */
export class SyncService {
  private grid?: SyncServiceOptions['grid'];
  private gantt?: SyncServiceOptions['gantt'];
  private _isSyncing: boolean = false;

  /**
   * @param options - Configuration
   */
  constructor(options: SyncServiceOptions = {}) {
    this.grid = options.grid;
    this.gantt = options.gantt;
  }

  /**
   * Sync scroll from grid to Gantt
   * @param scrollTop - Scroll position from grid
   */
  syncGridToGantt(scrollTop: number): void {
    if (this._isSyncing) return;
    this._isSyncing = true;

    if (this.gantt?.setScrollTop) {
      this.gantt.setScrollTop(scrollTop);
    }

    requestAnimationFrame(() => {
      this._isSyncing = false;
    });
  }

  /**
   * Sync scroll from Gantt to grid
   * @param scrollTop - Scroll position from Gantt
   */
  syncGanttToGrid(scrollTop: number): void {
    if (this._isSyncing) return;
    this._isSyncing = true;

    if (this.grid?.setScrollTop) {
      this.grid.setScrollTop(scrollTop);
    }

    requestAnimationFrame(() => {
      this._isSyncing = false;
    });
  }

  /**
   * Check if currently syncing
   * @returns True if syncing
   */
  isSyncing(): boolean {
    return this._isSyncing;
  }
}
