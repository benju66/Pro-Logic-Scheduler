/**
 * @fileoverview App Initializer - Handles application startup and initialization
 * @module services/AppInitializer
 * 
 * Manages the initialization sequence for the application.
 */

/// <reference path="../types/globals.d.ts" />

import { SchedulerService } from './SchedulerService';
import { StatsService } from './StatsService';
import { PersistenceService } from '../data/PersistenceService';
import { MigrationService } from '../data/MigrationService';
import type { SchedulerServiceOptions } from '../types';

/**
 * App initializer options
 */
export interface AppInitializerOptions {
  isTauri?: boolean;
}

/**
 * App Initializer Service
 * Handles application initialization sequence
 */
export class AppInitializer {
  private isTauri: boolean;
  private scheduler: SchedulerService | null = null;
  private statsService: StatsService | null = null;
  private persistenceService: PersistenceService | null = null;
  private migrationService: MigrationService | null = null;
  private isInitializing: boolean = false;
  public isInitialized: boolean = false;  // Public for access from main.ts

  /**
   * Create a new AppInitializer instance
   * @param options - Configuration
   */
  constructor(options: AppInitializerOptions = {}) {
    this.isTauri = options.isTauri || false;
    this.scheduler = null;
    this.statsService = null;
    this.isInitializing = false;
    this.isInitialized = false;
  }

  /**
   * Initialize the application
   * @returns Promise that resolves with the initialized scheduler instance
   */
  async initialize(): Promise<SchedulerService> {
    // Prevent double initialization
    if (this.isInitializing || this.isInitialized) {
      console.log('⚠️ Already initializing or initialized, skipping duplicate init');
      if (!this.scheduler) {
        throw new Error('Scheduler not initialized');
      }
      return this.scheduler;
    }
    
    this.isInitializing = true;
    console.log('🏎️ Pro Logic Scheduler - VS Code of Scheduling Tools');
    console.log('==================================================');
    console.log(`Environment: ${this.isTauri ? 'Tauri Desktop' : 'Web Browser'}`);
    console.log('🦀 Tauri detected:', this.isTauri);
    console.log('📄 Document ready state:', document.readyState);
    
    try {
      // Setup Tauri APIs if needed
      if (this.isTauri) {
        await this._setupTauriAPIs();
        // Give Tauri a moment to fully initialize
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Initialize persistence service (for SQLite)
      await this._initializePersistence();
      
      // Run migration from localStorage to SQLite (if needed)
      await this._runMigration();
      
      // Initialize scheduler
      await this._initializeScheduler();
      
      // Initialize UI handlers
      this._initializeUIHandlers();
      
      // Initialize stats service
      this._initializeStatsService();
      
      this.isInitialized = true;
      this.isInitializing = false;
      
      console.log('✅ Scheduler initialized');
      console.log('✅ window.scheduler available:', typeof window.scheduler);
      console.log('✅ Initial task count:', this.scheduler?.tasks?.length || 0);
      console.log('✅ Grid initialized:', !!this.scheduler?.grid);
      console.log('✅ Gantt initialized:', !!this.scheduler?.gantt);
      
      if (!this.scheduler) {
        throw new Error('Scheduler initialization failed');
      }
      
      return this.scheduler;
    } catch (error) {
      const err = error as Error;
      console.error('❌ Failed to initialize scheduler:', err);
      console.error('Error stack:', err.stack);
      this.isInitializing = false;
      this.scheduler = null;
      delete window.scheduler;
      alert('Failed to initialize scheduler. Check console for details.');
      throw error;
    }
  }

  /**
   * Initialize persistence service
   * @private
   */
  private async _initializePersistence(): Promise<void> {
    if (!this.isTauri) {
      console.log('[AppInitializer] Skipping persistence (not Tauri environment)');
      return;
    }

    try {
      console.log('[AppInitializer] Initializing PersistenceService...');
      this.persistenceService = new PersistenceService();
      await this.persistenceService.init();
      console.log('[AppInitializer] ✅ PersistenceService initialized');
    } catch (error) {
      console.error('[AppInitializer] Failed to initialize PersistenceService:', error);
      // Continue without persistence - app can still work
    }
  }

  /**
   * Run migration from localStorage to SQLite
   * @private
   */
  private async _runMigration(): Promise<void> {
    if (!this.isTauri || !this.persistenceService) {
      console.log('[AppInitializer] Skipping migration (not Tauri or persistence not available)');
      return;
    }

    try {
      console.log('[AppInitializer] Running migration from localStorage to SQLite...');
      this.migrationService = new MigrationService(this.persistenceService);
      const migrated = await this.migrationService.migrateFromLocalStorage();
      
      if (migrated) {
        console.log('[AppInitializer] ✅ Migration completed successfully');
      } else {
        console.log('[AppInitializer] No migration needed (no localStorage data found)');
      }
    } catch (error) {
      console.error('[AppInitializer] Migration failed:', error);
      // Continue anyway - migration failure shouldn't block app startup
    }
  }

  /**
   * Setup Tauri APIs
   * @private
   */
  private async _setupTauriAPIs(): Promise<void> {
    console.log('🦀 Running in Tauri environment');
    
    // Import Tauri APIs when available
    try {
      const { open, save } = await import('@tauri-apps/api/dialog');
      // Window globals are typed in globals.d.ts - using type assertion for dynamic assignment
      (window as Window & { tauriDialog?: { open: (options?: unknown) => Promise<string | null>; save: (options?: unknown) => Promise<string | null> } }).tauriDialog = { 
        open: open as (options?: unknown) => Promise<string | null>,
        save: save as (options?: unknown) => Promise<string | null>
      };
    } catch (e) {
      console.warn('Failed to load Tauri dialog API:', e);
    }
    
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/api/fs');
      // Window globals are typed in globals.d.ts - using type assertion for dynamic assignment
      (window as Window & { tauriFs?: { readTextFile: (path: string) => Promise<string>; writeTextFile: (path: string, contents: string) => Promise<void> } }).tauriFs = { 
        readTextFile: readTextFile as (path: string) => Promise<string>,
        writeTextFile: writeTextFile as (path: string, contents: string) => Promise<void>
      };
    } catch (e) {
      console.warn('Failed to load Tauri fs API:', e);
    }
  }

  /**
   * Initialize scheduler service
   * @private
   */
  private async _initializeScheduler(): Promise<void> {
    console.log('🚀 Starting scheduler initialization...');
    
    // Get containers
    const gridContainer = document.getElementById('grid-container');
    const ganttContainer = document.getElementById('gantt-container');
    const drawerContainer = document.getElementById('drawer-container');
    const modalContainer = document.getElementById('modal-container');
    
    if (!gridContainer || !ganttContainer) {
      const error = new Error('Missing required containers!');
      console.error('Missing containers:', {
        gridContainer: !!gridContainer,
        ganttContainer: !!ganttContainer
      });
      throw error;
    }
    
    // Initialize scheduler service
    console.log('🔧 Creating SchedulerService...');
    const options: SchedulerServiceOptions = {
      gridContainer: gridContainer,
      ganttContainer: ganttContainer,
      drawerContainer: drawerContainer || undefined,
      modalContainer: modalContainer || undefined,
      isTauri: this.isTauri,
    };
    
    this.scheduler = new SchedulerService(options);
    
    // Wait for scheduler to fully initialize (init() is now async)
    console.log('⏳ Waiting for scheduler to fully initialize...');
    await this.scheduler.init();
    
    console.log('✅ SchedulerService initialized');
    console.log('  - grid:', !!this.scheduler.grid);
    console.log('  - gantt:', !!this.scheduler.gantt);
    
    // Verify scheduler initialized successfully
    console.log('🔍 Verifying scheduler components...');
    if (!this.scheduler || !this.scheduler.grid || !this.scheduler.gantt) {
      throw new Error('Scheduler initialization incomplete - components missing');
    }
    
    // Make scheduler available globally (for button handlers)
    window.scheduler = this.scheduler;
    console.log('✅ window.scheduler set');
  }

    /**
     * Initialize UI handlers
     * @private
     */
    private _initializeUIHandlers(): void {
        console.log('🔧 Setting up UI handlers...');
        
        // These will be extracted to UIEventManager in next step
        // For now, they're called from main.ts after initialization
        // This method is kept for future refactoring
        
        console.log('  ✅ UI handlers will be initialized from main.ts');
    }

  /**
   * Initialize stats service
   * @private
   */
  private _initializeStatsService(): void {
    this.statsService = new StatsService({
      getScheduler: () => this.scheduler
    });
    this.statsService.start(500);
    (window as Window & { statsService?: StatsService }).statsService = this.statsService;
  }

  /**
   * Get the scheduler instance
   * @returns Scheduler instance or null
   */
  getScheduler(): SchedulerService | null {
    return this.scheduler;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.statsService) {
      this.statsService.destroy();
    }
    this.scheduler = null;
    window.scheduler = undefined;
  }
}
