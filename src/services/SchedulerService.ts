/**
 * @fileoverview Scheduler Service - Main application orchestrator
 * @module services/SchedulerService
 * 
 * The VS Code of scheduling tools - built for performance, UX, and extensibility.
 * 
 * ARCHITECTURE PRINCIPLES:
 * 1. Performance First - Every operation optimized for speed
 * 2. UX Excellence - Intuitive, keyboard-first, responsive
 * 3. Clean Separation - Services handle concerns, this orchestrates
 * 4. Extensible - Easy to add features without breaking existing code
 * 5. Long-term - Built to scale and evolve
 * 
 * RESPONSIBILITIES:
 * - Orchestrates all services and components
 * - Manages selection and focus state
 * - Coordinates CPM calculations
 * - Routes user actions to appropriate handlers
 * - Maintains view synchronization
 */

import { DateUtils } from '../core/DateUtils';
import { LINK_TYPES, CONSTRAINT_TYPES } from '../core/Constants';
import { OperationQueue } from '../core/OperationQueue';
import { TaskStore } from '../data/TaskStore';
import { CalendarStore } from '../data/CalendarStore';
import { TradePartnerStore, getTradePartnerStore } from '../data/TradePartnerStore';
import { HistoryManager } from '../data/HistoryManager';
import { PersistenceService } from '../data/PersistenceService';
import { DataLoader } from '../data/DataLoader';
import { SnapshotService } from '../data/SnapshotService';
import { ToastService } from '../ui/services/ToastService';
import { FileService } from '../ui/services/FileService';
import { KeyboardService } from '../ui/services/KeyboardService';
import { OrderingService } from './OrderingService';
import { getEditingStateManager, type EditingStateChangeEvent } from './EditingStateManager';
import { getTaskFieldValue } from '../types';
import { SchedulerViewport } from '../ui/components/scheduler/SchedulerViewport';
import { GridRenderer, PHANTOM_ROW_ID } from '../ui/components/scheduler/GridRenderer';
import { GanttRenderer } from '../ui/components/scheduler/GanttRenderer';
import { SideDrawer } from '../ui/components/SideDrawer';
import type { 
    GridRendererOptions, 
    GanttRendererOptions, 
    SchedulerViewportOptions,
    VirtualScrollGridFacade,
    CanvasGanttFacade
} from '../ui/components/scheduler/types';
import { DependenciesModal } from '../ui/components/DependenciesModal';
import { CalendarModal } from '../ui/components/CalendarModal';
import { ColumnSettingsModal } from '../ui/components/ColumnSettingsModal';
import { ContextMenu, type ContextMenuItem } from '../ui/components/ContextMenu';
import type { 
    Task, 
    Calendar, 
    TradePartner,
    GridColumn, 
    SchedulerServiceOptions,
    ViewMode,
    LinkType,
    ConstraintType,
    ColumnPreferences,
    CPMResult,
    Dependency
} from '../types';
import type { ISchedulingEngine, TaskHierarchyContext } from '../core/ISchedulingEngine';
import { debounce } from '../utils/debounce';

/**
 * Main scheduler service - orchestrates the entire application
 */
export class SchedulerService {
    /**
     * Storage key for localStorage persistence
     */
    static readonly STORAGE_KEY = 'pro_scheduler_v10';

    /**
     * Link types supported
     * @deprecated Use LINK_TYPES from core/Constants instead
     */
    static get LINK_TYPES(): readonly string[] {
        return LINK_TYPES;
    }

    /**
     * Constraint types supported
     * @deprecated Use CONSTRAINT_TYPES from core/Constants instead
     */
    static get CONSTRAINT_TYPES(): readonly string[] {
        return CONSTRAINT_TYPES;
    }

    // =========================================================================
    // INSTANCE PROPERTIES
    // =========================================================================

    private options: SchedulerServiceOptions;
    private isTauri: boolean;

    // Data stores
    private taskStore!: TaskStore;
    private calendarStore!: CalendarStore;
    private tradePartnerStore!: TradePartnerStore;
    private historyManager!: HistoryManager;

    // UI services
    public toastService!: ToastService;  // Public for access from main.ts
    private fileService!: FileService;
    private keyboardService: KeyboardService | null = null;
    
    // SQLite persistence services
    private persistenceService: PersistenceService | null = null;
    private dataLoader: DataLoader | null = null;
    private snapshotService: SnapshotService | null = null;
    private initPromise: Promise<void> | null = null; // Store init promise to avoid race condition

    // UI components (initialized in init())
    public grid: VirtualScrollGridFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    public gantt: CanvasGanttFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    private drawer: SideDrawer | null = null;
    private dependenciesModal: DependenciesModal | null = null;
    private calendarModal: CalendarModal | null = null;
    private columnSettingsModal: ColumnSettingsModal | null = null;
    private _contextMenu: ContextMenu | null = null;

    // Selection state (managed here, not in store - UI concern)
    public selectedIds: Set<string> = new Set();  // Public for access from UIEventManager
    private selectionOrder: string[] = [];  // Track selection order for linking
    private focusedId: string | null = null;
    private focusedColumn: string | null = null;  // Track which column is focused
    // REMOVE: private isEditingCell: boolean = false;
    // State now managed by EditingStateManager
    private anchorId: string | null = null;
    
    private _unsubscribeEditing: (() => void) | null = null;

    // Selection change callbacks for external listeners (e.g., RightSidebarManager)
    private _selectionChangeCallbacks: Array<(taskId: string | null, task: Task | null, field?: string) => void> = [];
    private _lastClickedField: string | undefined = undefined; // Track which field was clicked

    // Panel open request callbacks (for double-click to open behavior)
    private _openPanelCallbacks: Array<(panelId: string) => void> = [];

    // Data change callbacks for unified panel sync (e.g., RightSidebarManager)
    private _dataChangeCallbacks: Array<() => void> = [];

    // View state
    public viewMode: ViewMode = 'Week';  // Public for access from StatsService
    
    // Display settings
    private displaySettings = {
        highlightDependenciesOnHover: true,
        drivingPathMode: false
    };
    
    // Clipboard state
    private clipboard: Task[] | null = null;              // Array of cloned tasks
    private clipboardIsCut: boolean = false;              // True if cut operation
    private clipboardOriginalIds: string[] = [];          // Original IDs for deletion after cut-paste

    // Performance tracking
    private _lastCalcTime: number = 0;
    private _renderScheduled: boolean = false;
    private _isRecalculating: boolean = false;            // Prevent infinite recursion
    private _isSyncingHeader: boolean = false;            // Prevent scroll sync loops

    // Operation queue for serializing task operations
    private operationQueue: OperationQueue = new OperationQueue();

    // Scheduling engine (JavaScript or Rust)
    private engine: ISchedulingEngine | null = null;

    // Initialization flag
    public isInitialized: boolean = false;  // Public for access from UIEventManager

    /**
     * Debounced recalculation for date inputs
     * Prevents lag when typing by waiting until user stops typing
     * @private
     */
    private _debouncedRecalc: ReturnType<typeof debounce> | null = null;

    /**
     * Pending date change to apply after debounce
     * @private
     */
    private _pendingDateChange: { taskId: string; field: string; value: string } | null = null;

    /**
     * Create a new SchedulerService instance
     * 
     * @param options - Configuration options
     */
    constructor(options: SchedulerServiceOptions = {} as SchedulerServiceOptions) {
        this.options = options;
        this.isTauri = true; // Desktop-only architecture

        // Initialize debounced recalculation (300ms delay for responsive feel)
        this._debouncedRecalc = debounce(() => {
            if (this._pendingDateChange) {
                const { taskId, field, value } = this._pendingDateChange;
                this._pendingDateChange = null;
                
                // Apply the change and recalculate
                this._applyDateChangeImmediate(taskId, field, value);
            }
        }, 300);

        // Initialize services (async - will be awaited in init())
        // Store the promise to avoid race conditions
        this.initPromise = this._initServices().catch(error => {
            console.error('[SchedulerService] Service initialization failed:', error);
            throw error;
        });

        // Note: init() is now async and must be called separately by the caller
        // Don't call it here - let AppInitializer handle it
    }

    /**
     * Initialize all services
     * @private
     */
    private async _initServices(): Promise<void> {
        // 1. Initialize PersistenceService first (if Tauri environment)
        if (this.isTauri) {
            try {
                this.persistenceService = new PersistenceService();
                await this.persistenceService.init();
                console.log('[SchedulerService] ✅ PersistenceService initialized');
            } catch (error) {
                console.error('[SchedulerService] Failed to initialize PersistenceService:', error);
                // Continue without persistence - app can still work
            }
        }

        // 2. Initialize stores (TaskStore/CalendarStore/TradePartnerStore) normally
        this.taskStore = new TaskStore({
            onChange: () => this._onTasksChanged()
        });

        this.calendarStore = new CalendarStore({
            onChange: () => this._onCalendarChanged()
        });

        this.tradePartnerStore = getTradePartnerStore();

        // 3. Inject persistence into stores (if available)
        if (this.persistenceService) {
            this.taskStore.setPersistenceService(this.persistenceService);
            this.calendarStore.setPersistenceService(this.persistenceService);
        }

        // 4. Initialize DataLoader and SnapshotService (if Tauri environment)
        if (this.isTauri) {
            try {
                this.dataLoader = new DataLoader();
                await this.dataLoader.init();
                console.log('[SchedulerService] ✅ DataLoader initialized');

                this.snapshotService = new SnapshotService();
                await this.snapshotService.init();
                console.log('[SchedulerService] ✅ SnapshotService initialized');
            } catch (error) {
                console.error('[SchedulerService] Failed to initialize SQLite services:', error);
                // Continue without SQLite - will fall back to localStorage
            }
        }

        // 5. Initialize other services
        this.historyManager = new HistoryManager({
            maxHistory: 50
        });

        // 6. Inject history manager into stores (must be after both are created)
        if (this.historyManager) {
            this.taskStore.setHistoryManager(this.historyManager);
            this.calendarStore.setHistoryManager(this.historyManager);
        }
        
        // 7. Wire up snapshot service (if available)
        if (this.snapshotService && this.persistenceService) {
            // Set state accessors for automatic snapshots
            this.snapshotService.setStateAccessors(
                () => this.taskStore.getAll(),
                () => this.calendarStore.get(),
                () => this.tradePartnerStore.getAll()
            );
            
            // Connect to persistence service
            this.persistenceService.setSnapshotService(
                this.snapshotService,
                () => this.taskStore.getAll(),
                () => this.calendarStore.get()
            );
            
            // Set trade partners accessor
            this.persistenceService.setTradePartnersAccessor(
                () => this.tradePartnerStore.getAll()
            );
            
            // Start periodic snapshots
            this.snapshotService.startPeriodicSnapshots();
        }

        // UI services
        this.toastService = new ToastService({
            container: document.body
        });

        this.fileService = new FileService({
            isTauri: this.isTauri,
            onToast: (msg, type) => this.toastService.show(msg, type)
        });

        // 8. Initialize Dual Engine
        await this._initializeEngine();
    }

    /**
     * Initialize the Rust scheduling engine
     * 
     * CRITICAL: Desktop-only - if Rust engine fails, app cannot function.
     * 
     * @private
     * @throws Error if Rust engine fails to initialize
     */
    private async _initializeEngine(): Promise<void> {
        // Check for Tauri environment (async check for Tauri v2 compatibility)
        let tauriAvailable = false;
        
        // Quick check: window.__TAURI__ (Tauri v1, or v2 if available)
        if ((window as Window & { __TAURI__?: unknown }).__TAURI__) {
            tauriAvailable = true;
        } else {
            // Try to detect Tauri v2 by attempting to use the API
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                if (invoke && typeof invoke === 'function') {
                    tauriAvailable = true;
                }
            } catch (e) {
                // Can't import Tauri API - not in Tauri environment
                tauriAvailable = false;
            }
        }
        
        if (!tauriAvailable) {
            throw new Error(
                'Pro Logic Scheduler requires the desktop application. ' +
                'Browser mode is not supported.'
            );
        }

        const hierarchyContext: TaskHierarchyContext = {
            isParent: (id: string) => this.taskStore.isParent(id),
            getDepth: (id: string) => this.taskStore.getDepth(id),
        };

        console.log('[SchedulerService] Initializing Rust engine...');
        
        const { RustEngine } = await import('../core/engines/RustEngine');
        this.engine = new RustEngine();
        
        const tasks = this.taskStore.getAll();
        const calendar = this.calendarStore.get();
        
        // Always initialize the engine, even with empty data
        // This ensures the engine is ready for calculations
        await this.engine.initialize(tasks, calendar, hierarchyContext);
        
        console.log('[SchedulerService] ✅ Rust engine ready');
    }

    /**
     * Initialize the scheduler with UI components
     */
    async init(): Promise<void> {
        // Ensure services are initialized first (await the stored promise)
        if (this.initPromise) {
            await this.initPromise;
        }
        
        const { gridContainer, ganttContainer, drawerContainer, modalContainer } = this.options;

        if (!gridContainer || !ganttContainer) {
            throw new Error('gridContainer and ganttContainer are required');
        }

        // Initialize CSS variables for column widths (must be before header build)
        this._initializeColumnCSSVariables();

        // Build grid header dynamically from column definitions
        this._buildGridHeader();

        // Find parent container (the one that holds both grid and gantt)
        const parentContainer = gridContainer.parentElement?.parentElement || document.querySelector('.main') as HTMLElement;
        if (!parentContainer) {
            throw new Error('Could not find parent container for scheduler viewport');
        }

        // Create unified scheduler viewport
        const viewportOptions: SchedulerViewportOptions = {
            rowHeight: 38,
            headerHeight: 60,
            bufferRows: 5,
            onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
            onRowDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onCellChange: (taskId, field, value) => this._handleCellChange(taskId, field, value),
            onAction: (taskId, action, e) => this._handleAction(taskId, action, e),
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onSelectionChange: (selectedIds) => this._handleSelectionChange(selectedIds),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
            onBarClick: (taskId, e) => this._handleRowClick(taskId, e),
            onBarDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onBarDrag: (task, start, end) => this._handleBarDrag(task, start, end),
            isParent: (id) => this.taskStore.isParent(id),
            getDepth: (id) => this.taskStore.getDepth(id),
        };

        // Use the parent container that holds both grid and gantt
        // The viewport will create its own panes inside
        const viewportContainer = parentContainer;

        const viewport = new SchedulerViewport(viewportContainer, viewportOptions);

        // Initialize Grid renderer
        // Note: viewport will create its own grid pane, but we need to pass a container
        // The viewport's initGrid will use its internal grid pane
        const gridOptions: GridRendererOptions = {
            container: gridContainer, // Temporary - viewport will use its own pane
            rowHeight: 38,
            bufferRows: 5,
            columns: this._getColumnDefinitions(),
            onCellChange: (taskId, field, value) => this._handleCellChange(taskId, field, value),
            onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
            onRowDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onAction: (taskId, action, e) => this._handleAction(taskId, action, e),
            onRowMenu: (taskId, isBlank, anchorEl, e) => this._showRowContextMenu(taskId, isBlank, anchorEl, e),
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onSelectionChange: (selectedIds) => this._handleSelectionChange(selectedIds),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
            onEnterLastRow: (lastTaskId, field) => this._handleEnterLastRow(lastTaskId, field),
            onEditEnd: () => this.exitEditMode(),
            onTradePartnerClick: (taskId, tradePartnerId, e) => this._handleTradePartnerClick(taskId, tradePartnerId, e),
            isParent: (id) => this.taskStore.isParent(id),
            getDepth: (id) => this.taskStore.getDepth(id),
        };
        viewport.initGrid(gridOptions);

        // Initialize Gantt renderer
        // Note: viewport will create its own gantt pane, but we need to pass a container
        // The viewport's initGantt will use its internal gantt pane
        const ganttOptions: GanttRendererOptions = {
            container: ganttContainer, // Temporary - viewport will use its own pane
            rowHeight: 38,
            headerHeight: 60,
            onBarClick: (taskId, e) => this._handleRowClick(taskId, e),
            onBarDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onBarDrag: (task, start, end) => this._handleBarDrag(task, start, end),
            isParent: (id) => this.taskStore.isParent(id),
            getHighlightDependencies: () => this.displaySettings.highlightDependenciesOnHover,
        };
        viewport.initGantt(ganttOptions);

        // Start the viewport
        viewport.start();

        // Store viewport reference (for backward compatibility, also store as grid/gantt)
        (this as any).viewport = viewport;
        
        // Create facade wrappers for backward compatibility
        this.grid = this._createGridFacade(viewport);
        this.gantt = this._createGanttFacade(viewport);

        // ─────────────────────────────────────────────────────────────────────────────
        // Legacy drawer - now managed by RightSidebarManager
        // ─────────────────────────────────────────────────────────────────────────────
        // REMOVED: Drawer is now managed by RightSidebarManager
        // if (drawerContainer) {
        //     this.drawer = new SideDrawer({
        //         container: drawerContainer,
        //         onUpdate: (taskId, field, value) => this._handleDrawerUpdate(taskId, field, value),
        //         onDelete: (taskId) => this.deleteTask(taskId),
        //         onOpenLinks: (taskId) => this.openDependencies(taskId),
        //         getScheduler: () => this,
        //     });
        // }

        // Create modals
        const modalsContainer = modalContainer || document.body;

        this.dependenciesModal = new DependenciesModal({
            container: modalsContainer,
            getTasks: () => this.taskStore.getAll(),
            isParent: (id) => this.taskStore.isParent(id),
            onSave: (taskId, deps) => this._handleDependenciesSave(taskId, deps),
        });

        this.calendarModal = new CalendarModal({
            container: modalsContainer,
            onSave: (calendar) => this._handleCalendarSave(calendar),
        });

        this.columnSettingsModal = new ColumnSettingsModal({
            container: modalsContainer,
            onSave: (preferences) => this.updateColumnPreferences(preferences),
            getColumns: () => this._getBaseColumnDefinitions(),
            getPreferences: () => this._getColumnPreferences(),
        });

        // Note: Keyboard shortcuts are initialized after init() completes
        // See main.ts - they're attached after scheduler initialization
        
        // Subscribe to editing state changes
        const editingManager = getEditingStateManager();
        this._unsubscribeEditing = editingManager.subscribe((event) => {
            this._onEditingStateChange(event);
        });
        
        // Enable debug mode during development (optional)
        // editingManager.setDebugMode(true);

        // Load persisted data
        try {
            const taskCountBeforeLoad = this.taskStore.getAll().length;
            console.log('[SchedulerService] 🔍 Before loadData() - task count:', taskCountBeforeLoad);
            
            await this.loadData();
            
            const taskCountAfterLoad = this.taskStore.getAll().length;
            console.log('[SchedulerService] ✅ After loadData() - task count:', taskCountAfterLoad);
        } catch (error) {
            console.error('[SchedulerService] Error loading persisted data:', error);
        }
        
        // TODO: Calendar integration for Flatpickr - add setCalendar to GridRenderer
        // Pass calendar to grid for date picker integration
        // const calendar = this.calendarStore.get();
        // if (this.grid) {
        //     this.grid.setCalendar(calendar);
        // }
        
        // Mark initialization as complete
        this.isInitialized = true;
        console.log('[SchedulerService] ✅ Initialization complete - isInitialized set to true');
    }

    /**
     * Create facade wrapper for VirtualScrollGrid API compatibility
     */
    private _createGridFacade(viewport: SchedulerViewport): VirtualScrollGridFacade {
        // Return a facade object that implements VirtualScrollGrid interface
        return {
            setData: (tasks: Task[]) => viewport.setData(tasks),
            setVisibleData: (tasks: Task[]) => viewport.setVisibleData(tasks),
            setSelection: (selectedIds: Set<string>, focusedId?: string | null, options?: { focusCell?: boolean; focusField?: string }) => {
                viewport.setSelection([...selectedIds], focusedId ?? null, options);
            },
            scrollToTask: (taskId: string) => viewport.scrollToTask(taskId),
            focusCell: (taskId: string, field: string) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.focusCell(taskId, field);
                }
            },
            highlightCell: (taskId: string, field: string) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.highlightCell(taskId, field);
                }
            },
            focus: () => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.focus();
                }
            },
            refresh: () => viewport.refresh(),
            updateColumns: (columns: GridColumn[]) => viewport.updateGridColumns(columns),
            updateRow: (taskId: string) => viewport.updateRow(taskId),
            setScrollTop: (scrollTop: number) => viewport.setScrollTop(scrollTop),
            getScrollTop: () => viewport.getScrollTop(),
            setCalendar: (calendar: Calendar) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.setCalendar(calendar);
                }
            },
            getStats: () => ({
                totalTasks: viewport.getData().length,
                visibleRange: '0-0',
                renderedRows: 0,
                poolSize: 0,
                renderCount: 0,
            }),
            destroy: () => viewport.destroy(),
        };
    }

    /**
     * Create facade wrapper for CanvasGantt API compatibility
     */
    private _createGanttFacade(viewport: SchedulerViewport): CanvasGanttFacade {
        // Return a facade object that implements CanvasGantt interface
        return {
            setData: (tasks: Task[]) => viewport.setData(tasks),
            setSelection: (selectedIds: Set<string>) => {
                viewport.setSelection([...selectedIds]);
            },
            setViewMode: (mode: string) => {
                const ganttRenderer = (viewport as any).ganttRenderer as GanttRenderer | null;
                if (ganttRenderer) {
                    ganttRenderer.setViewMode(mode);
                }
            },
            setScrollTop: (scrollTop: number) => viewport.setScrollTop(scrollTop),
            getScrollTop: () => viewport.getScrollTop(),
            scrollToTask: (taskId: string) => viewport.scrollToTask(taskId),
            refresh: () => viewport.refresh(),
            getStats: () => ({
                totalTasks: viewport.getData().length,
                visibleRange: '0-0',
                renderedRows: 0,
                poolSize: 0,
                renderCount: 0,
            }),
            destroy: () => viewport.destroy(),
        };
    }

    /**
     * Handle selection change
     */
    private _handleSelectionChange(selectedIds: string[]): void {
        const selectedSet = new Set(selectedIds);
        
        // Maintain selection order: remove deselected, add newly selected
        this.selectionOrder = this.selectionOrder.filter(id => selectedSet.has(id));
        for (const id of selectedIds) {
            if (!this.selectionOrder.includes(id)) {
                this.selectionOrder.push(id);
            }
        }
        
        this.selectedIds = selectedSet;
        
        // === Notify registered callbacks ===
        // IMPORTANT: This is the ONLY place callbacks are triggered.
        // Do NOT add callbacks to _handleRowClick - it would cause double-firing
        // since row clicks internally trigger _handleSelectionChange via _updateSelection().
        const primaryId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
        const primaryTask = primaryId ? this.taskStore.getById(primaryId) || null : null;
        
        // Pass the clicked field (if any) to callbacks
        // Only pass field if this selection change was triggered by a click (not programmatic)
        const clickedField = this._lastClickedField;
        // Clear immediately after reading to avoid stale values
        const fieldToPass = clickedField;
        this._lastClickedField = undefined;
        
        this._selectionChangeCallbacks.forEach(cb => {
            try {
                cb(primaryId, primaryTask, fieldToPass);
            } catch (e) {
                console.error('[SchedulerService] Selection callback error:', e);
            }
        });
    }

    /**
     * Initialize keyboard shortcuts
     * Called after initialization completes to ensure handlers are only attached when ready
     */
    /**
     * Initialize keyboard shortcuts
     * Called after initialization completes to ensure handlers are only attached when ready
     */
    initKeyboard(): void {
        // Ensure we're initialized before attaching handlers
        if (!this.isInitialized) {
            console.warn('[SchedulerService] ⚠️ initKeyboard() called before initialization complete');
            return;
        }
        
        // Prevent double initialization
        if (this.keyboardService) {
            console.warn('[SchedulerService] ⚠️ Keyboard handlers already initialized');
            return;
        }
        
        console.log('[SchedulerService] 🔧 Initializing keyboard shortcuts...');
        
        this.keyboardService = new KeyboardService({
            isAppReady: () => this.isInitialized, // Guard to prevent handlers during initialization
            onUndo: () => this.undo(),
            onRedo: () => this.redo(),
            onDelete: () => this._deleteSelected(),
            onCopy: () => this.copySelected(),
            onCut: () => this.cutSelected(),
            onPaste: () => this.paste(),
            onInsert: () => this.insertTaskBelow(),
            onShiftInsert: () => this.insertTaskAbove(),
            onCtrlEnter: () => this.addChildTask(),
            onArrowUp: (shiftKey, _ctrlKey) => this._handleCellNavigation('up', shiftKey),
            onArrowDown: (shiftKey, _ctrlKey) => this._handleCellNavigation('down', shiftKey),
            onArrowLeft: (shiftKey, _ctrlKey) => this._handleCellNavigation('left', shiftKey),
            onArrowRight: (shiftKey, _ctrlKey) => this._handleCellNavigation('right', shiftKey),
            onCtrlArrowLeft: () => this._handleArrowCollapse('ArrowLeft'),
            onCtrlArrowRight: () => this._handleArrowCollapse('ArrowRight'),
            onTab: () => this._handleTabIndent(),
            onShiftTab: () => this._handleTabOutdent(),
            onCtrlArrowUp: () => this.moveSelectedTasks(-1),
            onCtrlArrowDown: () => this.moveSelectedTasks(1),
            onF2: () => this.enterEditMode(),
            onEscape: () => {
                // Exit driving path mode on Escape
                if (this.displaySettings.drivingPathMode) {
                    this.toggleDrivingPathMode();
                } else {
                    this._handleEscape();
                }
            },
            onLinkSelected: () => this.linkSelectedInOrder(),
            onDrivingPath: () => this.toggleDrivingPathMode(),
        });
        
        console.log('[SchedulerService] ✅ Keyboard shortcuts initialized');
    }

    /**
     * Get column definitions for the grid
     * @returns Column definitions
     */
    getColumnDefinitions(): GridColumn[] {
        return this._getColumnDefinitions();
    }

    /**
     * Get whether dependency highlighting on hover is enabled
     * @returns True if highlighting is enabled
     */
    getHighlightDependenciesOnHover(): boolean {
        return this.displaySettings.highlightDependenciesOnHover;
    }

    /**
     * Toggle driving path mode
     */
    toggleDrivingPathMode(): void {
        this.displaySettings.drivingPathMode = !this.displaySettings.drivingPathMode;
        this._updateGanttDrivingPathMode();
        this.render();
    }

    /**
     * Update Gantt driving path mode display
     * @private
     */
    private _updateGanttDrivingPathMode(): void {
        // TODO: Implement driving path visualization in GanttRenderer
        // For now, this is a placeholder
        if (this.gantt && this.displaySettings.drivingPathMode) {
            // Driving path mode is active - GanttRenderer should highlight critical path
            // This will be implemented when driving path feature is added
        }
    }

    /**
     * Get base column definitions (without preferences applied)
     * Conditionally includes actual/variance columns when baseline exists
     * @private
     * @returns Base column definitions
     */
    private _getBaseColumnDefinitions(): GridColumn[] {
        const hasBaseline = this.hasBaseline();
        const columns: GridColumn[] = [
            {
                id: 'drag',
                label: '',
                field: 'drag',
                type: 'drag',
                width: 28,
                align: 'center',
                editable: false,
                resizable: false,
                minWidth: 20,
            },
            {
                id: 'checkbox',
                label: '',
                field: 'checkbox',
                type: 'checkbox',
                width: 30,
                align: 'center',
                editable: false,
                resizable: false,
                minWidth: 25,
            },
            {
                id: 'rowNum',
                label: '#',
                field: 'rowNum',
                type: 'readonly',
                width: 35,
                align: 'center',
                editable: false,
                minWidth: 30,
                renderer: (task, meta) => `<span style="color: #94a3b8; font-size: 11px;">${meta.index + 1}</span>`,
            },
            {
                id: 'name',
                label: 'Task Name',
                field: 'name',
                type: 'text',
                width: 220,
                editable: true,
                minWidth: 100,
            },
            {
                id: 'duration',
                label: 'Duration',
                field: 'duration',
                type: 'number',
                width: 50,
                align: 'center',
                editable: true,
                readonlyForParent: true,
                minWidth: 40,
            },
            {
                id: 'start',
                label: 'Start',
                field: 'start',
                type: 'date',
                width: 100,
                editable: true,
                showConstraintIcon: true,
                readonlyForParent: true,
                minWidth: 80,
            },
            {
                id: 'end',
                label: 'End',
                field: 'end',
                type: 'date',
                width: 100,
                editable: true,
                showConstraintIcon: true,
                readonlyForParent: true,
                minWidth: 80,
            },
            {
                id: 'tradePartners',
                label: 'Trade Partners',
                field: 'tradePartnerIds' as keyof Task,
                type: 'readonly',
                width: 180,
                editable: false,
                align: 'left',
                minWidth: 120,
                renderer: (task: Task) => {
                    const partnerIds = task.tradePartnerIds || [];
                    if (partnerIds.length === 0) return '';
                    
                    return partnerIds
                        .map(id => {
                            const partner = this.tradePartnerStore.get(id);
                            if (!partner) return '';
                            // Return HTML for chips - will be set as innerHTML
                            const shortName = partner.name.length > 12 
                                ? partner.name.substring(0, 10) + '...' 
                                : partner.name;
                            return `<span class="trade-chip" data-partner-id="${id}" 
                                    style="background-color:${partner.color}; color: white; 
                                    padding: 2px 8px; border-radius: 12px; font-size: 11px;
                                    margin-right: 4px; cursor: pointer; display: inline-block;
                                    white-space: nowrap; max-width: 100px; overflow: hidden;
                                    text-overflow: ellipsis;" title="${partner.name}">${shortName}</span>`;
                        })
                        .join('');
                },
            },
            {
                id: 'constraintType',
                label: 'Constraint',
                field: 'constraintType',
                type: 'select',
                width: 80,
                editable: true,
                options: ['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'],
                readonlyForParent: true,
                minWidth: 50,
            },
            {
                id: 'schedulingMode',
                label: 'Mode',
                field: 'schedulingMode',
                type: 'select',
                width: 90,
                editable: true,
                options: ['Auto', 'Manual'],
                readonlyForParent: true,
                align: 'center',
                resizable: true,
                minWidth: 80,
                // No renderer - BindingSystem handles icon + select separately
            },
            {
                id: 'health',
                label: 'Health',
                field: '_health' as keyof Task,
                type: 'readonly',
                width: 80,
                align: 'center',
                editable: false,
                minWidth: 60,
                renderer: (task) => {
                    if (!task._health) return '<span style="color: #94a3b8;">-</span>';
                    const health = task._health;
                    const statusClass = `health-${health.status}`;
                    return `<span class="health-indicator-inline ${statusClass}" title="${health.summary}">${health.icon}</span>`;
                },
            },
            {
                id: 'actions',
                label: '',
                field: 'actions',
                type: 'actions',
                width: 30,
                editable: false,
                minWidth: 28,
                resizable: false,
                align: 'center',
                actions: [
                    {
                        id: 'row-menu',
                        name: 'row-menu',
                        title: 'Row Menu',
                        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2"/>
                            <circle cx="12" cy="12" r="2"/>
                            <circle cx="12" cy="19" r="2"/>
                        </svg>`,
                        color: '#64748b',
                    },
                ],
            },
        ];

        // Add baseline/actual/variance columns if baseline exists
        if (hasBaseline) {
            // Baseline Start column (readonly reference)
            columns.push({
                id: 'baselineStart',
                label: 'Baseline Start',
                field: 'baselineStart',
                type: 'date',
                width: 110,
                editable: false,
                readonlyForParent: true,
                minWidth: 80,
                headerClass: 'baseline-column-header',
                cellClass: 'baseline-column',
                visible: true,
            });

            // Actual Start column
            columns.push({
                id: 'actualStart',
                label: 'Actual Start',
                field: 'actualStart',
                type: 'date',
                width: 110,
                editable: true,
                readonlyForParent: true,
                minWidth: 80,
                headerClass: 'actual-column-header',
                cellClass: 'actual-column',
                visible: true,
            });

            // Start Variance column
            columns.push({
                id: 'startVariance',
                label: 'Start Var',
                field: 'startVariance',
                type: 'variance',
                width: 80,
                align: 'center',
                editable: false,
                readonlyForParent: true,
                minWidth: 60,
                visible: true,
                renderer: (task) => {
                    const variance = this._calculateVariance(task);
                    if (variance.start === null) return '<span style="color: #94a3b8;">-</span>';
                    
                    const value = variance.start;
                    const absValue = Math.abs(value);
                    const isPositive = value > 0;
                    const isNegative = value < 0;
                    
                    let className = 'variance-on-time';
                    let prefix = '';
                    
                    if (isPositive) {
                        className = 'variance-ahead';
                        prefix = '+';
                    } else if (isNegative) {
                        className = 'variance-behind';
                        prefix = '';
                    }
                    
                    return `<span class="${className}" title="${isPositive ? 'Ahead' : isNegative ? 'Behind' : 'On time'} by ${absValue} day${absValue !== 1 ? 's' : ''}">${prefix}${value}</span>`;
                },
            });

            // Baseline Finish column (readonly reference)
            columns.push({
                id: 'baselineFinish',
                label: 'Baseline Finish',
                field: 'baselineFinish',
                type: 'date',
                width: 110,
                editable: false,
                readonlyForParent: true,
                minWidth: 80,
                headerClass: 'baseline-column-header',
                cellClass: 'baseline-column',
                visible: true,
            });

            // Actual Finish column
            columns.push({
                id: 'actualFinish',
                label: 'Actual Finish',
                field: 'actualFinish',
                type: 'date',
                width: 110,
                editable: true,
                readonlyForParent: true,
                minWidth: 80,
                headerClass: 'actual-column-header',
                cellClass: 'actual-column',
                visible: true,
            });

            // Finish Variance column
            columns.push({
                id: 'finishVariance',
                label: 'Finish Var',
                field: 'finishVariance',
                type: 'variance',
                width: 80,
                align: 'center',
                editable: false,
                readonlyForParent: true,
                minWidth: 60,
                visible: true,
                renderer: (task) => {
                    const variance = this._calculateVariance(task);
                    if (variance.finish === null) return '<span style="color: #94a3b8;">-</span>';
                    
                    const value = variance.finish;
                    const absValue = Math.abs(value);
                    const isPositive = value > 0;
                    const isNegative = value < 0;
                    
                    let className = 'variance-on-time';
                    let prefix = '';
                    
                    if (isPositive) {
                        className = 'variance-ahead';
                        prefix = '+';
                    } else if (isNegative) {
                        className = 'variance-behind';
                        prefix = '';
                    }
                    
                    return `<span class="${className}" title="${isPositive ? 'Ahead' : isNegative ? 'Behind' : 'On time'} by ${absValue} day${absValue !== 1 ? 's' : ''}">${prefix}${value}</span>`;
                },
            });
        }

        return columns;
    }

    /**
     * Get column definitions with preferences applied
     * @private
     */
    private _getColumnDefinitions(): GridColumn[] {
        const baseColumns = this._getBaseColumnDefinitions();
        return this._applyColumnPreferences(baseColumns);
    }

    /**
     * Apply column preferences (visibility, order, pinning) to base columns
     * @private
     */
    private _applyColumnPreferences(columns: GridColumn[]): GridColumn[] {
        const prefs = this._getColumnPreferences();
        
        // Filter by visibility (merge with dynamic visibility)
        const visible = columns.filter(col => {
            const prefVisible = prefs.visible[col.id] !== false;
            // Also respect existing col.visible property (for baseline columns)
            if (col.visible !== undefined) {
                const dynamicVisible = typeof col.visible === 'function' 
                    ? col.visible() 
                    : col.visible;
                return prefVisible && dynamicVisible;
            }
            return prefVisible;
        });
        
        // Sort by order preference
        const ordered = visible.sort((a, b) => {
            const aIndex = prefs.order.indexOf(a.id);
            const bIndex = prefs.order.indexOf(b.id);
            
            // If not in preferences, maintain original order (new columns)
            if (aIndex === -1 && bIndex === -1) return 0;
            if (aIndex === -1) return 1; // New columns go to end
            if (bIndex === -1) return -1;
            
            return aIndex - bIndex;
        });
        
        // Apply pinned state via classes and calculate sticky left offset
        return ordered.map((col, index) => {
            const newCol = { ...col };
            if (prefs.pinned.includes(col.id)) {
                newCol.headerClass = (newCol.headerClass || '') + (newCol.headerClass ? ' ' : '') + 'pinned';
                newCol.cellClass = (newCol.cellClass || '') + (newCol.cellClass ? ' ' : '') + 'pinned';
                
                // Calculate left offset for sticky positioning
                const pinnedIndex = ordered.slice(0, index).filter(c => prefs.pinned.includes(c.id)).length;
                const leftOffset = this._calculateStickyLeft(pinnedIndex, ordered);
                // Store in a custom property that VirtualScrollGrid can use
                (newCol as any).stickyLeft = leftOffset;
            }
            return newCol;
        });
    }

    /**
     * Get column preferences from localStorage
     * @private
     */
    private _getColumnPreferences(): ColumnPreferences {
        try {
            const saved = localStorage.getItem('pro_scheduler_column_preferences');
            if (saved) {
                const parsed = JSON.parse(saved) as ColumnPreferences;
                // Validate structure
                if (parsed.visible && parsed.order && Array.isArray(parsed.order) && 
                    parsed.pinned && Array.isArray(parsed.pinned)) {
                    return parsed;
                }
            }
        } catch (err) {
            console.warn('[SchedulerService] Failed to load column preferences:', err);
        }
        
        // Return defaults
        return this._getDefaultColumnPreferences();
    }

    /**
     * Get default column preferences
     * @private
     */
    private _getDefaultColumnPreferences(): ColumnPreferences {
        const baseColumns = this._getBaseColumnDefinitions();
        return {
            visible: Object.fromEntries(baseColumns.map(col => [col.id, true])),
            order: baseColumns.map(col => col.id),
            pinned: []
        };
    }

    /**
     * Save column preferences to localStorage
     * @private
     */
    private _saveColumnPreferences(prefs: ColumnPreferences): void {
        try {
            localStorage.setItem('pro_scheduler_column_preferences', JSON.stringify(prefs));
        } catch (err) {
            console.warn('[SchedulerService] Failed to save column preferences:', err);
        }
    }

    /**
     * Update column preferences and rebuild grid
     * @param preferences - New column preferences
     */
    updateColumnPreferences(preferences: ColumnPreferences): void {
        // Validate: at least one column must be visible
        const visibleCount = Object.values(preferences.visible).filter(v => v).length;
        if (visibleCount === 0) {
            this.toastService?.show('At least one column must be visible', 'error');
            return;
        }
        
        // Validate: order must contain all visible columns
        const visibleIds = Object.keys(preferences.visible).filter(id => preferences.visible[id]);
        const orderSet = new Set(preferences.order);
        const missingInOrder = visibleIds.filter(id => !orderSet.has(id));
        if (missingInOrder.length > 0) {
            // Add missing columns to end of order
            preferences.order.push(...missingInOrder);
        }
        
        // Save preferences
        this._saveColumnPreferences(preferences);
        
        // Rebuild grid with new preferences
        this._rebuildGridColumns();
        
        // Re-initialize column resizers (columns may have changed)
        // Note: UIEventManager will handle this, but we trigger it here
        setTimeout(() => {
            const uiEventManager = (window as any).uiEventManager;
            if (uiEventManager?.initColumnResizers) {
                uiEventManager.initColumnResizers();
            }
        }, 100);
        
        this.toastService?.show('Column preferences saved', 'success');
    }

    /**
     * Build the grid header dynamically from column definitions
     * @private
     */
    private _buildGridHeader(): void {
        const headerContent = document.getElementById('grid-header-content');
        if (!headerContent) {
            console.warn('[SchedulerService] Grid header content container not found');
            return;
        }

        const columns = this._getColumnDefinitions();
        
        // Clear existing header
        headerContent.innerHTML = '';

        // Build header cells from column definitions
        columns.forEach(col => {
            // Check if column should be visible
            const isVisible = col.visible === undefined 
                ? true 
                : typeof col.visible === 'function' 
                    ? col.visible() 
                    : col.visible;

            if (!isVisible) return;

            const headerCell = document.createElement('div');
            headerCell.className = 'grid-header-cell';
            headerCell.setAttribute('data-field', col.field);
            
            // Set width using CSS variable
            headerCell.style.width = `var(--w-${col.field}, ${col.width}px)`;
            
            // Set alignment
            if (col.align === 'center' || col.align === 'right') {
                headerCell.style.justifyContent = col.align === 'center' ? 'center' : 'flex-end';
            } else {
                headerCell.style.justifyContent = 'flex-start';
            }

            // Add header class if specified
            if (col.headerClass) {
                headerCell.classList.add(...col.headerClass.split(' '));
            }

            // Build header content based on column type
            if (col.type === 'drag') {
                headerCell.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                        <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                        <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                    </svg>
                `;
            } else if (col.type === 'checkbox') {
                // Create functional checkbox for select/deselect all
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'header-checkbox-select-all';
                checkbox.title = 'Select/Deselect all visible tasks';
                checkbox.style.cssText = `
                    width: 14px;
                    height: 14px;
                    cursor: pointer;
                    accent-color: #6366f1;
                    outline: none;
                    border: none;
                `;
                
                // Update checkbox state based on current selection
                this._updateHeaderCheckboxState(checkbox);
                
                // Handle click to select/deselect all visible tasks
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._handleSelectAllClick(checkbox);
                });
                
                headerCell.appendChild(checkbox);
            } else {
                // Text columns: wrap in span for truncation
                const textSpan = document.createElement('span');
                textSpan.className = 'grid-header-cell-text';
                textSpan.textContent = col.label;
                headerCell.appendChild(textSpan);
                
                // Check truncation after render and add tooltip if needed
                requestAnimationFrame(() => {
                    if (textSpan.scrollWidth > textSpan.clientWidth) {
                        headerCell.setAttribute('title', col.label);
                    }
                });
            }

            // Add resizer if column is resizable
            const isResizable = col.resizable !== undefined ? col.resizable : (col.type !== 'drag' && col.type !== 'checkbox');
            if (isResizable) {
                const resizer = document.createElement('div');
                resizer.className = 'col-resizer';
                resizer.setAttribute('data-field', col.field);
                headerCell.appendChild(resizer);
            }

            // Apply sticky positioning for pinned columns
            if (col.headerClass?.includes('pinned')) {
                const pinnedIndex = columns.slice(0, columns.indexOf(col))
                    .filter(c => c.headerClass?.includes('pinned')).length;
                const leftOffset = this._calculateStickyLeft(pinnedIndex, columns);
                headerCell.style.left = leftOffset;
            }

            headerContent.appendChild(headerCell);
        });

        console.log('[SchedulerService] ✅ Grid header built with', columns.length, 'columns');
        
        // Set up bidirectional scroll sync: header → grid
        this._initHeaderScrollSync();
    }

    /**
     * Calculate left offset for sticky column
     * @private
     */
    private _calculateStickyLeft(pinnedIndex: number, columns: GridColumn[]): string {
        const prefs = this._getColumnPreferences();
        const pinnedColumns = columns.filter(c => prefs.pinned.includes(c.id)).slice(0, pinnedIndex);
        
        if (pinnedColumns.length === 0) return '0px';
        
        // Build calc() expression using CSS variables
        const widths = pinnedColumns.map(col => `var(--w-${col.field}, ${col.width || 100}px)`);
        return `calc(${widths.join(' + ')})`;
    }

    /**
     * Initialize header scroll sync (header → grid)
     * @private
     */
    private _initHeaderScrollSync(): void {
        const header = document.getElementById('grid-header');
        const gridContainer = document.getElementById('grid-container');
        if (!header || !gridContainer) return;
        
        // Sync header horizontal scroll with grid-container horizontal scroll
        // The grid-container now handles its own horizontal scrolling
        let isSyncing = false;
        
        gridContainer.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            header.scrollLeft = gridContainer.scrollLeft;
            isSyncing = false;
        }, { passive: true });
        
        header.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            gridContainer.scrollLeft = header.scrollLeft;
            isSyncing = false;
        }, { passive: true });
    }

    /**
     * Initialize CSS variables for column widths from column definitions
     * @private
     */
    private _initializeColumnCSSVariables(): void {
        const gridPane = document.getElementById('grid-pane');
        if (!gridPane) {
            console.warn('[SchedulerService] Grid pane not found for CSS variable initialization');
            return;
        }

        const columns = this._getColumnDefinitions();
        
        // Load saved widths from localStorage first
        try {
            const saved = localStorage.getItem('pro_scheduler_column_widths');
            if (saved) {
                const savedWidths = JSON.parse(saved) as Record<string, number>;
                columns.forEach(col => {
                    if (savedWidths[col.field]) {
                        gridPane.style.setProperty(`--w-${col.field}`, `${savedWidths[col.field]}px`);
                        return;
                    }
                });
            }
        } catch (err) {
            console.warn('[SchedulerService] Failed to load saved column widths:', err);
        }

        // Set default widths for columns that don't have saved values
        columns.forEach(col => {
            const varName = `--w-${col.field}`;
            const currentValue = gridPane.style.getPropertyValue(varName);
            if (!currentValue) {
                gridPane.style.setProperty(varName, `${col.width}px`);
            }
        });

        console.log('[SchedulerService] ✅ CSS variables initialized for', columns.length, 'columns');
    }

    /**
     * Get minimum widths for columns (for resizing)
     * @private
     * @returns Record of field -> minWidth
     */
    private _getColumnMinWidths(): Record<string, number> {
        const columns = this._getColumnDefinitions();
        const minWidths: Record<string, number> = {};
        
        columns.forEach(col => {
            minWidths[col.field] = col.minWidth ?? Math.max(20, col.width * 0.5);
        });
        
        return minWidths;
    }

    // =========================================================================
    // BASELINE MANAGEMENT
    // =========================================================================

    /**
     * Track whether baseline has been set
     * @private
     */
    private _hasBaseline: boolean = false;

    /**
     * Check if baseline has been set for any task
     * @returns True if baseline exists
     */
    hasBaseline(): boolean {
        if (this._hasBaseline) return true;
        
        // Check if any task has baseline data
        const hasBaselineData = this.tasks.some(task => 
            task.baselineStart !== null && task.baselineStart !== undefined ||
            task.baselineFinish !== null && task.baselineFinish !== undefined
        );
        
        this._hasBaseline = hasBaselineData;
        return hasBaselineData;
    }

    /**
     * Set baseline from current schedule
     * Saves current start/end/duration as baseline for all tasks
     */
    setBaseline(): void {
        const isUpdate = this._hasBaseline;
        console.log(`[SchedulerService] ${isUpdate ? 'Updating' : 'Saving'} baseline...`);
        
        this.saveCheckpoint();
        
        let baselineCount = 0;
        this.tasks.forEach(task => {
            if (task.start && task.end && task.duration) {
                task.baselineStart = task.start;
                task.baselineFinish = task.end;
                task.baselineDuration = task.duration;
                baselineCount++;
            }
        });
        
        this._hasBaseline = baselineCount > 0;
        
        // Rebuild grid columns to show actual/variance columns
        this._rebuildGridColumns();
        
        // Update UI button visibility
        this._updateBaselineButtonVisibility();
        
        this.saveData();
        const action = isUpdate ? 'updated' : 'saved';
        this.toastService.success(`Baseline ${action} for ${baselineCount} task${baselineCount !== 1 ? 's' : ''}`);
        
        console.log(`[SchedulerService] ✅ Baseline ${action} for`, baselineCount, 'tasks');
    }

    /**
     * Clear baseline data from all tasks
     */
    clearBaseline(): void {
        console.log('[SchedulerService] Clearing baseline...');
        
        this.saveCheckpoint();
        
        let clearedCount = 0;
        this.tasks.forEach(task => {
            if (task.baselineStart !== null || task.baselineFinish !== null) {
                task.baselineStart = null;
                task.baselineFinish = null;
                task.baselineDuration = undefined;
                clearedCount++;
            }
        });
        
        this._hasBaseline = false;
        
        // Rebuild grid columns to hide actual/variance columns
        this._rebuildGridColumns();
        
        // Update UI button visibility
        this._updateBaselineButtonVisibility();
        
        this.saveData();
        this.toastService.success(`Baseline cleared from ${clearedCount} task${clearedCount !== 1 ? 's' : ''}`);
        
        console.log('[SchedulerService] ✅ Baseline cleared from', clearedCount, 'tasks');
    }

    /**
     * Update baseline button text and menu item state based on baseline existence
     * - Button shows "Save Baseline" or "Update Baseline"
     * - Clear menu item is disabled when no baseline exists
     * @private
     */
    private _updateBaselineButtonVisibility(): void {
        // Update toolbar button text
        const baselineBtn = document.getElementById('baseline-btn');
        const baselineBtnText = document.getElementById('baseline-btn-text');
        
        if (baselineBtn && baselineBtnText) {
            if (this._hasBaseline) {
                baselineBtnText.textContent = 'Update Baseline';
                baselineBtn.title = 'Update Baseline with Current Schedule';
            } else {
                baselineBtnText.textContent = 'Save Baseline';
                baselineBtn.title = 'Save Current Schedule as Baseline';
            }
        }
        
        // Update Clear Baseline menu item state
        const clearMenuItem = document.getElementById('clear-baseline-menu-item');
        if (clearMenuItem) {
            if (this._hasBaseline) {
                clearMenuItem.classList.remove('disabled');
                clearMenuItem.removeAttribute('disabled');
            } else {
                clearMenuItem.classList.add('disabled');
                clearMenuItem.setAttribute('disabled', 'true');
            }
        }
    }

    /**
     * Calculate variance for a task
     * @param task - Task to calculate variance for
     * @returns Variance object with start and finish variances in work days
     */
    calculateVariance(task: Task): { start: number | null; finish: number | null } {
        return this._calculateVariance(task);
    }

    /**
     * Calculate variance for a task (internal)
     * @private
     * @param task - Task to calculate variance for
     * @returns Variance object with start and finish variances in work days
     */
    private _calculateVariance(task: Task): { start: number | null; finish: number | null } {
        let startVariance: number | null = null;
        let finishVariance: number | null = null;
        
        // Calculate start variance: compareStart - baselineStart (or current start if no actual)
        // Positive = ahead of baseline, Negative = behind baseline
        if (task.baselineStart) {
            const compareStart = task.actualStart || task.start;
            if (compareStart) {
                // calcWorkDaysDifference(compareStart, baselineStart) returns:
                // - Positive if compareStart < baselineStart (ahead of schedule)
                // - Negative if compareStart > baselineStart (behind schedule)
                // This matches the desired sign convention
                startVariance = DateUtils.calcWorkDaysDifference(compareStart, task.baselineStart, this.calendar);
            }
        }
        
        // Calculate finish variance: compareFinish - baselineFinish (or current end if no actual)
        // Positive = ahead of baseline, Negative = behind baseline
        if (task.baselineFinish) {
            const compareFinish = task.actualFinish || task.end;
            if (compareFinish) {
                // calcWorkDaysDifference(compareFinish, baselineFinish) returns:
                // - Positive if compareFinish < baselineFinish (ahead of schedule)
                // - Negative if compareFinish > baselineFinish (behind schedule)
                // This matches the desired sign convention
                finishVariance = DateUtils.calcWorkDaysDifference(compareFinish, task.baselineFinish, this.calendar);
            }
        }
        
        return { start: startVariance, finish: finishVariance };
    }

    /**
     * Rebuild grid columns when baseline state changes
     * Updates header and grid to show/hide actual/variance columns
     * @private
     */
    private _rebuildGridColumns(): void {
        // Rebuild header with updated column definitions
        this._buildGridHeader();
        
        // Update grid columns if grid exists
        if (this.grid) {
            const columns = this._getColumnDefinitions();
            this.grid.updateColumns(columns);
        }
        
        // Re-render to show new columns
        this.render();
        
        // Re-initialize column resizers (new columns may have been added)
        // This will be handled by UIEventManager, but we trigger it here
        // The resizers will be re-initialized on next interaction or we can call it explicitly
        setTimeout(() => {
            if (window.uiEventManager) {
                window.uiEventManager.initColumnResizers();
            }
        }, 100);
    }

    // =========================================================================
    // DATA ACCESS (delegated to stores)
    // =========================================================================

    /**
     * Get all tasks
     * @returns All tasks
     */
    get tasks(): Task[] {
        return this.taskStore.getAll();
    }

    /**
     * Set all tasks (replaces entire dataset)
     * CRITICAL: Reset editing state when replacing entire dataset
     * @param tasks - Tasks array
     */
    set tasks(tasks: Task[]) {
        const editingManager = getEditingStateManager();
        
        // CRITICAL: Reset editing state when replacing entire dataset
        // Unconditional reset - always safe when replacing entire dataset
        editingManager.reset();
        
        this.taskStore.setAll(tasks);
        // Trigger render to update viewport with new data
        this.render();
    }

    /**
     * Get calendar configuration
     * @returns Calendar object
     */
    get calendar(): Calendar {
        return this.calendarStore.get();
    }

    /**
     * Set calendar configuration
     * @param calendar - Calendar object
     */
    set calendar(calendar: Calendar) {
        this.calendarStore.set(calendar);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    /**
     * Handle row click
     * @private
     * @param taskId - Task ID
     * @param e - Click event
     */
    private _handleRowClick(taskId: string, e: MouseEvent): void {
        // Detect which field was clicked (if any) by checking the event target
        // This allows the Properties panel to focus the correct field when syncing
        // Note: e.target should be preserved even when GridRenderer creates a modified event
        const target = (e.target || e.currentTarget) as HTMLElement;
        
        if (!target) {
            this._lastClickedField = undefined;
        } else {
            // Skip field detection for checkboxes, action buttons, and collapse buttons
            if (target.closest('.vsg-checkbox') || 
                target.closest('[data-action]') || 
                target.closest('.vsg-collapse-btn')) {
                this._lastClickedField = undefined;
            } else {
                // Check if clicking directly on an input/select
                const input = target.closest('.vsg-input, .vsg-select') as HTMLElement | null;
                if (input) {
                    this._lastClickedField = input.getAttribute('data-field') || undefined;
                } else {
                    // Check if clicking on a cell (which contains an input)
                    const cell = target.closest('[data-field]') as HTMLElement | null;
                    if (cell) {
                        this._lastClickedField = cell.getAttribute('data-field') || undefined;
                    } else {
                        // No field detected - clear it (e.g., clicking on row background)
                        this._lastClickedField = undefined;
                    }
                }
            }
        }
        
        // Selection logic here
        if (e.shiftKey && this.anchorId) {
            // Range selection
            const visibleTasks = this.taskStore.getVisibleTasks((id) => {
                const task = this.taskStore.getById(id);
                return task?._collapsed || false;
            });
            const anchorIndex = visibleTasks.findIndex(t => t.id === this.anchorId);
            const targetIndex = visibleTasks.findIndex(t => t.id === taskId);
            
            if (anchorIndex !== -1 && targetIndex !== -1) {
                this.selectedIds.clear();
                this.selectionOrder = [];
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                for (let i = start; i <= end; i++) {
                    this.selectedIds.add(visibleTasks[i].id);
                    this.selectionOrder.push(visibleTasks[i].id);
                }
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            if (this.selectedIds.has(taskId)) {
                // Removing - filter from order
                this.selectedIds.delete(taskId);
                this.selectionOrder = this.selectionOrder.filter(id => id !== taskId);
            } else {
                // Adding - append to order
                this.selectedIds.add(taskId);
                if (!this.selectionOrder.includes(taskId)) {
                    this.selectionOrder.push(taskId);
                }
            }
            this.anchorId = taskId;
        } else {
            // Single selection - reset order
            this.selectedIds.clear();
            this.selectionOrder = [taskId];
            this.selectedIds.add(taskId);
            this.anchorId = taskId;
        }

        this.focusedId = taskId;
        this._updateSelection();
        this._updateHeaderCheckboxState();
    }

    /**
     * Handle row double-click
     * @private
     * @param taskId - Task ID
     * @param e - Double-click event
     */
    private _handleRowDoubleClick(taskId: string, e: MouseEvent): void {
        this.openDrawer(taskId);
    }

    /**
     * Apply task edit with scheduling triangle logic
     * 
     * Centralizes the CPM-aware edit logic used by both grid and drawer:
     * - Duration edit → Update duration, CPM recalculates end
     * - Start edit → Apply SNET constraint
     * - End edit → Apply FNLT constraint
     * - Actuals → Update without affecting CPM
     * - Constraints → Update and trigger recalculation
     * 
     * @private
     * @param taskId - Task ID
     * @param field - Field name
     * @param value - New value
     * @returns Object indicating what follow-up actions are needed
     */
    /**
     * Apply date change immediately (called from SideDrawer)
     * 
     * Behavior depends on scheduling mode:
     * - AUTO: Apply constraints (SNET for start, FNLT for end)
     * - MANUAL: Update dates directly without constraints
     * 
     * @private
     * @param taskId - Task ID
     * @param field - 'start', 'end', 'actualStart', or 'actualFinish'
     * @param value - New date value (ISO format: YYYY-MM-DD)
     */
    private _applyDateChangeImmediate(taskId: string, field: string, value: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        const isParent = this.taskStore.isParent(taskId);
        if (isParent) return; // Parents don't have direct date edits
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            console.warn('[SchedulerService] Invalid date format:', value);
            return;
        }
        
        const isManual = task.schedulingMode === 'Manual';
        const calendar = this.calendarStore.get();
        
        // ═══════════════════════════════════════════════════════════════════════
        // SCHEDULED DATE EDITS (start, end)
        // ═══════════════════════════════════════════════════════════════════════
        
        if (field === 'start') {
            if (isManual) {
                // MANUAL MODE: Update start directly, recalculate end from duration
                // Validation: End must always be >= Start (push End forward)
                const newEnd = DateUtils.addWorkDays(value, task.duration - 1, calendar);
                
                const updates: Partial<Task> = { 
                    start: value,
                    end: newEnd  // Always recalculate to ensure End >= Start
                };
                this.taskStore.update(taskId, updates);
                
                if (this.engine) {
                    this.engine.updateTask(taskId, updates).catch(error => {
                        console.warn('[SchedulerService] Failed to sync Manual task update to engine:', error);
                    });
                }
                
                this.toastService.info('Manual task dates updated');
            } else {
                // AUTO MODE: Apply SNET constraint
                const updates: Partial<Task> = { 
                    start: value,
                    constraintType: 'snet' as ConstraintType,
                    constraintDate: value 
                };
                this.taskStore.update(taskId, updates);
                
                if (this.engine) {
                    this.engine.updateTask(taskId, updates).catch(error => {
                        console.warn('[SchedulerService] Failed to sync task update to engine:', error);
                    });
                }
                
                this.toastService.info('Start constraint (SNET) applied');
            }
            
            this.recalculateAll();
            this.render();
            return;
        }
        
        if (field === 'end') {
            if (isManual) {
                // MANUAL MODE: Update end directly, recalculate duration
                const effectiveStart = task.actualStart || task.start;
                if (!effectiveStart) {
                    this.toastService.warning('Cannot set end date: Task has no start date');
                    return;
                }
                
                // ═══════════════════════════════════════════════════════════
                // VALIDATION: End must be >= Start (even in Manual mode)
                // If user tries to set End before Start, reject with warning
                // ═══════════════════════════════════════════════════════════
                if (value < effectiveStart) {
                    this.toastService.warning('End date cannot be before start date');
                    return;
                }
                
                const newDuration = DateUtils.calcWorkDays(effectiveStart, value, calendar);
                
                const updates: Partial<Task> = { 
                    end: value,
                    duration: Math.max(1, newDuration)
                };
                this.taskStore.update(taskId, updates);
                
                if (this.engine) {
                    this.engine.updateTask(taskId, updates).catch(error => {
                        console.warn('[SchedulerService] Failed to sync Manual task update to engine:', error);
                    });
                }
                
                this.toastService.info('Manual task dates updated');
            } else {
                // AUTO MODE: Apply FNLT constraint (deadline)
                const updates: Partial<Task> = { 
                    constraintType: 'fnlt' as ConstraintType,
                    constraintDate: value 
                };
                this.taskStore.update(taskId, updates);
                
                if (this.engine) {
                    this.engine.updateTask(taskId, updates).catch(error => {
                        console.warn('[SchedulerService] Failed to sync task update to engine:', error);
                    });
                }
                
                // Warn if deadline is before current start
                if (task.start && value < task.start) {
                    this.toastService.warning('Deadline is earlier than start date - schedule may be impossible');
                } else {
                    this.toastService.info('Finish deadline (FNLT) applied');
                }
            }
            
            this.recalculateAll();
            this.render();
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // ACTUAL DATE EDITS (actualStart, actualFinish) - Same for both modes
        // ═══════════════════════════════════════════════════════════════════════
        
        if (field === 'actualStart') {
            // DRIVER MODE + ANCHOR: actualStart drives schedule and locks history
            const calendar = this.calendarStore.get();
            const updates: Partial<Task> = {
                actualStart: value,
                start: value,
                constraintType: 'snet' as ConstraintType,
                constraintDate: value,
            };
            
            if (task.actualFinish) {
                updates.duration = DateUtils.calcWorkDays(value, task.actualFinish, calendar);
            }
            
            this.taskStore.update(taskId, updates);
            
            if (this.engine) {
                this.engine.updateTask(taskId, updates).catch(error => {
                    console.warn('[SchedulerService] Failed to sync actualStart to engine:', error);
                });
            }
            
            this.toastService.info('Task started - schedule locked with SNET constraint');
            this.recalculateAll();
            this.render();
            return;
            
        } else if (field === 'actualFinish') {
            // DRIVER MODE + COMPLETION: actualFinish closes out the task
            const effectiveStart = task.actualStart || task.start;
            
            if (effectiveStart && value < effectiveStart) {
                this.toastService.warning('Actual finish cannot be before start date');
                return;
            }
            
            const calendar = this.calendarStore.get();
            const actualDuration = effectiveStart
                ? DateUtils.calcWorkDays(effectiveStart, value, calendar)
                : task.duration;
            
            const updates: Partial<Task> = {
                actualFinish: value,
                end: value,
                progress: 100,
                remainingDuration: 0,
                duration: actualDuration,
            };
            
            // Auto-populate actualStart with full Anchor logic
            if (!task.actualStart) {
                if (task.start) {
                    updates.actualStart = task.start;
                    updates.start = task.start;
                    updates.constraintType = 'snet' as ConstraintType;
                    updates.constraintDate = task.start;
                } else {
                    // SAFETY NET: Cannot finish a task that has no start
                    this.toastService.warning('Cannot mark finished: Task has no Start Date.');
                    return;
                }
            }
            
            this.taskStore.update(taskId, updates);
            
            if (this.engine) {
                this.engine.updateTask(taskId, updates).catch(error => {
                    console.warn('[SchedulerService] Failed to sync actualFinish to engine:', error);
                });
            }
            
            this.toastService.success('Task complete');
            this.recalculateAll();
            this.render();
            return;
        }
        
        // Recalculate and render
        this.recalculateAll();
        this.render();
    }

    /**
     * Apply a task edit (called from grid cell change handler)
     * @private
     * @param taskId - Task ID
     * @param field - Field name
     * @param value - New value
     * @returns Object indicating what follow-up actions are needed
     */
    private _applyTaskEdit(taskId: string, field: string, value: unknown): { 
        needsRecalc: boolean; 
        needsRender: boolean;
        success: boolean;
    } {
        const task = this.taskStore.getById(taskId);
        if (!task) {
            return { needsRecalc: false, needsRender: false, success: false };
        }
        
        const isParent = this.taskStore.isParent(taskId);
        let needsRecalc = false;
        let needsRender = false;

        switch (field) {
            case 'duration':
                // Duration edit: update duration, CPM will recalculate end
                // This is standard CPM behavior - no constraint needed
                const newDuration = Math.max(1, parseInt(String(value)) || 1);
                this.taskStore.update(taskId, { duration: newDuration });
                
                // Sync update to engine
                if (this.engine) {
                    this.engine.updateTask(taskId, { duration: newDuration }).catch(error => {
                        console.warn('[SchedulerService] Failed to sync task update to engine:', error);
                    });
                }
                
                needsRecalc = true;
                break;
                
            case 'start':
                // Start edit: User is setting a start constraint
                // Use debounced update to prevent lag during typing
                if (value && !isParent) {
                    const startValue = String(value);
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
                        console.warn('[SchedulerService] Invalid date format:', startValue);
                        return { needsRecalc: false, needsRender: false, success: false };
                    }
                    
                    // Store pending change and debounce the recalculation
                    this._pendingDateChange = { taskId, field: 'start', value: startValue };
                    
                    // Optimistic UI update: show the value immediately in the input
                    // (The actual recalc happens after debounce)
                    if (this._debouncedRecalc) {
                        this._debouncedRecalc();
                    }
                    
                    // Don't set needsRecalc - the debounced function will handle it
                    return { needsRecalc: false, needsRender: false, success: true };
                }
                break;
                
            case 'end':
                // End edit: User is setting a finish deadline
                // Use debounced update to prevent lag during typing
                if (value && !isParent) {
                    const endValue = String(value);
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(endValue)) {
                        console.warn('[SchedulerService] Invalid date format:', endValue);
                        return { needsRecalc: false, needsRender: false, success: false };
                    }
                    
                    // Store pending change and debounce the recalculation
                    this._pendingDateChange = { taskId, field: 'end', value: endValue };
                    
                    if (this._debouncedRecalc) {
                        this._debouncedRecalc();
                    }
                    
                    return { needsRecalc: false, needsRender: false, success: true };
                }
                break;
                
            case 'actualStart':
                // ═══════════════════════════════════════════════════════════════════
                // DRIVER MODE + ANCHOR: actualStart drives schedule and locks history
                // ═══════════════════════════════════════════════════════════════════
                if (value && !isParent) {
                    const actualStartValue = String(value);
                    
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualStartValue)) {
                        console.warn('[SchedulerService] Invalid date format for actualStart:', actualStartValue);
                        return { needsRecalc: false, needsRender: false, success: false };
                    }

                    // Build atomic update
                    // CRITICAL: Lock with SNET so CPM respects historical fact
                    const updates: Partial<Task> = {
                        actualStart: actualStartValue,
                        start: actualStartValue,
                        constraintType: 'snet' as ConstraintType,
                        constraintDate: actualStartValue,
                    };

                    // If task was already finished, recalculate duration for consistency
                    if (task.actualFinish) {
                        updates.duration = DateUtils.calcWorkDays(
                            actualStartValue,
                            task.actualFinish,
                            this.calendarStore.get()
                        );
                    }

                    // Atomic update
                    this.taskStore.update(taskId, updates);

                    // Sync to engine
                    if (this.engine) {
                        this.engine.updateTask(taskId, updates).catch(error => {
                            console.warn('[SchedulerService] Failed to sync actualStart to engine:', error);
                        });
                    }

                    this.toastService.info('Task started - schedule locked with SNET constraint');
                    needsRecalc = true;
                    
                } else if (!value && !isParent) {
                    // Clearing actualStart
                    // NOTE: We preserve the constraint - user may have wanted SNET anyway
                    // They can manually remove it if needed
                    this.taskStore.update(taskId, { actualStart: null });
                    
                    if (this.engine) {
                        this.engine.updateTask(taskId, { actualStart: null }).catch(error => {
                            console.warn('[SchedulerService] Failed to sync actualStart clear to engine:', error);
                        });
                    }
                    
                    this.toastService.info('Actual start cleared. Start constraint preserved.');
                    needsRecalc = true;
                }
                break;
                
            case 'actualFinish':
                // ═══════════════════════════════════════════════════════════════════
                // DRIVER MODE + COMPLETION: actualFinish closes out the task
                // ═══════════════════════════════════════════════════════════════════
                if (value && !isParent) {
                    const actualFinishValue = String(value);
                    
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFinishValue)) {
                        console.warn('[SchedulerService] Invalid date format for actualFinish:', actualFinishValue);
                        return { needsRecalc: false, needsRender: false, success: false };
                    }

                    // Determine effective start for validation and duration calc
                    const effectiveStart = task.actualStart || task.start;

                    // Validation: finish cannot be before start
                    if (effectiveStart && actualFinishValue < effectiveStart) {
                        this.toastService.warning('Actual finish cannot be before start date');
                        return { needsRecalc: false, needsRender: false, success: false };
                    }

                    // Calculate actual duration
                    const calendar = this.calendarStore.get();
                    const actualDuration = effectiveStart
                        ? DateUtils.calcWorkDays(effectiveStart, actualFinishValue, calendar)
                        : task.duration;

                    // Build atomic update
                    const updates: Partial<Task> = {
                        actualFinish: actualFinishValue,
                        end: actualFinishValue,
                        progress: 100,
                        remainingDuration: 0,  // CRITICAL: Zero out for Earned Value calculations
                        duration: actualDuration,
                    };

                    // 1. Auto-populate actualStart if not set
                    if (!task.actualStart) {
                        if (task.start) {
                            // Apply "Anchor Logic" to the implied start
                            updates.actualStart = task.start;
                            updates.start = task.start;
                            updates.constraintType = 'snet' as ConstraintType;
                            updates.constraintDate = task.start;
                        } else {
                            // SAFETY NET: Cannot finish a task that has no start
                            this.toastService.warning('Cannot mark finished: Task has no Start Date.');
                            return { needsRecalc: false, needsRender: false, success: false };
                        }
                    }

                    // Atomic update
                    this.taskStore.update(taskId, updates);

                    // Sync to engine
                    if (this.engine) {
                        this.engine.updateTask(taskId, updates).catch(error => {
                            console.warn('[SchedulerService] Failed to sync actualFinish to engine:', error);
                        });
                    }

                    // User feedback with duration variance
                    const plannedDuration = task.duration || 0;
                    const variance = actualDuration - plannedDuration;
                    
                    if (variance > 0) {
                        this.toastService.info(
                            `Task complete - took ${variance} day${variance !== 1 ? 's' : ''} longer than planned`
                        );
                    } else if (variance < 0) {
                        this.toastService.success(
                            `Task complete - finished ${Math.abs(variance)} day${Math.abs(variance) !== 1 ? 's' : ''} early!`
                        );
                    } else {
                        this.toastService.success('Task complete - on schedule');
                    }

                    needsRecalc = true;
                    
                } else if (!value && !isParent) {
                    // Clearing actualFinish - task is no longer complete
                    this.taskStore.update(taskId, { 
                        actualFinish: null,
                        progress: 0,
                        remainingDuration: task.duration // Reset remaining work
                    });
                    
                    if (this.engine) {
                        this.engine.updateTask(taskId, { 
                            actualFinish: null, 
                            progress: 0 
                        }).catch(error => {
                            console.warn('[SchedulerService] Failed to sync actualFinish clear to engine:', error);
                        });
                    }
                    
                    this.toastService.info('Task reopened');
                    needsRecalc = true;
                }
                break;
                
            case 'constraintType':
                // Constraint type change: if set to ASAP, clear constraint date
                const constraintValue = String(value);
                if (constraintValue === 'asap') {
                    this.taskStore.update(taskId, { 
                        constraintType: 'asap',
                        constraintDate: null 
                    });
                    this.toastService.info('Constraint removed - task will schedule based on dependencies');
                } else {
                    // For other constraint types, just update
                    this.taskStore.update(taskId, { constraintType: constraintValue as ConstraintType });
                }
                needsRecalc = true;
                break;
                
            case 'constraintDate':
                // Constraint date change
                this.taskStore.update(taskId, { constraintDate: String(value) || null });
                needsRecalc = true;
                break;
                
            case 'tradePartnerIds':
                // Trade partner assignments - display only, doesn't affect CPM
                this.taskStore.update(taskId, { tradePartnerIds: Array.isArray(value) ? value as string[] : [] });
                
                // Sync to engine (for data round-trip preservation)
                if (this.engine) {
                    this.engine.updateTask(taskId, { tradePartnerIds: Array.isArray(value) ? value as string[] : [] }).catch(error => {
                        console.warn('[SchedulerService] Failed to sync tradePartnerIds to engine:', error);
                    });
                }
                
                needsRender = true;
                break;
                
            case 'schedulingMode':
                // ═══════════════════════════════════════════════════════════
                // SCHEDULING MODE CHANGE
                // Auto → Manual: Preserve current dates, task becomes "pinned"
                // Manual → Auto: Convert current Start to SNET constraint
                //                (preserves user intent, prevents jarring date jumps)
                // ═══════════════════════════════════════════════════════════
                const newMode = String(value) as 'Auto' | 'Manual';
                
                // Validate mode value
                if (newMode !== 'Auto' && newMode !== 'Manual') {
                    console.warn('[SchedulerService] Invalid scheduling mode:', value);
                    return { needsRecalc: false, needsRender: false, success: false };
                }
                
                // Parent tasks cannot be Manual
                if (isParent && newMode === 'Manual') {
                    this.toastService.warning('Parent tasks cannot be manually scheduled');
                    return { needsRecalc: false, needsRender: false, success: false };
                }
                
                // Skip if no change
                if (task.schedulingMode === newMode) {
                    return { needsRecalc: false, needsRender: false, success: true };
                }
                
                if (newMode === 'Auto' && task.schedulingMode === 'Manual') {
                    // ═══════════════════════════════════════════════════════
                    // MANUAL → AUTO TRANSITION
                    // Convert current Start to SNET constraint to preserve user intent
                    // This prevents the task from "snapping back" unexpectedly
                    // User can remove the constraint later if they want ASAP behavior
                    // ═══════════════════════════════════════════════════════
                    const updates: Partial<Task> = {
                        schedulingMode: 'Auto',
                        constraintType: 'snet' as ConstraintType,
                        constraintDate: task.start || null
                    };
                    
                    this.taskStore.update(taskId, updates);
                    
                    if (this.engine) {
                        this.engine.updateTask(taskId, updates).catch(error => {
                            console.warn('[SchedulerService] Failed to sync Manual→Auto transition:', error);
                        });
                    }
                    
                    this.toastService.info('Task is now auto-scheduled with SNET constraint (remove constraint for ASAP)');
                } else {
                    // AUTO → MANUAL: Simple mode change, dates preserved
                    this.taskStore.update(taskId, { schedulingMode: newMode });
                    
                    if (this.engine) {
                        this.engine.updateTask(taskId, { schedulingMode: newMode }).catch(error => {
                            console.warn('[SchedulerService] Failed to sync schedulingMode to engine:', error);
                        });
                    }
                    
                    this.toastService.info('Task is now manually scheduled - dates are fixed');
                }
                
                // Recalculate to apply new mode behavior
                needsRecalc = true;
                break;
                
            default:
                // All other fields - simple update (name, notes, progress, etc.)
                this.taskStore.update(taskId, { [field]: value } as Partial<Task>);
                needsRender = true;
        }
        
        return { needsRecalc, needsRender, success: true };
    }

    /**
     * Handle cell change with proper scheduling triangle logic
     * 
     * Matches industry-standard CPM behavior (same as MS Project):
     * - Duration edit → Keep start, CPM recalculates end
     * - Start edit → Apply SNET constraint (Start No Earlier Than)
     * - End edit → Apply FNLT constraint (Finish No Later Than)
     * 
     * Unlike MS Project, we show clear feedback when constraints are applied.
     * 
     * @private
     * @param taskId - Task ID
     * @param field - Field name
     * @param value - New value
     */
    private _handleCellChange(taskId: string, field: string, value: unknown): void {
        // Skip checkbox field - it's a visual indicator of selection, not task data
        if (field === 'checkbox') {
            return;
        }
        
        this.saveCheckpoint();
        
        const result = this._applyTaskEdit(taskId, field, value);
        
        if (!result.success) {
            return;
        }
        
        // Handle follow-up actions
        if (result.needsRecalc) {
            this.recalculateAll();
            this.saveData();
            this.render();
        } else if (result.needsRender) {
            this.render();
            this.saveData();
        } else {
            // Even if no recalc/render needed, save the data
            this.saveData();
        }
    }

    /**
     * Handle Enter key pressed on the last task in the list
     * Creates a new task as a sibling and focuses the same field
     * @private
     * @param lastTaskId - The ID of the last task (where Enter was pressed)
     * @param field - The field that was being edited (to focus same field in new task)
     */
    private _handleEnterLastRow(lastTaskId: string, field: string): void {
        // Get the last task to determine its parent (new task will be a sibling)
        const lastTask = this.taskStore.getById(lastTaskId);
        if (!lastTask) return;
        
        // Create new task with same parent as the last task (making it a sibling)
        // Use addTask which already handles:
        // - Generating sortKey (appends to end of siblings)
        // - Setting focusCell: true
        // - Selecting the new task
        // - Scrolling to it
        
        // We need to temporarily set focusedId so addTask creates sibling at correct level
        this.focusedId = lastTaskId;
        
        // Add the task - this will create it as a sibling of lastTask
        this.addTask().then((newTask) => {
            if (newTask && this.grid) {
                // Focus the same field that was being edited (not always 'name')
                // Use a short delay to ensure the task is rendered
                setTimeout(() => {
                    this.grid?.focusCell(newTask.id, field);
                }, 100);
            }
        });
    }

    /**
     * Handle trade partner chip click
     * @private
     * @param taskId - Task ID
     * @param tradePartnerId - Trade Partner ID
     * @param e - Click event
     */
    private _handleTradePartnerClick(taskId: string, tradePartnerId: string, e: MouseEvent): void {
        e.stopPropagation(); // Prevent row click from firing
        
        // For now, just show a toast - Phase 12 will add details panel
        const partner = this.tradePartnerStore.get(tradePartnerId);
        if (partner) {
            this.toastService.info(`Trade Partner: ${partner.name}`);
        }
        
        // TODO: Phase 12 - Open trade partner details panel
    }

    /**
     * Handle action button click
     * @private
     * @param taskId - Task ID
     * @param action - Action ID
     * @param e - Click event
     */
    private _handleAction(taskId: string, action: string, e?: MouseEvent): void {
        e?.stopPropagation(); // Prevent row click from firing
        
        // Handle phantom row activation
        // NOTE: addTask() already includes focusCell: true, focusField: 'name'
        // which provides the "spreadsheet feel" of immediate name column focus
        if (taskId === '__PHANTOM_ROW__' && action === 'activate-phantom') {
            this.addTask();  // Uses existing addTask logic with auto-focus
            return;
        }
        
        // Handle blank row actions
        if (action === 'wake-up') {
            this.wakeUpBlankRow(taskId);
            return;
        }
        
        if (action === 'maybe-revert') {
            this.maybeRevertToBlank(taskId);
            return;
        }
        
        switch (action) {
            case 'indent':
                this.indent(taskId);
                break;
            case 'outdent':
                this.outdent(taskId);
                break;
            case 'links':
                this.openDependencies(taskId);
                break;
            case 'delete':
                this.deleteTask(taskId);
                break;
        }
    }

    /**
     * Handle drawer update with scheduling triangle logic
     * 
     * Applies the same constraint logic as grid edits:
     * - Start edit → SNET constraint
     * - End edit → FNLT constraint
     * - Duration edit → Standard CPM
     * 
     * @private
     * @param taskId - Task ID
     * @param field - Field name
     * @param value - New value
     */
    private _handleDrawerUpdate(taskId: string, field: string, value: unknown): void {
        this.saveCheckpoint();
        
        const result = this._applyTaskEdit(taskId, field, value);
        
        if (!result.success) {
            return;
        }
        
        // Handle follow-up actions
        if (result.needsRecalc) {
            this.recalculateAll();
            this.saveData();
            this.render();
        } else if (result.needsRender) {
            this.render();
            this.saveData();
        } else {
            this.saveData();
        }
        
        // Sync drawer with updated values (dates may have changed from CPM)
        if (this.drawer && this.drawer.isDrawerOpen() && this.drawer.getActiveTaskId() === taskId) {
            const updatedTask = this.taskStore.getById(taskId);
            if (updatedTask) {
                this.drawer.sync(updatedTask);
            }
        }
    }

    /**
     * Handle dependencies save
     * @private
     * @param taskId - Task ID
     * @param dependencies - Dependencies array
     */
    private _handleDependenciesSave(taskId: string, dependencies: Array<{ id: string; type: LinkType; lag: number }>): void {
        this.saveCheckpoint();
        this.taskStore.update(taskId, { dependencies });
        
        // Sync update to engine
        if (this.engine) {
            this.engine.updateTask(taskId, { dependencies }).catch(error => {
                console.warn('[SchedulerService] Failed to sync task update to engine:', error);
            });
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Handle calendar save
     * @private
     * @param calendar - Calendar configuration
     */
    private _handleCalendarSave(calendar: Calendar): void {
        this.saveCheckpoint();
        this.calendarStore.set(calendar);
        
        // Sync calendar to engine (reinitialize with new calendar)
        if (this.engine) {
            const tasks = this.taskStore.getAll();
            const context: TaskHierarchyContext = {
                isParent: (id: string) => this.taskStore.isParent(id),
                getDepth: (id: string) => this.taskStore.getDepth(id),
            };
            this.engine.initialize(tasks, calendar, context).catch(error => {
                console.warn('[SchedulerService] Failed to sync calendar to engine:', error);
            });
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
        this.toastService.success('Calendar updated. Recalculating schedule...');
    }

    /**
     * Handle row move (drag and drop)
     * 
     * Supports three drop positions:
     * - 'before': Insert dragged tasks before target (same parent level)
     * - 'after': Insert dragged tasks after target (same parent level)
     * - 'child': Make dragged tasks children of target (indent)
     * 
     * When dragging parent tasks, all descendants move with them.
     * Uses fractional indexing (sortKey) to avoid renumbering other tasks.
     * 
     * @private
     * @param taskIds - Task IDs being moved (may include multiple selected)
     * @param targetId - Target task ID to drop on/near
     * @param position - 'before', 'after', or 'child'
     */
    private _handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void {
        // =========================================================================
        // VALIDATION
        // =========================================================================
        
        // Guard: No tasks to move
        if (!taskIds || taskIds.length === 0) {
            return;
        }
        
        // Guard: No valid target
        const targetTask = this.taskStore.getById(targetId);
        if (!targetTask) {
            this.toastService.warning('Invalid drop target');
            return;
        }
        
        // Guard: Can't drop on self
        if (taskIds.includes(targetId)) {
            return;
        }
        
        // =========================================================================
        // COLLECT ALL TASKS TO MOVE (including descendants)
        // =========================================================================
        
        const selectedSet = new Set(taskIds);
        
        // Find "top-level" selected tasks (tasks whose parent is NOT also selected)
        // This is the same pattern used in indentSelection()
        const topLevelSelected = taskIds
            .map(id => this.taskStore.getById(id))
            .filter((t): t is Task => t !== undefined)
            .filter(task => !task.parentId || !selectedSet.has(task.parentId));
        
        if (topLevelSelected.length === 0) {
            return;
        }
        
        // Collect all tasks to move (top-level + all their descendants)
        // This ensures parent tasks bring their children along
        const tasksToMove = new Set<Task>();
        const taskIdsToMove = new Set<string>();
        
        const collectDescendants = (task: Task): void => {
            tasksToMove.add(task);
            taskIdsToMove.add(task.id);
            
            // Recursively collect all descendants
            this.taskStore.getChildren(task.id).forEach(child => {
                collectDescendants(child);
            });
        };
        
        topLevelSelected.forEach(task => collectDescendants(task));
        
        // =========================================================================
        // VALIDATE: Prevent circular reference (can't drop parent onto descendant)
        // =========================================================================
        
        if (taskIdsToMove.has(targetId)) {
            this.toastService.warning('Cannot drop a task onto its own descendant');
            return;
        }
        
        // Also check if target is inside any task being moved
        let checkParent = targetTask.parentId;
        while (checkParent) {
            if (taskIdsToMove.has(checkParent)) {
                this.toastService.warning('Cannot drop a task onto its own descendant');
                return;
            }
            const parent = this.taskStore.getById(checkParent);
            checkParent = parent?.parentId ?? null;
        }
        
        // =========================================================================
        // SAVE CHECKPOINT FOR UNDO
        // =========================================================================
        
        this.saveCheckpoint();
        
        // =========================================================================
        // DETERMINE NEW PARENT AND SORT KEY POSITION
        // =========================================================================
        
        let newParentId: string | null;
        let beforeKey: string | null;
        let afterKey: string | null;
        
        if (position === 'child') {
            // =====================================================================
            // CHILD POSITION: Make dragged tasks children of target
            // =====================================================================
            newParentId = targetId;
            
            // Append to end of target's children
            const existingChildren = this.taskStore.getChildren(targetId);
            beforeKey = existingChildren.length > 0 
                ? existingChildren[existingChildren.length - 1].sortKey ?? null 
                : null;
            afterKey = null;
            
            // If target was collapsed, expand it to show the newly added children
            if (targetTask._collapsed) {
                this.taskStore.update(targetId, { _collapsed: false });
            }
            
        } else if (position === 'before') {
            // =====================================================================
            // BEFORE POSITION: Insert before target (same parent level)
            // =====================================================================
            newParentId = targetTask.parentId ?? null;
            
            // Get siblings at target's level
            const siblings = this.taskStore.getChildren(newParentId);
            const targetIndex = siblings.findIndex(t => t.id === targetId);
            
            // beforeKey = previous sibling's key (or null if first)
            beforeKey = targetIndex > 0 ? siblings[targetIndex - 1].sortKey ?? null : null;
            // afterKey = target's key
            afterKey = targetTask.sortKey ?? null;
            
        } else {
            // =====================================================================
            // AFTER POSITION: Insert after target (same parent level)
            // =====================================================================
            newParentId = targetTask.parentId ?? null;
            
            // Get siblings at target's level
            const siblings = this.taskStore.getChildren(newParentId);
            const targetIndex = siblings.findIndex(t => t.id === targetId);
            
            // beforeKey = target's key
            beforeKey = targetTask.sortKey ?? null;
            // afterKey = next sibling's key (or null if last)
            afterKey = targetIndex < siblings.length - 1 
                ? siblings[targetIndex + 1].sortKey ?? null 
                : null;
        }
        
        // =========================================================================
        // GENERATE SORT KEYS FOR MOVED TASKS
        // =========================================================================
        
        // Generate keys for top-level selected tasks (they get inserted at the drop position)
        const sortKeys = OrderingService.generateBulkKeys(
            beforeKey,
            afterKey,
            topLevelSelected.length
        );
        
        // =========================================================================
        // UPDATE TOP-LEVEL TASKS (change parentId and sortKey)
        // =========================================================================
        
        topLevelSelected.forEach((task, index) => {
            this.taskStore.update(task.id, {
                parentId: newParentId,
                sortKey: sortKeys[index]
            });
        });
        
        // NOTE: Descendants keep their parentId unchanged (they stay as children of their original parent)
        // They will automatically move with their parent because the hierarchy is preserved
        
        // =========================================================================
        // RECALCULATE, SAVE, AND RENDER
        // =========================================================================
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // =========================================================================
        // USER FEEDBACK
        // =========================================================================
        
        const totalMoved = tasksToMove.size;
        const topLevelCount = topLevelSelected.length;
        
        if (totalMoved === 1) {
            this.toastService.success('Task moved');
        } else if (totalMoved === topLevelCount) {
            this.toastService.success(`Moved ${totalMoved} tasks`);
        } else {
            this.toastService.success(`Moved ${topLevelCount} task(s) with ${totalMoved - topLevelCount} children`);
        }
    }

    /**
     * Handle bar drag in Gantt
     * @private
     * @param task - Task object
     * @param start - New start date
     * @param end - New end date
     */
    private _handleBarDrag(task: Task, start: string, end: string): void {
        this.saveCheckpoint();
        const calendar = this.calendarStore.get();
        const duration = DateUtils.calcWorkDays(start, end, calendar);
        
        this.taskStore.update(task.id, { start, end, duration });
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    // =========================================================================
    // KEYBOARD HANDLERS
    // =========================================================================

    /**
     * Handle arrow navigation
     * @private
     * @param key - 'ArrowUp' or 'ArrowDown'
     * @param shiftKey - Shift key pressed
     * @param ctrlKey - Ctrl key pressed
     */
    private _handleArrowNavigation(key: 'ArrowUp' | 'ArrowDown', shiftKey: boolean, _ctrlKey: boolean): void {
        const visibleTasks = this.taskStore.getVisibleTasks((id) => {
            const task = this.taskStore.getById(id);
            return task?._collapsed || false;
        });
        
        if (visibleTasks.length === 0) return;

        let currentIndex = -1;
        if (this.focusedId) {
            currentIndex = visibleTasks.findIndex(t => t.id === this.focusedId);
        }

        let newIndex: number;
        if (key === 'ArrowUp') {
            newIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        } else {
            newIndex = currentIndex < visibleTasks.length - 1 ? currentIndex + 1 : visibleTasks.length - 1;
        }

        const newTaskId = visibleTasks[newIndex].id;

        if (shiftKey && this.anchorId) {
            // Extend selection
            const anchorIndex = visibleTasks.findIndex(t => t.id === this.anchorId);
            const start = Math.min(anchorIndex, newIndex);
            const end = Math.max(anchorIndex, newIndex);
            
            this.selectedIds.clear();
            for (let i = start; i <= end; i++) {
                this.selectedIds.add(visibleTasks[i].id);
            }
        } else if (!shiftKey) {
            // Single selection
            this.selectedIds.clear();
            this.selectedIds.add(newTaskId);
            this.anchorId = newTaskId;
        }

        this.focusedId = newTaskId;
        this._updateSelection();

        // Scroll to task
        if (this.grid) {
            this.grid.scrollToTask(newTaskId);
        }
    }

    /**
     * Handle arrow cell navigation (Excel-style)
     * Moves the selection highlight WITHOUT entering edit mode
     * UPDATED: Check EditingStateManager instead of local flag
     * @private
     * @param direction - 'up' | 'down' | 'left' | 'right'
     * @param shiftKey - Shift key pressed (for range selection)
     */
    private _handleCellNavigation(direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean): void {
        const editingManager = getEditingStateManager();
        
        // If currently editing, don't navigate
        if (editingManager.isEditing()) {
            return;
        }
        
        const editableColumns = this.getColumnDefinitions()
            .filter(col => col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select')
            .map(col => col.field);
        
        if (editableColumns.length === 0) return;
        
        const visibleTasks = this.taskStore.getVisibleTasks((id) => {
            const task = this.taskStore.getById(id);
            return task?._collapsed || false;
        });
        
        if (visibleTasks.length === 0) return;
        
        // Initialize focused column if not set
        if (!this.focusedColumn) {
            this.focusedColumn = editableColumns[0]; // Default to first editable column (name)
        }
        
        let currentRowIndex = this.focusedId 
            ? visibleTasks.findIndex(t => t.id === this.focusedId)
            : 0;
        let currentColIndex = this.focusedColumn ? editableColumns.indexOf(this.focusedColumn as typeof editableColumns[number]) : -1;
        if (currentColIndex === -1) currentColIndex = 0;
        
        let newRowIndex = currentRowIndex;
        let newColIndex = currentColIndex;
        
        switch (direction) {
            case 'up':
                newRowIndex = Math.max(0, currentRowIndex - 1);
                break;
            case 'down':
                newRowIndex = Math.min(visibleTasks.length - 1, currentRowIndex + 1);
                break;
            case 'left':
                if (currentColIndex > 0) {
                    newColIndex = currentColIndex - 1;
                }
                // Don't wrap to previous row for left/right - keep it simple
                break;
            case 'right':
                if (currentColIndex < editableColumns.length - 1) {
                    newColIndex = currentColIndex + 1;
                }
                break;
        }
        
        const newTaskId = visibleTasks[newRowIndex].id;
        const newColumn = editableColumns[newColIndex];
        
        // Update row selection (for up/down movement)
        if (direction === 'up' || direction === 'down') {
            if (shiftKey && this.anchorId) {
                // Extend selection range
                const anchorIndex = visibleTasks.findIndex(t => t.id === this.anchorId);
                const start = Math.min(anchorIndex, newRowIndex);
                const end = Math.max(anchorIndex, newRowIndex);
                
                this.selectedIds.clear();
                for (let i = start; i <= end; i++) {
                    this.selectedIds.add(visibleTasks[i].id);
                }
            } else if (!shiftKey) {
                // Single selection
                this.selectedIds.clear();
                this.selectedIds.add(newTaskId);
                this.anchorId = newTaskId;
            }
        }
        
        this.focusedId = newTaskId;
        this.focusedColumn = newColumn;
        this._updateSelection();
        
        // Update cell highlight (visual only, no input focus)
        if (this.grid) {
            this.grid.scrollToTask(newTaskId);
            this.grid.highlightCell(newTaskId, newColumn);
        }
    }

    /**
     * Handle arrow collapse/expand
     * @private
     * @param key - 'ArrowLeft' or 'ArrowRight'
     */
    private _handleArrowCollapse(key: 'ArrowLeft' | 'ArrowRight'): void {
        if (!this.focusedId) return;
        
        const task = this.taskStore.getById(this.focusedId);
        if (!task || !this.taskStore.isParent(this.focusedId)) return;

        if (key === 'ArrowRight' && task._collapsed) {
            this.toggleCollapse(this.focusedId);
        } else if (key === 'ArrowLeft' && !task._collapsed) {
            this.toggleCollapse(this.focusedId);
        }
    }

    /**
     * Get all descendant task IDs (recursive)
     * @private
     * @param parentId - Parent task ID
     * @returns Set of descendant task IDs
     */
    private _getAllDescendants(parentId: string): Set<string> {
        const descendants = new Set<string>();
        const addDescendants = (pid: string): void => {
            this.taskStore.getChildren(pid).forEach(child => {
                descendants.add(child.id);
                addDescendants(child.id);
            });
        };
        addDescendants(parentId);
        return descendants;
    }

    /**
     * Get flat list of tasks in display order
     * @private
     * @returns Flat list of tasks
     */
    private _getFlatList(): Task[] {
        const result: Task[] = [];
        const addTask = (parentId: string | null): void => {
            this.taskStore.getChildren(parentId).forEach(task => {
                result.push(task);
                if (!task._collapsed && this.taskStore.isParent(task.id)) {
                    addTask(task.id);
                }
            });
        };
        addTask(null);
        // Add any orphaned tasks (shouldn't happen, but safety check)
        const knownIds = new Set(result.map(t => t.id));
        this.taskStore.getAll().forEach(task => {
            if (!knownIds.has(task.id)) {
                result.push(task);
            }
        });
        return result;
    }


    /**
     * Handle Tab indent
     * @private
     */
    private _handleTabIndent(): void {
        if (this.selectedIds.size === 0) return;
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectedIds);
        const allTasks = this.taskStore.getAll();
        
        // 1. Find the "top-level" selected tasks 
        //    (tasks whose parent is NOT also selected)
        const topLevelSelected = list.filter(task => 
            selectedIds.has(task.id) && 
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        if (topLevelSelected.length === 0) return;
        
        // 2. Find the first top-level selected task to determine the new parent
        //    New parent = the sibling immediately ABOVE it (not selected)
        //    If no valid sibling above, skip this task
        const firstTask = topLevelSelected[0];
        const firstIdx = list.findIndex(t => t.id === firstTask.id);
        
        // Validation: prevent indent on first task
        if (firstIdx <= 0) return;
        
        const prev = list[firstIdx - 1];
        const taskDepth = this.taskStore.getDepth(firstTask.id);
        const prevDepth = this.taskStore.getDepth(prev.id);
        
        // Can't indent if previous task is at a deeper level
        if (prevDepth < taskDepth) return;
        
        // Determine new parent for the first task
        let newParentId: string | null = null;
        if (prevDepth === taskDepth) {
            // Same depth - make previous task the parent
            newParentId = prev.id;
        } else {
            // Previous task is at shallower depth - find ancestor at same depth
            let curr: Task | undefined = prev;
            while (curr && this.taskStore.getDepth(curr.id) > taskDepth) {
                curr = allTasks.find(t => t.id === curr!.parentId);
            }
            if (curr) {
                newParentId = curr.id;
            }
        }
        
        // Validation: prevent circular references (new parent shouldn't be a descendant)
        if (newParentId) {
            // Check if any selected task is a descendant of newParentId
            const newParentDescendants = this._getAllDescendants(newParentId);
            const wouldCreateCircularRef = topLevelSelected.some(task => 
                newParentDescendants.has(task.id)
            );
            if (wouldCreateCircularRef) {
                return; // Would create circular reference
            }
        }
        
        if (!newParentId) return;
        
        // 3. Apply SAME parent to ALL top-level selected tasks
        //    Children of selected tasks keep their parentId unchanged
        //    (they move with their parent automatically)
        topLevelSelected.forEach(task => {
            // Get the new parent's last child's sortKey
            const newSortKey = OrderingService.generateAppendKey(
                this.taskStore.getLastSortKey(newParentId)
            );
            this.taskStore.update(task.id, { 
                parentId: newParentId,
                sortKey: newSortKey
            });
        });
        
        // 5. Update store and render
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Handle Shift+Tab outdent
     * @private
     */
    private _handleTabOutdent(): void {
        if (this.selectedIds.size === 0) return;
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectedIds);
        const allTasks = this.taskStore.getAll();
        
        // 1. Find top-level selected tasks (parent not selected)
        const topLevelSelected = list.filter(task => 
            selectedIds.has(task.id) && 
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        if (topLevelSelected.length === 0) return;
        
        // 2. For each top-level selected task, move to grandparent
        //    New parent = current parent's parent (grandparent)
        //    If already at root (parentId is null), skip
        topLevelSelected.forEach(task => {
            // Validation: prevent outdent on root tasks
            if (!task.parentId) return;
            
            const currentParent = allTasks.find(t => t.id === task.parentId);
            const grandparentId = currentParent ? currentParent.parentId : null;
            
            // Insert after the former parent among its siblings
            const formerParent = currentParent;
            const auntsUncles = this.taskStore.getChildren(grandparentId);
            const formerParentIndex = auntsUncles.findIndex(t => t.id === formerParent?.id);
            
            const beforeKey = formerParent?.sortKey ?? null;
            const afterKey = formerParentIndex < auntsUncles.length - 1 
                ? auntsUncles[formerParentIndex + 1].sortKey 
                : null;
            
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            this.taskStore.update(task.id, { 
                parentId: grandparentId,
                sortKey: newSortKey
            });
        });
        
        // 4. Update store and render
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Handle Escape key
     * @private
     */
    private _handleEscape(): void {
        // First check if drawer is open
        if (this.drawer && this.drawer.isDrawerOpen()) {
            this.drawer.close();
            return;
        }
        
        // If cut is pending, cancel it
        if (this.clipboardIsCut) {
            // Remove 'row-cut' visual class from original rows (if implemented)
            // For now, just clear the cut state
            
            // Clear clipboard
            this.clipboard = null;
            this.clipboardIsCut = false;
            this.clipboardOriginalIds = [];
            
            this.toastService.info('Cut cancelled');
            return;
        }
        
        // Otherwise, deselect all
        this.selectedIds.clear();
        this._updateSelection();
    }

    // =========================================================================
    // SCROLL SYNCHRONIZATION
    // =========================================================================

    /**
     * Sync scroll from grid to Gantt
     * @private
     * @param scrollTop - Scroll position
     */
    /**
     * Calculate the total width of pinned columns
     * @private
     * @returns Total width in pixels
     */
    private _calculatePinnedColumnsWidth(): number {
        const columns = this._getColumnDefinitions();
        const prefs = this._getColumnPreferences();
        const pinnedIndex = prefs.pinned.length;
        
        if (pinnedIndex === 0) return 0;
        
        const pinnedColumns = columns.filter(c => prefs.pinned.includes(c.id)).slice(0, pinnedIndex);
        if (pinnedColumns.length === 0) return 0;
        
        // Calculate total width by summing column widths
        const gridPane = document.getElementById('grid-pane');
        if (!gridPane) return 0;
        
        let totalWidth = 0;
        pinnedColumns.forEach(col => {
            const varName = `--w-${col.field}`;
            const computedStyle = getComputedStyle(gridPane);
            const widthValue = computedStyle.getPropertyValue(varName).trim();
            if (widthValue) {
                totalWidth += parseFloat(widthValue) || col.width || 100;
            } else {
                totalWidth += col.width || 100;
            }
        });
        
        return totalWidth;
    }

    /**
     * Sync header horizontal scroll with grid body
     * @private
     */
    private _syncHeaderScroll(scrollLeft: number): void {
        const header = document.getElementById('grid-header');
        if (!header) return;
        
        // Calculate pinned width
        const pinnedWidth = this._calculatePinnedColumnsWidth();
        
        // Adjust scroll position for pinned columns
        // When grid scrolls, header should scroll by the same amount minus pinned width
        const adjustedScrollLeft = Math.max(0, scrollLeft - pinnedWidth);
        
        if (Math.abs(header.scrollLeft - adjustedScrollLeft) > 1) {
            // Prevent scroll event from triggering sync back to grid
            this._isSyncingHeader = true;
            header.scrollLeft = adjustedScrollLeft;
            // Reset flag after a short delay to allow scroll event to process
            requestAnimationFrame(() => {
                this._isSyncingHeader = false;
            });
        }
    }

    /**
     * Robustly scroll to task and focus cell
     * Waits for task to be available in viewport data before scrolling
     * @private
     * @param taskId - Task ID to scroll to
     * @param field - Field to focus (default: 'name')
     * @param maxRetries - Maximum retry attempts (default: 10)
     * @param retryDelay - Delay between retries in ms (default: 50)
     */
    private _scrollToTaskAndFocus(taskId: string, field: string = 'name', maxRetries: number = 10, retryDelay: number = 50): void {
        if (!this.grid) {
            console.warn('[SchedulerService] Cannot scroll to task - grid not available');
            return;
        }

        // Verify task exists in store first
        const task = this.taskStore.getById(taskId);
        if (!task) {
            console.warn('[SchedulerService] Cannot scroll to task - task not found in store:', taskId);
            return;
        }

        // Check if task's parent is collapsed (task won't be visible)
        if (task.parentId) {
            const parent = this.taskStore.getById(task.parentId);
            if (parent?._collapsed) {
                console.log('[SchedulerService] Task parent is collapsed - task will not be visible until parent is expanded:', taskId);
                // Still try to scroll - the viewport might handle this
            }
        }

        let attempts = 0;
        const checkAndScroll = (): void => {
            attempts++;
            
            // Get current visible tasks from viewport
            const visibleTasks = this.taskStore.getVisibleTasks((id) => {
                const t = this.taskStore.getById(id);
                return t?._collapsed || false;
            });
            
            // Check if task exists in visible tasks
            const taskIndex = visibleTasks.findIndex(t => t.id === taskId);
            const taskExists = taskIndex !== -1;
            
            if (taskExists) {
                // Task is in visible list - safe to scroll
                if (!this.grid) {
                    console.warn('[SchedulerService] Grid not available for scrolling');
                    return;
                }
                
                try {
                    this.grid.scrollToTask(taskId);
                    
                    // Focus cell after scroll completes
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            if (this.grid) {
                                this.grid.focusCell(taskId, field);
                            }
                        }, 100);
                    });
                } catch (error) {
                    console.error('[SchedulerService] Error scrolling to task:', error);
                }
                return; // Success - exit
            }
            
            // Task not found yet
            if (attempts >= maxRetries) {
                console.warn(`[SchedulerService] Failed to scroll to task after ${maxRetries} attempts:`, taskId);
                console.warn('[SchedulerService] Task exists in store but not in visible tasks. Parent may be collapsed.');
                
                // Last attempt: try scrolling anyway (might work if viewport handles it)
                if (this.grid) {
                    try {
                        this.grid.scrollToTask(taskId);
                    } catch (error) {
                        console.error('[SchedulerService] Final scroll attempt failed:', error);
                    }
                }
                return;
            }
            
            // Retry after delay
            setTimeout(checkAndScroll, retryDelay);
        };
        
        // Start checking after initial render cycle completes
        // Use double RAF to ensure render() has processed
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                checkAndScroll();
            });
        });
    }

    // =========================================================================
    // TASK OPERATIONS
    // =========================================================================

    /**
     * Get a task by ID
     * @param id - Task ID
     * @returns Task or undefined
     */
    getTask(id: string): Task | undefined {
        return this.taskStore.getById(id);
    }

    // =========================================================================
    // SELECTION CALLBACKS
    // =========================================================================

    /**
     * Register a callback for task selection changes
     * Used by RightSidebarManager to sync panels with selection
     * 
     * @param callback - Function called when selection changes
     * @returns Unsubscribe function
     */
    public onTaskSelect(callback: (taskId: string | null, task: Task | null, field?: string) => void): () => void {
        this._selectionChangeCallbacks.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this._selectionChangeCallbacks.indexOf(callback);
            if (index > -1) {
                this._selectionChangeCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Get the currently focused/selected task
     * Returns the primary selection (last selected task)
     */
    public getSelectedTask(): Task | null {
        if (!this.focusedId) return null;
        return this.taskStore.getById(this.focusedId) || null;
    }

    /**
     * Register a callback for panel open requests
     * Used by RightSidebarManager to open panels on double-click
     * 
     * @param callback - Function called when a panel should be opened
     * @returns Unsubscribe function
     */
    public onPanelOpenRequest(callback: (panelId: string) => void): () => void {
        this._openPanelCallbacks.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this._openPanelCallbacks.indexOf(callback);
            if (index > -1) {
                this._openPanelCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Update dependencies for a task
     * @param taskId - Task ID
     * @param dependencies - New dependencies array
     */
    public updateDependencies(taskId: string, dependencies: Dependency[]): void {
        this._handleDependenciesSave(taskId, dependencies);
    }

    /**
     * Handle task update from drawer/panel
     * @param taskId - Task ID
     * @param field - Field name
     * @param value - New value
     */
    public handleTaskUpdate(taskId: string, field: string, value: unknown): void {
        this._handleDrawerUpdate(taskId, field, value);
    }

    /**
     * Check if task is a parent
     * @param id - Task ID
     * @returns True if parent
     */
    isParent(id: string): boolean {
        return this.taskStore.isParent(id);
    }

    /**
     * Get task depth
     * @param id - Task ID
     * @returns Depth level
     */
    getDepth(id: string): number {
        return this.taskStore.getDepth(id);
    }

    /**
     * Add a new task
     * @param taskData - Task data
     * @returns Created task
     */
    /**
     * Add a new task - ALWAYS appends to bottom of siblings
     * Uses fractional indexing for bulletproof ordering
     */
    addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
        if (!this.isInitialized) {
            return Promise.resolve(undefined);
        }
        
        return this.operationQueue.enqueue(async () => {
            this.saveCheckpoint();
            
            // Determine parent
            let parentId: string | null = taskData.parentId ?? null;
            if (this.focusedId && taskData.parentId === undefined) {
                const focusedTask = this.taskStore.getById(this.focusedId);
                if (focusedTask) {
                    parentId = focusedTask.parentId ?? null;
                }
            }
            
            // Generate sort key (now guaranteed to see latest state)
            const lastSortKey = this.taskStore.getLastSortKey(parentId);
            const sortKey = OrderingService.generateAppendKey(lastSortKey);
            
            const today = DateUtils.today();
            const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const task: Task = {
                id: taskId,
                rowType: 'task',  // Explicitly set rowType
                name: taskData.name || 'New Task',
                start: taskData.start || today,
                end: taskData.end || today,
                duration: taskData.duration || 1,
                parentId: parentId,
                dependencies: taskData.dependencies || [],
                progress: taskData.progress || 0,
                constraintType: taskData.constraintType || 'asap',
                constraintDate: taskData.constraintDate || null,
                notes: taskData.notes || '',
                level: 0,
                sortKey: sortKey,
                _collapsed: false,
            } as Task;
            
            // Add to store
            this.taskStore.add(task, 'Add Task');
            
            // Update UI state
            this.selectedIds.clear();
            this.selectedIds.add(task.id);
            this.focusedId = task.id;
            
            // Pass focusCell: true to focus the name input for immediate editing
            if (this.grid) {
                this.grid.setSelection(this.selectedIds, this.focusedId, { focusCell: true, focusField: 'name' });
            }
            if (this.gantt) {
                this.gantt.setSelection(this.selectedIds);
            }
            this._updateHeaderCheckboxState();
            
            // Recalculate and render
            // Sync new task to engine
            if (this.engine) {
                this.engine.addTask(task).catch(error => {
                    console.warn('[SchedulerService] Failed to sync new task to engine:', error);
                });
            }
            
            this.recalculateAll();
            this.saveData();
            this.render();
            
            this.toastService?.success('Task added');
            return task;
        });
    }

    /**
     * Delete a task and its children
     */
    deleteTask(taskId: string): void {
        const editingManager = getEditingStateManager();
        
        if (editingManager.isEditingTask(taskId)) {
            editingManager.exitEditMode('task-deleted');
        }
        
        // TaskStore.delete() now handles composite actions internally
        this.taskStore.delete(taskId, true);
        
        // Sync to engine
        if (this.engine) {
            const collectIds = (id: string): string[] => {
                const children = this.taskStore.getChildren(id);
                let ids = [id];
                for (const child of children) {
                    ids = ids.concat(collectIds(child.id));
                }
                return ids;
            };
            
            // Note: Children already deleted from store, just need to sync
            this.engine.deleteTask(taskId).catch(console.error);
        }
        
        this.selectedIds.delete(taskId);
        if (this.focusedId === taskId) {
            this.focusedId = null;
        }

        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService.success('Task deleted');
    }

    /**
     * Delete selected tasks
     * @private
     */
    private _deleteSelected(): void {
        if (this.selectedIds.size === 0) return;
        
        const idsToDelete = Array.from(this.selectedIds);
        
        // Begin composite action for bulk delete
        if (this.historyManager) {
            this.historyManager.beginComposite(`Delete ${idsToDelete.length} Task(s)`);
        }
        
        try {
            for (const id of idsToDelete) {
                // Delete each task (including children)
                // TaskStore will add events to the active composite
                this.taskStore.delete(id, true);
            }
        } finally {
            // End composite action
            if (this.historyManager) {
                this.historyManager.endComposite();
            }
        }

        this.selectedIds.clear();
        this.focusedId = null;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService.success(`Deleted ${idsToDelete.length} task(s)`);
    }

    /**
     * Toggle collapse state
     * @param taskId - Task ID
     */
    toggleCollapse(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;

        this.taskStore.update(taskId, {
            _collapsed: !task._collapsed
        });
        
        // Force immediate render to update visible data and cell states
        // Clear hashes to ensure all cells update (especially name cell with collapse button)
        if (this.grid) {
            const tasks = this.taskStore.getVisibleTasks((id) => {
                const t = this.taskStore.getById(id);
                return t?._collapsed || false;
            });
            this.grid.setVisibleData(tasks);
            this.grid.setSelection(this.selectedIds, this.focusedId);
        }
        
        if (this.gantt) {
            const tasks = this.taskStore.getVisibleTasks((id) => {
                const t = this.taskStore.getById(id);
                return t?._collapsed || false;
            });
            this.gantt.setData(tasks);
            this.gantt.setSelection(this.selectedIds);
        }
    }

    /**
     * Indent a task (make it a child of previous sibling)
     */
    indent(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;

        const list = this.taskStore.getVisibleTasks((id) => {
            const t = this.taskStore.getById(id);
            return t?._collapsed || false;
        });
        
        const idx = list.findIndex(t => t.id === taskId);
        if (idx <= 0) return;
        
        const prev = list[idx - 1];
        const taskDepth = this.taskStore.getDepth(taskId);
        const prevDepth = this.taskStore.getDepth(prev.id);
        
        if (prevDepth < taskDepth) return;
        
        let newParentId: string | null = null;
        
        if (prevDepth === taskDepth) {
            newParentId = prev.id;
        } else {
            let curr: Task | undefined = prev;
            while (curr && this.taskStore.getDepth(curr.id) > taskDepth) {
                curr = curr.parentId ? this.taskStore.getById(curr.parentId) : undefined;
            }
            if (curr) {
                newParentId = curr.id;
            }
        }
        
        if (newParentId !== null) {
            // Generate new sort key for new parent's children
            const newSortKey = OrderingService.generateAppendKey(
                this.taskStore.getLastSortKey(newParentId)
            );
            
            // Use move() which properly records the composite operation
            this.taskStore.move(taskId, newParentId, newSortKey, 'Indent Task');
            
            this.recalculateAll();
            this.saveData();
            this.render();
        }
    }

    /**
     * Outdent a task (move to parent's level)
     */
    outdent(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task || !task.parentId) return;

        const parent = this.taskStore.getById(task.parentId);
        const newParentId = parent ? parent.parentId : null;
        
        // Generate sort key to insert after former parent
        const siblings = this.taskStore.getChildren(newParentId);
        const parentIndex = siblings.findIndex(t => t.id === task.parentId);
        
        let newSortKey: string;
        if (parentIndex >= 0 && parentIndex < siblings.length - 1) {
            // Insert between parent and next sibling
            newSortKey = OrderingService.generateInsertKey(
                siblings[parentIndex].sortKey ?? null,
                siblings[parentIndex + 1].sortKey ?? null
            );
        } else {
            // Insert at end
            newSortKey = OrderingService.generateAppendKey(
                this.taskStore.getLastSortKey(newParentId)
            );
        }
        
        this.taskStore.move(taskId, newParentId, newSortKey, 'Outdent Task');
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Link selected tasks in selection order
     * Creates FS (Finish-to-Start) dependencies with 0 lag
     * Single undo reverses all created links
     */
    linkSelectedInOrder(): void {
        const selectedArray = this.getSelectionInOrder();
        
        if (selectedArray.length < 2) {
            this.toastService?.warning('Select 2 or more tasks to link');
            return;
        }
        
        // Filter out parent/summary tasks (can't link them)
        const linkable = selectedArray.filter(id => !this.taskStore.isParent(id));
        
        if (linkable.length < 2) {
            this.toastService?.warning('Need 2+ non-summary tasks to link');
            return;
        }
        
        // Track how many links we create
        let linksCreated = 0;
        const tasksToUpdate: Array<{ id: string; oldDeps: Dependency[]; newDeps: Dependency[] }> = [];
        
        // Create links: task[0] → task[1] → task[2] → ...
        for (let i = 0; i < linkable.length - 1; i++) {
            const predecessorId = linkable[i];
            const successorId = linkable[i + 1];
            const successor = this.taskStore.getById(successorId);
            
            if (!successor) continue;
            
            // Skip if link already exists
            const existingDeps = successor.dependencies || [];
            if (existingDeps.some(d => d.id === predecessorId)) {
                continue;
            }
            
            // Create new dependency
            const newDep: Dependency = { 
                id: predecessorId, 
                type: 'FS' as LinkType, 
                lag: 0 
            };
            
            const newDeps = [...existingDeps, newDep];
            
            tasksToUpdate.push({
                id: successorId,
                oldDeps: existingDeps,
                newDeps: newDeps
            });
            
            linksCreated++;
        }
        
        if (linksCreated === 0) {
            this.toastService?.info('Tasks are already linked');
            return;
        }
        
        // Apply all updates (each creates its own history entry)
        // The undo stack will have multiple entries, but that's acceptable
        // For true batch undo, we'd need HistoryManager changes
        for (const update of tasksToUpdate) {
            this.taskStore.update(update.id, { dependencies: update.newDeps });
            
            // Sync to engine if available
            if (this.engine) {
                this.engine.updateTask(update.id, { dependencies: update.newDeps }).catch(err => {
                    console.warn('[SchedulerService] Failed to sync dependency update to engine:', err);
                });
            }
        }
        
        // Recalculate CPM (dates may change due to new dependencies)
        this.recalculateAll();
        this.render();
        
        this.toastService?.success(`Linked ${linkable.length} tasks in sequence`);
    }

    /**
     * Insert task above focused task
     */
    /**
     * Insert a new task above the currently focused task
     * Uses fractional indexing to insert between siblings
     */
    insertTaskAbove(): void {
        // Guard: Don't allow task creation during initialization
        if (!this.isInitialized) {
            console.log('[SchedulerService] ⚠️ insertTaskAbove() blocked - not initialized');
            return;
        }
        
        // If no focused task, just add to bottom
        if (!this.focusedId) {
            this.addTask();
            return;
        }
        
        const focusedTask = this.taskStore.getById(this.focusedId);
        if (!focusedTask) {
            this.addTask();
            return;
        }
        
        this.saveCheckpoint();
        
        // Get siblings sorted by sortKey
        const siblings = this.taskStore.getChildren(focusedTask.parentId ?? null);
        const focusedIndex = siblings.findIndex(t => t.id === focusedTask.id);
        
        // Determine sort key bounds for insertion
        const beforeKey = focusedIndex > 0 ? siblings[focusedIndex - 1].sortKey : null;
        const afterKey = focusedTask.sortKey;
        
        // Generate key between previous sibling and focused task
        const sortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        
        const today = DateUtils.today();
        
        // Create new task
        const newTask: Task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: 'New Task',
            start: today,
            end: today,
            duration: 1,
            parentId: focusedTask.parentId,
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            level: focusedTask.level || 0,
            sortKey: sortKey,
            _collapsed: false,
        } as Task;
        
        // Add to store
        this.taskStore.add(newTask, 'Insert Task Above');
        
        // Focus the new task
        this.selectedIds.clear();
        this.selectedIds.add(newTask.id);
        this.focusedId = newTask.id;
        
        // Pass focusCell: true to focus the name input for immediate editing
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId, { focusCell: true, focusField: 'name' });
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
        this._updateHeaderCheckboxState();
        
        // Recalculate and render
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService.success('Task inserted');
    }

    /**
     * Insert a new task BELOW the currently focused task
     * Uses fractional indexing to insert between siblings
     */
    insertTaskBelow(): void {
        // Guard: Don't allow task creation during initialization
        if (!this.isInitialized) {
            console.log('[SchedulerService] ⚠️ insertTaskBelow() blocked - not initialized');
            return;
        }
        
        // If no focused task, just add to bottom
        if (!this.focusedId) {
            this.addTask();
            return;
        }
        
        const focusedTask = this.taskStore.getById(this.focusedId);
        if (!focusedTask) {
            this.addTask();
            return;
        }
        
        this.saveCheckpoint();
        
        // Get siblings sorted by sortKey
        const siblings = this.taskStore.getChildren(focusedTask.parentId ?? null);
        const focusedIndex = siblings.findIndex(t => t.id === focusedTask.id);
        
        // Determine sort key bounds for insertion BELOW focused task
        // beforeKey = focused task's key (insert AFTER this)
        // afterKey = next sibling's key (insert BEFORE this), or null if at end
        const beforeKey = focusedTask.sortKey;
        const afterKey = (focusedIndex >= 0 && focusedIndex < siblings.length - 1)
            ? siblings[focusedIndex + 1].sortKey
            : null;
        
        // Generate key between focused task and next sibling
        const sortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        
        const today = DateUtils.today();
        
        // Create new task
        const newTask: Task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: 'New Task',
            start: today,
            end: today,
            duration: 1,
            parentId: focusedTask.parentId,
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            level: focusedTask.level || 0,
            sortKey: sortKey,
            _collapsed: false,
        } as Task;
        
        // Add to store
        this.taskStore.add(newTask, 'Insert Task Below');
        
        // Focus the new task
        this.selectedIds.clear();
        this.selectedIds.add(newTask.id);
        this.focusedId = newTask.id;
        
        // Pass focusCell: true to focus the name input for immediate editing
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId, { focusCell: true, focusField: 'name' });
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
        this._updateHeaderCheckboxState();
        
        // Recalculate and render
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService.success('Task inserted');
    }

    /**
     * Add a new task as a CHILD of the currently focused task
     * If focused task has no children, this is the first child
     * If focused task has children, appends to end of children
     * If no task is focused, behaves like addTask() (adds to root)
     */
    addChildTask(): void {
        // Guard: Don't allow task creation during initialization
        if (!this.isInitialized) {
            console.log('[SchedulerService] ⚠️ addChildTask() blocked - not initialized');
            return;
        }
        
        // If no focused task, just add to root level
        if (!this.focusedId) {
            this.addTask();
            return;
        }
        
        const parentTask = this.taskStore.getById(this.focusedId);
        if (!parentTask) {
            this.addTask();
            return;
        }
        
        this.saveCheckpoint();
        
        // The focused task becomes the parent
        const newParentId = this.focusedId;
        
        // Get existing children of this parent (sorted by sortKey)
        const existingChildren = this.taskStore.getChildren(newParentId);
        
        // Generate sortKey - append after last child (or first child if none)
        const lastChildKey = existingChildren.length > 0 
            ? existingChildren[existingChildren.length - 1].sortKey 
            : null;
        const sortKey = OrderingService.generateInsertKey(lastChildKey, null);
        
        const today = DateUtils.today();
        
        // Create new task as child
        const newTask: Task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: 'New Task',
            start: today,
            end: today,
            duration: 1,
            parentId: newParentId,  // KEY: Set parent to focused task
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: null,
            notes: '',
            level: (parentTask.level || 0) + 1,  // Increment level
            sortKey: sortKey,
            _collapsed: false,
        } as Task;
        
        // Ensure parent is expanded so child is visible
        if (parentTask._collapsed) {
            this.taskStore.update(newParentId, { _collapsed: false });
        }
        
        // Add to store
        this.taskStore.add(newTask, 'Add Child Task');
        
        // Focus the new task
        this.selectedIds.clear();
        this.selectedIds.add(newTask.id);
        this.focusedId = newTask.id;
        
        // Update selection with focusCell to immediately enter edit mode
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId, { focusCell: true, focusField: 'name' });
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
        this._updateHeaderCheckboxState();
        
        // Recalculate (parent becomes summary task if it wasn't already)
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // Scroll to new task
        if (this.grid) {
            this.grid.scrollToTask(newTask.id);
        }
        
        this.toastService.success('Child task added');
    }

    /**
     * Move the focused task up (before previous sibling)
     * Only modifies the moved task's sortKey
     */
    moveSelectedTasks(direction: number): void {
        if (!this.focusedId) return;
        
        const task = this.taskStore.getById(this.focusedId);
        if (!task) return;
        
        const siblings = this.taskStore.getChildren(task.parentId ?? null);
        const currentIndex = siblings.findIndex(t => t.id === task.id);
        
        // Already at top
        if (direction === -1 && currentIndex <= 0) return;
        // Already at bottom
        if (direction === 1 && currentIndex >= siblings.length - 1) return;
        
        this.saveCheckpoint();
        
        if (direction === -1) {
            // Move up: before previous sibling
            const prevSibling = siblings[currentIndex - 1];
            const beforeKey = currentIndex > 1 ? siblings[currentIndex - 2].sortKey : null;
            const afterKey = prevSibling.sortKey;
            
            // Generate new key
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            // Update only this task's sortKey
            this.taskStore.updateSortKey(task.id, newSortKey);
        } else {
            // Move down: after next sibling
            const nextSibling = siblings[currentIndex + 1];
            const beforeKey = nextSibling.sortKey;
            const afterKey = currentIndex < siblings.length - 2 ? siblings[currentIndex + 2].sortKey : null;
            
            // Generate new key
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            // Update only this task's sortKey
            this.taskStore.updateSortKey(task.id, newSortKey);
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // Keep focus on moved task
        if (this.grid) {
            requestAnimationFrame(() => {
                this.grid!.scrollToTask(this.focusedId!);
            });
        }
    }

    /**
     * Enter edit mode for focused task
     */
    /**
     * Handle editing state changes from EditingStateManager
     */
    private _onEditingStateChange(event: EditingStateChangeEvent): void {
        const { newState, previousState, trigger } = event;
        
        if (!newState.isEditing && previousState.isEditing) {
            // Exiting edit mode
            
            // Re-highlight the cell visually
            if (this.focusedId && this.focusedColumn && this.grid) {
                this.grid.highlightCell(this.focusedId, this.focusedColumn);
            }
            
            // Focus the grid container for keyboard navigation
            // CRITICAL: Must focus the container (tabindex="-1"), NOT the input cell
            // If we focus the input, it would re-trigger edit mode, causing an infinite loop
            // GridRenderer.focus() correctly focuses this.container (which has tabindex="-1")
            // Use requestAnimationFrame for better timing than setTimeout
            if (this.grid) {
                requestAnimationFrame(() => {
                    // Defensive check: Ensure we're not accidentally focusing an input
                    const activeElement = document.activeElement;
                    if (activeElement && 
                        (activeElement.classList.contains('vsg-input') || 
                         activeElement.classList.contains('vsg-select'))) {
                        // If somehow an input is focused, blur it first
                        (activeElement as HTMLElement).blur();
                    }
                    // GridRenderer.focus() focuses the container (tabindex="-1"), not the input
                    this.grid?.focus();
                });
            }
        }
        
        // Update selection when Enter/Shift+Enter/Tab moves to a different row
        if ((trigger === 'enter' || trigger === 'tab' || trigger === 'shift-tab') && 
            newState.isEditing && newState.context) {
            const prevTaskId = previousState.context?.taskId;
            const newTaskId = newState.context.taskId;
            
            // If we moved to a new row, update checkbox selection
            if (prevTaskId && newTaskId !== prevTaskId) {
                this.selectedIds.clear();
                this.selectedIds.add(newTaskId);
                this.focusedId = newTaskId;
                this.focusedColumn = newState.context.field;
                this.anchorId = newTaskId;
                this._updateSelection();
            }
        }
    }

    /**
     * Enter edit mode for the currently highlighted cell
     */
    enterEditMode(): void {
        if (!this.focusedId || !this.focusedColumn) return;
        
        const editingManager = getEditingStateManager();
        const task = this.taskStore.getById(this.focusedId);
        const originalValue = task ? getTaskFieldValue(task, this.focusedColumn as GridColumn['field']) : undefined;
        
        editingManager.enterEditMode(
            { taskId: this.focusedId, field: this.focusedColumn },
            'f2',
            originalValue
        );
        
        if (this.grid) {
            this.grid.focusCell(this.focusedId, this.focusedColumn);
        }
    }

    /**
     * Called when cell editing ends
     * Now mostly handled by EditingStateManager subscription
     */
    exitEditMode(): void {
        const editingManager = getEditingStateManager();
        if (editingManager.isEditing()) {
            editingManager.exitEditMode('programmatic');
        }
    }

    // =========================================================================
    // SELECTION MANAGEMENT
    // =========================================================================

    /**
     * Get selected task IDs in selection order
     * @returns Array of task IDs in the order they were selected
     */
    getSelectionInOrder(): string[] {
        return [...this.selectionOrder];
    }

    /**
     * Update selection in UI components
     * @private
     */
    private _updateSelection(): void {
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId);
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
        // Update header checkbox state
        this._updateHeaderCheckboxState();
        
        // Update driving path if mode is active
        if (this.displaySettings.drivingPathMode) {
            this._updateGanttDrivingPathMode();
        }
        
        // Trigger selection change callbacks (for RightSidebarManager and other listeners)
        // Convert Set to array for _handleSelectionChange
        const selectedArray = Array.from(this.selectedIds);
        this._handleSelectionChange(selectedArray);
    }

    /**
     * Update header checkbox state (checked/unchecked/indeterminate)
     * @private
     * @param checkbox - Optional checkbox element (if not provided, finds it)
     */
    private _updateHeaderCheckboxState(checkbox?: HTMLInputElement): void {
        if (!checkbox) {
            const headerCheckbox = document.querySelector('.header-checkbox-select-all') as HTMLInputElement | null;
            if (!headerCheckbox) return;
            checkbox = headerCheckbox;
        }

        // Get visible tasks (respecting collapse state)
        const visibleTasks = this.taskStore.getVisibleTasks((id) => {
            const task = this.taskStore.getById(id);
            return task?._collapsed || false;
        });

        if (visibleTasks.length === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            return;
        }

        // Count how many visible tasks are selected
        const selectedCount = visibleTasks.filter(t => this.selectedIds.has(t.id)).length;

        if (selectedCount === 0) {
            // None selected
            checkbox.checked = false;
            checkbox.indeterminate = false;
        } else if (selectedCount === visibleTasks.length) {
            // All selected
            checkbox.checked = true;
            checkbox.indeterminate = false;
        } else {
            // Some selected (indeterminate state)
            checkbox.checked = false;
            checkbox.indeterminate = true;
        }
    }

    /**
     * Handle select all checkbox click
     * @private
     * @param checkbox - The header checkbox element
     */
    private _handleSelectAllClick(checkbox: HTMLInputElement): void {
        // Get visible tasks (respecting collapse state)
        const visibleTasks = this.taskStore.getVisibleTasks((id) => {
            const task = this.taskStore.getById(id);
            return task?._collapsed || false;
        });

        if (checkbox.checked) {
            // Select all visible tasks
            visibleTasks.forEach(task => {
                this.selectedIds.add(task.id);
            });
        } else {
            // Deselect all visible tasks
            visibleTasks.forEach(task => {
                this.selectedIds.delete(task.id);
            });
        }

        // Update selection state
        this._updateSelection();
    }

    /**
     * Copy selected tasks
     */
    copySelected(): void {
        if (this.selectedIds.size === 0) {
            this.toastService.info('No tasks selected');
            return;
        }

        const selected = this.taskStore.getAll().filter(t => this.selectedIds.has(t.id));
        
        // Include children - for each selected parent, auto-include ALL descendants (recursively)
        const payload = new Set<Task>();
        const getDescendants = (parentId: string): void => {
            this.taskStore.getChildren(parentId).forEach(child => {
                payload.add(child);
                getDescendants(child.id);
            });
        };

        selected.forEach(task => {
            payload.add(task);
            if (this.taskStore.isParent(task.id)) {
                getDescendants(task.id);
            }
        });

        // Deep clone the collection (JSON parse/stringify)
        const payloadArray = Array.from(payload);
        this.clipboard = payloadArray.map(t => JSON.parse(JSON.stringify(t)));
        
        // Store original IDs
        this.clipboardOriginalIds = payloadArray.map(t => t.id);
        
        // Set clipboardIsCut = false
        this.clipboardIsCut = false;
        
        this.toastService.success(`Copied ${this.clipboard.length} task(s)`);
    }

    /**
     * Cut selected tasks
     */
    cutSelected(): void {
        if (this.selectedIds.size === 0) {
            this.toastService.info('No tasks selected');
            return;
        }

        // Perform same logic as copySelection()
        const selected = this.taskStore.getAll().filter(t => this.selectedIds.has(t.id));
        
        // Include children - for each selected parent, auto-include ALL descendants (recursively)
        const payload = new Set<Task>();
        const getDescendants = (parentId: string): void => {
            this.taskStore.getChildren(parentId).forEach(child => {
                payload.add(child);
                getDescendants(child.id);
            });
        };

        selected.forEach(task => {
            payload.add(task);
            if (this.taskStore.isParent(task.id)) {
                getDescendants(task.id);
            }
        });

        // Deep clone the collection (JSON parse/stringify)
        const payloadArray = Array.from(payload);
        this.clipboard = payloadArray.map(t => JSON.parse(JSON.stringify(t)));
        
        // Store original IDs for deletion after cut-paste
        this.clipboardOriginalIds = payloadArray.map(t => t.id);
        
        // Set clipboardIsCut = true
        this.clipboardIsCut = true;
        
        // Do NOT delete tasks yet - wait for paste
        
        this.toastService.success(`Cut ${this.clipboard.length} task(s)`);
    }

    /**
     * Paste tasks
     */
    paste(): void {
        // 1. If clipboard is empty, show toast "Nothing to paste" and return
        if (!this.clipboard || this.clipboard.length === 0) {
            this.toastService.info('Nothing to paste');
            return;
        }

        // 2. saveCheckpoint() for undo
        this.saveCheckpoint();

        // 3. Determine insert location (after focusedId, or at end)
        const flatList = this._getFlatList();
        let insertIndex = flatList.length;
        
        if (this.focusedId) {
            const focusedIndex = flatList.findIndex(t => t.id === this.focusedId);
            if (focusedIndex !== -1) {
                insertIndex = focusedIndex + 1;
            }
        }

        // 4. Determine target parentId (same parent as focused task, or null)
        let targetParentId: string | null = null;
        if (this.focusedId) {
            const focusedTask = this.taskStore.getById(this.focusedId);
            if (focusedTask) {
                targetParentId = focusedTask.parentId;
            }
        }

        // 5. Create ID map: oldId → newId (generate unique IDs)
        const idMap = new Map<string, string>();
        this.clipboard.forEach(task => {
            const newId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            idMap.set(task.id, newId);
        });

        // 6. Clone tasks with new IDs
        const newTasks = this.clipboard.map(task => {
            const cloned = JSON.parse(JSON.stringify(task)) as Task;
            cloned.id = idMap.get(task.id)!;
            return cloned;
        });

        // 7. Remap parentId:
        //    - If original parentId exists in idMap → use mapped ID (internal)
        //    - Else → use targetParentId (external parent)
        newTasks.forEach(task => {
            if (task.parentId && idMap.has(task.parentId)) {
                // Internal parent - use mapped ID
                task.parentId = idMap.get(task.parentId)!;
            } else {
                // Top-level of pasted subtree: attach to target parent
                task.parentId = targetParentId;
            }
        });

        // 8. Remap dependencies:
        //    - KEEP only dependencies where dep.id exists in idMap (internal)
        //    - DROP dependencies pointing outside the copied set (external)
        //    - Remap kept dep.id to new ID
        newTasks.forEach(task => {
            task.dependencies = (task.dependencies || [])
                .filter(dep => idMap.has(dep.id))
                .map(dep => ({
                    ...dep,
                    id: idMap.get(dep.id)!
                }));
        });

        // 8.5. Assign sortKeys to pasted tasks - INSERT AFTER FOCUSED TASK
        // 
        // For tasks being pasted at the same level as the focused task (targetParentId),
        // we want to insert them immediately AFTER the focused task, not at the end.
        // For tasks in other parent groups (nested children within pasted content),
        // we append to the end of that group since there's no specific position.
        
        const pastedTasksByParent = new Map<string | null, Task[]>();
        newTasks.forEach(task => {
            const parentId = task.parentId ?? null;
            if (!pastedTasksByParent.has(parentId)) {
                pastedTasksByParent.set(parentId, []);
            }
            pastedTasksByParent.get(parentId)!.push(task);
        });
        
        // Assign sortKeys to each group
        pastedTasksByParent.forEach((pastedSiblings, parentId) => {
            // Check if this is the same parent level as the focused task
            const isTargetLevel = parentId === targetParentId;
            
            if (isTargetLevel && this.focusedId) {
                // INSERT AFTER FOCUSED TASK
                // Get the focused task and its siblings
                const focusedTask = this.taskStore.getById(this.focusedId);
                const siblings = this.taskStore.getChildren(parentId);
                const focusedIndex = siblings.findIndex(t => t.id === this.focusedId);
                
                // Determine the sort key bounds for insertion
                // beforeKey = focused task's key (insert AFTER this)
                // afterKey = next sibling's key (insert BEFORE this), or null if at end
                const beforeKey = focusedTask?.sortKey ?? null;
                const afterKey = (focusedIndex >= 0 && focusedIndex < siblings.length - 1)
                    ? siblings[focusedIndex + 1].sortKey
                    : null;
                
                // Generate keys between focused task and next sibling
                const sortKeys = OrderingService.generateBulkKeys(
                    beforeKey,
                    afterKey,
                    pastedSiblings.length
                );
                
                pastedSiblings.forEach((task, index) => {
                    task.sortKey = sortKeys[index];
                });
            } else {
                // APPEND TO END (for nested children or when no focused task)
                // This handles internal hierarchy within pasted content
                const existingLastKey = this.taskStore.getLastSortKey(parentId);
                
                const sortKeys = OrderingService.generateBulkKeys(
                    existingLastKey,
                    null,
                    pastedSiblings.length
                );
                
                pastedSiblings.forEach((task, index) => {
                    task.sortKey = sortKeys[index];
                });
            }
        });

        // 9. Append newTasks to existing tasks
        const allTasks = this.taskStore.getAll();
        const finalTasks = [...allTasks, ...newTasks];

        // Update store with new array (use finalTasks, not allTasks!)
        this.taskStore.setAll(finalTasks);

        // 10. If clipboardIsCut === true:
        //     - Delete original tasks using clipboardOriginalIds
        //     - Clear clipboard (cut is one-time)
        //     - Clear clipboardIsCut flag
        const wasCut = this.clipboardIsCut;
        if (this.clipboardIsCut) {
            // Delete original tasks
            this.clipboardOriginalIds.forEach(id => {
                this.taskStore.delete(id);
            });
            
            // Clear clipboard (cut is one-time)
            this.clipboard = null;
            this.clipboardIsCut = false;
            this.clipboardOriginalIds = [];
        }

        // 11. Select the newly pasted tasks
        this.selectedIds.clear();
        newTasks.forEach(t => this.selectedIds.add(t.id));
        this.focusedId = newTasks[0]?.id || null;
        this.anchorId = this.focusedId;

        // Update selection in UI
        this._updateSelection();

        // 12. recalculateAll() → saveData() → render()
        this.recalculateAll();
        this.saveData();
        this.render();

        // Scroll to show the first pasted task
        // Use requestAnimationFrame to ensure render completes before scrolling
        if (this.grid && this.focusedId) {
            requestAnimationFrame(() => {
                this.grid?.scrollToTask(this.focusedId!);
            });
        }

        // 13. Show toast: "Pasted X task(s)" or "Moved X task(s)" for cut
        const message = wasCut 
            ? `Moved ${newTasks.length} task(s)` 
            : `Pasted ${newTasks.length} task(s)`;
        this.toastService.success(message);
    }

    // =========================================================================
    // UI MODAL OPERATIONS
    // =========================================================================

    /**
     * Open drawer for a task
     * Called by double-click handlers to explicitly open the panel
     * Now uses callback system to work with RightSidebarManager
     * 
     * @param taskId - Task ID to show details for
     */
    openDrawer(taskId: string): void {
        // 1. Ensure selection is synced first (this triggers _handleSelectionChange)
        if (this.focusedId !== taskId) {
            // Select the task - this will sync data to panels via onTaskSelect
            this.selectedIds.clear();
            this.selectedIds.add(taskId);
            this.selectionOrder = [taskId];
            this.focusedId = taskId;
            this.anchorId = taskId;
            this._updateSelection();
        }
        
        // 2. Request the UI to open the 'details' panel
        this._openPanelCallbacks.forEach(cb => {
            try {
                cb('details');
            } catch (e) {
                console.error('[SchedulerService] Panel open callback error:', e);
            }
        });
    }

    /**
     * Close drawer
     */
    closeDrawer(): void {
        if (this.drawer) {
            this.drawer.close();
        }
    }

    /**
     * Open dependencies modal or panel
     * @param taskId - Task ID
     */
    openDependencies(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        // Try to open via panel system first (if RightSidebarManager is available)
        if (this._openPanelCallbacks.length > 0) {
            this._openPanelCallbacks.forEach(cb => {
                try {
                    cb('links');
                } catch (e) {
                    console.error('[SchedulerService] Panel open callback error:', e);
                }
            });
            // Sync the panel with the task (panel will handle it via selection callback)
            // But we also need to ensure the task is selected
            if (this.focusedId !== taskId) {
                this.selectedIds.clear();
                this.selectedIds.add(taskId);
                this.selectionOrder = [taskId];
                this.focusedId = taskId;
                this.anchorId = taskId;
                this._updateSelection();
            }
            return;
        }
        
        // Fallback to modal mode if no panel system available
        if (this.dependenciesModal) {
            this.dependenciesModal.open(task);
        }
    }

    /**
     * Open calendar modal
     */
    openCalendar(): void {
        if (!this.calendarModal) return;
        this.calendarModal.open(this.calendarStore.get());
    }

    /**
     * Open column settings modal
     */
    openColumnSettings(): void {
        if (!this.columnSettingsModal) return;
        this.columnSettingsModal.open();
    }

    // =========================================================================
    // CPM CALCULATIONS
    // =========================================================================

    /**
     * Recalculate all tasks using CPM
     */
    recalculateAll(): void {
        // Prevent infinite recursion / overlapping calculations
        if (this._isRecalculating) {
            // console.warn('[SchedulerService] Skipping overlap calculation');
            return;
        }
        
        this._isRecalculating = true;
        const startTime = performance.now();
        const allTasks = this.taskStore.getAll();
        
        // Get only schedulable tasks for CPM (exclude blank rows)
        const tasks = allTasks.filter(t => !t.rowType || t.rowType === 'task');
        const calendar = this.calendarStore.get();

        if (tasks.length === 0) {
            this._lastCalcTime = 0;
            this._isRecalculating = false;
            return;
        }

        if (!this.engine) {
            this._isRecalculating = false;
            throw new Error('[SchedulerService] FATAL: Rust engine not initialized');
        }

        this.engine.recalculateAll()
            .then((result) => {
                this._applyCalculationResult(result);
                this._lastCalcTime = performance.now() - startTime;
            })
            .catch((error) => {
                console.error('[SchedulerService] FATAL: CPM calculation failed:', error);
                this.toastService.error('Schedule calculation failed. Please restart the application.');
                throw error;
            })
            .finally(() => {
                this._isRecalculating = false;
            });
    }

    /**
     * Apply calculation result to task store
     * @private
     */
    private _applyCalculationResult(result: CPMResult): void {
        // Temporarily disable onChange to prevent recursion
        const restoreNotifications = this.taskStore.disableNotifications();

        // Update tasks with calculated values
        result.tasks.forEach(calculatedTask => {
            const task = this.taskStore.getById(calculatedTask.id);
            if (task) {
                Object.assign(task, {
                    start: calculatedTask.start,
                    end: calculatedTask.end,
                    duration: calculatedTask.duration,
                    _isCritical: calculatedTask._isCritical || false,
                    _totalFloat: calculatedTask._totalFloat || 0,
                    _freeFloat: calculatedTask._freeFloat || 0,
                    lateStart: calculatedTask.lateStart,
                    lateFinish: calculatedTask.lateFinish,
                    totalFloat: calculatedTask.totalFloat,
                    freeFloat: calculatedTask.freeFloat,
                    _health: calculatedTask._health,
                });
            }
        });

        // Restore onChange
        restoreNotifications();
        
        // Trigger render updates
        this.render();

        // Check for constraint violations and warn user
        const criticalTasks = result.tasks.filter(t => 
            t._health?.status === 'critical'
        );

        if (criticalTasks.length > 0) {
            const deadlineViolations = criticalTasks.filter(t => t.constraintType === 'fnlt');
            
            if (deadlineViolations.length > 0) {
                const names = deadlineViolations.slice(0, 2).map(t => `"${t.name}"`).join(', ');
                const moreCount = deadlineViolations.length > 2 ? ` +${deadlineViolations.length - 2} more` : '';
                this.toastService.warning(`Deadline at risk: ${names}${moreCount}`);
            } else {
                const names = criticalTasks.slice(0, 2).map(t => `"${t.name}"`).join(', ');
                const moreCount = criticalTasks.length > 2 ? ` +${criticalTasks.length - 2} more` : '';
                this.toastService.warning(`Schedule issues: ${names}${moreCount}`);
            }
        }
    }


    /**
     * Roll up parent task dates from children
     * 
     * Calculates parent dates as:
     * - Start = Min(child start dates)
     * - End = Max(child end dates)  
     * - Duration = work days from Start to End
     * 
     * Processes deepest parents first to handle nested hierarchies correctly.
     * @private
     */
    private _rollupParentDates(): void {
        const allTasks = this.taskStore.getAll();
        const calendar = this.calendarStore.get();
        
        // Find all parent tasks (tasks that have children)
        const parentIds = new Set<string>();
        allTasks.forEach(task => {
            if (task.parentId) {
                parentIds.add(task.parentId);
            }
        });
        
        if (parentIds.size === 0) return;
        
        // Get parent tasks and sort by depth (deepest first)
        // This ensures child-parents are processed before grandparents
        const parents = allTasks.filter(t => parentIds.has(t.id));
        const sortedParents = [...parents].sort((a, b) => 
            this.taskStore.getDepth(b.id) - this.taskStore.getDepth(a.id)
        );

        sortedParents.forEach(parent => {
            // Get direct children of this parent
            const children = this.taskStore.getChildren(parent.id);
            if (children.length === 0) return;

            // Collect valid start and end dates from children
            const childStarts: string[] = [];
            const childEnds: string[] = [];
            
            children.forEach(child => {
                if (child.start && child.start.length > 0) {
                    childStarts.push(child.start);
                }
                if (child.end && child.end.length > 0) {
                    childEnds.push(child.end);
                }
            });

            if (childStarts.length === 0 || childEnds.length === 0) return;

            // Sort to find min start and max end
            childStarts.sort();
            childEnds.sort();
            
            const newStart = childStarts[0];
            const newEnd = childEnds[childEnds.length - 1];
            const newDuration = DateUtils.calcWorkDays(newStart, newEnd, calendar);
            
            // Update parent task with rolled-up values
            // Use direct assignment to avoid triggering unnecessary events
            parent.start = newStart;
            parent.end = newEnd;
            parent.duration = newDuration;
        });
    }

    // =========================================================================
    // DATA CHANGE HANDLERS
    // =========================================================================

    /**
     * Handle tasks changed event from TaskStore
     * @private
     */
    private _onTasksChanged(): void {
        // Prevent recursion - if we're already recalculating, skip
        if (this._isRecalculating) {
            return;
        }
        
        // NOTE: Engine state is kept in sync via delta updates (addTask/updateTask/deleteTask)
        // No need to syncTasks here - engine already has latest state
        
        // Tasks changed - trigger recalculation and render
        this.recalculateAll();
        this.render();
        
        // Notify data change listeners (for unified panel sync)
        this._notifyDataChange();
    }

    /**
     * Handle calendar changed event from CalendarStore
     * @private
     */
    private _onCalendarChanged(): void {
        // Calendar changed - trigger recalculation
        // TODO: Calendar integration for Flatpickr - add setCalendar to GridRenderer
        // const calendar = this.calendarStore.get();
        // 
        // // Update grid's date picker calendar
        // if (this.grid) {
        //     this.grid.setCalendar(calendar);
        // }
        
        this.recalculateAll();
        this.render();
        
        // Notify data change listeners (for unified panel sync)
        this._notifyDataChange();
    }

    /**
     * Notify all data change listeners
     * @private
     */
    private _notifyDataChange(): void {
        for (const callback of this._dataChangeCallbacks) {
            try {
                callback();
            } catch (error) {
                console.error('[SchedulerService] Error in data change callback:', error);
            }
        }
    }

    /**
     * Subscribe to data changes (tasks, calendar, trade partners, etc.)
     * Returns unsubscribe function
     */
    public onDataChange(callback: () => void): () => void {
        this._dataChangeCallbacks.push(callback);
        return () => {
            const index = this._dataChangeCallbacks.indexOf(callback);
            if (index > -1) {
                this._dataChangeCallbacks.splice(index, 1);
            }
        };
    }

    // =========================================================================
    // RENDERING
    // =========================================================================

    /**
     * Render all views
     */
    render(): void {
        // Batch renders for performance
        if (this._renderScheduled) return;
        
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderScheduled = false;
            
            // Get visible tasks for hierarchy-aware display
            const tasks = this.taskStore.getVisibleTasks((id) => {
                const task = this.taskStore.getById(id);
                return task?._collapsed || false;
            });

            if (this.grid) {
                // Pass visible tasks to grid (it handles virtual scrolling)
                this.grid.setData(tasks);
                this.grid.setSelection(this.selectedIds, this.focusedId);
            }

            if (this.gantt) {
                this.gantt.setData(tasks);
                this.gantt.setSelection(this.selectedIds);
                // Note: Don't call setViewMode here - it resets custom zoom levels
                // setViewMode should only be called when user explicitly changes view mode
            }
        });
    }

    // =========================================================================
    // PERSISTENCE
    // =========================================================================

    /**
     * Load data from storage (SQLite or localStorage)
     * CRITICAL: Reset editing state at the very start - prevents saving to non-existent task IDs
     * This is called during initialization and when loading a new file/project
     */
    /**
     * Load data from SQLite database
     */
    async loadData(): Promise<void> {
        const editingManager = getEditingStateManager();
        editingManager.reset();
        console.log('[SchedulerService] 🔍 loadData() called');
        
        if (!this.dataLoader) {
            throw new Error('[SchedulerService] FATAL: DataLoader not initialized');
        }
        
        try {
            const { tasks, calendar, tradePartners } = await this.dataLoader.loadData();
            
            // Load trade partners first
            this.tradePartnerStore.setAll(tradePartners);
            console.log('[SchedulerService] ✅ Loaded trade partners:', tradePartners.length);
            
            if (tasks.length > 0 || Object.keys(calendar.exceptions).length > 0) {
                const tasksWithSortKeys = this._assignSortKeysToImportedTasks(tasks);
                
                const restoreNotifications = this.taskStore.disableNotifications();
                this.taskStore.setAll(tasksWithSortKeys);
                restoreNotifications();
                
                this.calendarStore.set(calendar, true);
                
                if (this.engine) {
                    const context: TaskHierarchyContext = {
                        isParent: (id: string) => this.taskStore.isParent(id),
                        getDepth: (id: string) => this.taskStore.getDepth(id),
                    };
                    await this.engine.initialize(tasksWithSortKeys, calendar, context);
                }
                
                this.recalculateAll();
                console.log('[SchedulerService] ✅ Loaded from SQLite:', tasks.length, 'tasks');
            } else {
                console.log('[SchedulerService] No saved data found - creating sample data');
                this._createSampleData();
            }
        } catch (err) {
            console.error('[SchedulerService] FATAL: Load data failed:', err);
            this.toastService.error('Failed to load schedule data');
            throw err;
        }
    }

    /**
     * Save data (creates snapshot checkpoint)
     */
    async saveData(): Promise<void> {
        if (!this.snapshotService) {
            console.warn('[SchedulerService] SnapshotService not available');
            return;
        }
        
        try {
            await this.snapshotService.createSnapshot(
                this.taskStore.getAll(),
                this.calendarStore.get(),
                this.tradePartnerStore.getAll()
            );
            console.log('[SchedulerService] ✅ Snapshot checkpoint created');
        } catch (error) {
            console.error('[SchedulerService] Failed to create snapshot:', error);
            this.toastService.warning('Failed to save checkpoint');
        }
    }
    
    /**
     * Shutdown handler - flush all pending events and create final snapshot
     */
    async onShutdown(): Promise<void> {
        console.log('[SchedulerService] Shutting down...');
        
        if (this.persistenceService) {
            await this.persistenceService.flushNow();
        }
        
        if (this.snapshotService) {
            await this.snapshotService.createSnapshot(
                this.taskStore.getAll(),
                this.calendarStore.get(),
                this.tradePartnerStore.getAll()
            );
            this.snapshotService.stopPeriodicSnapshots();
        }
        
        console.log('[SchedulerService] ✅ Shutdown complete');
    }

    /**
     * Create sample data for first-time users
     * @private
     */
    private _createSampleData(): void {
        const today = DateUtils.today();
        const calendar = this.calendarStore.get(); // Get calendar from store
        
        const tasks: Task[] = [
            {
                id: 'sample_1',
                name: 'Project Setup',
                start: today,
                end: DateUtils.addWorkDays(today, 2, calendar),
                duration: 3,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                notes: 'Initial project setup and planning',
                level: 0,
                sortKey: OrderingService.generateAppendKey(null),
                _collapsed: false,
            },
            {
                id: 'sample_2',
                name: 'Design Phase',
                start: DateUtils.addWorkDays(today, 3, calendar),
                end: DateUtils.addWorkDays(today, 7, calendar),
                duration: 5,
                parentId: null,
                dependencies: [{ id: 'sample_1', type: 'FS', lag: 0 }],
                progress: 0,
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                level: 0,
                sortKey: OrderingService.generateAppendKey(OrderingService.generateAppendKey(null)),
                _collapsed: false,
            },
        ];
        
        // Temporarily disable onChange to prevent recursion
        const restoreNotifications = this.taskStore.disableNotifications();
        this.taskStore.setAll(tasks);
        restoreNotifications();
        
        // Recalculate after a brief delay to ensure everything is set up
        setTimeout(() => {
            try {
                this.recalculateAll();
            } catch (error) {
                console.error('[SchedulerService] Error recalculating sample data:', error);
            }
        }, 100);
    }

    /**
     * Assign sortKeys to tasks that don't have them, preserving original order.
     * 
     * This is the CRITICAL migration function that converts:
     * - Legacy tasks with displayOrder → tasks with sortKey
     * - Imported tasks without sortKey → tasks with sortKey
     * - Tasks from localStorage → properly ordered tasks
     * 
     * The key insight: sortKey must be assigned based on INTENDED display order,
     * which is determined by:
     * 1. Existing sortKey (if present) - highest priority
     * 2. displayOrder field (legacy) - second priority  
     * 3. Original array position - fallback
     * 
     * @param tasks - Tasks to migrate
     * @returns Tasks with sortKey assigned, preserving intended order
     */
    private _assignSortKeysToImportedTasks(tasks: Task[]): Task[] {
        // Guard: empty or null input
        if (!tasks || tasks.length === 0) {
            return tasks;
        }
        
        // Check if migration is needed
        const needsMigration = tasks.some(t => !t.sortKey);
        if (!needsMigration) {
            console.log('[SchedulerService] All tasks have sortKey, no migration needed');
            return tasks;
        }
        
        console.log('[SchedulerService] Migrating tasks to sortKey...', {
            total: tasks.length,
            withSortKey: tasks.filter(t => t.sortKey).length,
            withDisplayOrder: tasks.filter(t => (t as any).displayOrder !== undefined).length
        });
        
        // Step 1: Create a tracking structure that preserves all ordering info
        interface TaskWithMeta {
            task: Task;
            originalIndex: number;
            displayOrder: number;
            hasSortKey: boolean;
        }
        
        const tasksWithMeta: TaskWithMeta[] = tasks.map((task, index) => ({
            task,
            originalIndex: index,
            displayOrder: (task as any).displayOrder ?? Number.MAX_SAFE_INTEGER,
            hasSortKey: !!task.sortKey
        }));
        
        // Step 2: Group by parentId
        const tasksByParent = new Map<string | null, TaskWithMeta[]>();
        
        tasksWithMeta.forEach(item => {
            const parentId = item.task.parentId ?? null;
            if (!tasksByParent.has(parentId)) {
                tasksByParent.set(parentId, []);
            }
            tasksByParent.get(parentId)!.push(item);
        });
        
        // Step 3: Sort each group by intended display order
        // Priority: existing sortKey > displayOrder > original array index
        tasksByParent.forEach((group) => {
            group.sort((a, b) => {
                // If both have sortKey, use string comparison
                if (a.hasSortKey && b.hasSortKey) {
                    const keyA = a.task.sortKey || '';
                    const keyB = b.task.sortKey || '';
                    if (keyA < keyB) return -1;
                    if (keyA > keyB) return 1;
                    return 0;
                }
                
                // If only one has sortKey, it comes first (preserve existing order)
                if (a.hasSortKey && !b.hasSortKey) return -1;
                if (!a.hasSortKey && b.hasSortKey) return 1;
                
                // Neither has sortKey - use displayOrder if available
                if (a.displayOrder !== b.displayOrder) {
                    return a.displayOrder - b.displayOrder;
                }
                
                // Fallback: original array position
                return a.originalIndex - b.originalIndex;
            });
        });
        
        // Step 4: Assign sortKeys to each group
        // Tasks that already have sortKey keep them (unless they conflict)
        tasksByParent.forEach((group, parentId) => {
            // Check if we need to regenerate all sortKeys for this group
            // (necessary if some have sortKey and some don't, to ensure consistency)
            const hasMissingSortKeys = group.some(item => !item.hasSortKey);
            
            if (hasMissingSortKeys) {
                // Generate fresh sortKeys for entire group to ensure consistency
                const sortKeys = OrderingService.generateBulkKeys(null, null, group.length);
                
                group.forEach((item, index) => {
                    item.task = {
                        ...item.task,
                        sortKey: sortKeys[index]
                    };
                    item.hasSortKey = true;
                });
                
                console.log(`[SchedulerService] Assigned sortKeys to ${group.length} tasks with parentId: ${parentId}`);
            }
            // If all have sortKey, keep them as-is (they're already sorted correctly)
        });
        
        // Step 5: Reconstruct result array maintaining original positions
        // This ensures the array structure matches what was saved
        const result: Task[] = new Array(tasks.length);
        
        tasksByParent.forEach((group) => {
            group.forEach((item) => {
                result[item.originalIndex] = item.task;
            });
        });
        
        // Verify no undefined slots (defensive)
        const undefinedCount = result.filter(t => t === undefined).length;
        if (undefinedCount > 0) {
            console.error('[SchedulerService] Migration error: undefined slots in result', {
                undefinedCount,
                totalTasks: tasks.length
            });
            // Fallback: return original with simple sequential sortKeys
            return tasks.map((task, index) => ({
                ...task,
                sortKey: task.sortKey || OrderingService.generateBulkKeys(null, null, tasks.length)[index]
            }));
        }
        
        console.log('[SchedulerService] ✅ Migration complete', {
            totalMigrated: result.length,
            sampleSortKeys: result.slice(0, 5).map(t => ({ id: t.id, sortKey: t.sortKey }))
        });
        
        return result;
    }

    // =========================================================================
    // HISTORY (UNDO/REDO)
    // =========================================================================

    /**
     * Save checkpoint for undo/redo (deprecated - now handled by Event Sourcing)
     * Kept as no-op for backward compatibility
     * @deprecated Events are automatically recorded via TaskStore
     */
    saveCheckpoint(): void {
        // No-op: Events are now automatically recorded via TaskStore.recordAction()
        // This method is kept for backward compatibility with existing code
    }

    /**
     * Undo last action (supports composite actions)
     */
    undo(): void {
        if (!this.historyManager) {
            this.toastService.info('History manager not available');
            return;
        }

        const backwardEvents = this.historyManager.undo();
        if (!backwardEvents || backwardEvents.length === 0) {
            this.toastService.info('Nothing to undo');
            return;
        }

        // Apply all backward events
        for (const event of backwardEvents) {
            if (event.type === 'CALENDAR_UPDATED') {
                this.calendarStore.applyEvent(event);
            } else {
                this.taskStore.applyEvents([event]);
            }
        }

        this.recalculateAll();
        this.render();
        
        const label = this.historyManager.getRedoLabel();
        this.toastService.info(label ? `Undone: ${label}` : 'Undone');
    }

    /**
     * Redo last undone action (supports composite actions)
     */
    redo(): void {
        if (!this.historyManager) {
            this.toastService.info('History manager not available');
            return;
        }

        const forwardEvents = this.historyManager.redo();
        if (!forwardEvents || forwardEvents.length === 0) {
            this.toastService.info('Nothing to redo');
            return;
        }

        // Apply all forward events
        for (const event of forwardEvents) {
            if (event.type === 'CALENDAR_UPDATED') {
                this.calendarStore.applyEvent(event);
            } else {
                this.taskStore.applyEvents([event]);
            }
        }

        this.recalculateAll();
        this.render();
        
        const label = this.historyManager.getUndoLabel();
        this.toastService.info(label ? `Redone: ${label}` : 'Redone');
    }

    // =========================================================================
    // FILE OPERATIONS
    // =========================================================================

    /**
     * Save to file
     * @returns Promise that resolves when saved
     */
    async saveToFile(): Promise<void> {
        try {
            await this.fileService.saveToFile({
                tasks: this.taskStore.getAll(),
                calendar: this.calendarStore.get(),
            });
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Open from file
     * @returns Promise that resolves when loaded
     */
    async openFromFile(): Promise<void> {
        try {
            const data = await this.fileService.openFromFile();
            if (data) {
                this.saveCheckpoint();
                this.taskStore.setAll(data.tasks || []);
                if (data.calendar) {
                    this.calendarStore.set(data.calendar);
                }
                this.recalculateAll();
                this.saveData();
                this.render();
                this.toastService.success(`Loaded ${this.taskStore.getAll().length} tasks`);
            }
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Export as download
     */
    exportAsDownload(): void {
        this.fileService.exportAsDownload({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });
    }

    /**
     * Import from file
     * @param file - File object
     * @returns Promise that resolves when imported
     */
    async importFromFile(file: File): Promise<void> {
        try {
            const data = await this.fileService.importFromFile(file);
            this.saveCheckpoint();
            
            // Assign sortKeys to imported tasks
            const tasks = data.tasks || [];
            const tasksWithSortKeys = this._assignSortKeysToImportedTasks(tasks);
            
            this.taskStore.setAll(tasksWithSortKeys);
            if (data.calendar) {
                this.calendarStore.set(data.calendar);
            }
            // Note: recalculateAll() and render() will be triggered automatically by _onTasksChanged()
            this.saveData();
            this.toastService.success(`Imported ${tasksWithSortKeys.length} tasks`);
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Import from MS Project XML
     * @param file - XML file
     * @returns Promise that resolves when imported
     */
    async importFromMSProjectXML(file: File): Promise<void> {
        try {
            const data = await this.fileService.importFromMSProjectXML(file);
            this.saveCheckpoint();
            
            // Assign sortKeys to imported tasks
            const tasks = data.tasks || [];
            const tasksWithSortKeys = this._assignSortKeysToImportedTasks(tasks);
            
            // Import calendar if provided
            if (data.calendar) {
                this.calendarStore.set(data.calendar, true); // skipEvent=true to avoid duplicate persistence
            }
            
            this.taskStore.setAll(tasksWithSortKeys);
            // Note: recalculateAll() and render() will be triggered automatically by _onTasksChanged()
            this.saveData();
            this.toastService.success(`Imported ${tasksWithSortKeys.length} tasks`);
        } catch (err) {
            // Error handled by FileService
        }
    }

    /**
     * Import from MS Project XML content (for Tauri native dialog)
     * 
     * @param content - XML file content as string
     */
    async importFromMSProjectXMLContent(content: string): Promise<void> {
        const result = await this.fileService.importFromMSProjectXMLContent(content);
        this.saveCheckpoint();
        
        const tasksWithSortKeys = this._assignSortKeysToImportedTasks(result.tasks);
        this.taskStore.setAll(tasksWithSortKeys);
        
        if (result.calendar) {
            this.calendarStore.set(result.calendar);
        }
        
        this.recalculateAll();
        this.saveData();
        this.toastService.success(`Imported ${result.tasks.length} tasks from MS Project`);
    }

    /**
     * Export to MS Project XML
     */
    exportToMSProjectXML(): void {
        this.fileService.exportToMSProjectXML({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });
    }

    /**
     * Clear all saved data and start fresh
     * Use when data is corrupted or user wants to reset
     */
    async clearAllData(): Promise<void> {
        if (!confirm('This will delete all your tasks and settings. Continue?')) {
            return;
        }
        
        // Purge SQLite database if persistence service is available
        if (this.persistenceService) {
            try {
                await this.persistenceService.purgeDatabase();
            } catch (error) {
                console.error('[SchedulerService] Failed to purge database:', error);
                this.toastService.error('Failed to clear database - some data may remain');
            }
        }
        
        // Clear localStorage (backup/fallback)
        localStorage.removeItem(SchedulerService.STORAGE_KEY);
        localStorage.removeItem('pro_scheduler_column_widths');
        localStorage.removeItem('pro_scheduler_column_preferences');
        
        // Reset in-memory state
        this.taskStore.setAll([]);
        this._createSampleData();
        
        this.recalculateAll();
        await this.saveData();
        this.render();
        
        this.toastService.success('All data cleared - starting fresh');
    }

    // =========================================================================
    // STATS & UTILITIES
    // =========================================================================

    /**
     * Zoom in (increase visual scale)
     * NOTE: This changes zoom level, NOT view mode
     * Use setViewMode() to change Day/Week/Month time scale
     */
    zoomIn(): void {
        this.zoomGanttIn();
    }

    /**
     * Zoom out (decrease visual scale)
     * NOTE: This changes zoom level, NOT view mode
     * Use setViewMode() to change Day/Week/Month time scale
     */
    zoomOut(): void {
        this.zoomGanttOut();
    }

    /**
     * Set view mode
     * @param mode - View mode: 'Day', 'Week', or 'Month'
     */
    setViewMode(mode: ViewMode): void {
        if (['Day', 'Week', 'Month'].includes(mode)) {
            this.viewMode = mode;
            if (this.gantt) {
                this.gantt.setViewMode(this.viewMode);
            }
            this.render();
        }
    }

    /**
     * Set Gantt zoom level
     * @param pixelsPerDay - Pixels per day (1-80)
     */
    setGanttZoom(pixelsPerDay: number): void {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            (viewport.ganttRenderer as any).setZoom(pixelsPerDay);
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        } else if (this.gantt) {
            (this.gantt as any).setZoom(pixelsPerDay);
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        }
    }

    /**
     * Get current Gantt zoom level
     */
    getGanttZoom(): number {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            return (viewport.ganttRenderer as any).getZoom() || 20;
        } else if (this.gantt) {
            return (this.gantt as any).getZoom() || 20;
        }
        return 20;
    }

    /**
     * Zoom Gantt in
     */
    zoomGanttIn(): void {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            (viewport.ganttRenderer as any).zoomIn();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        } else if (this.gantt) {
            (this.gantt as any).zoomIn();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        }
    }

    /**
     * Zoom Gantt out
     */
    zoomGanttOut(): void {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            (viewport.ganttRenderer as any).zoomOut();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        } else if (this.gantt) {
            (this.gantt as any).zoomOut();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        }
    }

    /**
     * Fit Gantt to view
     */
    fitGanttToView(): void {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            (viewport.ganttRenderer as any).fitToView();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        } else if (this.gantt) {
            (this.gantt as any).fitToView();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        }
    }

    /**
     * Reset Gantt zoom to default
     */
    resetGanttZoom(): void {
        const viewport = (this as any).viewport;
        if (viewport?.ganttRenderer) {
            (viewport.ganttRenderer as any).resetZoom();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        } else if (this.gantt) {
            (this.gantt as any).resetZoom();
            // Note: GanttRenderer handles re-rendering internally, no need to call render()
        }
    }

    /**
     * Get performance statistics
     * @returns Stats object
     */
    getStats(): {
        taskCount: number;
        visibleCount: number;
        lastCalcTime: string;
        gridStats?: unknown;
        ganttStats?: unknown;
    } {
        return {
            taskCount: this.taskStore.getAll().length,
            visibleCount: this.taskStore.getVisibleTasks((id) => {
                const task = this.taskStore.getById(id);
                return task?._collapsed || false;
            }).length,
            lastCalcTime: `${this._lastCalcTime.toFixed(2)}ms`,
            gridStats: this.grid?.getStats(),
            ganttStats: this.gantt?.getStats(),
        };
    }

    /**
     * Generate mock tasks for testing
     * @param count - Number of tasks to generate
     */
    generateMockTasks(count: number): void {
        this.saveCheckpoint();
        
        const today = DateUtils.today();
        const existingTasks = this.taskStore.getAll();
        const tasks: Task[] = [...existingTasks];
        
        // Pre-generate all sortKeys to avoid stale reads
        const lastKey = this.taskStore.getLastSortKey(null);
        const sortKeys = OrderingService.generateBulkKeys(lastKey, null, count);
        
        const calendar = this.calendarStore.get();
        
        for (let i = 0; i < count; i++) {
            const duration = Math.floor(Math.random() * 10) + 1;
            const startOffset = Math.floor(Math.random() * 200);
            const startDate = DateUtils.addWorkDays(today, startOffset, calendar);
            const endDate = DateUtils.addWorkDays(startDate, duration - 1, calendar);
            
            const task: Task = {
                id: `task_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`,
                name: `Task ${existingTasks.length + i + 1}`,
                start: startDate,
                end: endDate,
                duration: duration,
                parentId: null,
                dependencies: [],
                progress: Math.floor(Math.random() * 100),
                constraintType: 'asap',
                constraintDate: null,
                notes: '',
                level: 0,
                sortKey: sortKeys[i],
                _collapsed: false,
            };
            
            if (i > 10 && Math.random() < 0.2) {
                const parentIndex = Math.floor(Math.random() * Math.min(i, 20));
                task.parentId = tasks[parentIndex]?.id || null;
            }
            
            if (i > 5 && Math.random() < 0.3) {
                const predIndex = Math.floor(Math.random() * Math.min(i, 10));
                if (tasks[predIndex] && tasks[predIndex].id !== task.parentId) {
                    task.dependencies.push({
                        id: tasks[predIndex].id,
                        type: 'FS',
                        lag: 0,
                    });
                }
            }
            
            tasks.push(task);
        }
        
        this.taskStore.setAll(tasks);
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService?.success(`Generated ${count} tasks`);
    }

    /**
     * Generate random task name for mock data
     * @private
     * @returns Random task name
     */
    private _randomTaskName(): string {
        const prefixes = ['Install', 'Frame', 'Pour', 'Paint', 'Finish', 'Inspect', 'Test', 'Review'];
        const suffixes = ['Foundation', 'Walls', 'Roof', 'Windows', 'Doors', 'Electrical', 'Plumbing', 'HVAC'];
        return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
    }

    /**
     * Clean up resources
     */
    // =========================================================================
    // TRADE PARTNER OPERATIONS
    // =========================================================================

    /**
     * Get all trade partners
     */
    getTradePartners(): TradePartner[] {
        return this.tradePartnerStore.getAll();
    }

    /**
     * Get a trade partner by ID
     */
    getTradePartner(id: string): TradePartner | undefined {
        return this.tradePartnerStore.get(id);
    }

    /**
     * Set scheduling mode for a task
     * 
     * @param taskId - Task ID
     * @param mode - 'Auto' or 'Manual'
     */
    public setSchedulingMode(taskId: string, mode: 'Auto' | 'Manual'): void {
        const task = this.taskStore.getById(taskId);
        if (!task) {
            console.warn('[SchedulerService] Task not found:', taskId);
            return;
        }
        
        this.saveCheckpoint();
        
        const result = this._applyTaskEdit(taskId, 'schedulingMode', mode);
        
        if (result.success && result.needsRecalc) {
            this.recalculateAll();
            this.saveData();
            this.render();
        }
    }

    /**
     * Toggle scheduling mode between Auto and Manual
     * 
     * @param taskId - Task ID
     */
    public toggleSchedulingMode(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        const newMode = task.schedulingMode === 'Manual' ? 'Auto' : 'Manual';
        this.setSchedulingMode(taskId, newMode);
    }

    /**
     * Create a new trade partner
     */
    createTradePartner(data: Omit<TradePartner, 'id'>): TradePartner {
        const partner = this.tradePartnerStore.add(data);
        
        // Queue persistence event
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TRADE_PARTNER_CREATED', partner.id, {
                id: partner.id,
                name: partner.name,
                contact: partner.contact,
                phone: partner.phone,
                email: partner.email,
                color: partner.color,
                notes: partner.notes,
            });
        }
        
        this.toastService.success(`Created trade partner: ${partner.name}`);
        
        // Notify data change listeners (for unified panel sync)
        this._notifyDataChange();
        
        return partner;
    }

    /**
     * Update a trade partner
     */
    updateTradePartner(id: string, field: keyof TradePartner, value: unknown): void {
        const existing = this.tradePartnerStore.get(id);
        if (!existing) return;
        
        const oldValue = existing[field];
        this.tradePartnerStore.update(id, { [field]: value });
        
        // Queue persistence event
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TRADE_PARTNER_UPDATED', id, {
                field,
                old_value: oldValue,
                new_value: value,
            });
        }
        
        // Re-render if color changed (affects task display)
        if (field === 'color' || field === 'name') {
            this.render();
        }
        
        // Notify data change listeners (for unified panel sync)
        this._notifyDataChange();
    }

    /**
     * Delete a trade partner
     */
    deleteTradePartner(id: string): void {
        const partner = this.tradePartnerStore.get(id);
        if (!partner) return;
        
        // Remove from all tasks first
        const affectedTasks = this.taskStore.getAll().filter(
            t => t.tradePartnerIds?.includes(id)
        );
        
        for (const task of affectedTasks) {
            this.unassignTradePartner(task.id, id, false); // Don't show toast for each
        }
        
        // Delete the partner
        this.tradePartnerStore.delete(id);
        
        // Queue persistence event
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TRADE_PARTNER_DELETED', id, {
                name: partner.name,
            });
        }
        
        this.toastService.info(`Deleted trade partner: ${partner.name}`);
        this.render();
    }

    /**
     * Assign a trade partner to a task
     */
    assignTradePartner(taskId: string, tradePartnerId: string): void {
        const task = this.taskStore.getById(taskId);
        const partner = this.tradePartnerStore.get(tradePartnerId);
        if (!task || !partner) return;
        
        // Check if already assigned
        if (task.tradePartnerIds?.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = [...(task.tradePartnerIds || []), tradePartnerId];
        this.taskStore.update(taskId, { tradePartnerIds: newIds });
        
        // Queue persistence event
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_TRADE_PARTNER_ASSIGNED', taskId, {
                trade_partner_id: tradePartnerId,
                trade_partner_name: partner.name,
            });
        }
        
        this.render();
    }

    /**
     * Unassign a trade partner from a task
     */
    unassignTradePartner(taskId: string, tradePartnerId: string, showToast = true): void {
        const task = this.taskStore.getById(taskId);
        if (!task || !task.tradePartnerIds) return;
        
        // Check if assigned
        if (!task.tradePartnerIds.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = task.tradePartnerIds.filter(id => id !== tradePartnerId);
        this.taskStore.update(taskId, { tradePartnerIds: newIds });
        
        // Queue persistence event
        if (this.persistenceService) {
            this.persistenceService.queueEvent('TASK_TRADE_PARTNER_UNASSIGNED', taskId, {
                trade_partner_id: tradePartnerId,
            });
        }
        
        if (showToast) {
            this.render();
        }
    }

    /**
     * Get trade partners for a task
     */
    getTaskTradePartners(taskId: string): TradePartner[] {
        const task = this.taskStore.getById(taskId);
        if (!task?.tradePartnerIds) return [];
        return this.tradePartnerStore.getMany(task.tradePartnerIds);
    }

    /**
     * Cleanup on destroy
     */
    destroy(): void {
        if (this._unsubscribeEditing) {
            this._unsubscribeEditing();
            this._unsubscribeEditing = null;
        }
        
        if (this.keyboardService) {
            this.keyboardService.detach();
        }
        if (this.grid) this.grid.destroy();
        if (this.gantt) this.gantt.destroy();
        if (this.drawer) this.drawer.destroy();
        if (this.dependenciesModal) this.dependenciesModal.destroy();
        if (this.calendarModal) this.calendarModal.destroy();
    }

    /**
     * Get or create context menu
     * @private
     */
    private _getContextMenu(): ContextMenu {
        if (!this._contextMenu) {
            this._contextMenu = new ContextMenu();
        }
        return this._contextMenu;
    }

    /**
     * Show context menu for a row
     * @private
     */
    private _showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, event: MouseEvent): void {
        const menu = this._getContextMenu();
        
        const task = this.taskStore.getById(taskId);
        const hasDependencies = task?.dependencies && task.dependencies.length > 0;
        
        const items: ContextMenuItem[] = [
            {
                id: 'insert-above',
                label: 'Insert Blank Row Above',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>`,
            },
            {
                id: 'insert-below',
                label: 'Insert Blank Row Below',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>`,
            },
            { id: 'divider-1', type: 'divider' },
        ];
        
        // Convert to Task option only for blank rows
        if (isBlank) {
            items.push({
                id: 'convert-to-task',
                label: 'Convert to Task',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>`,
            });
            items.push({ id: 'divider-2', type: 'divider' });
        }
        
        // Add original actions: Indent, Outdent, Links
        if (!isBlank) {
            items.push({
                id: 'outdent',
                label: 'Outdent',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>`,
            });
            items.push({
                id: 'indent',
                label: 'Indent',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>`,
            });
            items.push({
                id: 'links',
                label: 'Dependencies',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${hasDependencies ? '#9333ea' : 'currentColor'}" stroke-width="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>`,
            });
            items.push({ id: 'divider-3', type: 'divider' });
        }
        
        items.push({
            id: 'delete',
            label: 'Delete Row',
            icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>`,
            danger: true,
        });
        
        items.push({ id: 'divider-4', type: 'divider' });
        
        items.push({
            id: 'properties',
            label: 'Properties...',
            icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>`,
        });
        
        menu.show(anchorEl, items, (itemId) => {
            switch (itemId) {
                case 'insert-above':
                    this.insertBlankRowAbove(taskId);
                    break;
                case 'insert-below':
                    this.insertBlankRowBelow(taskId);
                    break;
                case 'convert-to-task':
                    this.convertBlankToTask(taskId);
                    break;
                case 'outdent':
                    this.outdent(taskId);
                    break;
                case 'indent':
                    this.indent(taskId);
                    break;
                case 'links':
                    this.openDependencies(taskId);
                    break;
                case 'delete':
                    this.deleteTask(taskId);
                    break;
                case 'properties':
                    this.openProperties(taskId);
                    break;
            }
        });
    }

    /**
     * Insert blank row above a task
     */
    insertBlankRowAbove(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        this.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = this.taskStore.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = taskIndex > 0 ? siblings[taskIndex - 1].sortKey : null;
        const afterKey = task.sortKey;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        const blankRow = this.taskStore.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        this.selectedIds.clear();
        this.selectedIds.add(blankRow.id);
        this.focusedId = blankRow.id;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // Scroll to and highlight the new row
        if (this.grid) {
            this.grid.scrollToTask(blankRow.id);
            this.grid.highlightCell(blankRow.id, 'name');
        }
    }

    /**
     * Insert blank row below a task
     */
    insertBlankRowBelow(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        this.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = this.taskStore.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = task.sortKey;
        const afterKey = taskIndex < siblings.length - 1 ? siblings[taskIndex + 1].sortKey : null;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        const blankRow = this.taskStore.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        this.selectedIds.clear();
        this.selectedIds.add(blankRow.id);
        this.focusedId = blankRow.id;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // Scroll to and highlight the new row
        if (this.grid) {
            this.grid.scrollToTask(blankRow.id);
            this.grid.highlightCell(blankRow.id, 'name');
        }
    }

    /**
     * Convert a blank row to a task
     */
    convertBlankToTask(taskId: string): void {
        if (!this.taskStore.isBlankRow(taskId)) {
            this.toastService?.error('Only blank rows can be converted');
            return;
        }
        
        this.saveCheckpoint();
        
        const task = this.taskStore.wakeUpBlankRow(taskId, 'New Task');
        if (!task) return;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        // Focus the name field for immediate editing
        if (this.grid) {
            setTimeout(() => {
                this.grid?.focusCell(taskId, 'name');
            }, 50);
        }
    }

    /**
     * Open properties panel for a task
     */
    openProperties(taskId: string): void {
        // Trigger right sidebar with details panel
        if (this._openPanelCallbacks.length > 0) {
            this._openPanelCallbacks.forEach(cb => {
                try {
                    cb('details');
                } catch (e) {
                    console.error('[SchedulerService] Panel open callback error:', e);
                }
            });
        }
        
        // Ensure task is selected
        this.selectedIds.clear();
        this.selectedIds.add(taskId);
        this.focusedId = taskId;
        this._updateSelection();
    }

    /**
     * Indent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    indentSelected(): void {
        if (this.selectedIds.size === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectedIds);
        
        // Get top-level selected tasks (parent not in selection)
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        // Process in visual order (top to bottom)
        let indentedCount = 0;
        for (const task of topLevelSelected) {
            const idx = list.findIndex(t => t.id === task.id);
            if (idx <= 0) continue;
            
            const prev = list[idx - 1];
            const taskDepth = this.taskStore.getDepth(task.id);
            const prevDepth = this.taskStore.getDepth(prev.id);
            
            // Can only indent if prev is at same or higher depth
            if (prevDepth < taskDepth) continue;
            
            let newParentId: string | null = null;
            if (prevDepth === taskDepth) {
                newParentId = prev.id;
            } else {
                let curr: Task | undefined = prev;
                while (curr && this.taskStore.getDepth(curr.id) > taskDepth) {
                    curr = curr.parentId ? this.taskStore.getById(curr.parentId) : undefined;
                }
                if (curr) newParentId = curr.id;
            }
            
            if (newParentId !== null) {
                const newSortKey = OrderingService.generateAppendKey(
                    this.taskStore.getLastSortKey(newParentId)
                );
                this.taskStore.move(task.id, newParentId, newSortKey, 'Indent Task');
                indentedCount++;
            }
        }
        
        if (indentedCount > 0) {
            this.recalculateAll();
            this.saveData();
            this.render();
            this.toastService?.success(`Indented ${indentedCount} task${indentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Outdent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    outdentSelected(): void {
        if (this.selectedIds.size === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectedIds);
        const allTasks = this.taskStore.getAll();
        
        // Get top-level selected tasks
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        let outdentedCount = 0;
        for (const task of topLevelSelected) {
            if (!task.parentId) continue; // Already at root
            
            const currentParent = allTasks.find(t => t.id === task.parentId);
            const grandparentId = currentParent ? currentParent.parentId : null;
            
            // Position after former parent among its siblings
            const auntsUncles = this.taskStore.getChildren(grandparentId);
            const formerParentIndex = auntsUncles.findIndex(t => t.id === currentParent?.id);
            
            const beforeKey = currentParent?.sortKey ?? null;
            const afterKey = formerParentIndex < auntsUncles.length - 1
                ? auntsUncles[formerParentIndex + 1].sortKey
                : null;
            
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            this.taskStore.update(task.id, {
                parentId: grandparentId,
                sortKey: newSortKey
            });
            outdentedCount++;
        }
        
        if (outdentedCount > 0) {
            this.recalculateAll();
            this.saveData();
            this.render();
            this.toastService?.success(`Outdented ${outdentedCount} task${outdentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Delete all selected tasks
     * Shows confirmation for multiple tasks or parent tasks
     */
    async deleteSelected(): Promise<void> {
        if (this.selectedIds.size === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        const selectedCount = this.selectedIds.size;
        const hasParents = Array.from(this.selectedIds).some(id => this.taskStore.isParent(id));
        
        // Confirm for multiple tasks or parent tasks
        if (selectedCount > 1 || hasParents) {
            const childCount = hasParents
                ? Array.from(this.selectedIds).reduce((sum, id) => 
                    sum + this._getAllDescendants(id).size, 0)
                : 0;
            
            const message = hasParents
                ? `Delete ${selectedCount} task${selectedCount > 1 ? 's' : ''} and ${childCount} child task${childCount !== 1 ? 's' : ''}?`
                : `Delete ${selectedCount} tasks?`;
            
            const confirmed = await this._confirmAction(message, 'Delete');
            if (!confirmed) return;
        }
        
        this.saveCheckpoint();
        
        const editingManager = getEditingStateManager();
        const idsToDelete = Array.from(this.selectedIds);
        
        for (const taskId of idsToDelete) {
            if (editingManager.isEditingTask(taskId)) {
                editingManager.exitEditMode('task-deleted');
            }
            this.taskStore.delete(taskId, true);
            this.selectedIds.delete(taskId);
            
            if (this.engine) {
                this.engine.deleteTask(taskId).catch(console.error);
            }
        }
        
        if (this.focusedId && idsToDelete.includes(this.focusedId)) {
            this.focusedId = null;
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService?.success(`Deleted ${idsToDelete.length} task${idsToDelete.length > 1 ? 's' : ''}`);
    }

    /**
     * Simple confirmation dialog
     * @private
     */
    private _confirmAction(message: string, actionLabel: string): Promise<boolean> {
        return new Promise(resolve => {
            // For now, use browser confirm - can be replaced with custom modal
            const result = confirm(message);
            resolve(result);
        });
    }

    /**
     * Get all descendants of a task (helper for delete confirmation)
     * @private
     */
    private _getAllDescendants(taskId: string): Set<string> {
        const descendants = new Set<string>();
        const children = this.taskStore.getChildren(taskId);
        for (const child of children) {
            descendants.add(child.id);
            const childDescendants = this._getAllDescendants(child.id);
            childDescendants.forEach(id => descendants.add(id));
        }
        return descendants;
    }

    /**
     * Get flat list of visible tasks (helper for bulk operations)
     * @private
     */
    private _getFlatList(): Task[] {
        return this.taskStore.getVisibleTasks((id) => {
            const t = this.taskStore.getById(id);
            return t?._collapsed || false;
        });
    }
}
