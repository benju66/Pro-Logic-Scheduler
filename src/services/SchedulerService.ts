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
import { ColumnRegistry } from '../core/columns';
// NOTE: TaskStore and CalendarStore removed - all data flows through ProjectController
import { TradePartnerStore, getTradePartnerStore } from '../data/TradePartnerStore';
// NOTE: HistoryManager moved to AppInitializer (application level) - access via ProjectController.getHistoryManager()
import { PersistenceService } from '../data/PersistenceService';
import { DataLoader } from '../data/DataLoader';
import { SnapshotService } from '../data/SnapshotService';
import { ToastService } from '../ui/services/ToastService';
import { FileService } from '../ui/services/FileService';
import { KeyboardService } from '../ui/services/KeyboardService';
import { OrderingService } from './OrderingService';
import { ProjectController } from './ProjectController';
import { SelectionModel } from './SelectionModel';
import { AppInitializer } from './AppInitializer';
import { EditingStateManager, getEditingStateManager, type EditingStateChangeEvent } from './EditingStateManager';
import { ZoomController, type IZoomableGantt } from './ZoomController';
import { SchedulingLogicService } from './migration/SchedulingLogicService';
import { ViewCoordinator } from './migration/ViewCoordinator';
import { TaskOperationsService } from './scheduler/TaskOperationsService';
import { ViewStateService } from './scheduler/ViewStateService';
import { ContextMenuService } from './scheduler/ContextMenuService';
import { ModalCoordinator } from './scheduler/ModalCoordinator';
import { FileOperationsService } from './scheduler/FileOperationsService';
import { BaselineService } from './scheduler/BaselineService';
import { TradePartnerService } from './scheduler/TradePartnerService';
import { ColumnPreferencesService } from './scheduler/ColumnPreferencesService';
import { CommandService } from '../commands';
import { getTaskFieldValue } from '../types';
import { SchedulerViewport } from '../ui/components/scheduler/SchedulerViewport';
import { GridRenderer } from '../ui/components/scheduler/GridRenderer';
import { GanttRenderer } from '../ui/components/scheduler/GanttRenderer';
import { SideDrawer } from '../ui/components/SideDrawer';
import type { RendererFactory } from '../ui/factories';
import type { 
    GridRendererOptions, 
    GanttRendererOptions, 
    SchedulerViewportOptions,
    VirtualScrollGridFacade,
    CanvasGanttFacade
} from '../ui/components/scheduler/types';
// Note: DependenciesModal, CalendarModal, ColumnSettingsModal now managed by ModalCoordinator
import type { 
    Task, 
    Calendar, 
    TradePartner,
    GridColumn, 
    SchedulerServiceOptions,
    ViewMode,
    LinkType,
    ColumnPreferences,
    Dependency
} from '../types';

/**
 * Main scheduler service - orchestrates the entire application
 */
export class SchedulerService {
    /**
     * Storage key for localStorage persistence
     */
    static readonly STORAGE_KEY = 'pro_scheduler_v10';

    // =========================================================================
    // INSTANCE PROPERTIES
    // =========================================================================

    private options: SchedulerServiceOptions;
    private isTauri: boolean;

    // =========================================================================
    // INJECTED SERVICES (Pure DI Migration)
    // These can be injected via constructor or fall back to singletons
    // @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md
    // =========================================================================
    
    /** ProjectController - core data controller */
    private projectController: ProjectController;
    
    /** SelectionModel - selection state */
    private selectionModel: SelectionModel;
    
    /** CommandService - command registry */
    private commandService: CommandService;
    
    /** SchedulingLogicService - scheduling business logic */
    private schedulingLogicService: SchedulingLogicService;
    
    /** ColumnRegistry - column definitions and renderer types */
    private columnRegistry: ColumnRegistry;
    
    /** EditingStateManager - tracks cell editing state */
    private editingStateManager: EditingStateManager;

    // Data stores
    // NOTE: taskStore and calendarStore removed - data flows through ProjectController
    private tradePartnerStore!: TradePartnerStore;
    // NOTE: historyManager moved to AppInitializer - access via ProjectController.getHistoryManager()

    // UI services
    public toastService!: ToastService;  // Public for access from main.ts
    private fileService!: FileService;
    private keyboardService: KeyboardService | null = null;
    
    // SQLite persistence services
    private persistenceService: PersistenceService | null = null;
    private dataLoader: DataLoader | null = null;
    private snapshotService: SnapshotService | null = null;
    private initPromise: Promise<void> | null = null; // Store init promise to avoid race condition
    
    // Zoom controller (extracted from this class for SRP)
    private zoomController: ZoomController | null = null;
    
    // ViewCoordinator for reactive rendering (Phase 1 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private viewCoordinator: ViewCoordinator | null = null;
    
    // TaskOperationsService for task CRUD, hierarchy, movement (Phase 2 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private taskOperations: TaskOperationsService | null = null;
    
    // ViewStateService for view mode, navigation, edit mode (Phase 3 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private viewStateService: ViewStateService | null = null;
    
    // ContextMenuService for right-click context menus (Phase 4 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private contextMenuService: ContextMenuService | null = null;
    
    // ModalCoordinator for modals and panels (Phase 5 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private modalCoordinator: ModalCoordinator | null = null;
    
    // FileOperationsService for file I/O (Phase 6 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private fileOperationsService: FileOperationsService | null = null;
    
    // BaselineService for baseline operations (Phase 7 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private baselineService: BaselineService | null = null;
    
    // TradePartnerService for trade partner operations (Phase 8 decomposition)
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private tradePartnerService: TradePartnerService | null = null;
    
    // ColumnPreferencesService for column management (Phase 9 decomposition)
    // ⚠️ ENCAPSULATED LEGACY: Contains direct DOM manipulation
    // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
    private columnPreferencesService: ColumnPreferencesService | null = null;

    // UI components (initialized in init())
    public grid: VirtualScrollGridFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    public gantt: CanvasGanttFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    private drawer: SideDrawer | null = null;
    // Note: Modals (dependenciesModal, calendarModal, columnSettingsModal) now managed by ModalCoordinator

    // Selection state now fully managed by SelectionModel
    // Legacy public accessor for backward compatibility (reads from SelectionModel)
    public get selectedIds(): Set<string> {
        return this.selectionModel.getSelectedIdSet();
    }
    
    private _unsubscribeEditing: (() => void) | null = null;

    // Selection change callbacks for external listeners (e.g., RightSidebarManager)
    private _selectionChangeCallbacks: Array<(taskId: string | null, task: Task | null, field?: string) => void> = [];
    private _lastClickedField: string | undefined = undefined; // Track which field was clicked

    // Panel open request callbacks (for double-click to open behavior)
    private _openPanelCallbacks: Array<(panelId: string) => void> = [];

    // Data change callbacks for unified panel sync (e.g., RightSidebarManager)
    private _dataChangeCallbacks: Array<() => void> = [];

    // =========================================================================
    // View state
    public viewMode: ViewMode = 'Week';  // Public for access from StatsService
    
    // Display settings
    private displaySettings = {
        highlightDependenciesOnHover: true,
        drivingPathMode: false
    };

    // Performance tracking
    private _lastCalcTime: number = 0;
    private _renderScheduled: boolean = false;

    // Initialization flag
    public isInitialized: boolean = false;  // Public for access from UIEventManager

    /**
     * Create a new SchedulerService instance
     * 
     * @param options - Configuration options (extended with DI deps)
     * @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md
     */
    constructor(options: SchedulerServiceOptions & {
        // DI Dependencies (optional for backward compatibility)
        projectController?: ProjectController;
        selectionModel?: SelectionModel;
        commandService?: CommandService;
        rendererFactory?: RendererFactory;
        keyboardService?: KeyboardService;
        schedulingLogicService?: SchedulingLogicService;
        // Pure DI: Additional injectable services
        columnRegistry?: ColumnRegistry;
        zoomController?: ZoomController;
        tradePartnerStore?: TradePartnerStore;
        dataLoader?: DataLoader;
        snapshotService?: SnapshotService;
        editingStateManager?: EditingStateManager;
        // Phase 1 decomposition: ViewCoordinator for reactive rendering
        viewCoordinator?: ViewCoordinator;
    } = {} as SchedulerServiceOptions) {
        this.options = options;
        // Use isTauri from options (provided by AppInitializer)
        // Desktop-only architecture - must be Tauri environment
        this.isTauri = options.isTauri !== undefined ? options.isTauri : true;
        
        // =====================================================================
        // PURE DI: Initialize service references
        // Use injected dependencies if provided, otherwise fall back to singletons
        // @see docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md
        // =====================================================================
        this.projectController = options.projectController || ProjectController.getInstance();
        this.selectionModel = options.selectionModel || SelectionModel.getInstance();
        this.commandService = options.commandService || CommandService.getInstance();
        this.schedulingLogicService = options.schedulingLogicService || SchedulingLogicService.getInstance();
        this.columnRegistry = options.columnRegistry || ColumnRegistry.getInstance();
        this.editingStateManager = options.editingStateManager || getEditingStateManager();
        
        // Pure DI: Store injected services for use in _initServices() and init()
        if (options.zoomController) {
            this.zoomController = options.zoomController;
        }
        if (options.dataLoader) {
            this.dataLoader = options.dataLoader;
        }
        if (options.snapshotService) {
            this.snapshotService = options.snapshotService;
        }
        if (options.tradePartnerStore) {
            this.tradePartnerStore = options.tradePartnerStore;
        }
        
        // KeyboardService is injected or created in initKeyboard()
        if (options.keyboardService) {
            this.keyboardService = options.keyboardService;
        }
        
        // Phase 1 decomposition: ViewCoordinator for reactive rendering
        if (options.viewCoordinator) {
            this.viewCoordinator = options.viewCoordinator;
        }

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
     * 
     * STRANGLER FIG: Service initialization moved to AppInitializer.
     * SchedulerService now uses shared services via AppInitializer singleton.
     */
    private async _initServices(): Promise<void> {
        // Pure DI: Use injected services if available, fall back to singletons
        const controller = this.projectController;
        
        // Get reference to shared PersistenceService
        if (controller.hasPersistenceService()) {
            this.persistenceService = controller.getPersistenceService();
            console.log('[SchedulerService] Using shared PersistenceService');
        } else {
            console.warn('[SchedulerService] PersistenceService not available - trade partner events will not be persisted');
        }
        
        // Pure DI: Use injected DataLoader and SnapshotService, or fall back to AppInitializer
        if (!this.dataLoader || !this.snapshotService) {
            const appInitializer = AppInitializer.getInstance();
            if (appInitializer) {
                this.dataLoader = this.dataLoader || appInitializer.getDataLoader();
                this.snapshotService = this.snapshotService || appInitializer.getSnapshotService();
                console.log('[SchedulerService] Using DataLoader/SnapshotService from AppInitializer fallback');
            } else {
                console.warn('[SchedulerService] AppInitializer not available - some features may be limited');
            }
        } else {
            console.log('[SchedulerService] Using injected DataLoader and SnapshotService');
        }

        // Pure DI: Use injected TradePartnerStore or fall back to global getter
        if (!this.tradePartnerStore) {
            this.tradePartnerStore = getTradePartnerStore();
            console.log('[SchedulerService] Using TradePartnerStore from fallback');
        } else {
            console.log('[SchedulerService] Using injected TradePartnerStore');
        }
        
        // Set trade partners accessor on shared persistence service
        if (this.persistenceService) {
            this.persistenceService.setTradePartnersAccessor(
                () => this.tradePartnerStore.getAll()
            );
        }

        // NOTE: HistoryManager is now initialized in AppInitializer (application level)
        // Access via this.projectController.getHistoryManager()

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
     * Initialize the scheduling engine
     * 
     * NOTE: With WASM Worker architecture, the engine is no longer used.
     * All calculations happen in the Worker via ProjectController.
     * This method is kept for backward compatibility but does nothing.
     * 
     * @private
     */
    private async _initializeEngine(): Promise<void> {
        // PHASE 8: Engine removed - all calculations happen in WASM Worker via ProjectController
        // The engine property is kept as null - it's no longer needed
        console.log('[SchedulerService] Engine initialization skipped - using ProjectController + WASM Worker');
    }

    /**
     * Initialize the scheduler with UI components
     */
    async init(): Promise<void> {
        // Ensure services are initialized first (await the stored promise)
        if (this.initPromise) {
            await this.initPromise;
        }
        
        const { gridContainer, ganttContainer, modalContainer } = this.options;

        if (!gridContainer || !ganttContainer) {
            throw new Error('gridContainer and ganttContainer are required');
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 9 Decomposition: ColumnPreferencesService (Encapsulated Legacy)
        // MUST be initialized early because _initializeColumnCSSVariables and 
        // _buildGridHeader are called before the grid exists.
        // Note: getGrid() will return undefined at this point, but these early methods
        // don't use the grid - they only manipulate DOM elements by ID.
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.columnPreferencesService = new ColumnPreferencesService({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            columnRegistry: this.columnRegistry,
            toastService: this.toastService,
            getGrid: () => this.grid,
            render: () => this.render(),
            updateSelection: () => this._updateSelection(),
        });
        console.log('[SchedulerService] ✅ ColumnPreferencesService initialized (early - for header build)');

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
            isParent: (id) => this.projectController.isParent(id),
            getDepth: (id) => this.projectController.getDepth(id),
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
            onRowMenu: (taskId, isBlank, anchorEl, event) => this._showRowContextMenu(taskId, isBlank, anchorEl, event),
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onSelectionChange: (selectedIds) => this._handleSelectionChange(selectedIds),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
            onEnterLastRow: (lastTaskId, field) => this._handleEnterLastRow(lastTaskId, field),
            onEditEnd: () => this.exitEditMode(),
            onTradePartnerClick: (taskId, tradePartnerId, e) => this._handleTradePartnerClick(taskId, tradePartnerId, e),
            isParent: (id) => this.projectController.isParent(id),
            getDepth: (id) => this.projectController.getDepth(id),
        };
        viewport.initGrid(gridOptions);

        // NOTE: TaskStore wiring removed - BindingSystem now uses ProjectController directly

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
            isParent: (id) => this.projectController.isParent(id),
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
        
        // Pure DI: Use injected ZoomController or fall back to singleton
        if (!this.zoomController) {
            this.zoomController = ZoomController.getInstance();
            console.log('[SchedulerService] Using ZoomController from fallback');
        } else {
            console.log('[SchedulerService] Using injected ZoomController');
        }
        // Wire ZoomController to GanttRenderer
        const ganttRenderer = (viewport as any).ganttRenderer as IZoomableGantt | null;
        if (ganttRenderer) {
            this.zoomController.setGanttRenderer(ganttRenderer);
        }
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 1 Decomposition: Wire ViewCoordinator for reactive rendering
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        if (!this.viewCoordinator) {
            // Fall back to singleton if not injected
            this.viewCoordinator = ViewCoordinator.getInstance();
            console.log('[SchedulerService] Using ViewCoordinator from fallback');
        } else {
            console.log('[SchedulerService] Using injected ViewCoordinator');
        }
        
        // Set component references so ViewCoordinator can update them
        this.viewCoordinator.setComponents(this.grid, this.gantt);
        
        // Initialize reactive subscriptions (this activates the reactive data flow)
        this.viewCoordinator.initSubscriptions();
        console.log('[SchedulerService] ✅ ViewCoordinator initialized with reactive subscriptions');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 2 Decomposition: TaskOperationsService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.taskOperations = new TaskOperationsService({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            editingStateManager: this.editingStateManager,
            commandService: this.commandService,
            toastService: this.toastService,
            getGrid: () => this.grid,
            getGantt: () => this.gantt,
            saveCheckpoint: () => this.saveCheckpoint(),
            enterEditMode: () => this.enterEditMode(),
            isInitialized: () => this.isInitialized,
            updateHeaderCheckboxState: () => this._updateHeaderCheckboxState(),
        });
        console.log('[SchedulerService] ✅ TaskOperationsService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 3 Decomposition: ViewStateService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.viewStateService = new ViewStateService({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            editingStateManager: this.editingStateManager,
            commandService: this.commandService,
            viewCoordinator: this.viewCoordinator,
            getGrid: () => this.grid,
            getGantt: () => this.gantt,
            getColumnDefinitions: () => this._getColumnDefinitions(),
            closeDrawer: () => this.drawer?.close(),
            isDrawerOpen: () => this.drawer?.isDrawerOpen() ?? false,
        });
        // Sync initial state from SchedulerService to ViewStateService
        this.viewStateService.viewMode = this.viewMode;
        this.viewStateService.displaySettings.highlightDependenciesOnHover = this.displaySettings.highlightDependenciesOnHover;
        this.viewStateService.displaySettings.drivingPathMode = this.displaySettings.drivingPathMode;
        console.log('[SchedulerService] ✅ ViewStateService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 4 Decomposition: ContextMenuService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.contextMenuService = new ContextMenuService({
            insertBlankRowAbove: (taskId) => this.insertBlankRowAbove(taskId),
            insertBlankRowBelow: (taskId) => this.insertBlankRowBelow(taskId),
            convertBlankToTask: (taskId) => this.convertBlankToTask(taskId),
            deleteTask: (taskId) => this.deleteTask(taskId),
            openProperties: (taskId) => this.openProperties(taskId),
        });
        console.log('[SchedulerService] ✅ ContextMenuService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 5 Decomposition: ModalCoordinator
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.modalCoordinator = new ModalCoordinator({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            columnRegistry: this.columnRegistry,
            getOpenPanelCallbacks: () => this._openPanelCallbacks,
            onDependenciesSave: (taskId, deps) => this._handleDependenciesSave(taskId, deps),
            onCalendarSave: (calendar) => this._handleCalendarSave(calendar),
            onColumnPreferencesSave: (prefs) => this.updateColumnPreferences(prefs),
            getColumnPreferences: () => this._getColumnPreferences(),
            updateSelection: () => this._updateSelection(),
        });
        // Initialize modals with container
        const modalsContainer = modalContainer || document.body;
        this.modalCoordinator.initialize(modalsContainer);
        console.log('[SchedulerService] ✅ ModalCoordinator initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 6 Decomposition: FileOperationsService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.fileOperationsService = new FileOperationsService({
            projectController: this.projectController,
            fileService: this.fileService,
            toastService: this.toastService,
            persistenceService: this.persistenceService,
            saveCheckpoint: () => this.saveCheckpoint(),
            saveData: () => this.saveData(),
            createSampleData: () => this._createSampleData(),
            storageKey: SchedulerService.STORAGE_KEY,
        });
        console.log('[SchedulerService] ✅ FileOperationsService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 7 Decomposition: BaselineService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.baselineService = new BaselineService({
            projectController: this.projectController,
            columnRegistry: this.columnRegistry,
            toastService: this.toastService,
            saveCheckpoint: () => this.saveCheckpoint(),
            saveData: () => this.saveData(),
            rebuildGridColumns: () => this._rebuildGridColumns(),
            getCalendar: () => this.calendar,
        });
        console.log('[SchedulerService] ✅ BaselineService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Phase 8 Decomposition: TradePartnerService
        // @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
        // ─────────────────────────────────────────────────────────────────────────────
        this.tradePartnerService = new TradePartnerService({
            projectController: this.projectController,
            tradePartnerStore: this.tradePartnerStore,
            persistenceService: this.persistenceService,
            toastService: this.toastService,
            viewCoordinator: this.viewCoordinator,
            notifyDataChange: () => this._notifyDataChange(),
        });
        console.log('[SchedulerService] ✅ TradePartnerService initialized');
        
        // ─────────────────────────────────────────────────────────────────────────────
        // Legacy drawer - now managed by RightSidebarManager
        // ─────────────────────────────────────────────────────────────────────────────
        // REMOVED: Drawer is now managed by RightSidebarManager
        // Note: Modal creation now handled by ModalCoordinator (Phase 5)
        // SideDrawer is managed by RightSidebarManager

        // Note: Keyboard shortcuts are initialized after init() completes
        // See main.ts - they're attached after scheduler initialization
        
        // Subscribe to editing state changes
        const editingManager = this.editingStateManager;
        this._unsubscribeEditing = editingManager.subscribe((event) => {
            this._onEditingStateChange(event);
        });
        
        // Enable debug mode during development (optional)
        // editingManager.setDebugMode(true);

        // Load persisted data
        try {
            const taskCountBeforeLoad = this.projectController.getTasks().length;
            console.log('[SchedulerService] 🔍 Before loadData() - task count:', taskCountBeforeLoad);
            
            await this.loadData();
            
            const taskCountAfterLoad = this.projectController.getTasks().length;
            console.log('[SchedulerService] ✅ After loadData() - task count:', taskCountAfterLoad);
        } catch (error) {
            console.error('[SchedulerService] Error loading persisted data:', error);
        }
        
        // TODO: Calendar integration for Flatpickr - add setCalendar to GridRenderer
        // Pass calendar to grid for date picker integration
        // const calendar = this.projectController.getCalendar();
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
     * Updates SelectionModel (single source of truth for selection)
     */
    private _handleSelectionChange(selectedIds: string[]): void {
        const selectedSet = new Set(selectedIds);
        const primaryId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
        
        // Update SelectionModel (the single source of truth)
        // SelectionModel now tracks selection order internally
        this.selectionModel.setSelection(selectedSet, primaryId, selectedIds);
        
        // === Notify registered callbacks ===
        // IMPORTANT: This is the ONLY place callbacks are triggered.
        // Do NOT add callbacks to _handleRowClick - it would cause double-firing
        // since row clicks internally trigger _handleSelectionChange via _updateSelection().
        const primaryTask = primaryId ? this.projectController.getTaskById(primaryId) || null : null;
        
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
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    getHighlightDependenciesOnHover(): boolean {
        if (!this.viewStateService) {
        return this.displaySettings.highlightDependenciesOnHover;
        }
        return this.viewStateService.getHighlightDependenciesOnHover();
    }

    /**
     * Set whether dependency highlighting on hover is enabled
     * @param enabled - True to enable highlighting
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    setHighlightDependenciesOnHover(enabled: boolean): void {
        if (!this.viewStateService) {
            this.displaySettings.highlightDependenciesOnHover = enabled;
            return;
        }
        this.viewStateService.setHighlightDependenciesOnHover(enabled);
        // Keep local copy in sync
        this.displaySettings.highlightDependenciesOnHover = enabled;
    }

    /**
     * Toggle driving path mode
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    toggleDrivingPathMode(): void {
        if (!this.viewStateService) {
        this.displaySettings.drivingPathMode = !this.displaySettings.drivingPathMode;
        this._updateGanttDrivingPathMode();
        this.render();
            return;
        }
        this.viewStateService.toggleDrivingPathMode();
        // Keep local copy in sync
        this.displaySettings.drivingPathMode = this.viewStateService.displaySettings.drivingPathMode;
    }

    /**
     * Update Gantt driving path mode display
     * @private
     * @deprecated Phase 3: Now handled by ViewStateService
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
     * Get column definitions with preferences applied
     * STRANGLER FIG: Now uses ColumnRegistry instead of inline definitions
     * @private
     */
    /**
     * Get column definitions
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _getColumnDefinitions(): GridColumn[] {
        if (this.columnPreferencesService) {
            return this.columnPreferencesService.getColumnDefinitions();
        }
        const registry = this.columnRegistry;
        const prefs = this._getColumnPreferences();
        return registry.getGridColumns(prefs);
    }

    // STRANGLER FIG: _getBaseColumnDefinitions() REMOVED (~320 lines) - now uses ColumnRegistry
    // STRANGLER FIG: _applyColumnPreferences() REMOVED (~50 lines) - handled by ColumnRegistry.getGridColumns()

    /**
     * Get column preferences from localStorage
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _getColumnPreferences(): ColumnPreferences {
        return this.columnPreferencesService!.getPreferences();
    }

    /**
     * Update column preferences and rebuild grid
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @param preferences - New column preferences
     */
    updateColumnPreferences(preferences: ColumnPreferences): void {
        this.columnPreferencesService!.updatePreferences(preferences);
    }

    /**
     * Build the grid header dynamically from column definitions
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _buildGridHeader(): void {
        this.columnPreferencesService!.buildGridHeader();
    }

    /**
     * Initialize CSS variables for column widths from column definitions
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _initializeColumnCSSVariables(): void {
        this.columnPreferencesService!.initializeColumnCSSVariables();
    }

    // =========================================================================
    // BASELINE MANAGEMENT
    // =========================================================================

    /**
     * Check if baseline has been set for any task
     * @returns True if baseline exists
     * 
     * Phase 7 Decomposition: Delegates to BaselineService
     */
    hasBaseline(): boolean {
        return this.baselineService!.hasBaseline();
    }

    /**
     * Set baseline from current schedule
     * Saves current start/end/duration as baseline for all tasks
     * 
     * Phase 7 Decomposition: Delegates to BaselineService
     */
    setBaseline(): void {
        this.baselineService!.setBaseline();
    }

    /**
     * Clear baseline data from all tasks
     * 
     * Phase 7 Decomposition: Delegates to BaselineService
     */
    clearBaseline(): void {
        this.baselineService!.clearBaseline();
    }

    /**
     * Calculate variance for a task
     * @param task - Task to calculate variance for
     * @returns Variance object with start and finish variances in work days
     * 
     * Phase 7 Decomposition: Delegates to BaselineService
     */
    calculateVariance(task: Task): { start: number | null; finish: number | null } {
        return this.baselineService!.calculateVariance(task);
    }

    /**
     * Rebuild grid columns when baseline state changes
     * Updates header and grid to show/hide actual/variance columns
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _rebuildGridColumns(): void {
        this.columnPreferencesService!.rebuildGridColumns();
    }

    // =========================================================================
    // DATA ACCESS (delegated to stores)
    // =========================================================================

    /**
     * Get all tasks
     * @returns All tasks
     */
    get tasks(): Task[] {
        return this.projectController.getTasks();
    }

    /**
     * Set all tasks (replaces entire dataset)
     * CRITICAL: Reset editing state when replacing entire dataset
     * @param tasks - Tasks array
     */
    set tasks(tasks: Task[]) {
        const editingManager = this.editingStateManager;
        
        // CRITICAL: Reset editing state when replacing entire dataset
        // Unconditional reset - always safe when replacing entire dataset
        editingManager.reset();
        
        this.projectController.syncTasks(tasks);
        // Trigger render to update viewport with new data
        this.render();
    }

    /**
     * Get calendar configuration
     * @returns Calendar object
     */
    get calendar(): Calendar {
        return this.projectController.getCalendar();
    }

    /**
     * Set calendar configuration
     * @param calendar - Calendar object
     */
    set calendar(calendar: Calendar) {
        this.projectController.updateCalendar(calendar);
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
        if (e.shiftKey && this.selectionModel.getAnchorId()) {
            // Range selection
            const visibleTasks = this.projectController.getVisibleTasks((id) => {
                const task = this.projectController.getTaskById(id);
                return task?._collapsed || false;
            });
            const anchorIndex = visibleTasks.findIndex(t => t.id === this.selectionModel.getAnchorId());
            const targetIndex = visibleTasks.findIndex(t => t.id === taskId);
            
            if (anchorIndex !== -1 && targetIndex !== -1) {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                const rangeIds = visibleTasks.slice(start, end + 1).map(t => t.id);
                this.selectionModel.setSelection(new Set(rangeIds), taskId, rangeIds);
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            if (this.selectionModel.isSelected(taskId)) {
                // Removing
                this.selectionModel.removeFromSelection([taskId]);
            } else {
                // Adding
                this.selectionModel.addToSelection([taskId]);
            }
            // Note: _sel_setAnchor was a no-op, removed
        } else {
            // Single selection
            this.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
        }

        this.selectionModel.setFocus(taskId, this._lastClickedField);
        this._updateSelection();
        this._updateHeaderCheckboxState();
    }

    /**
     * Handle row double-click
     * @private
     * @param taskId - Task ID
     * @param e - Double-click event
     */
    private _handleRowDoubleClick(taskId: string, _e: MouseEvent): void {
        this.openDrawer(taskId);
    }

    // NOTE: _applyDateChangeImmediate and _applyTaskEdit have been removed.
    // All scheduling logic is now handled by SchedulingLogicService.applyEdit()
    // @see src/services/migration/SchedulingLogicService.ts

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
    private async _handleCellChange(taskId: string, field: string, value: unknown): Promise<void> {
        // Skip checkbox field - it's a visual indicator of selection, not task data
        if (field === 'checkbox') {
            return;
        }
        
        this.saveCheckpoint();
        
        // Use SchedulingLogicService for all task edit business logic
        const result = this.schedulingLogicService.applyEdit(taskId, field, value, {
            controller: this.projectController,
            calendar: this.projectController.getCalendar(),
        });
        
        // Show toast message if provided
        if (result.message) {
            switch (result.messageType) {
                case 'success': this.toastService?.success(result.message); break;
                case 'warning': this.toastService?.warning(result.message); break;
                case 'error': this.toastService?.error(result.message); break;
                default: this.toastService?.info(result.message);
            }
        }
        
        if (!result.success) {
            return;
        }
        
        // NOTE: With ENABLE_LEGACY_RECALC=false, ProjectController.updateTask() triggers
        // Worker calculation, and reactive saveData subscription handles persistence
    }

    /**
     * Handle Enter key pressed on the last task in the list
     * Creates a new task as a sibling and focuses the same field
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     * 
     * @private
     * @param lastTaskId - The ID of the last task (where Enter was pressed)
     * @param field - The field that was being edited (to focus same field in new task)
     */
    private _handleEnterLastRow(lastTaskId: string, field: string): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.handleEnterLastRow(lastTaskId, field);
    }

    /**
     * Handle trade partner chip click
     * @private
     * @param taskId - Task ID
     * @param tradePartnerId - Trade Partner ID
     * @param e - Click event
     */
    /**
     * Handle trade partner click
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    private _handleTradePartnerClick(taskId: string, tradePartnerId: string, e: MouseEvent): void {
        this.tradePartnerService!.handleClick(taskId, tradePartnerId, e);
    }

    /**
     * Handle action button click
     * @private
     * @param taskId - Task ID
     * @param action - Action ID
     * @param e - Click event
     */
    private _handleAction(taskId: string, action: string, e?: Event): void {
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
    private async _handleDrawerUpdate(taskId: string, field: string, value: unknown): Promise<void> {
        this.saveCheckpoint();
        
        // Use SchedulingLogicService for all task edit business logic
        const result = this.schedulingLogicService.applyEdit(taskId, field, value, {
            controller: this.projectController,
            calendar: this.projectController.getCalendar(),
        });
        
        // Show toast message if provided
        if (result.message) {
            switch (result.messageType) {
                case 'success': this.toastService?.success(result.message); break;
                case 'warning': this.toastService?.warning(result.message); break;
                case 'error': this.toastService?.error(result.message); break;
                default: this.toastService?.info(result.message);
            }
        }
        
        if (!result.success) {
            return;
        }
        
        // Sync drawer with updated values (dates may have changed from CPM)
        if (this.drawer && this.drawer.isDrawerOpen() && this.drawer.getActiveTaskId() === taskId) {
            const updatedTask = this.projectController.getTaskById(taskId);
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
        // Validate dependencies before saving
        const validation = this._validateDependencies(taskId, dependencies);
        if (!validation.valid) {
            this.toastService.error(validation.error || 'Invalid dependencies');
            return;
        }

        this.saveCheckpoint();
        this.projectController.updateTask(taskId, { dependencies });
        
        // NOTE: ProjectController handles recalc/save via Worker
    }

    /**
     * Handle calendar save
     * @private
     * @param calendar - Calendar configuration
     */
    private _handleCalendarSave(calendar: Calendar): void {
        this.saveCheckpoint();
        this.projectController.updateCalendar(calendar);
        
        // NOTE: ProjectController handles recalc/save via Worker
        this.toastService.success('Calendar updated. Recalculating schedule...');
    }

    /**
     * Handle row move (drag and drop)
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     * 
     * @private
     * @param taskIds - Task IDs being moved (may include multiple selected)
     * @param targetId - Target task ID to drop on/near
     * @param position - 'before', 'after', or 'child'
     */
    private _handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.handleRowMove(taskIds, targetId, position);
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
        const calendar = this.projectController.getCalendar();
        const duration = DateUtils.calcWorkDays(start, end, calendar);
        
        this.projectController.updateTask(task.id, { start, end, duration });
        // NOTE: ProjectController handles recalc/save via Worker
    }

    // =========================================================================
    // KEYBOARD HANDLERS
    // =========================================================================

    // STRANGLER FIG: _handleArrowNavigation removed - dead code
    // Navigation now handled exclusively by _handleCellNavigation

    /**
     * Handle arrow cell navigation (Excel-style)
     * Moves the selection highlight WITHOUT entering edit mode
     * UPDATED: Check EditingStateManager instead of local flag
     * @private
     * @param direction - 'up' | 'down' | 'left' | 'right'
     * @param shiftKey - Shift key pressed (for range selection)
     */
    private _handleCellNavigation(direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean): void {
        const editingManager = this.editingStateManager;
        
        // If currently editing, don't navigate
        if (editingManager.isEditing()) {
            return;
        }
        
        const editableColumns = this.getColumnDefinitions()
            .filter(col => col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select' || col.type === 'name' || col.type === 'schedulingMode')
            .map(col => col.field);
        
        if (editableColumns.length === 0) return;
        
        const visibleTasks = this.projectController.getVisibleTasks((id) => {
            const task = this.projectController.getTaskById(id);
            return task?._collapsed || false;
        });
        
        if (visibleTasks.length === 0) return;
        
        // Initialize focused column if not set
        const currentFocusedColumn = this.selectionModel.getFocusedField();
        if (!currentFocusedColumn) {
            this.selectionModel.setFocusedField(editableColumns[0]); // Default to first editable column (name)
        }
        
        const focused = this.selectionModel.getFocusedId();
        let currentRowIndex = focused 
            ? visibleTasks.findIndex(t => t.id === focused)
            : 0;
        const focusedCol = this.selectionModel.getFocusedField();
        let currentColIndex = focusedCol ? editableColumns.indexOf(focusedCol as typeof editableColumns[number]) : -1;
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
            if (shiftKey && this.selectionModel.getAnchorId()) {
                // Extend selection range
                const anchorIndex = visibleTasks.findIndex(t => t.id === this.selectionModel.getAnchorId());
                const start = Math.min(anchorIndex, newRowIndex);
                const end = Math.max(anchorIndex, newRowIndex);
                
                const rangeIds = visibleTasks.slice(start, end + 1).map(t => t.id);
                this.selectionModel.setSelection(new Set(rangeIds), newTaskId, rangeIds);
            } else if (!shiftKey) {
                // Single selection
                this.selectionModel.setSelection(new Set([newTaskId]), newTaskId, [newTaskId]);
            }
        }
        
        this.selectionModel.setFocus(newTaskId, newColumn);
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
        const focusedId = this.selectionModel.getFocusedId();
        if (!focusedId) return;
        
        const task = this.projectController.getTaskById(focusedId);
        if (!task || !this.projectController.isParent(focusedId)) return;

        if (key === 'ArrowRight' && task._collapsed) {
            this.toggleCollapse(focusedId);
        } else if (key === 'ArrowLeft' && !task._collapsed) {
            this.toggleCollapse(focusedId);
        }
    }



    /**
     * Handle Tab indent
     * @private
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    private _handleTabIndent(): void {
        if (!this.viewStateService) {
        this.commandService.execute('hierarchy.indent');
            return;
        }
        this.viewStateService.handleTabIndent();
    }

    /**
     * Handle Shift+Tab outdent
     * @private
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    private _handleTabOutdent(): void {
        if (!this.viewStateService) {
        this.commandService.execute('hierarchy.outdent');
            return;
        }
        this.viewStateService.handleTabOutdent();
    }

    /**
     * Handle Escape key
     * @private
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    private _handleEscape(): void {
        if (!this.viewStateService) {
            // Fallback to original logic
        if (this.drawer && this.drawer.isDrawerOpen()) {
            this.drawer.close();
            return;
        }
        this.commandService.execute('selection.escape');
            this._updateSelection();
            return;
        }
        this.viewStateService.handleEscape();
        this._updateSelection();
    }

    // =========================================================================
    // SCROLL SYNCHRONIZATION
    // =========================================================================

    // =========================================================================
    // TASK OPERATIONS
    // =========================================================================

    /**
     * Get a task by ID
     * @param id - Task ID
     * @returns Task or undefined
     */
    getTask(id: string): Task | undefined {
        return this.projectController.getTaskById(id);
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
        const focusedId = this.selectionModel.getFocusedId();
        if (!focusedId) return null;
        return this.projectController.getTaskById(focusedId) || null;
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
        return this.projectController.isParent(id);
    }

    /**
     * Get task depth
     * @param id - Task ID
     * @returns Depth level
     */
    getDepth(id: string): number {
        return this.projectController.getDepth(id);
    }

    /**
     * Add a new task
     * @param taskData - Task data
     * @returns Created task
     */
    /**
     * Add a new task - ALWAYS appends to bottom of siblings
     * Uses fractional indexing for bulletproof ordering
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return Promise.resolve(undefined);
        }
        return this.taskOperations.addTask(taskData);
    }

    /**
     * Delete a task and its children
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    deleteTask(taskId: string): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.deleteTask(taskId);
    }

    /**
     * Delete selected tasks
     * @private
     */
    private _deleteSelected(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('task.delete');
    }

    /**
     * Toggle collapse state
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    toggleCollapse(taskId: string): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.toggleCollapse(taskId);
    }

    /**
     * Indent a task (make it a child of previous sibling)
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    indent(taskId: string): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.indent(taskId);
    }

    /**
     * Outdent a task (move to parent's level)
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    outdent(taskId: string): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.outdent(taskId);
    }

    /**
     * Show context menu for a row
     * Phase 4 Decomposition: Delegates to ContextMenuService
     * @private
     */
    private _showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, event: MouseEvent): void {
        this.contextMenuService!.showRowContextMenu(taskId, isBlank, anchorEl, event);
    }

    /**
     * Insert blank row above a task
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    insertBlankRowAbove(taskId: string): void {
        this.taskOperations!.insertBlankRowAbove(taskId);
    }

    /**
     * Insert blank row below a task
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    insertBlankRowBelow(taskId: string): void {
        this.taskOperations!.insertBlankRowBelow(taskId);
    }

    /**
     * Wake up a blank row (convert to task and enter edit mode)
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    wakeUpBlankRow(taskId: string): void {
        this.taskOperations!.wakeUpBlankRow(taskId);
    }

    /**
     * Convert a blank row to a task
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    convertBlankToTask(taskId: string): void {
        this.taskOperations!.convertBlankToTask(taskId);
    }

    /**
     * Open properties panel for a task
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    openProperties(taskId: string): void {
        this.modalCoordinator!.openProperties(taskId);
    }

    /**
     * Indent all selected tasks
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    indentSelected(): void {
        this.taskOperations!.indentSelected();
    }

    /**
     * Outdent all selected tasks
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     */
    outdentSelected(): void {
        this.taskOperations!.outdentSelected();
    }

    /**
     * Delete all selected tasks
     * Shows confirmation for multiple tasks or parent tasks
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    async deleteSelected(): Promise<void> {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        return this.taskOperations.deleteSelected();
    }

    /**
     * Get all predecessor task IDs (transitive closure through dependencies)
     * Uses BFS to traverse dependency graph backward
     * @private
     */
    private _getAllPredecessors(taskId: string): Set<string> {
        const predecessors = new Set<string>();
        const visited = new Set<string>();
        const queue: string[] = [taskId];
        
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            
            const task = this.projectController.getTaskById(currentId);
            if (task?.dependencies) {
                for (const dep of task.dependencies) {
                    if (!visited.has(dep.id)) {
                        predecessors.add(dep.id);
                        queue.push(dep.id);
                    }
                }
            }
        }
        
        return predecessors;
    }

    /**
     * Check if adding a dependency would create a circular dependency
     * @private
     * @param taskId - Task that will have the dependency
     * @param predecessorId - Predecessor task ID to check
     * @returns True if adding this dependency would create a cycle
     */
    private _wouldCreateCycle(taskId: string, predecessorId: string): boolean {
        // A cycle exists if the predecessor depends on (directly or transitively) the current task
        const predecessorPredecessors = this._getAllPredecessors(predecessorId);
        return predecessorPredecessors.has(taskId);
    }

    /**
     * Validate dependencies before saving
     * @private
     * @param taskId - Task ID
     * @param dependencies - Dependencies to validate
     * @returns Validation result with error message if invalid
     */
    private _validateDependencies(taskId: string, dependencies: Array<{ id: string; type: LinkType; lag: number }>): { valid: boolean; error?: string } {
        const task = this.projectController.getTaskById(taskId);
        if (!task) {
            return { valid: false, error: 'Task not found' };
        }

        // Check each dependency
        for (const dep of dependencies) {
            // Check if predecessor exists
            const predecessor = this.projectController.getTaskById(dep.id);
            if (!predecessor) {
                return { valid: false, error: `Predecessor task "${dep.id}" not found` };
            }

            // Check if predecessor is a blank row
            if (predecessor.rowType === 'blank') {
                return { valid: false, error: 'Cannot create dependency to a blank row' };
            }

            // Check for circular dependencies
            if (this._wouldCreateCycle(taskId, dep.id)) {
                const taskName = task.name || taskId;
                const predName = predecessor.name || dep.id;
                return { valid: false, error: `Circular dependency detected: "${taskName}" depends on "${predName}", which depends on "${taskName}"` };
            }

            // Check if linking to self
            if (dep.id === taskId) {
                return { valid: false, error: 'Task cannot depend on itself' };
            }

            // Validate link type
            const validLinkTypes: LinkType[] = ['FS', 'SS', 'FF', 'SF'];
            if (!validLinkTypes.includes(dep.type)) {
                return { valid: false, error: `Invalid link type: ${dep.type}` };
            }

            // Validate lag is a number
            if (typeof dep.lag !== 'number' || isNaN(dep.lag)) {
                return { valid: false, error: 'Lag must be a number' };
            }
        }

        return { valid: true };
    }

    /**
     * Get column definitions for Settings Modal
     * STRANGLER FIG: Now uses ColumnRegistry
     * v3.0: Used by Columns tab in Settings
     */
    getColumnDefinitionsForSettings(): GridColumn[] {
        return this.columnRegistry.getGridColumns();
    }

    /**
     * Get current column preferences
     * v3.0: Used by Columns tab in Settings
     */
    getColumnPreferencesForSettings(): ColumnPreferences {
        return this._getColumnPreferences();
    }

    /**
     * Save column preferences from Settings Modal
     * v3.0: Called when user saves changes in Columns tab
     */
    saveColumnPreferencesFromSettings(preferences: ColumnPreferences): void {
        this.updateColumnPreferences(preferences);
    }

    /**
     * Link selected tasks in selection order
     * Creates FS (Finish-to-Start) dependencies with 0 lag
     * Single undo reverses all created links
     */
    linkSelectedInOrder(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('dependency.linkSelected');
    }

    /**
     * Insert a new task above the currently focused task
     */
    insertTaskAbove(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('task.insertAbove');
    }

    /**
     * Insert a new task BELOW the currently focused task
     */
    insertTaskBelow(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('task.insertBelow');
    }

    /**
     * Add a new task as a CHILD of the currently focused task
     */
    addChildTask(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('task.addChild');
    }

    /**
     * Move the focused task up (before previous sibling)
     * Only modifies the moved task's sortKey
     * 
     * Phase 2 Decomposition: Delegates to TaskOperationsService
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
     */
    moveSelectedTasks(direction: number): void {
        if (!this.taskOperations) {
            console.warn('[SchedulerService] TaskOperationsService not initialized');
            return;
        }
        this.taskOperations.moveSelectedTasks(direction);
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
            const currentFocusedId = this.selectionModel.getFocusedId();
            const currentFocusedColumn = this.selectionModel.getFocusedField();
            if (currentFocusedId && currentFocusedColumn && this.grid) {
                this.grid.highlightCell(currentFocusedId, currentFocusedColumn);
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
                this.selectionModel.setSelection(new Set([newTaskId]), newTaskId, [newTaskId]);
                this.selectionModel.setFocus(newTaskId, newState.context.field);
                this._updateSelection();
            }
        }
    }

    /**
     * Enter edit mode for the currently highlighted cell
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    enterEditMode(): void {
        if (!this.viewStateService) {
            // Fallback to original logic
        const focusedId = this.selectionModel.getFocusedId();
        const focusedColumn = this.selectionModel.getFocusedField();
        if (!focusedId || !focusedColumn) return;
        
        const editingManager = this.editingStateManager;
        const task = this.projectController.getTaskById(focusedId);
        const originalValue = task ? getTaskFieldValue(task, focusedColumn as GridColumn['field']) : undefined;
        
        editingManager.enterEditMode(
            { taskId: focusedId, field: focusedColumn },
            'f2',
            originalValue
        );
        
        if (this.grid) {
            this.grid.focusCell(focusedId, focusedColumn);
        }
            return;
        }
        this.viewStateService.enterEditMode();
    }

    /**
     * Called when cell editing ends
     * Now mostly handled by EditingStateManager subscription
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    exitEditMode(): void {
        if (!this.viewStateService) {
        const editingManager = this.editingStateManager;
        if (editingManager.isEditing()) {
            editingManager.exitEditMode('programmatic');
        }
            return;
        }
        this.viewStateService.exitEditMode();
    }

    // =========================================================================
    // SELECTION MANAGEMENT
    // =========================================================================

    /**
     * Get selected task IDs in selection order
     * @returns Array of task IDs in the order they were selected
     */
    getSelectionInOrder(): string[] {
        return this.selectionModel.getSelectionInOrder();
    }

    /**
     * Update selection in UI components
     * @private
     */
    private _updateSelection(): void {
        if (this.grid) {
            this.grid.setSelection(new Set(this.selectionModel.getSelectedIds()), this.selectionModel.getFocusedId());
        }
        if (this.gantt) {
            this.gantt.setSelection(new Set(this.selectionModel.getSelectedIds()));
        }
        // Update header checkbox state
        this._updateHeaderCheckboxState();
        
        // Phase 3: Update driving path if mode is active (via ViewStateService)
        if (this.viewStateService) {
            this.viewStateService.updateDrivingPathIfActive();
        } else if (this.displaySettings.drivingPathMode) {
            this._updateGanttDrivingPathMode();
        }
        
        // Trigger selection change callbacks (for RightSidebarManager and other listeners)
        // Convert Set to array for _handleSelectionChange
        const selectedArray = Array.from(this.selectedIds);
        this._handleSelectionChange(selectedArray);
    }

    /**
     * Update header checkbox state (checked/unchecked/indeterminate)
     * Phase 9 Decomposition: Delegates to ColumnPreferencesService
     * @private
     */
    private _updateHeaderCheckboxState(checkbox?: HTMLInputElement): void {
        this.columnPreferencesService!.updateHeaderCheckboxState(checkbox);
    }

    /**
     * Copy selected tasks
     */
    copySelected(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('clipboard.copy');
    }

    /**
     * Cut selected tasks
     */
    cutSelected(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('clipboard.cut');
    }

    /**
     * Paste tasks
     */
    paste(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('clipboard.paste');
    }

    // =========================================================================
    // UI MODAL OPERATIONS
    // =========================================================================

    /**
     * Open drawer for a task
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    openDrawer(taskId: string): void {
        this.modalCoordinator!.openDrawer(taskId);
    }

    /**
     * Close drawer
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    closeDrawer(): void {
        this.modalCoordinator!.closeDrawer();
    }

    /**
     * Open dependencies modal or panel
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    openDependencies(taskId: string): void {
        this.modalCoordinator!.openDependencies(taskId);
    }

    /**
     * Open calendar modal
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    openCalendar(): void {
        this.modalCoordinator!.openCalendar();
    }

    /**
     * Open column settings modal
     * Phase 5 Decomposition: Delegates to ModalCoordinator
     */
    openColumnSettings(): void {
        this.modalCoordinator!.openColumnSettings();
    }

    // =========================================================================
    // CPM CALCULATIONS
    // =========================================================================

    /**
     * Recalculate all tasks using CPM
     * NOTE: With ProjectController + WASM Worker architecture, this method is now
     * largely redundant. The Worker calculates and emits results via tasks$.
     * Keeping this as a thin wrapper for backward compatibility.
     * @returns Promise that resolves immediately (Worker handles async calculation)
     */
    recalculateAll(): Promise<void> {
        // In the new architecture, ProjectController.forceRecalculate() sends
        // a CALCULATE command to the WASM Worker. The Worker emits results
        // via tasks$ which the UI subscribes to. No manual result application needed.
        this.projectController.forceRecalculate();
        return Promise.resolve();
    }

    // STRANGLER FIG: _applyCalculationResult() removed - dead code
    // ProjectController + WASM Worker now handles CPM results via reactive streams (tasks$).
    // The viewport subscribes to tasks$ and renders automatically.



    // STRANGLER FIG: _onTasksChanged() and _onCalendarChanged() removed - dead code
    // ProjectController + WASM Worker handles data changes via reactive streams.
    // The viewport subscribes to tasks$ and calendar$ and renders automatically.

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
     * Assign visual row numbers to tasks, skipping blank and phantom rows.
     * This enables "logical numbering" in the UI where blank rows don't 
     * consume numbers in the sequence.
     * 
     * CRITICAL: Uses hierarchical traversal (not flat getAll()) to ensure
     * numbers follow visual tree order. getAll() returns insertion order,
     * which doesn't match the display order determined by parentId + sortKey.
     * 
     * Note: Traverses ALL tasks including collapsed children. This ensures
     * row numbers remain stable when collapsing/expanding (standard scheduling
     * software behavior - row numbers don't change based on visibility).
     * 
     * Called before each render to ensure row numbers are always current.
     * 
     * @private
     */
    private _assignVisualRowNumbers(): void {
        let counter = 1;
        
        /**
         * Recursive traversal following visual tree order
         * @param parentId - Parent task ID (null for root level)
         */
        const traverse = (parentId: string | null): void => {
            // getChildren returns tasks SORTED by sortKey - this is critical
            const children = this.projectController.getChildren(parentId);
            
            for (const task of children) {
                // 1. Assign number based on row type
                if (task.rowType === 'blank' || task.rowType === 'phantom') {
                    // Blank and phantom rows don't get a visual number
                    task._visualRowNumber = null;
                } else {
                    // Regular tasks get sequential numbers
                    task._visualRowNumber = counter++;
                }
                
                // 2. Recurse into children (regardless of collapsed state)
                // This ensures number continuity even for hidden tasks
                if (this.projectController.isParent(task.id)) {
                    traverse(task.id);
                }
            }
        };
        
        // Start traversal from root level (parentId = null)
        traverse(null);
    }

    /**
     * Render all views
     * 
     * Phase 1 Decomposition: Now delegates to ViewCoordinator for reactive rendering.
     * ViewCoordinator handles visual row numbering, data updates, and render scheduling.
     * 
     * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md - Phase 1
     */
    render(): void {
        // Phase 1: Delegate to ViewCoordinator for reactive rendering
        // ViewCoordinator handles:
        // - Visual row number assignment (assignVisualRowNumbers)
        // - Grid data updates (_updateGridData)
        // - Gantt data updates (_updateGanttData)
        // - Batched rendering via requestAnimationFrame
        if (this.viewCoordinator) {
            this.viewCoordinator.forceUpdate();
            return;
        }
        
        // Legacy fallback (only if ViewCoordinator not initialized)
        // This should rarely execute after init() completes
        if (this._renderScheduled) return;
        
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderScheduled = false;
            
            // Pre-calculate visual row numbers (skips blank/phantom rows)
            this._assignVisualRowNumbers();
            
            // Get visible tasks for hierarchy-aware display
            const tasks = this.projectController.getVisibleTasks((id) => {
                const task = this.projectController.getTaskById(id);
                return task?._collapsed || false;
            });

            if (this.grid) {
                // Pass visible tasks to grid (it handles virtual scrolling)
                this.grid.setData(tasks);
                this.grid.setSelection(new Set(this.selectionModel.getSelectedIds()), this.selectionModel.getFocusedId());
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
        const editingManager = this.editingStateManager;
        editingManager.reset();
        console.log('[SchedulerService] 🔍 loadData() called');
        
        if (!this.dataLoader) {
            // In test mode without Tauri, there's no DataLoader - this is expected
            console.log('[SchedulerService] loadData() skipped - no DataLoader (test mode or non-Tauri environment)');
            return;
        }
        
        try {
            const { tasks, calendar, tradePartners } = await this.dataLoader.loadData();
            
            // Load trade partners first
            this.tradePartnerStore.setAll(tradePartners);
            console.log('[SchedulerService] ✅ Loaded trade partners:', tradePartners.length);
            
            if (tasks.length > 0 || Object.keys(calendar.exceptions).length > 0) {
                const tasksWithSortKeys = this._assignSortKeysToImportedTasks(tasks);
                
                // NOTE: disableNotifications removed - ProjectController handles via reactive streams
                this.projectController.syncTasks(tasksWithSortKeys);
                
                this.projectController.updateCalendar(calendar);
                // NOTE: Removed engine sync - ProjectController handles via Worker
                
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
                this.projectController.getTasks(),
                this.projectController.getCalendar(),
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
                this.projectController.getTasks(),
                this.projectController.getCalendar(),
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
        const calendar = this.projectController.getCalendar(); // Get calendar from store
        
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
        
        // NOTE: disableNotifications removed - ProjectController handles via reactive streams
        this.projectController.syncTasks(tasks);
        
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
     * Now routes through ProjectController for unified state management
     */
    undo(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('edit.undo');
    }

    /**
     * Redo last undone action (supports composite actions)
     * Now routes through ProjectController for unified state management
     */
    redo(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('edit.redo');
    }

    // =========================================================================
    // FILE OPERATIONS
    // =========================================================================

    /**
     * Save to file
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async saveToFile(): Promise<void> {
        await this.fileOperationsService!.saveToFile();
    }

    /**
     * Open from file
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async openFromFile(): Promise<void> {
        await this.fileOperationsService!.openFromFile();
    }

    /**
     * Export as download
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    exportAsDownload(): void {
        this.fileOperationsService!.exportAsDownload();
    }

    /**
     * Import from file
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async importFromFile(file: File): Promise<void> {
        await this.fileOperationsService!.importFromFile(file);
    }

    /**
     * Import from MS Project XML
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async importFromMSProjectXML(file: File): Promise<void> {
        await this.fileOperationsService!.importFromMSProjectXML(file);
    }

    /**
     * Import from MS Project XML content (for Tauri native dialog)
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async importFromMSProjectXMLContent(content: string): Promise<void> {
        await this.fileOperationsService!.importFromMSProjectXMLContent(content);
    }

    /**
     * Export to MS Project XML
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    exportToMSProjectXML(): void {
        this.fileOperationsService!.exportToMSProjectXML();
    }

    /**
     * Clear all saved data and start fresh
     * Phase 6 Decomposition: Delegates to FileOperationsService
     */
    async clearAllData(): Promise<void> {
        await this.fileOperationsService!.clearAllData();
    }

    // =========================================================================
    // STATS & UTILITIES
    // =========================================================================

    /**
     * Set view mode
     * @param mode - View mode: 'Day', 'Week', or 'Month'
     * 
     * Phase 3 Decomposition: Delegates to ViewStateService
     */
    setViewMode(mode: ViewMode): void {
        if (!this.viewStateService) {
            console.warn('[SchedulerService] ViewStateService not initialized');
            return;
        }
        this.viewStateService.setViewMode(mode);
        // Keep local copy in sync
        this.viewMode = this.viewStateService.viewMode;
    }

    /**
     * Get the ZoomController instance
     * Allows external code to subscribe to zoom state changes
     */
    getZoomController(): ZoomController | null {
        return this.zoomController;
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
            taskCount: this.projectController.getTasks().length,
            visibleCount: this.projectController.getVisibleTasks((id) => {
                const task = this.projectController.getTaskById(id);
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
        const existingTasks = this.projectController.getTasks();
        const tasks: Task[] = [...existingTasks];
        
        // Pre-generate all sortKeys to avoid stale reads
        const lastKey = this.projectController.getLastSortKey(null);
        const sortKeys = OrderingService.generateBulkKeys(lastKey, null, count);
        
        const calendar = this.projectController.getCalendar();
        
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
        
        this.projectController.syncTasks(tasks);
        // NOTE: ProjectController handles recalc/save via Worker
        
        this.toastService?.success(`Generated ${count} tasks`);
    }

    // =========================================================================
    // TRADE PARTNER OPERATIONS
    // =========================================================================

    /**
     * Get all trade partners
     * 
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    getTradePartners(): TradePartner[] {
        if (this.tradePartnerService) {
            return this.tradePartnerService.getAll();
        }
        return this.tradePartnerStore.getAll();
    }

    /**
     * Get a trade partner by ID
     * 
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    getTradePartner(id: string): TradePartner | undefined {
        if (this.tradePartnerService) {
            return this.tradePartnerService.get(id);
        }
        return this.tradePartnerStore.get(id);
    }

    /**
     * Set scheduling mode for a task
     * 
     * @param taskId - Task ID
     * @param mode - 'Auto' or 'Manual'
     */
    public async setSchedulingMode(taskId: string, mode: 'Auto' | 'Manual'): Promise<void> {
        const task = this.projectController.getTaskById(taskId);
        if (!task) {
            console.warn('[SchedulerService] Task not found:', taskId);
            return;
        }
        
        this.saveCheckpoint();
        
        // Use SchedulingLogicService for scheduling mode changes
        const result = this.schedulingLogicService.applyEdit(taskId, 'schedulingMode', mode, {
            controller: this.projectController,
            calendar: this.projectController.getCalendar(),
        });
        
        if (result.message) {
            switch (result.messageType) {
                case 'success': this.toastService?.success(result.message); break;
                case 'warning': this.toastService?.warning(result.message); break;
                default: this.toastService?.info(result.message);
            }
        }
    }

    /**
     * Toggle scheduling mode between Auto and Manual
     * 
     * @param taskId - Task ID
     */
    public toggleSchedulingMode(taskId: string): void {
        const task = this.projectController.getTaskById(taskId);
        if (!task) return;
        
        const newMode = task.schedulingMode === 'Manual' ? 'Auto' : 'Manual';
        this.setSchedulingMode(taskId, newMode);
    }

    /**
     * Create a new trade partner
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    createTradePartner(data: Omit<TradePartner, 'id'>): TradePartner {
        return this.tradePartnerService!.create(data);
    }

    /**
     * Update a trade partner
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    updateTradePartner(id: string, field: keyof TradePartner, value: unknown): void {
        this.tradePartnerService!.update(id, field, value);
    }

    /**
     * Delete a trade partner
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    deleteTradePartner(id: string): void {
        this.tradePartnerService!.delete(id);
    }

    /**
     * Assign a trade partner to a task
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    assignTradePartner(taskId: string, tradePartnerId: string): void {
        this.tradePartnerService!.assignToTask(taskId, tradePartnerId);
    }

    /**
     * Unassign a trade partner from a task
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    unassignTradePartner(taskId: string, tradePartnerId: string, showToast = true): void {
        this.tradePartnerService!.unassignFromTask(taskId, tradePartnerId, showToast);
    }

    /**
     * Get trade partners for a task
     * Phase 8 Decomposition: Delegates to TradePartnerService
     */
    getTaskTradePartners(taskId: string): TradePartner[] {
        return this.tradePartnerService!.getForTask(taskId);
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
        // Note: Modals are now managed by ModalCoordinator
        if (this.modalCoordinator) this.modalCoordinator.dispose();
    }
}
