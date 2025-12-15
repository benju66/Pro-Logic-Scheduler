/**
 * @fileoverview Stats Service - Manages performance statistics display
 * @module services/StatsService
 * 
 * Handles updating the stats bar with performance metrics.
 */

import type { SchedulerService } from './SchedulerService';

/**
 * Stats service options
 */
export interface StatsServiceOptions {
  getScheduler?: () => SchedulerService | null;
}

/**
 * Performance memory interface (non-standard, Chrome/Edge only)
 */
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Extended Performance interface with memory property
 */
interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

/**
 * Stats Service
 * Manages the performance statistics bar updates
 */
export class StatsService {
  private getScheduler: () => SchedulerService | null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new StatsService instance
   * @param options - Configuration
   */
  constructor(options: StatsServiceOptions = {}) {
    this.getScheduler = options.getScheduler || (() => null);
    this.intervalId = null;
  }

  /**
   * Start updating stats periodically
   * @param intervalMs - Update interval in milliseconds (default: 500)
   */
  start(intervalMs: number = 500): void {
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
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Update stats bar with current values
   */
  update(): void {
    const scheduler = this.getScheduler();
    if (!scheduler) return;
    
    const stats = scheduler.getStats();
    
    const setEl = (id: string, value: string | number): void => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    
    setEl('stat-tasks', stats.taskCount?.toLocaleString() || '0');
    setEl('stat-visible', stats.visibleCount?.toLocaleString() || '0');
    setEl('stat-rendered', (stats.gridStats as { renderedRows?: number })?.renderedRows || '0');
    setEl('stat-calc', stats.lastCalcTime || '0ms');
    setEl('stat-gantt', (stats.ganttStats as { lastRenderTime?: string })?.lastRenderTime || '0ms');
    
    // Memory usage (if available - Chrome/Edge only)
    const perf = performance as PerformanceWithMemory;
    if (perf.memory) {
      const mb = (perf.memory.usedJSHeapSize / 1048576).toFixed(1);
      setEl('stat-memory', `${mb} MB`);
      
      const memEl = document.getElementById('stat-memory');
      if (memEl) {
        memEl.classList.remove('warning', 'error');
        const mbNum = parseFloat(mb);
        if (mbNum > 200) memEl.classList.add('error');
        else if (mbNum > 100) memEl.classList.add('warning');
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
  destroy(): void {
    this.stop();
  }
}
