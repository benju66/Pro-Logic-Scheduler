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
import { ColumnRegistry } from '../core/columns';
import { calculateVariance as calculateVarianceFn } from '../core/calculations';
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
import { getEditingStateManager, type EditingStateChangeEvent } from './EditingStateManager';
import { ZoomController, type IZoomableGantt, ZOOM_CONFIG } from './ZoomController';
import { SchedulingLogicService } from './migration/SchedulingLogicService';
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
    Dependency
} from '../types';

/**
 * Feature flag for legacy recalculation behavior.
 * 
 * When TRUE (legacy): Manual recalculateAll() and render() calls are executed.
 * When FALSE (new):   Reactive architecture - Worker calculates, tasks$ emits, UI auto-renders.
 * 
 * Set to false to use new reactive architecture.
 * Set to true to revert to legacy double-calculation if issues arise.
 * 
 * @see docs/PHASE1_ARCHITECTURAL_OPTIMIZATION.md
 */
const ENABLE_LEGACY_RECALC = false;  // Phase 4: Testing new reactive architecture

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
    
    /** RendererFactory - creates GridRenderer/GanttRenderer with captured deps */
    private rendererFactory: RendererFactory | null = null;
    
    /** SchedulingLogicService - scheduling business logic */
    private schedulingLogicService: SchedulingLogicService;
    
    /** ColumnRegistry - column definitions and renderer types */
    private columnRegistry: ColumnRegistry;

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

    // UI components (initialized in init())
    public grid: VirtualScrollGridFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    public gantt: CanvasGanttFacade | null = null;  // Public for access from AppInitializer and UIEventManager
    private drawer: SideDrawer | null = null;
    private dependenciesModal: DependenciesModal | null = null;
    private calendarModal: CalendarModal | null = null;
    private columnSettingsModal: ColumnSettingsModal | null = null;

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
    
    // Clipboard state
    private clipboard: Task[] | null = null;              // Array of cloned tasks
    private clipboardIsCut: boolean = false;              // True if cut operation
    private clipboardOriginalIds: string[] = [];          // Original IDs for deletion after cut-paste

    // Performance tracking
    private _lastCalcTime: number = 0;
    private _renderScheduled: boolean = false;

    // Operation queue for serializing task operations
    private operationQueue: OperationQueue = new OperationQueue();

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
        this.rendererFactory = options.rendererFactory || null;
        this.schedulingLogicService = options.schedulingLogicService || SchedulingLogicService.getInstance();
        this.columnRegistry = ColumnRegistry.getInstance(); // Cache for internal use
        
        // KeyboardService is injected or created in initKeyboard()
        if (options.keyboardService) {
            this.keyboardService = options.keyboardService;
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
        // STRANGLER FIG: PersistenceService, DataLoader, SnapshotService
        // are now initialized by AppInitializer and accessed via singleton.
        // This prevents duplicate initialization and double snapshot timers.
        
        const appInitializer = AppInitializer.getInstance();
        const controller = this.projectController;
        
        // Get reference to shared PersistenceService
        if (controller.hasPersistenceService()) {
            this.persistenceService = controller.getPersistenceService();
            console.log('[SchedulerService] Using shared PersistenceService from AppInitializer');
        } else {
            console.warn('[SchedulerService] PersistenceService not available - trade partner events will not be persisted');
        }
        
        // Get references to shared DataLoader and SnapshotService
        if (appInitializer) {
            this.dataLoader = appInitializer.getDataLoader();
            this.snapshotService = appInitializer.getSnapshotService();
            console.log('[SchedulerService] Using shared DataLoader and SnapshotService from AppInitializer');
        } else {
            console.warn('[SchedulerService] AppInitializer not available - some features may be limited');
        }

        // Initialize stores (TradePartnerStore only - TaskStore/CalendarStore removed)
        // NOTE: Task and calendar data now flows through ProjectController
        this.tradePartnerStore = getTradePartnerStore();
        
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
        
        // Initialize ZoomController with the GanttRenderer
        // Note: ganttRenderer is exposed on the viewport for this purpose
        this.zoomController = ZoomController.getInstance();
        const ganttRenderer = (viewport as any).ganttRenderer as IZoomableGantt | null;
        if (ganttRenderer) {
            this.zoomController.setGanttRenderer(ganttRenderer);
        }

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
            getTasks: () => this.projectController.getTasks(),
            isParent: (id) => this.projectController.isParent(id),
            onSave: (taskId, deps) => this._handleDependenciesSave(taskId, deps),
        });

        this.calendarModal = new CalendarModal({
            container: modalsContainer,
            onSave: (calendar) => this._handleCalendarSave(calendar),
        });

        this.columnSettingsModal = new ColumnSettingsModal({
            container: modalsContainer,
            onSave: (preferences) => this.updateColumnPreferences(preferences),
            getColumns: () => this.columnRegistry.getGridColumns(),
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
     */
    getHighlightDependenciesOnHover(): boolean {
        return this.displaySettings.highlightDependenciesOnHover;
    }

    /**
     * Set whether dependency highlighting on hover is enabled
     * @param enabled - True to enable highlighting
     */
    setHighlightDependenciesOnHover(enabled: boolean): void {
        this.displaySettings.highlightDependenciesOnHover = enabled;
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
     * Get column definitions with preferences applied
     * STRANGLER FIG: Now uses ColumnRegistry instead of inline definitions
     * @private
     */
    private _getColumnDefinitions(): GridColumn[] {
        const registry = this.columnRegistry;
        const prefs = this._getColumnPreferences();
        return registry.getGridColumns(prefs);
    }

    // STRANGLER FIG: _getBaseColumnDefinitions() REMOVED (~320 lines) - now uses ColumnRegistry
    // STRANGLER FIG: _applyColumnPreferences() REMOVED (~50 lines) - handled by ColumnRegistry.getGridColumns()

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
     * STRANGLER FIG: Now uses ColumnRegistry
     * @private
     */
    private _getDefaultColumnPreferences(): ColumnPreferences {
        return this.columnRegistry.getDefaultPreferences();
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
        
        // STRANGLER FIG: Sync baseline column visibility with registry
        if (hasBaselineData) {
            const registry = this.columnRegistry;
            const baselineColumnIds = ['baselineStart', 'actualStart', 'startVariance', 'baselineFinish', 'actualFinish', 'finishVariance'];
            registry.setColumnsVisibility(baselineColumnIds, true);
        }
        
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
        
        // STRANGLER FIG: Set baseline column visibility via ColumnRegistry
        const registry = this.columnRegistry;
        const baselineColumnIds = ['baselineStart', 'actualStart', 'startVariance', 'baselineFinish', 'actualFinish', 'finishVariance'];
        registry.setColumnsVisibility(baselineColumnIds, this._hasBaseline);
        
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
        
        // STRANGLER FIG: Hide baseline columns via ColumnRegistry
        const registry = this.columnRegistry;
        const baselineColumnIds = ['baselineStart', 'actualStart', 'startVariance', 'baselineFinish', 'actualFinish', 'finishVariance'];
        registry.setColumnsVisibility(baselineColumnIds, false);
        
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
     * 
     * @see src/core/calculations/VarianceCalculator.ts for the extracted implementation
     */
    private _calculateVariance(task: Task): { start: number | null; finish: number | null } {
        // Delegated to standalone module for Pure DI compatibility
        // See: docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md - Phase 0
        return calculateVarianceFn(task, this.calendar);
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
        return this.projectController.getTasks();
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
     * @private
     * @param lastTaskId - The ID of the last task (where Enter was pressed)
     * @param field - The field that was being edited (to focus same field in new task)
     */
    private _handleEnterLastRow(lastTaskId: string, field: string): void {
        // Get the last task to determine its parent (new task will be a sibling)
        const lastTask = this.projectController.getTaskById(lastTaskId);
        if (!lastTask) return;
        
        // Create new task with same parent as the last task (making it a sibling)
        // Use addTask which already handles:
        // - Generating sortKey (appends to end of siblings)
        // - Setting focusCell: true
        // - Selecting the new task
        // - Scrolling to it
        
        // We need to temporarily set focusedId so addTask creates sibling at correct level
        this.selectionModel.setFocus(lastTaskId);
        
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
    private _handleTradePartnerClick(_taskId: string, tradePartnerId: string, e: MouseEvent): void {
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
        const targetTask = this.projectController.getTaskById(targetId);
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
            .map(id => this.projectController.getTaskById(id))
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
            this.projectController.getChildren(task.id).forEach(child => {
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
            const parent = this.projectController.getTaskById(checkParent);
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
            const existingChildren = this.projectController.getChildren(targetId);
            beforeKey = existingChildren.length > 0 
                ? existingChildren[existingChildren.length - 1].sortKey ?? null 
                : null;
            afterKey = null;
            
            // If target was collapsed, expand it to show the newly added children
            if (targetTask._collapsed) {
                this.projectController.updateTask(targetId, { _collapsed: false });
            }
            
        } else if (position === 'before') {
            // =====================================================================
            // BEFORE POSITION: Insert before target (same parent level)
            // =====================================================================
            newParentId = targetTask.parentId ?? null;
            
            // Get siblings at target's level
            const siblings = this.projectController.getChildren(newParentId);
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
            const siblings = this.projectController.getChildren(newParentId);
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
            this.projectController.updateTask(task.id, {
                parentId: newParentId,
                sortKey: sortKeys[index]
            });
        });
        
        // NOTE: Descendants keep their parentId unchanged (they stay as children of their original parent)
        // They will automatically move with their parent because the hierarchy is preserved
        
        // NOTE: ProjectController handles recalc/save via Worker
        
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
        const editingManager = getEditingStateManager();
        
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
     */
    private _handleTabIndent(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('hierarchy.indent');
    }

    /**
     * Handle Shift+Tab outdent
     * @private
     */
    private _handleTabOutdent(): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('hierarchy.outdent');
    }

    /**
     * Handle Escape key
     * @private
     */
    private _handleEscape(): void {
        // First check if drawer is open (UI-specific, not in command)
        if (this.drawer && this.drawer.isDrawerOpen()) {
            this.drawer.close();
            return;
        }
        
        // PHASE 2: Delegate to CommandService for cut cancel / selection clear
        this.commandService.execute('selection.escape');
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
     */
    addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
        if (!this.isInitialized) {
            return Promise.resolve(undefined);
        }
        
        const controller = this.projectController;
        
        return this.operationQueue.enqueue(async () => {
            this.saveCheckpoint();
            
            // Determine parent
            let parentId: string | null = taskData.parentId ?? null;
            const currentFocusedId = this.selectionModel.getFocusedId();
            if (currentFocusedId && taskData.parentId === undefined) {
                const focusedTask = controller.getTaskById(currentFocusedId);
                if (focusedTask) {
                    parentId = focusedTask.parentId ?? null;
                }
            }
            
            // Generate sort key (now guaranteed to see latest state)
            const lastSortKey = controller.getLastSortKey(parentId);
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
            
            // Fire-and-forget to ProjectController (handles optimistic update + worker + persistence)
            controller.addTask(task);
            
            // Update UI state
            this.selectionModel.setSelection(new Set([task.id]), task.id, [task.id]);
            
            // Pass focusCell: true to focus the name input for immediate editing
            if (this.grid) {
                this.grid.setSelection(this.selectedIds, this.selectionModel.getFocusedId(), { focusCell: true, focusField: 'name' });
            }
            if (this.gantt) {
                this.gantt.setSelection(this.selectedIds);
            }
            this._updateHeaderCheckboxState();
            
            // NOTE: Removed recalculateAll(), engine sync, saveData(), render()
            // ProjectController handles these via Worker + optimistic updates
            // SchedulerViewport subscribes to controller.tasks$ and auto-renders
            
            this.toastService?.success('Task added');
            return task;
        });
    }

    /**
     * Delete a task and its children
     */
    deleteTask(taskId: string): void {
        const editingManager = getEditingStateManager();
        const controller = this.projectController;
        
        if (editingManager.isEditingTask(taskId)) {
            editingManager.exitEditMode('task-deleted');
        }
        
        // Fire-and-forget to ProjectController (handles optimistic update + worker + persistence)
        // ProjectController.deleteTask() also handles descendants
        controller.deleteTask(taskId);
        
        // Update UI state
        this.selectionModel.removeFromSelection([taskId]);
        if (this.selectionModel.getFocusedId() === taskId) {
            this.selectionModel.setFocus(null);
        }

        // NOTE: Removed recalculateAll(), engine sync, saveData(), render()
        // ProjectController handles these via Worker + optimistic updates
        // SchedulerViewport subscribes to controller.tasks$ and auto-renders
        
        this.toastService.success('Task deleted');
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
     * @param taskId - Task ID
     */
    toggleCollapse(taskId: string): void {
        // PHASE 2: Delegate to CommandService
        this.commandService.execute('view.toggleCollapse', { args: { taskId } });
    }

    /**
     * Indent a task (make it a child of previous sibling)
     */
    indent(taskId: string): void {
        const controller = this.projectController;
        const task = controller.getTaskById(taskId);
        if (!task) return;

        const list = controller.getVisibleTasks((id) => {
            const t = controller.getTaskById(id);
            return t?._collapsed || false;
        });
        
        const idx = list.findIndex(t => t.id === taskId);
        if (idx <= 0) return;
        
        const prev = list[idx - 1];
        const taskDepth = controller.getDepth(taskId);
        const prevDepth = controller.getDepth(prev.id);
        
        if (prevDepth < taskDepth) return;
        
        let newParentId: string | null = null;
        
        if (prevDepth === taskDepth) {
            newParentId = prev.id;
        } else {
            let curr: Task | undefined = prev;
            while (curr && controller.getDepth(curr.id) > taskDepth) {
                curr = curr.parentId ? controller.getTaskById(curr.parentId) : undefined;
            }
            if (curr) {
                newParentId = curr.id;
            }
        }
        
        if (newParentId !== null) {
            // Generate new sort key for new parent's children
            const newSortKey = OrderingService.generateAppendKey(
                controller.getLastSortKey(newParentId)
            );
            
            // Fire-and-forget to ProjectController
            controller.moveTask(taskId, newParentId, newSortKey);
            
            // NOTE: Removed recalculateAll(), saveData(), render()
        }
    }

    /**
     * Outdent a task (move to parent's level)
     */
    outdent(taskId: string): void {
        const controller = this.projectController;
        const task = controller.getTaskById(taskId);
        if (!task || !task.parentId) return;

        const parent = controller.getTaskById(task.parentId);
        const newParentId = parent ? parent.parentId : null;
        
        // Generate sort key to insert after former parent
        const siblings = controller.getChildren(newParentId);
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
                controller.getLastSortKey(newParentId)
            );
        }
        
        // Fire-and-forget to ProjectController
        controller.moveTask(taskId, newParentId, newSortKey);
        
        // NOTE: Removed recalculateAll(), saveData(), render()
    }

    /**
     * Context menu instance (singleton)
     * @private
     */
    private _contextMenu: ContextMenu | null = null;

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
    private _showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, _event: MouseEvent): void {
        const menu = this._getContextMenu();
        
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
        
        items.push({
            id: 'delete',
            label: 'Delete Row',
            icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>`,
            danger: true,
        });
        
        items.push({ id: 'divider-3', type: 'divider' });
        
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
        const controller = this.projectController;
        const task = controller.getTaskById(taskId);
        if (!task) return;
        
        this.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = controller.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = taskIndex > 0 ? siblings[taskIndex - 1].sortKey : null;
        const afterKey = task.sortKey;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        // Fire-and-forget to ProjectController
        const blankRow = controller.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        this.selectionModel.setSelection(new Set([blankRow.id]), blankRow.id, [blankRow.id]);
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
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
        const controller = this.projectController;
        const task = controller.getTaskById(taskId);
        if (!task) return;
        
        this.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = controller.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = task.sortKey;
        const afterKey = taskIndex < siblings.length - 1 ? siblings[taskIndex + 1].sortKey : null;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        // Fire-and-forget to ProjectController
        const blankRow = controller.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        this.selectionModel.setSelection(new Set([blankRow.id]), blankRow.id, [blankRow.id]);
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
        // Scroll to and highlight the new row
        if (this.grid) {
            this.grid.scrollToTask(blankRow.id);
            this.grid.highlightCell(blankRow.id, 'name');
        }
    }

    /**
     * Wake up a blank row (convert to task and enter edit mode)
     * Called when user double-clicks a blank row
     */
    wakeUpBlankRow(taskId: string): void {
        const controller = this.projectController;
        const task = controller.getTaskById(taskId);
        if (!task || !controller.isBlankRow(taskId)) {
            return;
        }
        
        this.saveCheckpoint();
        
        // Fire-and-forget to ProjectController
        const wokenTask = controller.wakeUpBlankRow(taskId);
        if (!wokenTask) return;
        
        // Update selection state
        this.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
        this.selectionModel.setFocus(taskId, 'name');
        
        // NOTE: Removed recalculateAll(), render() - ProjectController handles via Worker
        
        // Wait for the next paint frame before focusing (allows reactive update to propagate)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.enterEditMode();
            });
        });
    }

    /**
     * Convert a blank row to a task
     */
    convertBlankToTask(taskId: string): void {
        const controller = this.projectController;
        
        if (!controller.isBlankRow(taskId)) {
            this.toastService?.error('Only blank rows can be converted');
            return;
        }
        
        this.saveCheckpoint();
        
        // Fire-and-forget to ProjectController
        const task = controller.wakeUpBlankRow(taskId, 'New Task');
        if (!task) return;
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
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
        this._openPanelCallbacks.forEach(cb => {
            try {
                cb('details');
            } catch (e) {
                console.error('[SchedulerService] Panel open callback error:', e);
            }
        });
        
        // Ensure task is selected
        this.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
        this._updateSelection();
    }

    /**
     * Indent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    indentSelected(): void {
        if (this.selectionModel.getSelectionCount() === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectionModel.getSelectedIds());
        
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
            const taskDepth = this.projectController.getDepth(task.id);
            const prevDepth = this.projectController.getDepth(prev.id);
            
            // Can only indent if prev is at same or higher depth
            if (prevDepth < taskDepth) continue;
            
            let newParentId: string | null = null;
            if (prevDepth === taskDepth) {
                newParentId = prev.id;
            } else {
                let curr: Task | undefined = prev;
                while (curr && this.projectController.getDepth(curr.id) > taskDepth) {
                    curr = curr.parentId ? this.projectController.getTaskById(curr.parentId) : undefined;
                }
                if (curr) newParentId = curr.id;
            }
            
            if (newParentId !== null) {
                const newSortKey = OrderingService.generateAppendKey(
                    this.projectController.getLastSortKey(newParentId)
                );
                this.projectController.moveTask(task.id, newParentId, newSortKey);
                indentedCount++;
            }
        }
        
        if (indentedCount > 0) {
            // NOTE: ProjectController handles recalc/save via Worker
            this.toastService?.success(`Indented ${indentedCount} task${indentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Outdent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    outdentSelected(): void {
        if (this.selectionModel.getSelectionCount() === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        this.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(this.selectionModel.getSelectedIds());
        const allTasks = this.projectController.getTasks();
        
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
            const auntsUncles = this.projectController.getChildren(grandparentId);
            const formerParentIndex = auntsUncles.findIndex(t => t.id === currentParent?.id);
            
            const beforeKey = currentParent?.sortKey ?? null;
            const afterKey = formerParentIndex < auntsUncles.length - 1
                ? auntsUncles[formerParentIndex + 1].sortKey
                : null;
            
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            this.projectController.updateTask(task.id, {
                parentId: grandparentId,
                sortKey: newSortKey
            });
            outdentedCount++;
        }
        
        if (outdentedCount > 0) {
            // NOTE: ProjectController handles recalc/save via Worker
            this.toastService?.success(`Outdented ${outdentedCount} task${outdentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Delete all selected tasks
     * Shows confirmation for multiple tasks or parent tasks
     */
    async deleteSelected(): Promise<void> {
        if (this.selectionModel.getSelectionCount() === 0) {
            this.toastService?.info('No tasks selected');
            return;
        }
        
        const selectedCount = this.selectionModel.getSelectionCount();
        const selectedArray = this.selectionModel.getSelectedIds();
        const hasParents = selectedArray.some(id => this.projectController.isParent(id));
        
        // Confirm for multiple tasks or parent tasks
        if (selectedCount > 1 || hasParents) {
            const childCount = hasParents
                ? selectedArray.reduce((sum, id) => 
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
        const idsToDelete = this.selectionModel.getSelectedIds();
        
        for (const taskId of idsToDelete) {
            if (editingManager.isEditingTask(taskId)) {
                editingManager.exitEditMode('task-deleted');
            }
            this.projectController.deleteTask(taskId);
            this.selectionModel.removeFromSelection([taskId]);
            // NOTE: Removed engine sync - ProjectController handles via Worker
        }
        
        const currentFocusedId = this.selectionModel.getFocusedId();
        if (currentFocusedId && idsToDelete.includes(currentFocusedId)) {
            this.selectionModel.setFocus(null);
        }
        
        // NOTE: ProjectController handles recalc/save via Worker
        
        this.toastService?.success(`Deleted ${idsToDelete.length} task${idsToDelete.length > 1 ? 's' : ''}`);
    }

    /**
     * Simple confirmation dialog
     * @private
     */
    private _confirmAction(message: string, _actionLabel: string): Promise<boolean> {
        return new Promise(resolve => {
            // For now, use browser confirm - can be replaced with custom modal
            const result = confirm(message);
            resolve(result);
        });
    }

    /**
     * Get flat list of visible tasks
     * @private
     */
    private _getFlatList(): Task[] {
        return this.projectController.getVisibleTasks((id) => {
            const t = this.projectController.getTaskById(id);
            return t?._collapsed || false;
        });
    }

    /**
     * Get all descendants of a task
     * @private
     */
    private _getAllDescendants(taskId: string): Set<string> {
        const descendants = new Set<string>();
        const collect = (id: string) => {
            const children = this.projectController.getChildren(id);
            for (const child of children) {
                descendants.add(child.id);
                collect(child.id);
            }
        };
        collect(taskId);
        return descendants;
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
     */
    moveSelectedTasks(direction: number): void {
        // PHASE 2: Delegate to CommandService
        if (direction === -1) {
            this.commandService.execute('hierarchy.moveUp');
        } else {
            this.commandService.execute('hierarchy.moveDown');
        }
        
        // Keep focus on moved task
        if (this.grid) {
            const currentFocusedId = this.selectionModel.getFocusedId();
            if (currentFocusedId) {
                requestAnimationFrame(() => {
                    this.grid!.scrollToTask(currentFocusedId);
                });
            }
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
     */
    enterEditMode(): void {
        const focusedId = this.selectionModel.getFocusedId();
        const focusedColumn = this.selectionModel.getFocusedField();
        if (!focusedId || !focusedColumn) return;
        
        const editingManager = getEditingStateManager();
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
        const visibleTasks = this.projectController.getVisibleTasks((id) => {
            const task = this.projectController.getTaskById(id);
            return task?._collapsed || false;
        });

        if (visibleTasks.length === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            return;
        }

        // Count how many visible tasks are selected
        const selectedCount = visibleTasks.filter(t => this.selectionModel.isSelected(t.id)).length;

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
        const visibleTasks = this.projectController.getVisibleTasks((id) => {
            const task = this.projectController.getTaskById(id);
            return task?._collapsed || false;
        });

        if (checkbox.checked) {
            // Select all visible tasks
            visibleTasks.forEach(task => {
                this.selectionModel.addToSelection([task.id]);
            });
        } else {
            // Deselect all visible tasks
            visibleTasks.forEach(task => {
                this.selectionModel.removeFromSelection([task.id]);
            });
        }

        // Update selection state
        this._updateSelection();
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
     * Called by double-click handlers to explicitly open the panel
     * Now uses callback system to work with RightSidebarManager
     * 
     * @param taskId - Task ID to show details for
     */
    openDrawer(taskId: string): void {
        // 1. Ensure selection is synced first (this triggers _handleSelectionChange)
        if (this.selectionModel.getFocusedId() !== taskId) {
            // Select the task - this will sync data to panels via onTaskSelect
            this.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
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
        const task = this.projectController.getTaskById(taskId);
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
            if (this.selectionModel.getFocusedId() !== taskId) {
                this.selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
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
        this.calendarModal.open(this.projectController.getCalendar());
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
     * Update GridRenderer.data synchronously before render()
     * This ensures that when _bindCell() is called during the render cycle,
     * it has the correct task structure. Values are queried from TaskStore directly.
     * @private
     */
    private _updateGridDataSync(): void {
        if (this.grid) {
            const tasks = this.projectController.getVisibleTasks((id) => {
                const task = this.projectController.getTaskById(id);
                return task?._collapsed || false;
            });
            this.grid.setData(tasks);
        }
    }

    /**
     * Update GanttRenderer.data synchronously before render()
     * This ensures the Gantt chart has fresh data before rendering, eliminating flash.
     * Values are queried from TaskStore directly.
     * @private
     */
    private _updateGanttDataSync(): void {
        if (this.gantt) {
            const tasks = this.projectController.getVisibleTasks((id) => {
                const task = this.projectController.getTaskById(id);
                return task?._collapsed || false;
            });
            this.gantt.setData(tasks);
        }
    }

    /**
     * Render all views
     */
    render(): void {
        // Batch renders for performance
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
        const editingManager = getEditingStateManager();
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
     * @returns Promise that resolves when saved
     */
    async saveToFile(): Promise<void> {
        try {
            await this.fileService.saveToFile({
                tasks: this.projectController.getTasks(),
                calendar: this.projectController.getCalendar(),
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
                this.projectController.syncTasks(data.tasks || []);
                if (data.calendar) {
                    this.projectController.updateCalendar(data.calendar);
                }
                // NOTE: ProjectController handles recalc/save via Worker
                this.toastService.success(`Loaded ${this.projectController.getTasks().length} tasks`);
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
            tasks: this.projectController.getTasks(),
            calendar: this.projectController.getCalendar(),
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
            
            this.projectController.syncTasks(tasksWithSortKeys);
            if (data.calendar) {
                this.projectController.updateCalendar(data.calendar);
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
                this.projectController.updateCalendar(data.calendar); // skipEvent=true to avoid duplicate persistence
            }
            
            this.projectController.syncTasks(tasksWithSortKeys);
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
        this.projectController.syncTasks(tasksWithSortKeys);
        
        if (result.calendar) {
            this.projectController.updateCalendar(result.calendar);
        }
        
        // NOTE: ProjectController handles recalc/save via Worker
        this.toastService.success(`Imported ${result.tasks.length} tasks from MS Project`);
    }

    /**
     * Export to MS Project XML
     */
    exportToMSProjectXML(): void {
        this.fileService.exportToMSProjectXML({
            tasks: this.projectController.getTasks(),
            calendar: this.projectController.getCalendar(),
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
        this.projectController.syncTasks([]);
        this._createSampleData();
        
        // NOTE: ProjectController handles recalc/save via Worker
        
        this.toastService.success('All data cleared - starting fresh');
    }

    // =========================================================================
    // STATS & UTILITIES
    // =========================================================================

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
        const affectedTasks = this.projectController.getTasks().filter(
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
        const task = this.projectController.getTaskById(taskId);
        const partner = this.tradePartnerStore.get(tradePartnerId);
        if (!task || !partner) return;
        
        // Check if already assigned
        if (task.tradePartnerIds?.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = [...(task.tradePartnerIds || []), tradePartnerId];
        this.projectController.updateTask(taskId, { tradePartnerIds: newIds });
        
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
        const task = this.projectController.getTaskById(taskId);
        if (!task || !task.tradePartnerIds) return;
        
        // Check if assigned
        if (!task.tradePartnerIds.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = task.tradePartnerIds.filter(id => id !== tradePartnerId);
        this.projectController.updateTask(taskId, { tradePartnerIds: newIds });
        
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
        const task = this.projectController.getTaskById(taskId);
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
}
