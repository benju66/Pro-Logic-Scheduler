/**
 * @fileoverview App Initializer - Handles application startup and initialization
 * @module services/AppInitializer
 * 
 * Manages the initialization sequence for the application.
 * 
 * PHASE 6: Now wires together ProjectController, PersistenceService, and SnapshotService
 * for proper event sourcing and SQLite persistence.
 */

/// <reference path="../types/globals.d.ts" />

import { SchedulerService } from './SchedulerService';
import { StatsService } from './StatsService';
import { ProjectController } from './ProjectController';
import { PersistenceService } from '../data/PersistenceService';
import { SnapshotService } from '../data/SnapshotService';
import { DataLoader } from '../data/DataLoader';
import { ActivityBar } from '../ui/components/ActivityBar';
import { SettingsModal } from '../ui/components/SettingsModal';
import { RightSidebarManager } from '../ui/components/RightSidebarManager';
import type { SchedulerServiceOptions, Calendar, TradePartner } from '../types';

/**
 * App initializer options
 */
export interface AppInitializerOptions {
  isTauri?: boolean;
}

/**
 * App Initializer Service
 * Handles application initialization sequence
 * 
 * STRANGLER FIG: Now a singleton to provide shared access to services
 */
export class AppInitializer {
  // Singleton instance
  private static instance: AppInitializer | null = null;
  
  private isTauri: boolean;
  private scheduler: SchedulerService | null = null;
  private statsService: StatsService | null = null;
  private persistenceService: PersistenceService | null = null;
  private snapshotService: SnapshotService | null = null;
  private dataLoader: DataLoader | null = null;
  private projectController: ProjectController | null = null;
  private activityBar: ActivityBar | null = null;
  private settingsModal: SettingsModal | null = null;
  private rightSidebarManager: RightSidebarManager | null = null;
  private isInitializing: boolean = false;
  public isInitialized: boolean = false;  // Public for access from main.ts
  
  // Store loaded data for SnapshotService accessors
  private loadedCalendar: Calendar = { workingDays: [1, 2, 3, 4, 5], exceptions: {} };
  private loadedTradePartners: TradePartner[] = [];

  /**
   * Get singleton instance (must be created first via constructor)
   */
  public static getInstance(): AppInitializer | null {
    return AppInitializer.instance;
  }

  /**
   * Create a new AppInitializer instance
   * @param options - Configuration
   */
  constructor(options: AppInitializerOptions = {}) {
    this.isTauri = options.isTauri || false;
    this.scheduler = null;
    this.statsService = null;
    
    // Store singleton reference
    AppInitializer.instance = this;
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
    console.log('Environment: Tauri Desktop');
    console.log('🦀 Tauri detected:', this.isTauri);
    console.log('📄 Document ready state:', document.readyState);
    
    try {
      // Setup Tauri APIs if needed
      if (this.isTauri) {
        await this._setupTauriAPIs();
        // Give Tauri a moment to fully initialize
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // PHASE 6: Initialize services in correct order
      // 1. PersistenceService (for event queue)
      // 2. SnapshotService (for periodic snapshots)
      // 3. DataLoader (load from SQLite)
      // 4. ProjectController (seed with loaded data, wire persistence)
      await this._initializePersistenceLayer();
      
      // Initialize scheduler (now uses ProjectController internally)
      await this._initializeScheduler();
      
      // Initialize UI handlers
      this._initializeUIHandlers();
      
      // Initialize activity bar and settings modal
      this._initializeActivityBar();
      
      // Initialize right sidebar manager
      this._initializeRightSidebar();
      
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
   * PHASE 6: Initialize the entire persistence layer
   * This sets up PersistenceService, SnapshotService, DataLoader, and ProjectController
   * @private
   */
  private async _initializePersistenceLayer(): Promise<void> {
    console.log('[AppInitializer] 🗄️ Initializing persistence layer...');
    
    // Get ProjectController singleton (will be used throughout)
    this.projectController = ProjectController.getInstance();
    
    // Skip database operations if not in Tauri
    if (!this.isTauri) {
      console.log('[AppInitializer] Skipping SQLite persistence (not in Tauri environment)');
      // Initialize controller with empty state for development/testing
      await this.projectController.initialize([], { workingDays: [1, 2, 3, 4, 5], exceptions: {} });
      return;
    }
    
    try {
      // 1. Initialize PersistenceService (event queue for writes)
      console.log('[AppInitializer] Initializing PersistenceService...');
      this.persistenceService = new PersistenceService();
      await this.persistenceService.init();
      console.log('[AppInitializer] ✅ PersistenceService initialized');
      
      // 2. Initialize SnapshotService (periodic full saves)
      console.log('[AppInitializer] Initializing SnapshotService...');
      this.snapshotService = new SnapshotService();
      await this.snapshotService.init();
      console.log('[AppInitializer] ✅ SnapshotService initialized');
      
      // 3. Load data from SQLite via DataLoader
      console.log('[AppInitializer] Loading data from SQLite...');
      this.dataLoader = new DataLoader();
      await this.dataLoader.init();
      const { tasks, calendar, tradePartners } = await this.dataLoader.loadData();
      
      // Store for SnapshotService accessors
      this.loadedCalendar = calendar;
      this.loadedTradePartners = tradePartners;
      
      console.log(`[AppInitializer] ✅ Loaded ${tasks.length} tasks, ${tradePartners.length} trade partners`);
      
      // 4. Wire ProjectController to PersistenceService
      this.projectController.setPersistenceService(this.persistenceService);
      
      // 5. Initialize ProjectController with loaded data
      // This sends data to the WASM Worker for CPM calculation
      await this.projectController.initialize(tasks, calendar);
      console.log('[AppInitializer] ✅ ProjectController initialized with loaded data');
      
      // 6. Wire SnapshotService to get live state from ProjectController
      this.snapshotService.setStateAccessors(
        () => this.projectController!.tasks$.value,
        () => this.projectController!.calendar$.value,
        () => this.loadedTradePartners // TODO: Wire trade partners through controller when supported
      );
      
      // 7. Connect PersistenceService to SnapshotService for event-threshold snapshots
      this.persistenceService.setSnapshotService(
        this.snapshotService,
        () => this.projectController!.tasks$.value,
        () => this.projectController!.calendar$.value
      );
      this.persistenceService.setTradePartnersAccessor(() => this.loadedTradePartners);
      
      // 8. Start periodic snapshots
      this.snapshotService.startPeriodicSnapshots();
      console.log('[AppInitializer] ✅ SnapshotService started periodic snapshots');
      
    } catch (error) {
      console.error('[AppInitializer] ❌ Failed to initialize persistence layer:', error);
      // Continue without persistence - app can still work but won't save
      // Initialize controller with empty state
      await this.projectController.initialize([], { workingDays: [1, 2, 3, 4, 5], exceptions: {} });
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
      const { open, save } = await import('@tauri-apps/plugin-dialog');
      // Window globals are typed in globals.d.ts - using type assertion for dynamic assignment
      (window as Window & { tauriDialog?: { open: (options?: unknown) => Promise<string | null>; save: (options?: unknown) => Promise<string | null> } }).tauriDialog = { 
        open: open as (options?: unknown) => Promise<string | null>,
        save: save as (options?: unknown) => Promise<string | null>
      };
    } catch (e) {
      console.warn('Failed to load Tauri dialog API:', e);
    }
    
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
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
     * Initialize activity bar and settings modal
     * @private
     */
    private _initializeActivityBar(): void {
        const activityBarEl = document.getElementById('activity-bar');
        const settingsOverlay = document.getElementById('settings-modal-overlay');
        const settingsModal = document.getElementById('settings-modal');

        if (!activityBarEl || !settingsOverlay || !settingsModal) {
            console.warn('[AppInitializer] Activity bar or settings modal elements not found');
            return;
        }

        // Initialize settings modal first
        this.settingsModal = new SettingsModal({
            overlay: settingsOverlay,
            modal: settingsModal,
            onClose: () => {
                console.log('[Settings] Modal closed');
            },
            onSettingChange: (setting, value) => {
                if (setting === 'highlightDependenciesOnHover' && this.scheduler) {
                    this.scheduler.setHighlightDependenciesOnHover(value);
                }
            },
            getScheduler: () => this.scheduler || null,
        });

        // Initialize activity bar
        this.activityBar = new ActivityBar({
            container: activityBarEl,
            onViewChange: (view) => {
                console.log('[ActivityBar] View changed to:', view);
                // Future: implement view switching logic
            },
            onSettingsClick: () => {
                this.settingsModal?.open();
            }
        });

        console.log('[AppInitializer] ✅ Activity bar initialized');
    }

  /**
   * Initialize right sidebar manager
   * @private
   */
  private _initializeRightSidebar(): void {
    if (!this.scheduler) {
      console.warn('[AppInitializer] Cannot initialize right sidebar - scheduler not ready');
      return;
    }
    
    try {
      this.rightSidebarManager = new RightSidebarManager({
        containerId: 'right-panel-container',
        activityBarId: 'activity-bar-right',
        scheduler: this.scheduler,
        onLayoutChange: (width) => {
          console.log('[RightSidebar] Layout width changed:', width);
        },
      });
      
      // Handle Zen Mode toggle button
      document.getElementById('toggle-right-sidebar')?.addEventListener('click', () => {
        this.rightSidebarManager?.toggleActivityBar();
      });
      
      console.log('[AppInitializer] ✅ Right sidebar initialized');
    } catch (e) {
      console.error('[AppInitializer] Failed to initialize right sidebar:', e);
    }
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
   * Get the SnapshotService instance
   * STRANGLER FIG: Shared access for SchedulerService
   */
  getSnapshotService(): SnapshotService | null {
    return this.snapshotService;
  }

  /**
   * Get the DataLoader instance
   * STRANGLER FIG: Shared access for SchedulerService reload operations
   */
  getDataLoader(): DataLoader | null {
    return this.dataLoader;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop snapshot service
    this.snapshotService?.stopPeriodicSnapshots();
    
    this.rightSidebarManager?.destroy();
    if (this.statsService) {
      this.statsService.destroy();
    }
    this.scheduler = null;
    window.scheduler = undefined;
  }
}
