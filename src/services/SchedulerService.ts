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

import { CPM } from '../core/CPM';
import { DateUtils } from '../core/DateUtils';
import { LINK_TYPES, CONSTRAINT_TYPES } from '../core/Constants';
import { TaskStore } from '../data/TaskStore';
import { CalendarStore } from '../data/CalendarStore';
import { HistoryManager } from '../data/HistoryManager';
import { ToastService } from '../ui/services/ToastService';
import { FileService } from '../ui/services/FileService';
import { KeyboardService } from '../ui/services/KeyboardService';
import { SyncService } from './SyncService';
import { VirtualScrollGrid } from '../ui/components/VirtualScrollGrid';
import { CanvasGantt } from '../ui/components/CanvasGantt';
import { SchedulerViewport } from '../ui/components/scheduler/SchedulerViewport';
import { GridRenderer } from '../ui/components/scheduler/GridRenderer';
import { GanttRenderer } from '../ui/components/scheduler/GanttRenderer';
import { SideDrawer } from '../ui/components/SideDrawer';
import type { GridRendererOptions, GanttRendererOptions, SchedulerViewportOptions } from '../ui/components/scheduler/types';
import { DependenciesModal } from '../ui/components/DependenciesModal';
import { CalendarModal } from '../ui/components/CalendarModal';
import { ColumnSettingsModal } from '../ui/components/ColumnSettingsModal';
import type { 
    Task, 
    Calendar, 
    GridColumn, 
    SchedulerServiceOptions,
    ViewMode,
    LinkType,
    ConstraintType,
    ColumnPreferences
} from '../types';

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
    private historyManager!: HistoryManager;

    // UI services
    public toastService!: ToastService;  // Public for access from main.ts
    private fileService!: FileService;
    private keyboardService: KeyboardService | null = null;
    private syncService: SyncService | null = null;

    // UI components (initialized in init())
    public grid: VirtualScrollGrid | null = null;  // Public for access from AppInitializer and UIEventManager
    public gantt: CanvasGantt | null = null;  // Public for access from AppInitializer and UIEventManager
    private drawer: SideDrawer | null = null;
    private dependenciesModal: DependenciesModal | null = null;
    private calendarModal: CalendarModal | null = null;
    private columnSettingsModal: ColumnSettingsModal | null = null;

    // Selection state (managed here, not in store - UI concern)
    public selectedIds: Set<string> = new Set();  // Public for access from UIEventManager
    private focusedId: string | null = null;
    private anchorId: string | null = null;

    // View state
    public viewMode: ViewMode = 'Week';  // Public for access from StatsService
    
    // Clipboard state
    private clipboard: Task[] | null = null;              // Array of cloned tasks
    private clipboardIsCut: boolean = false;              // True if cut operation
    private clipboardOriginalIds: string[] = [];          // Original IDs for deletion after cut-paste

    // Performance tracking
    private _lastCalcTime: number = 0;
    private _renderScheduled: boolean = false;
    private _isRecalculating: boolean = false;            // Prevent infinite recursion
    private _isSyncingHeader: boolean = false;            // Prevent scroll sync loops

    // Initialization flag
    public isInitialized: boolean = false;  // Public for access from UIEventManager

    /**
     * Create a new SchedulerService instance
     * 
     * @param options - Configuration options
     */
    constructor(options: SchedulerServiceOptions = {} as SchedulerServiceOptions) {
        this.options = options;
        this.isTauri = options.isTauri || false;

        // Initialize services
        this._initServices();

        // Initialize if containers provided
        if (options.gridContainer && options.ganttContainer) {
            this.init();
        }
    }

    /**
     * Initialize all services
     * @private
     */
    private _initServices(): void {
        // Data stores
        this.taskStore = new TaskStore({
            onChange: () => this._onTasksChanged()
        });

        this.calendarStore = new CalendarStore({
            onChange: () => this._onCalendarChanged()
        });

        this.historyManager = new HistoryManager({
            maxHistory: 50
        });

        // UI services
        this.toastService = new ToastService({
            container: document.body
        });

        this.fileService = new FileService({
            isTauri: this.isTauri,
            onToast: (msg, type) => this.toastService.show(msg, type)
        });

        // Sync service (will be initialized after grid/gantt created)
        this.syncService = null;
    }

    /**
     * Initialize the scheduler with UI components
     */
    init(): void {
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
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onSelectionChange: (selectedIds) => this._handleSelectionChange(selectedIds),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
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
        };
        viewport.initGantt(ganttOptions);

        // Start the viewport
        viewport.start();

        // Store viewport reference (for backward compatibility, also store as grid/gantt)
        (this as any).viewport = viewport;
        
        // Create facade wrappers for backward compatibility
        this.grid = this._createGridFacade(viewport);
        this.gantt = this._createGanttFacade(viewport);

        // Sync service is no longer needed (viewport handles sync internally)
        this.syncService = null;

        // Create side drawer
        if (drawerContainer) {
            this.drawer = new SideDrawer({
                container: drawerContainer,
                onUpdate: (taskId, field, value) => this._handleDrawerUpdate(taskId, field, value),
                onDelete: (taskId) => this.deleteTask(taskId),
                onOpenLinks: (taskId) => this.openDependencies(taskId),
                getScheduler: () => this,
            });
        }

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

        // Load persisted data
        try {
            const taskCountBeforeLoad = this.taskStore.getAll().length;
            console.log('[SchedulerService] 🔍 Before loadData() - task count:', taskCountBeforeLoad);
            
            this.loadData();
            
            const taskCountAfterLoad = this.taskStore.getAll().length;
            console.log('[SchedulerService] ✅ After loadData() - task count:', taskCountAfterLoad);
        } catch (error) {
            console.error('[SchedulerService] Error loading persisted data:', error);
        }
        
        // Mark initialization as complete
        this.isInitialized = true;
        console.log('[SchedulerService] ✅ Initialization complete - isInitialized set to true');
    }

    /**
     * Create facade wrapper for VirtualScrollGrid API compatibility
     */
    private _createGridFacade(viewport: SchedulerViewport): VirtualScrollGrid {
        // Return a facade object that implements VirtualScrollGrid interface
        return {
            setData: (tasks: Task[]) => viewport.setData(tasks),
            setVisibleData: (tasks: Task[]) => viewport.setVisibleData(tasks),
            setSelection: (selectedIds: Set<string>, focusedId?: string | null) => {
                viewport.setSelection([...selectedIds]);
            },
            scrollToTask: (taskId: string) => viewport.scrollToTask(taskId),
            focusCell: (taskId: string, field: string) => {
                // Delegate to grid renderer if available
                const gridRenderer = (viewport as any).gridRenderer as GridRenderer | null;
                if (gridRenderer) {
                    gridRenderer.focusCell(taskId, field);
                }
            },
            refresh: () => viewport.refresh(),
            updateColumns: (columns: GridColumn[]) => viewport.updateGridColumns(columns),
            updateRow: (taskId: string) => viewport.updateRow(taskId),
            setScrollTop: (scrollTop: number) => viewport.setScrollTop(scrollTop),
            getScrollTop: () => viewport.getScrollTop(),
            getStats: () => ({
                totalTasks: viewport.getData().length,
                visibleRange: '0-0',
                renderedRows: 0,
                poolSize: 0,
                renderCount: 0,
            }),
            destroy: () => viewport.destroy(),
        } as VirtualScrollGrid;
    }

    /**
     * Create facade wrapper for CanvasGantt API compatibility
     */
    private _createGanttFacade(viewport: SchedulerViewport): CanvasGantt {
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
        } as unknown as CanvasGantt;
    }

    /**
     * Handle selection change
     */
    private _handleSelectionChange(selectedIds: string[]): void {
        const selectedSet = new Set(selectedIds);
        this.selectedIds = selectedSet;
        // Update other components that depend on selection
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
            onInsert: () => this.insertTaskAbove(),
            onArrowUp: (shiftKey, ctrlKey) => this._handleArrowNavigation('ArrowUp', shiftKey, ctrlKey),
            onArrowDown: (shiftKey, ctrlKey) => this._handleArrowNavigation('ArrowDown', shiftKey, ctrlKey),
            onArrowLeft: () => this._handleArrowCollapse('ArrowLeft'),
            onArrowRight: () => this._handleArrowCollapse('ArrowRight'),
            onTab: () => this._handleTabIndent(),
            onShiftTab: () => this._handleTabOutdent(),
            onCtrlArrowUp: () => this.moveSelectedTasks(-1),
            onCtrlArrowDown: () => this.moveSelectedTasks(1),
            onF2: () => this.enterEditMode(),
            onEscape: () => this._handleEscape(),
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
                renderer: (_task, meta) => `<span style="color: #94a3b8; font-size: 11px;">${meta.index + 1}</span>`,
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
                label: 'Actions',
                field: 'actions',
                type: 'actions',
                width: 80,
                editable: false,
                minWidth: 80,
                actions: [
                    { 
                        id: 'outdent', 
                        name: 'outdent',
                        title: 'Outdent',
                        icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>',
                        color: '#64748b'
                    },
                    { 
                        id: 'indent', 
                        name: 'indent',
                        title: 'Indent',
                        icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>',
                        color: '#64748b'
                    },
                    { 
                        id: 'links', 
                        name: 'links',
                        title: 'Dependencies',
                        icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
                        color: '#64748b'
                    },
                    { 
                        id: 'delete', 
                        name: 'delete',
                        title: 'Delete',
                        icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
                        color: '#64748b'
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
     * Set all tasks
     * @param tasks - Tasks array
     */
    set tasks(tasks: Task[]) {
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
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                for (let i = start; i <= end; i++) {
                    this.selectedIds.add(visibleTasks[i].id);
                }
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            if (this.selectedIds.has(taskId)) {
                this.selectedIds.delete(taskId);
            } else {
                this.selectedIds.add(taskId);
            }
            this.anchorId = taskId;
        } else {
            // Single selection
            this.selectedIds.clear();
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
        
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        // Check if this is a parent/summary task (dates roll up from children)
        const isParent = this.taskStore.isParent(taskId);

        // Handle scheduling triangle fields with proper CPM logic
        switch (field) {
            case 'duration':
                // Duration edit: update duration, CPM will recalculate end
                // This is standard CPM behavior - no constraint needed
                const newDuration = Math.max(1, parseInt(String(value)) || 1);
                this.taskStore.update(taskId, { duration: newDuration });
                break;
                
            case 'start':
                // Start edit: User is setting a start constraint
                // Apply SNET (Start No Earlier Than) so CPM respects this date
                if (value && !isParent) {
                    const startValue = String(value);
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
                        console.warn('[SchedulerService] Invalid date format:', startValue);
                        return;
                    }
                    
                    this.taskStore.update(taskId, { 
                        start: startValue,
                        constraintType: 'snet',
                        constraintDate: startValue 
                    });
                    this.toastService.info('Start constraint (SNET) applied');
                }
                break;
                
            case 'end':
                // End edit: User is setting a finish deadline
                // Apply FNLT (Finish No Later Than) so CPM respects this date
                if (value && !isParent) {
                    const endValue = String(value);
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(endValue)) {
                        console.warn('[SchedulerService] Invalid date format:', endValue);
                        return;
                    }
                    
                    // Check if deadline is earlier than current start (impossible constraint)
                    if (task.start && endValue < task.start) {
                        this.toastService.warning('Deadline is earlier than start date - schedule may be impossible');
                    }
                    
                    this.taskStore.update(taskId, { 
                        constraintType: 'fnlt',
                        constraintDate: endValue 
                    });
                    this.toastService.info('Finish deadline (FNLT) applied');
                }
                break;
                
            case 'actualStart':
                // Actual start edit: Update actual start date (does NOT trigger CPM recalculation)
                if (value && !isParent) {
                    const actualStartValue = String(value);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualStartValue)) {
                        console.warn('[SchedulerService] Invalid date format:', actualStartValue);
                        return;
                    }
                    this.taskStore.update(taskId, { actualStart: actualStartValue });
                    // Re-render to update variance display
                    this.render();
                } else if (!value && !isParent) {
                    // Clear actual start
                    this.taskStore.update(taskId, { actualStart: null });
                    this.render();
                }
                break;
                
            case 'actualFinish':
                // Actual finish edit: Update actual finish date (does NOT trigger CPM recalculation)
                if (value && !isParent) {
                    const actualFinishValue = String(value);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFinishValue)) {
                        console.warn('[SchedulerService] Invalid date format:', actualFinishValue);
                        return;
                    }
                    this.taskStore.update(taskId, { actualFinish: actualFinishValue });
                    // Re-render to update variance display
                    this.render();
                } else if (!value && !isParent) {
                    // Clear actual finish
                    this.taskStore.update(taskId, { actualFinish: null });
                    this.render();
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
                break;
                
            default:
                // All other fields - simple update
                this.taskStore.update(taskId, { [field]: value });
        }

        // Recalculate if date/duration changed (but NOT for actuals - they don't affect schedule)
        if (['start', 'end', 'duration'].includes(field) && !['actualStart', 'actualFinish'].includes(field)) {
            this.recalculateAll();
        } else {
            this.render();
        }

        this.saveData();
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
        
        const task = this.taskStore.getById(taskId);
        if (!task) return;
        
        const isParent = this.taskStore.isParent(taskId);

        // Handle scheduling triangle fields with proper CPM logic
        switch (field) {
            case 'duration':
                // Duration edit: update duration, CPM will recalculate end
                const newDuration = Math.max(1, parseInt(String(value)) || 1);
                this.taskStore.update(taskId, { duration: newDuration });
                break;
                
            case 'start':
                // Start edit: Apply SNET constraint
                if (value && !isParent) {
                    const startValue = String(value);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
                        console.warn('[SchedulerService] Invalid date format:', startValue);
                        return;
                    }
                    
                    this.taskStore.update(taskId, { 
                        start: startValue,
                        constraintType: 'snet',
                        constraintDate: startValue 
                    });
                    this.toastService.info('Start constraint (SNET) applied');
                }
                break;
                
            case 'end':
                // End edit: Apply FNLT constraint (deadline)
                if (value && !isParent) {
                    const endValue = String(value);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(endValue)) {
                        console.warn('[SchedulerService] Invalid date format:', endValue);
                        return;
                    }
                    
                    if (task.start && endValue < task.start) {
                        this.toastService.warning('Deadline is earlier than start date - schedule may be impossible');
                    }
                    
                    this.taskStore.update(taskId, { 
                        constraintType: 'fnlt',
                        constraintDate: endValue 
                    });
                    this.toastService.info('Finish deadline (FNLT) applied');
                }
                break;
                
            case 'constraintType':
                // Constraint type change
                const constraintValue = String(value);
                if (constraintValue === 'asap') {
                    this.taskStore.update(taskId, { 
                        constraintType: 'asap',
                        constraintDate: null 
                    });
                    this.toastService.info('Constraint removed - task will schedule based on dependencies');
                } else {
                    this.taskStore.update(taskId, { constraintType: constraintValue as ConstraintType });
                }
                break;
                
            default:
                // All other fields - simple update
                this.taskStore.update(taskId, { [field]: value } as Partial<Task>);
        }

        // Recalculate if date/duration/constraint changed
        if (['start', 'end', 'duration', 'constraintType', 'constraintDate'].includes(field)) {
            this.recalculateAll();
        } else {
            this.render();
        }
        
        // Sync drawer with updated values (dates may have changed from CPM)
        if (this.drawer && this.drawer.isDrawerOpen() && this.drawer.getActiveTaskId() === taskId) {
            const updatedTask = this.taskStore.getById(taskId);
            if (updatedTask) {
                this.drawer.sync(updatedTask);
            }
        }

        this.saveData();
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
        this.recalculateAll();
        this.saveData();
        this.render();
        this.toastService.success('Calendar updated. Recalculating schedule...');
    }

    /**
     * Handle row move (drag and drop)
     * @private
     * @param taskIds - Task IDs being moved
     * @param targetId - Target task ID
     * @param position - 'before', 'after', or 'child'
     */
    private _handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void {
        // TODO: Implement drag and drop reordering
        this.toastService.info('Drag and drop reordering coming soon');
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
            this.taskStore.update(task.id, { parentId: newParentId });
        });
        
        // 4. Update store and render
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
        const updates: Array<{ taskId: string; newParentId: string | null }> = [];
        topLevelSelected.forEach(task => {
            // Validation: prevent outdent on root tasks
            if (!task.parentId) return;
            
            const currentParent = allTasks.find(t => t.id === task.parentId);
            const grandparentId = currentParent ? currentParent.parentId : null;
            
            updates.push({ taskId: task.id, newParentId: grandparentId });
        });
        
        // 3. Apply updates
        updates.forEach(({ taskId, newParentId }) => {
            this.taskStore.update(taskId, { parentId: newParentId });
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

    private _syncScrollToGantt(scrollTop: number): void {
        if (this.syncService) {
            this.syncService.syncGridToGantt(scrollTop);
        }
    }

    /**
     * Sync scroll from Gantt to grid
     * @private
     * @param scrollTop - Scroll position
     */
    private _syncScrollToGrid(scrollTop: number): void {
        if (this.syncService) {
            this.syncService.syncGanttToGrid(scrollTop);
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
    addTask(taskData: Partial<Task> = {}): Task | undefined {
        // Debug: Log call with stack trace
        console.log('[SchedulerService] 🔍 addTask() called', {
            isInitialized: this.isInitialized,
            taskData,
            stackTrace: new Error().stack
        });
        
        // Guard: Don't allow task creation during initialization
        if (!this.isInitialized) {
            console.log('[SchedulerService] ⚠️ addTask() blocked - not initialized');
            return;
        }
        
        try {
            this.saveCheckpoint();
            
            const today = DateUtils.today();
            const task: Task = {
                id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: taskData.name || 'New Task',
                start: taskData.start || today,
                end: taskData.end || today,
                duration: taskData.duration || 1,
                parentId: taskData.parentId || null,
                dependencies: taskData.dependencies || [],
                progress: taskData.progress || 0,
                constraintType: taskData.constraintType || 'asap',
                constraintDate: taskData.constraintDate || null,
                notes: taskData.notes || '',
                level: taskData.level || 0,
                _collapsed: false,
                // Initialize baseline/actual fields to null
                baselineStart: taskData.baselineStart ?? null,
                baselineFinish: taskData.baselineFinish ?? null,
                baselineDuration: taskData.baselineDuration,
                actualStart: taskData.actualStart ?? null,
                actualFinish: taskData.actualFinish ?? null,
                remainingDuration: taskData.remainingDuration,
                ...taskData
            } as Task;

            console.log('[SchedulerService] Adding task:', task);
            
            // Determine where to insert the task (after focused task in display order)
            const tasks = this.taskStore.getAll();
            let insertIndex = tasks.length; // Default: add at end
            
            if (this.focusedId) {
                const focusedTask = this.taskStore.getById(this.focusedId);
                if (focusedTask) {
                    // Set parentId to match focused task's parent (same hierarchy level)
                    task.parentId = taskData.parentId ?? focusedTask.parentId ?? null;
                    
                    // Use flat list to find where to insert (maintains display order)
                    const flatList = this._getFlatList();
                    const focusedFlatIndex = flatList.findIndex(t => t.id === this.focusedId);
                    
                    if (focusedFlatIndex !== -1) {
                        // Find the next task after focused task in display order
                        // (could be sibling, or next task at parent level)
                        let nextTaskInDisplay: Task | null = null;
                        for (let i = focusedFlatIndex + 1; i < flatList.length; i++) {
                            const candidate = flatList[i];
                            // Check if this is still a descendant of focused task
                            let isDescendant = false;
                            let checkId = candidate.parentId;
                            while (checkId) {
                                if (checkId === this.focusedId) {
                                    isDescendant = true;
                                    break;
                                }
                                const parent = this.taskStore.getById(checkId);
                                checkId = parent?.parentId ?? null;
                            }
                            
                            // If not a descendant, this is the next task we want to insert before
                            if (!isDescendant) {
                                nextTaskInDisplay = candidate;
                                break;
                            }
                        }
                        
                        // Find the array index of the next task (or end if none)
                        if (nextTaskInDisplay) {
                            const nextIndex = tasks.findIndex(t => t.id === nextTaskInDisplay!.id);
                            if (nextIndex !== -1) {
                                insertIndex = nextIndex;
                            }
                        }
                        // If no next task found, insertIndex stays at tasks.length (end)
                    }
                }
            } else {
                // No focused task - use provided parentId or null
                task.parentId = taskData.parentId ?? null;
            }
            
            // Insert task at the determined position
            tasks.splice(insertIndex, 0, task);
            this.taskStore.setAll(tasks);
            
            console.log('[SchedulerService] Task inserted at index', insertIndex, '. Total tasks:', tasks.length);
            
            this.recalculateAll();
            this.saveData();
            
            // Select and focus the new task
            this.selectedIds.clear();
            this.selectedIds.add(task.id);
            this.focusedId = task.id;
            this._updateSelection();
            
            // Render and scroll to new task
            this.render();
            
            // Robustly wait for task to be available in viewport, then scroll and focus
            this._scrollToTaskAndFocus(task.id);
            
            this.toastService.success('Task added');
            
            return task;
        } catch (error) {
            const err = error as Error;
            console.error('[SchedulerService] Error adding task:', err);
            this.toastService.error('Failed to add task: ' + err.message);
            throw error;
        }
    }

    /**
     * Delete a task
     * @param taskId - Task ID
     */
    deleteTask(taskId: string): void {
        this.saveCheckpoint();
        
        // Delete children recursively
        const deleteRecursive = (id: string): void => {
            const children = this.taskStore.getChildren(id);
            children.forEach(child => deleteRecursive(child.id));
            this.taskStore.delete(id);
        };

        deleteRecursive(taskId);
        
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
        
        this.saveCheckpoint();
        const idsToDelete = Array.from(this.selectedIds);
        
        idsToDelete.forEach(id => {
            const deleteRecursive = (taskId: string): void => {
                const children = this.taskStore.getChildren(taskId);
                children.forEach(child => deleteRecursive(child.id));
                this.taskStore.delete(taskId);
            };
            deleteRecursive(id);
        });

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
     * Indent a task (make it a child)
     * @param taskId - Task ID
     */
    indent(taskId: string): void {
        this.saveCheckpoint();
        
        const task = this.taskStore.getById(taskId);
        if (!task) return;

        // Get flat list of visible tasks (matching POC getFlatList())
        const list = this.taskStore.getVisibleTasks((id) => {
            const t = this.taskStore.getById(id);
            return t?._collapsed || false;
        });
        
        const idx = list.findIndex(t => t.id === taskId);
        if (idx <= 0) return; // Can't indent first task
        
        const prev = list[idx - 1];
        const taskDepth = this.taskStore.getDepth(taskId);
        const prevDepth = this.taskStore.getDepth(prev.id);
        
        // Can't indent if previous task is at a shallower level
        if (prevDepth < taskDepth) return;
        
        let newParentId: string | null = null;
        
        if (prevDepth === taskDepth) {
            // Previous task is at same level - make it the parent
            newParentId = prev.id;
        } else {
            // Previous task is deeper - walk up its parent chain to find task at taskDepth level
            let curr: Task | undefined = prev;
            while (curr && this.taskStore.getDepth(curr.id) > taskDepth) {
                curr = curr.parentId ? this.taskStore.getById(curr.parentId) : undefined;
            }
            if (curr) {
                newParentId = curr.id;
            }
        }
        
        if (newParentId !== null) {
            this.taskStore.update(taskId, { parentId: newParentId });
            this.recalculateAll();
            this.saveData();
            this.render();
        }
    }

    /**
     * Outdent a task (remove from parent)
     * @param taskId - Task ID
     */
    outdent(taskId: string): void {
        this.saveCheckpoint();
        
        const task = this.taskStore.getById(taskId);
        if (!task || !task.parentId) return;

        // Get parent's parent (or null if parent is root)
        const parent = this.taskStore.getById(task.parentId);
        const newParentId = parent ? parent.parentId : null;
        
        this.taskStore.update(taskId, { parentId: newParentId });

        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Insert task above focused task
     */
    insertTaskAbove(): void {
        // Debug: Log call
        console.log('[SchedulerService] 🔍 insertTaskAbove() called', {
            isInitialized: this.isInitialized,
            focusedId: this.focusedId,
            stackTrace: new Error().stack
        });
        
        // Guard: Don't allow task creation during initialization
        if (!this.isInitialized) {
            console.log('[SchedulerService] ⚠️ insertTaskAbove() blocked - not initialized');
            return;
        }
        
        this.saveCheckpoint();
        
        if (!this.focusedId) {
            console.log('[SchedulerService] 🔍 insertTaskAbove() calling addTask() - no focusedId');
            this.addTask();
            return;
        }

        const tasks = this.taskStore.getAll();
        const focusedIndex = tasks.findIndex(t => t.id === this.focusedId);
        if (focusedIndex === -1) return;
        
        const focusedTask = tasks[focusedIndex];
        const today = DateUtils.today();
        
        // Create new task object
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
            _collapsed: false
        };
        
        // Insert at focused task's index
        tasks.splice(focusedIndex, 0, newTask);
        
        // Update store with new array
        this.taskStore.setAll(tasks);
        this.recalculateAll();
        this.saveData();
        
        // Select and focus the new task
        this.selectedIds.clear();
        this.selectedIds.add(newTask.id);
        this.focusedId = newTask.id;
        this._updateSelection();
        
        // Render and scroll to new task
        this.render();
        
        // Robustly wait for task to be available in viewport, then scroll and focus
        this._scrollToTaskAndFocus(newTask.id);
    }

    /**
     * Move selected tasks vertically (reorder within siblings)
     * @param direction - -1 for up, 1 for down
     */
    moveSelectedTasks(direction: number): void {
        if (!this.focusedId) return;
        
        this.saveCheckpoint();
        
        const tasks = this.taskStore.getAll();
        const focusedTask = tasks.find(t => t.id === this.focusedId);
        if (!focusedTask) return;
        
        // Find siblings (tasks with same parentId)
        const siblings = tasks.filter(t => t.parentId === focusedTask.parentId);
        const currentSiblingIndex = siblings.findIndex(t => t.id === focusedTask.id);
        if (currentSiblingIndex === -1) return;
        
        // Calculate target position
        const targetSiblingIndex = currentSiblingIndex + direction;
        if (targetSiblingIndex < 0 || targetSiblingIndex >= siblings.length) return;
        
        const siblingTarget = siblings[targetSiblingIndex];
        
        // Find indices in full tasks array
        const indexA = tasks.findIndex(t => t.id === focusedTask.id);
        const indexB = tasks.findIndex(t => t.id === siblingTarget.id);
        
        if (indexA > -1 && indexB > -1) {
            // Swap tasks in array
            [tasks[indexA], tasks[indexB]] = [tasks[indexB], tasks[indexA]];
            
            // Update store with reordered array
            this.taskStore.setAll(tasks);
            this.recalculateAll();
            this.saveData();
            this.render();
            
            // Scroll to focused task
            if (this.grid) {
                requestAnimationFrame(() => {
                    this.grid!.scrollToTask(this.focusedId!);
                });
            }
        }
    }

    /**
     * Enter edit mode for focused task
     */
    enterEditMode(): void {
        if (this.focusedId && this.grid) {
            this.grid.focusCell(this.focusedId, 'name');
        }
    }

    // =========================================================================
    // SELECTION MANAGEMENT
    // =========================================================================

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

        // 9. Insert newTasks at target location
        // Get all tasks and insert in correct order
        const allTasks = this.taskStore.getAll();
        
        // Find where to insert in the full task list
        // We need to insert after the last task that appears before insertIndex in flat list
        if (insertIndex > 0 && insertIndex <= flatList.length) {
            const targetTask = flatList[insertIndex - 1];
            const targetTaskIndex = allTasks.findIndex(t => t.id === targetTask.id);
            
            // Insert after target task
            // But we need to find where the target task's subtree ends
            // For simplicity, insert all new tasks after target task
            const insertPos = targetTaskIndex + 1;
            newTasks.forEach((task, idx) => {
                allTasks.splice(insertPos + idx, 0, task);
            });
        } else {
            // Insert at end
            newTasks.forEach(task => {
                allTasks.push(task);
            });
        }

        // Update store with new array
        this.taskStore.setAll(allTasks);

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

        // 12. recalculateAll() → saveData() → render()
        this.recalculateAll();
        this.saveData();
        this.render();

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
     * @param taskId - Task ID
     */
    openDrawer(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task || !this.drawer) return;
        this.drawer.open(task);
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
     * Open dependencies modal
     * @param taskId - Task ID
     */
    openDependencies(taskId: string): void {
        const task = this.taskStore.getById(taskId);
        if (!task || !this.dependenciesModal) return;
        this.dependenciesModal.open(task);
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
        // Prevent infinite recursion
        if (this._isRecalculating) {
            console.warn('[SchedulerService] Recursion detected - skipping recalculateAll()');
            return;
        }
        
        this._isRecalculating = true;
        const startTime = performance.now();
        
        try {
            const tasks = this.taskStore.getAll();
            const calendar = this.calendarStore.get();

            if (tasks.length === 0) {
                this._lastCalcTime = 0;
                return;
            }

            const result = CPM.calculate(tasks, calendar, {
                isParent: (id) => this.taskStore.isParent(id),
                getDepth: (id) => this.taskStore.getDepth(id),
            });

            // Temporarily disable onChange to prevent recursion
            const restoreNotifications = this.taskStore.disableNotifications();

            // Update tasks with calculated values
            result.tasks.forEach(calculatedTask => {
                const task = this.taskStore.getById(calculatedTask.id);
                if (task) {
                    // Update directly without triggering onChange
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

            // Roll up parent dates
            this._rollupParentDates();

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

            this._lastCalcTime = performance.now() - startTime;
        } catch (error) {
            console.error('[SchedulerService] Error in recalculateAll:', error);
            throw error;
        } finally {
            this._isRecalculating = false;
        }
    }

    /**
     * Roll up parent task dates from children
     * @private
     */
    private _rollupParentDates(): void {
        const tasks = this.taskStore.getAll();
        const parents = tasks.filter(t => this.taskStore.isParent(t.id));

        parents.forEach(parent => {
            const children = this.taskStore.getChildren(parent.id);
            if (children.length === 0) return;

            const childStarts = children.map(c => c.start).filter(Boolean).sort();
            const childEnds = children.map(c => c.end).filter(Boolean).sort();

            if (childStarts.length > 0 && childEnds.length > 0) {
                this.taskStore.update(parent.id, {
                    start: childStarts[0],
                    end: childEnds[childEnds.length - 1],
                });
            }
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
        
        // Tasks changed - trigger recalculation and render
        this.recalculateAll();
        this.render();
    }

    /**
     * Handle calendar changed event from CalendarStore
     * @private
     */
    private _onCalendarChanged(): void {
        // Calendar changed - trigger recalculation
        this.recalculateAll();
        this.render();
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
                this.gantt.setViewMode(this.viewMode);
            }
        });
    }

    // =========================================================================
    // PERSISTENCE
    // =========================================================================

    /**
     * Load data from localStorage
     */
    loadData(): void {
        console.log('[SchedulerService] 🔍 loadData() called', {
            isInitialized: this.isInitialized,
            stackTrace: new Error().stack
        });
        
        try {
            const saved = localStorage.getItem(SchedulerService.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as { tasks?: Task[]; calendar?: Calendar; savedAt?: string };
                const taskCount = parsed.tasks ? parsed.tasks.length : 0;
                console.log('[SchedulerService] 🔍 Loading data from localStorage', {
                    taskCount,
                    hasCalendar: !!parsed.calendar,
                    savedAt: parsed.savedAt
                });
                
                if (parsed.tasks) {
                    // Temporarily disable onChange to prevent recursion during load
                    const restoreNotifications = this.taskStore.disableNotifications();
                    this.taskStore.setAll(parsed.tasks);
                    restoreNotifications();
                    console.log('[SchedulerService] ✅ Loaded', parsed.tasks.length, 'tasks from localStorage');
                }
                if (parsed.calendar) {
                    this.calendarStore.set(parsed.calendar);
                }
            } else {
                console.log('[SchedulerService] 🔍 No saved data found - creating sample data');
                // Create sample data for first-time users
                this._createSampleData();
            }
        } catch (err) {
            console.error('[SchedulerService] Load data failed:', err);
            // Don't create sample data if load failed - might cause more errors
            // Just start with empty tasks
            // @ts-expect-error - Accessing private property for recursion prevention
            const originalOnChange = this.taskStore.options.onChange;
            // @ts-expect-error - Accessing private property for recursion prevention
            this.taskStore.options.onChange = undefined;
            this.taskStore.setAll([]);
            // @ts-expect-error - Accessing private property for recursion prevention
            this.taskStore.options.onChange = originalOnChange;
        }
    }

    /**
     * Save data to localStorage
     */
    saveData(): void {
        try {
            const data = {
                tasks: this.taskStore.getAll(),
                calendar: this.calendarStore.get(),
                savedAt: new Date().toISOString(),
            };
            localStorage.setItem(SchedulerService.STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
            console.error('[SchedulerService] Save data failed:', err);
        }
    }

    /**
     * Create sample data for first-time users
     * @private
     */
    private _createSampleData(): void {
        console.log('[SchedulerService] 🔍 _createSampleData() called', {
            isInitialized: this.isInitialized,
            stackTrace: new Error().stack
        });
        
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
                _collapsed: false,
            },
        ];

        console.log('[SchedulerService] Creating sample data:', tasks.length, 'tasks');
        
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
        
        const finalTaskCount = this.taskStore.getAll().length;
        console.log('[SchedulerService] ✅ Sample data created. Total tasks:', finalTaskCount);
    }

    // =========================================================================
    // HISTORY (UNDO/REDO)
    // =========================================================================

    /**
     * Save checkpoint for undo/redo
     */
    saveCheckpoint(): void {
        const snapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });
        this.historyManager.saveCheckpoint(snapshot);
    }

    /**
     * Undo last action
     */
    undo(): void {
        const currentSnapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });

        const previousSnapshot = this.historyManager.undo(currentSnapshot);
        if (!previousSnapshot) {
            this.toastService.info('Nothing to undo');
            return;
        }

        const previous = JSON.parse(previousSnapshot) as { tasks: Task[]; calendar?: Calendar };
        this.taskStore.setAll(previous.tasks);
        if (previous.calendar) {
            this.calendarStore.set(previous.calendar);
        }

        this.recalculateAll();
        this.saveData();
        this.render();
        this.toastService.info('Undone');
    }

    /**
     * Redo last undone action
     */
    redo(): void {
        const currentSnapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });

        const nextSnapshot = this.historyManager.redo(currentSnapshot);
        if (!nextSnapshot) {
            this.toastService.info('Nothing to redo');
            return;
        }

        const next = JSON.parse(nextSnapshot) as { tasks: Task[]; calendar?: Calendar };
        this.taskStore.setAll(next.tasks);
        if (next.calendar) {
            this.calendarStore.set(next.calendar);
        }

        this.recalculateAll();
        this.saveData();
        this.render();
        this.toastService.info('Redone');
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
            this.taskStore.setAll(data.tasks || []);
            if (data.calendar) {
                this.calendarStore.set(data.calendar);
            }
            this.recalculateAll();
            this.saveData();
            this.render();
            this.toastService.success(`Imported ${this.taskStore.getAll().length} tasks`);
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
            this.taskStore.setAll(data.tasks || []);
            this.recalculateAll();
            this.saveData();
            this.render();
        } catch (err) {
            // Error handled by FileService
        }
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

    // =========================================================================
    // STATS & UTILITIES
    // =========================================================================

    /**
     * Zoom in (change to more detailed view)
     */
    zoomIn(): void {
        const modes: ViewMode[] = ['Month', 'Week', 'Day'];
        const currentIndex = modes.indexOf(this.viewMode);
        if (currentIndex < modes.length - 1) {
            this.viewMode = modes[currentIndex + 1];
            if (this.gantt) {
                this.gantt.setViewMode(this.viewMode);
            }
            this.render();
        }
    }

    /**
     * Zoom out (change to less detailed view)
     */
    zoomOut(): void {
        const modes: ViewMode[] = ['Month', 'Week', 'Day'];
        const currentIndex = modes.indexOf(this.viewMode);
        if (currentIndex > 0) {
            this.viewMode = modes[currentIndex - 1];
            if (this.gantt) {
                this.gantt.setViewMode(this.viewMode);
            }
            this.render();
        }
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
        
        const calendar = this.calendarStore.get();
        const tasks: Task[] = [];
        
        for (let i = 0; i < count; i++) {
            const duration = Math.floor(Math.random() * 10) + 1;
            const startOffset = Math.floor(Math.random() * 200);
            const startDate = DateUtils.addWorkDays(DateUtils.today(), startOffset, calendar);
            const endDate = DateUtils.addWorkDays(startDate, duration - 1, calendar);
            
            const task: Task = {
                id: `mock_${i}_${Date.now()}`,
                name: `Task ${i + 1} - ${this._randomTaskName()}`,
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
    destroy(): void {
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
