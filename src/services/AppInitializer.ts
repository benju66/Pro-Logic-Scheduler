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
import { SelectionModel } from './SelectionModel';
import { OrderingService } from './OrderingService';
import { PersistenceService } from '../data/PersistenceService';
import { SnapshotService } from '../data/SnapshotService';
import { DataLoader } from '../data/DataLoader';
import { ActivityBar } from '../ui/components/ActivityBar';
import { SettingsModal } from '../ui/components/SettingsModal';
import { RightSidebarManager } from '../ui/components/RightSidebarManager';
import type { SchedulerServiceOptions, Calendar, TradePartner, Task } from '../types';
import { initializeColumnSystem, configureServices } from '../core/columns';
import { createVarianceCalculator } from '../core/calculations';
import { getEditingStateManager } from './EditingStateManager';
import { getTradePartnerStore } from '../data/TradePartnerStore';
import { HistoryManager } from '../data/HistoryManager';
import { Subscription, skip, debounceTime } from 'rxjs';
import { CommandService, registerAllCommands, CommandUIBinding } from '../commands';
import type { CommandContext } from '../commands';
import { getClipboardManager } from './ClipboardManager';

/**
 * App initializer options
 */
export interface AppInitializerOptions {
  isTauri?: boolean;
  /** RendererFactory for creating Grid/Gantt renderers with captured deps */
  rendererFactory?: import('../ui/factories').RendererFactory;
}

/**
 * App Initializer Service
 * Handles application initialization sequence
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is already public
 * - getInstance() and setInstance() for DI compatibility
 * - Will transition to being called from main.ts Composition Root
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class AppInitializer {
  // Singleton instance
  private static instance: AppInitializer | null = null;
  
  private isTauri: boolean;
  private rendererFactory: import('../ui/factories').RendererFactory | null = null;
  private scheduler: SchedulerService | null = null;
  private statsService: StatsService | null = null;
  private persistenceService: PersistenceService | null = null;
  private snapshotService: SnapshotService | null = null;
  private dataLoader: DataLoader | null = null;
  private projectController: ProjectController | null = null;
  private historyManager: HistoryManager | null = null;
  
  // Reactive saveData subscription - saves after calculations complete
  private saveDataSubscription: Subscription | null = null;
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
   * Set the singleton instance (for testing/DI)
   */
  public static setInstance(instance: AppInitializer): void {
    AppInitializer.instance = instance;
  }
  
  /**
   * Reset the singleton instance (for testing)
   */
  public static resetInstance(): void {
    AppInitializer.instance = null;
  }

  /**
   * Create a new AppInitializer instance
   * @param options - Configuration
   */
  constructor(options: AppInitializerOptions = {}) {
    this.isTauri = options.isTauri || false;
    this.rendererFactory = options.rendererFactory || null;
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
      
      // Initialize Column Registry (new architecture)
      this._initializeColumnRegistry();
      
      // Initialize scheduler (now uses ProjectController internally)
      await this._initializeScheduler();
      
      // Initialize Command Registry (PHASE 2)
      this._initializeCommandService();
      
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
      
      // Still initialize HistoryManager for undo/redo in non-Tauri mode
      console.log('[AppInitializer] Initializing HistoryManager (non-Tauri)...');
      this.historyManager = new HistoryManager({ maxHistory: 50 });
      this.projectController.setHistoryManager(this.historyManager);
      console.log('[AppInitializer] ✅ HistoryManager initialized');
      
      // Note: No reactive saveData in non-Tauri mode (no persistence)
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
      
      // 9. Initialize HistoryManager for undo/redo (application level)
      // Moved from SchedulerService to ensure history survives view/tab switches
      console.log('[AppInitializer] Initializing HistoryManager...');
      this.historyManager = new HistoryManager({
        maxHistory: 50
      });
      this.projectController.setHistoryManager(this.historyManager);
      console.log('[AppInitializer] ✅ HistoryManager initialized');
      
      // 10. Setup reactive saveData subscription
      // This ensures saveData() runs AFTER worker calculations complete (via tasks$ emission)
      // Solves the "Await Trap" - no need to await recalculateAll() before saving
      this._setupReactiveSaveData();
      
    } catch (error) {
      console.error('[AppInitializer] ❌ Failed to initialize persistence layer:', error);
      // Continue without persistence - app can still work but won't save
      // Initialize controller with empty state
      await this.projectController.initialize([], { workingDays: [1, 2, 3, 4, 5], exceptions: {} });
      
      // Still initialize HistoryManager for undo/redo even if persistence fails
      if (!this.historyManager) {
        console.log('[AppInitializer] Initializing HistoryManager (fallback)...');
        this.historyManager = new HistoryManager({ maxHistory: 50 });
        this.projectController.setHistoryManager(this.historyManager);
        console.log('[AppInitializer] ✅ HistoryManager initialized');
      }
    }
  }

  /**
   * Get the HistoryManager instance
   * @returns HistoryManager instance or null if not initialized
   */
  public getHistoryManager(): HistoryManager | null {
    return this.historyManager;
  }

  /**
   * Setup reactive saveData subscription
   * 
   * This subscribes to ProjectController.tasks$ and automatically saves
   * data after calculations complete. This solves the "Await Trap" problem
   * where saveData() was called before worker calculations finished.
   * 
   * Flow:
   * 1. User edits task → updateTask() sends to worker
   * 2. Worker calculates → emits new tasks via tasks$
   * 3. This subscription triggers (after debounce) → saveData()
   * 
   * @private
   */
  private _setupReactiveSaveData(): void {
    if (!this.projectController || !this.snapshotService) {
      console.warn('[AppInitializer] Cannot setup reactive saveData - services not available');
      return;
    }

    console.log('[AppInitializer] Setting up reactive saveData subscription...');

    // Subscribe to task changes with debounce
    this.saveDataSubscription = this.projectController.tasks$
      .pipe(
        skip(1),           // Skip initial value (empty array or loaded data)
        debounceTime(500)  // Wait 500ms after last change (prevents saving on every keystroke)
      )
      .subscribe(async (tasks) => {
        if (tasks.length === 0) {
          // Don't save empty state
          return;
        }

        try {
          await this.snapshotService!.createSnapshot(
            tasks,
            this.projectController!.calendar$.value,
            this.loadedTradePartners
          );
          console.log('[AppInitializer] ✅ Reactive saveData: snapshot created');
        } catch (error) {
          console.error('[AppInitializer] ❌ Reactive saveData failed:', error);
        }
      });

    console.log('[AppInitializer] ✅ Reactive saveData subscription active');
  }

  /**
   * Dispose reactive saveData subscription
   * Called during shutdown
   */
  private _disposeReactiveSaveData(): void {
    if (this.saveDataSubscription) {
      this.saveDataSubscription.unsubscribe();
      this.saveDataSubscription = null;
      console.log('[AppInitializer] Reactive saveData subscription disposed');
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
    const options = {
      gridContainer: gridContainer,
      ganttContainer: ganttContainer,
      drawerContainer: drawerContainer || undefined,
      modalContainer: modalContainer || undefined,
      isTauri: this.isTauri,
      // Pure DI: Pass rendererFactory from Composition Root
      rendererFactory: this.rendererFactory || undefined,
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
   * Initialize Column Registry System
   * STRANGLER FIG: New column architecture with renderer registry
   * @private
   */
  private _initializeColumnRegistry(): void {
    console.log('[AppInitializer] 📊 Initializing Column Registry...');
    
    try {
      // Initialize the column system (register renderers and columns)
      initializeColumnSystem();
      
      // Configure services for renderers that need dependencies
      const tradePartnerStore = getTradePartnerStore();
      const editingManager = getEditingStateManager();
      
      // Create variance calculator that reads calendar from ProjectController
      // This breaks the SchedulerService dependency - variance calculation is now standalone
      // See: docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md - Phase 0
      const projectController = this.projectController!;
      const calculateVariance = createVarianceCalculator(
        () => projectController.getCalendar()
      );
      
      configureServices({
        // Trade partner lookup
        getTradePartner: (id: string) => tradePartnerStore.get(id),
        
        // Variance calculation (standalone module - no scheduler dependency)
        calculateVariance,
        
        // Editing state check
        isEditingCell: (taskId: string, field: string) => {
          return editingManager.isEditingCell(taskId, field);
        },
        
        // Date picker (placeholder - will be wired after scheduler init)
        openDatePicker: (taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => {
          // Delegate to scheduler's date picker
          console.log('[ColumnRegistry] openDatePicker:', taskId, field, currentValue);
        },
        
        // Date change handler (placeholder - will be wired after scheduler init)
        onDateChange: (taskId: string, field: string, value: string) => {
          // Delegate to scheduler
          if (this.scheduler && typeof (this.scheduler as any)._handleCellChange === 'function') {
            (this.scheduler as any)._handleCellChange(taskId, field, value);
          }
        },
        
        // Calendar accessor
        getCalendar: () => {
          return projectController.getCalendar();
        },
        
        // Visual row number accessor
        getVisualRowNumber: (task) => {
          return task._visualRowNumber ?? null;
        }
      });
      
      console.log('[AppInitializer] ✅ Column Registry initialized');
    } catch (error) {
      console.error('[AppInitializer] ❌ Column Registry initialization failed:', error);
      // Non-fatal - the system will fall back to legacy binding
    }
  }

  /**
   * Initialize Command Service (PHASE 2: Command Registry)
   * Sets up the command context and registers all commands.
   * @private
   */
  private _initializeCommandService(): void {
    console.log('[AppInitializer] 🎮 Initializing Command Service...');
    
    // Pure DI: Use cached service references
    const service = CommandService.getInstance();
    const controller = this.projectController!;
    const selectionModel = SelectionModel.getInstance();
    const self = this; // Capture for closures
    
    // Build command context with all dependencies
    // NOTE: Uses lazy getter for toastService (created inside SchedulerService)
    const context: CommandContext = {
      controller: controller,
      selection: selectionModel,
      historyManager: this.historyManager,
      
      // LAZY GETTER: ToastService is created inside SchedulerService
      get toastService() {
        return self.scheduler?.toastService ?? null;
      },
      
      // Static class with utility methods
      orderingService: OrderingService,
      
      tradePartnerStore: getTradePartnerStore(),
      
      // Clipboard for copy/cut/paste
      clipboardManager: getClipboardManager(),
      
      // Helper method replacing private _getFlatList()
      getVisibleTasks(): Task[] {
        return controller.getVisibleTasks((id: string) => {
          const task = controller.getTaskById(id);
          return task?._collapsed ?? false;
        });
      }
    };
    
    service.setContext(context);
    registerAllCommands();
    
    // PHASE 2.3: Wire state changes to notify CommandService
    // Selection changes trigger command state updates
    selectionModel.state$.subscribe(() => {
      service.notifyStateChange();
    });
    
    // History changes also trigger command state updates (for undo/redo buttons)
    if (this.historyManager) {
      const originalOnStateChange = this.historyManager.getOptions().onStateChange;
      this.historyManager.setOnStateChange((_state) => {
        service.notifyStateChange();
        if (originalOnStateChange) originalOnStateChange(_state);
      });
    }
    
    // PHASE 2.3: Set up UI bindings for toolbar buttons
    const uiBinding = new CommandUIBinding(service);
    uiBinding
      .bindButton('[data-action="undo"]', 'edit.undo')
      .bindButton('[data-action="redo"]', 'edit.redo')
      .bindButton('[data-action="bulk-indent"]', 'hierarchy.indent')
      .bindButton('[data-action="bulk-outdent"]', 'hierarchy.outdent')
      .bindButton('[data-action="bulk-delete"]', 'task.delete');
    
    // Start binding after DOM is ready
    setTimeout(() => uiBinding.start(), 0);
    
    // Expose command service globally for debugging
    (window as unknown as Record<string, unknown>).commandService = service;
    (window as unknown as Record<string, unknown>).commandUIBinding = uiBinding;
    
    console.log('[AppInitializer] ✅ Command Service initialized');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop reactive saveData subscription
    this._disposeReactiveSaveData();
    
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
