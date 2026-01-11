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
import { TestDataGenerator } from '../utils/TestDataGenerator';
// NOTE: TaskStore and CalendarStore removed - all data flows through ProjectController
import { TradePartnerStore, getTradePartnerStore } from '../data/TradePartnerStore';
// NOTE: HistoryManager moved to AppInitializer (application level) - access via ProjectController.getHistoryManager()
import { PersistenceService } from '../data/PersistenceService';
import { DataLoader } from '../data/DataLoader';
import { SnapshotService } from '../data/SnapshotService';
import { ToastService } from '../ui/services/ToastService';
import { FileService } from '../ui/services/FileService';
import { KeyboardService } from '../ui/services/KeyboardService';
import { ProjectController } from './ProjectController';
import { SelectionModel } from './SelectionModel';
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
import { GridNavigationController } from './scheduler/GridNavigationController';
import { DependencyValidationService } from './scheduler/DependencyValidationService';
import { ViewportFactoryService } from './scheduler/ViewportFactoryService';
import { KeyboardBindingService } from './scheduler/KeyboardBindingService';
import { CommandService } from '../commands';
import { SchedulerViewport } from '../ui/components/scheduler/SchedulerViewport';
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
    
    // Zoom controller
    private zoomController: ZoomController | null = null;
    
    // ViewCoordinator for reactive rendering
    private viewCoordinator: ViewCoordinator | null = null;
    
    // Extracted services (initialized in init())
    private taskOperations!: TaskOperationsService;
    private viewStateService!: ViewStateService;
    private contextMenuService!: ContextMenuService;
    private modalCoordinator!: ModalCoordinator;
    private fileOperationsService!: FileOperationsService;
    private baselineService!: BaselineService;
    private tradePartnerService!: TradePartnerService;
    private columnPreferencesService!: ColumnPreferencesService;
    private gridNavigationController!: GridNavigationController;
    private dependencyValidationService!: DependencyValidationService;
    private viewportFactoryService!: ViewportFactoryService;
    private keyboardBindingService!: KeyboardBindingService;
    private testDataGenerator!: TestDataGenerator;

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
        viewCoordinator?: ViewCoordinator;
    } = {} as SchedulerServiceOptions) {
        this.options = options;
        this.isTauri = options.isTauri !== undefined ? options.isTauri : true;
        
        // Initialize core dependencies (use injected or fallback to singletons)
        this.projectController = options.projectController || ProjectController.getInstance();
        this.selectionModel = options.selectionModel || SelectionModel.getInstance();
        this.commandService = options.commandService || CommandService.getInstance();
        this.schedulingLogicService = options.schedulingLogicService || SchedulingLogicService.getInstance();
        this.columnRegistry = options.columnRegistry || ColumnRegistry.getInstance();
        this.editingStateManager = options.editingStateManager || getEditingStateManager();
        
        // Store optional injected services
        if (options.zoomController) this.zoomController = options.zoomController;
        if (options.dataLoader) this.dataLoader = options.dataLoader;
        if (options.snapshotService) this.snapshotService = options.snapshotService;
        if (options.tradePartnerStore) this.tradePartnerStore = options.tradePartnerStore;
        if (options.keyboardService) this.keyboardService = options.keyboardService;
        if (options.viewCoordinator) this.viewCoordinator = options.viewCoordinator;

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
        
        // Pure DI: DataLoader and SnapshotService must be injected - fail fast if not provided
        if (!this.dataLoader || !this.snapshotService) {
            console.warn('[SchedulerService] DataLoader or SnapshotService not injected - some features may be limited');
            console.warn('[SchedulerService] Ensure these services are passed via constructor options in AppInitializer._initializeScheduler()');
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

        // NOTE: Engine initialization removed - all calculations happen in WASM Worker via ProjectController
        // The engine property is kept as null - it's no longer needed
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

        // Initialize ColumnPreferencesService early (before grid exists for header build)
        this.columnPreferencesService = new ColumnPreferencesService({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            columnRegistry: this.columnRegistry,
            toastService: this.toastService,
            getGrid: () => this.grid,
            render: () => this.render(),
            updateSelection: () => this.viewStateService.updateSelection(),
        });
        console.log('[SchedulerService] ✅ ColumnPreferencesService initialized (early - for header build)');

        // GridNavigationController for Excel-style cell navigation
        this.gridNavigationController = new GridNavigationController({
            getVisibleTaskIds: () => {
                return this.projectController.getVisibleTasks((id) => {
                    const task = this.projectController.getTaskById(id);
                    return task?._collapsed || false;
                }).map(t => t.id);
            },
            getNavigableColumns: () => {
                return this._getColumnDefinitions()
                    .filter(col => col.type === 'text' || col.type === 'number' || col.type === 'date' || col.type === 'select' || col.type === 'name' || col.type === 'schedulingMode')
                    .map(col => col.field);
            },
            isEditing: () => this.editingStateManager.isEditing()
        });
        console.log('[SchedulerService] ✅ GridNavigationController initialized');

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
        this.grid = this.viewportFactoryService.createGridFacade(viewport);
        this.gantt = this.viewportFactoryService.createGanttFacade(viewport);
        
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
        
        // Initialize ViewCoordinator for reactive rendering
        if (!this.viewCoordinator) {
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
        
        // Initialize TaskOperationsService
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
            updateHeaderCheckboxState: () => this.viewStateService.updateHeaderCheckboxState(),
        });
        console.log('[SchedulerService] ✅ TaskOperationsService initialized');
        
        // Initialize ViewStateService
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
            onSelectionChange: (selectedIds) => this._handleSelectionChange(selectedIds),
            updateHeaderCheckboxState: (checkbox) => this.columnPreferencesService.updateHeaderCheckboxState(checkbox),
        });
        // Sync initial state from SchedulerService to ViewStateService
        this.viewStateService.viewMode = this.viewMode;
        this.viewStateService.displaySettings.highlightDependenciesOnHover = this.displaySettings.highlightDependenciesOnHover;
        this.viewStateService.displaySettings.drivingPathMode = this.displaySettings.drivingPathMode;
        console.log('[SchedulerService] ✅ ViewStateService initialized');
        
        // Initialize ContextMenuService
        this.contextMenuService = new ContextMenuService({
            insertBlankRowAbove: (taskId) => this.insertBlankRowAbove(taskId),
            insertBlankRowBelow: (taskId) => this.insertBlankRowBelow(taskId),
            convertBlankToTask: (taskId) => this.convertBlankToTask(taskId),
            deleteTask: (taskId) => this.deleteTask(taskId),
            openProperties: (taskId) => this.openProperties(taskId),
        });
        console.log('[SchedulerService] ✅ ContextMenuService initialized');
        
        // Initialize ModalCoordinator
        this.modalCoordinator = new ModalCoordinator({
            projectController: this.projectController,
            selectionModel: this.selectionModel,
            columnRegistry: this.columnRegistry,
            getOpenPanelCallbacks: () => this._openPanelCallbacks,
            onDependenciesSave: (taskId, deps) => this._handleDependenciesSave(taskId, deps),
            onCalendarSave: (calendar) => this._handleCalendarSave(calendar),
            onColumnPreferencesSave: (prefs) => this.updateColumnPreferences(prefs),
            getColumnPreferences: () => this._getColumnPreferences(),
            updateSelection: () => this.viewStateService.updateSelection(),
        });
        // Initialize modals with container
        const modalsContainer = modalContainer || document.body;
        this.modalCoordinator.initialize(modalsContainer);
        console.log('[SchedulerService] ✅ ModalCoordinator initialized');
        
        // Initialize FileOperationsService
        this.fileOperationsService = new FileOperationsService({
            projectController: this.projectController,
            fileService: this.fileService,
            toastService: this.toastService,
            persistenceService: this.persistenceService,
            saveCheckpoint: () => this.saveCheckpoint(),
            saveData: () => this.saveData(),
            recalculateAll: () => this.recalculateAll(),
            storageKey: SchedulerService.STORAGE_KEY,
        });
        console.log('[SchedulerService] ✅ FileOperationsService initialized');
        
        // Initialize BaselineService
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
        
        // Initialize TradePartnerService
        this.tradePartnerService = new TradePartnerService({
            projectController: this.projectController,
            tradePartnerStore: this.tradePartnerStore,
            persistenceService: this.persistenceService,
            toastService: this.toastService,
            viewCoordinator: this.viewCoordinator,
            notifyDataChange: () => this._notifyDataChange(),
        });
        console.log('[SchedulerService] ✅ TradePartnerService initialized');
        
        // Initialize DependencyValidationService
        this.dependencyValidationService = new DependencyValidationService({
            projectController: this.projectController,
        });
        console.log('[SchedulerService] ✅ DependencyValidationService initialized');
        
        // Initialize ViewportFactoryService
        this.viewportFactoryService = new ViewportFactoryService({});
        console.log('[SchedulerService] ✅ ViewportFactoryService initialized');
        
        // Initialize KeyboardBindingService
        this.keyboardBindingService = new KeyboardBindingService({
            actions: {
                isAppReady: () => this.isInitialized,
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
            },
            KeyboardServiceClass: KeyboardService,
        });
        console.log('[SchedulerService] ✅ KeyboardBindingService initialized');
        
        // Initialize TestDataGenerator
        this.testDataGenerator = new TestDataGenerator({
            projectController: this.projectController,
            toastService: this.toastService,
        });
        console.log('[SchedulerService] ✅ TestDataGenerator initialized');
        
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
        // since row clicks internally trigger _handleSelectionChange via viewStateService.updateSelection().
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
        
        this.keyboardService = this.keyboardBindingService.initialize();
        
        console.log('[SchedulerService] ✅ Keyboard shortcuts initialized');
    }

    /**
     * Get column definitions for the grid
     * @returns Column definitions
     */
    getColumnDefinitions(): GridColumn[] {
        return this._getColumnDefinitions();
    }

    /** Get whether dependency highlighting on hover is enabled */
    getHighlightDependenciesOnHover(): boolean {
        return this.viewStateService.getHighlightDependenciesOnHover();
    }

    /** Set whether dependency highlighting on hover is enabled */
    setHighlightDependenciesOnHover(enabled: boolean): void {
        this.viewStateService.setHighlightDependenciesOnHover(enabled);
    }

    /** Toggle driving path mode */
    toggleDrivingPathMode(): void {
        this.viewStateService.toggleDrivingPathMode();
    }

    /** Get column definitions with preferences applied */
    private _getColumnDefinitions(): GridColumn[] {
        return this.columnPreferencesService.getColumnDefinitions();
    }

    /** Get column preferences from localStorage */
    private _getColumnPreferences(): ColumnPreferences {
        return this.columnPreferencesService.getPreferences();
    }

    /** Update column preferences and rebuild grid */
    updateColumnPreferences(preferences: ColumnPreferences): void {
        this.columnPreferencesService.updatePreferences(preferences);
    }

    /** Build the grid header dynamically from column definitions */
    private _buildGridHeader(): void {
        this.columnPreferencesService.buildGridHeader();
    }

    /** Initialize CSS variables for column widths from column definitions */
    private _initializeColumnCSSVariables(): void {
        this.columnPreferencesService.initializeColumnCSSVariables();
    }

    // =========================================================================
    // BASELINE MANAGEMENT
    // =========================================================================

    /** Check if baseline has been set for any task */
    hasBaseline(): boolean {
        return this.baselineService.hasBaseline();
    }

    /** Set baseline from current schedule */
    setBaseline(): void {
        this.baselineService.setBaseline();
    }

    /** Clear baseline data from all tasks */
    clearBaseline(): void {
        this.baselineService.clearBaseline();
    }

    /** Calculate variance for a task */
    calculateVariance(task: Task): { start: number | null; finish: number | null } {
        return this.baselineService.calculateVariance(task);
    }

    /** Rebuild grid columns when baseline state changes */
    private _rebuildGridColumns(): void {
        this.columnPreferencesService.rebuildGridColumns();
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
        this.viewStateService.updateSelection();
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

    /** Handle Enter key pressed on the last task - creates sibling task */
    private _handleEnterLastRow(lastTaskId: string, field: string): void {
        this.taskOperations.handleEnterLastRow(lastTaskId, field);
    }

    /** Handle trade partner chip click */
    private _handleTradePartnerClick(taskId: string, tradePartnerId: string, e: MouseEvent): void {
        this.tradePartnerService.handleClick(taskId, tradePartnerId, e);
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
        const validation = this.dependencyValidationService.validate(taskId, dependencies);
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
     */
    private _handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void {
        this.taskOperations.handleRowMove(taskIds, targetId, position);
    }

    /** Handle bar drag in Gantt */
    private _handleBarDrag(task: Task, start: string, end: string): void {
        this.saveCheckpoint();
        const calendar = this.projectController.getCalendar();
        const duration = DateUtils.calcWorkDays(start, end, calendar);
        this.projectController.updateTask(task.id, { start, end, duration });
    }

    // =========================================================================
    // KEYBOARD HANDLERS
    // =========================================================================

    /** Handle arrow cell navigation (Excel-style) using GridNavigationController */
    private _handleCellNavigation(direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean): void {
        
        // Sync controller position with current selection
        const focusedId = this.selectionModel.getFocusedId();
        const focusedField = this.selectionModel.getFocusedField();
        if (focusedId && focusedField) {
            this.gridNavigationController.setPosition(focusedId, focusedField);
        }
        
        // Navigate using controller
        if (shiftKey && (direction === 'up' || direction === 'down')) {
            // Range selection with Shift+Arrow
            const rangeResult = this.gridNavigationController.navigateWithRange(
                direction, 
                this.selectionModel.getAnchorId()
            );
            if (!rangeResult) return;
            
            const { result, rangeTaskIds } = rangeResult;
            this.selectionModel.setSelection(new Set(rangeTaskIds), result.taskId, rangeTaskIds);
            this.selectionModel.setFocus(result.taskId, result.field);
        } else {
            // Single navigation
            const result = this.gridNavigationController.navigate(direction);
            if (!result) return;
            
            // For up/down, update selection; for left/right, just move focus
            if (direction === 'up' || direction === 'down') {
                this.selectionModel.setSelection(new Set([result.taskId]), result.taskId, [result.taskId]);
            }
            this.selectionModel.setFocus(result.taskId, result.field);
        }
        
        // Update UI
        this.viewStateService.updateSelection();
        
        const currentCell = this.gridNavigationController.getCurrentCell();
        if (currentCell && this.grid) {
            this.grid.scrollToTask(currentCell.taskId);
            this.grid.highlightCell(currentCell.taskId, currentCell.field);
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



    /** Handle Tab indent */
    private _handleTabIndent(): void {
        this.viewStateService.handleTabIndent();
    }

    /** Handle Shift+Tab outdent */
    private _handleTabOutdent(): void {
        this.viewStateService.handleTabOutdent();
    }

    /** Handle Escape key */
    private _handleEscape(): void {
        this.viewStateService.handleEscape();
        this.viewStateService.updateSelection();
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

    /** Add a new task */
    addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
        return this.taskOperations.addTask(taskData);
    }

    /** Delete a task and its children */
    deleteTask(taskId: string): void {
        this.taskOperations.deleteTask(taskId);
    }

    /** Delete selected tasks */
    private _deleteSelected(): void {
        this.commandService.execute('task.delete');
    }

    /** Toggle collapse state */
    toggleCollapse(taskId: string): void {
        this.taskOperations.toggleCollapse(taskId);
    }

    /** Indent a task (make it a child of previous sibling) */
    indent(taskId: string): void {
        this.taskOperations.indent(taskId);
    }

    /** Outdent a task (move to parent's level) */
    outdent(taskId: string): void {
        this.taskOperations.outdent(taskId);
    }

    /** Show context menu for a row */
    private _showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, event: MouseEvent): void {
        this.contextMenuService.showRowContextMenu(taskId, isBlank, anchorEl, event);
    }

    /** Insert blank row above a task */
    insertBlankRowAbove(taskId: string): void {
        this.taskOperations.insertBlankRowAbove(taskId);
    }

    /** Insert blank row below a task */
    insertBlankRowBelow(taskId: string): void {
        this.taskOperations.insertBlankRowBelow(taskId);
    }

    /** Wake up a blank row (convert to task and enter edit mode) */
    wakeUpBlankRow(taskId: string): void {
        this.taskOperations.wakeUpBlankRow(taskId);
    }

    /** Convert a blank row to a task */
    convertBlankToTask(taskId: string): void {
        this.taskOperations.convertBlankToTask(taskId);
    }

    /** Open properties panel for a task */
    openProperties(taskId: string): void {
        this.modalCoordinator.openProperties(taskId);
    }

    /** Indent all selected tasks */
    indentSelected(): void {
        this.taskOperations.indentSelected();
    }

    /** Outdent all selected tasks */
    outdentSelected(): void {
        this.taskOperations.outdentSelected();
    }

    /** Delete all selected tasks (shows confirmation for multiple/parent tasks) */
    async deleteSelected(): Promise<void> {
        return this.taskOperations.deleteSelected();
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
        this.commandService.execute('task.insertBelow');
    }

    /** Add a new task as a CHILD of the currently focused task */
    addChildTask(): void {
        this.commandService.execute('task.addChild');
    }

    /** Move the focused task up/down (before/after sibling) */
    moveSelectedTasks(direction: number): void {
        this.taskOperations.moveSelectedTasks(direction);
    }
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
                this.viewStateService.updateSelection();
            }
        }
    }

    /** Enter edit mode for the currently highlighted cell */
    enterEditMode(): void {
        this.viewStateService.enterEditMode();
    }

    /** Called when cell editing ends */
    exitEditMode(): void {
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

    /** Open drawer for a task */
    openDrawer(taskId: string): void {
        this.modalCoordinator.openDrawer(taskId);
    }

    /** Close drawer */
    closeDrawer(): void {
        this.modalCoordinator.closeDrawer();
    }

    /** Open dependencies modal or panel */
    openDependencies(taskId: string): void {
        this.modalCoordinator.openDependencies(taskId);
    }

    /** Open calendar modal */
    openCalendar(): void {
        this.modalCoordinator.openCalendar();
    }

    /** Open column settings modal */
    openColumnSettings(): void {
        this.modalCoordinator.openColumnSettings();
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

    /** Render all views (delegates to ViewCoordinator) */
    render(): void {
        if (this.viewCoordinator) {
            this.viewCoordinator.forceUpdate();
        } else {
            console.error('[SchedulerService] CRITICAL: ViewCoordinator is null during render()');
        }
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
                // Use FileOperationsService for sort key migration (single source of truth)
                const tasksWithSortKeys = this.fileOperationsService.assignSortKeysToImportedTasks(tasks);
                
                // NOTE: disableNotifications removed - ProjectController handles via reactive streams
                this.projectController.syncTasks(tasksWithSortKeys);
                
                this.projectController.updateCalendar(calendar);
                // NOTE: Removed engine sync - ProjectController handles via Worker
                
                this.recalculateAll();
                console.log('[SchedulerService] ✅ Loaded from SQLite:', tasks.length, 'tasks');
            } else {
                console.log('[SchedulerService] No saved data found - creating sample data');
                // P2a: Use FileOperationsService for sample data creation
                this.fileOperationsService.createSampleData();
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

    /** Save to file */
    async saveToFile(): Promise<void> {
        await this.fileOperationsService.saveToFile();
    }

    /** Open from file */
    async openFromFile(): Promise<void> {
        await this.fileOperationsService.openFromFile();
    }

    /** Export as download */
    exportAsDownload(): void {
        this.fileOperationsService.exportAsDownload();
    }

    /** Import from file */
    async importFromFile(file: File): Promise<void> {
        await this.fileOperationsService.importFromFile(file);
    }

    /** Import from MS Project XML */
    async importFromMSProjectXML(file: File): Promise<void> {
        await this.fileOperationsService.importFromMSProjectXML(file);
    }

    /** Import from MS Project XML content (for Tauri native dialog) */
    async importFromMSProjectXMLContent(content: string): Promise<void> {
        await this.fileOperationsService.importFromMSProjectXMLContent(content);
    }

    /** Export to MS Project XML */
    exportToMSProjectXML(): void {
        this.fileOperationsService.exportToMSProjectXML();
    }

    /** Clear all saved data and start fresh */
    async clearAllData(): Promise<void> {
        await this.fileOperationsService.clearAllData();
    }

    // =========================================================================
    // STATS & UTILITIES
    // =========================================================================

    /** Set view mode (Day, Week, or Month) */
    setViewMode(mode: ViewMode): void {
        this.viewStateService.setViewMode(mode);
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
     * Delegates to TestDataGenerator utility
     * @param count - Number of tasks to generate
     */
    generateMockTasks(count: number): void {
        this.saveCheckpoint();
        this.testDataGenerator.generateMockTasks(count);
    }

    // =========================================================================
    // TRADE PARTNER OPERATIONS
    // =========================================================================

    /** Get all trade partners */
    getTradePartners(): TradePartner[] {
        return this.tradePartnerService.getAll();
    }

    /** Get a trade partner by ID */
    getTradePartner(id: string): TradePartner | undefined {
        return this.tradePartnerService.get(id);
    }

    /** Set scheduling mode for a task */
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

    /** Create a new trade partner */
    createTradePartner(data: Omit<TradePartner, 'id'>): TradePartner {
        return this.tradePartnerService.create(data);
    }

    /** Update a trade partner */
    updateTradePartner(id: string, field: keyof TradePartner, value: unknown): void {
        this.tradePartnerService.update(id, field, value);
    }

    /** Delete a trade partner */
    deleteTradePartner(id: string): void {
        this.tradePartnerService.delete(id);
    }

    /** Assign a trade partner to a task */
    assignTradePartner(taskId: string, tradePartnerId: string): void {
        this.tradePartnerService.assignToTask(taskId, tradePartnerId);
    }

    /** Unassign a trade partner from a task */
    unassignTradePartner(taskId: string, tradePartnerId: string, showToast = true): void {
        this.tradePartnerService.unassignFromTask(taskId, tradePartnerId, showToast);
    }

    /** Get trade partners for a task */
    getTaskTradePartners(taskId: string): TradePartner[] {
        return this.tradePartnerService.getForTask(taskId);
    }

    /** Cleanup on destroy */
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
