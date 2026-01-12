/**
 * @fileoverview Subordinate Factory Interface for SchedulerService
 * @module services/scheduler/SchedulerSubordinateFactory
 * 
 * Defines the contract for creating subordinate services used by SchedulerService.
 * The factory pattern allows SchedulerService to remain decoupled from concrete
 * service implementations while main.ts handles the complex dependency wiring.
 * 
 * @see docs/PURE_DI_SUBORDINATE_FACTORY_PLAN.md
 */

import type { TaskOperationsService } from './TaskOperationsService';
import type { ViewStateService } from './ViewStateService';
import type { ColumnPreferencesService } from './ColumnPreferencesService';
import type { GridNavigationController } from './GridNavigationController';
import type { ContextMenuService } from './ContextMenuService';
import type { ModalCoordinator } from './ModalCoordinator';
import type { FileOperationsService } from './FileOperationsService';
import type { BaselineService } from './BaselineService';
import type { TradePartnerService } from './TradePartnerService';
import type { DependencyValidationService } from './DependencyValidationService';
import type { ViewportFactoryService } from './ViewportFactoryService';
import type { KeyboardBindingService } from './KeyboardBindingService';
import type { TestDataGenerator } from '../../utils/TestDataGenerator';
import type { VirtualScrollGridFacade, CanvasGanttFacade } from '../../ui/components/scheduler/types';
import type { GridColumn, Calendar, Dependency, ColumnPreferences } from '../../types';

/**
 * Context provided by SchedulerService to the factory
 * Contains runtime accessors and callbacks that only SchedulerService can provide
 */
export interface SubordinateFactoryContext {
    // =========================================================================
    // Runtime UI Accessors
    // =========================================================================
    
    /** Get grid component (may be null before init) */
    getGrid: () => VirtualScrollGridFacade | null;
    /** Get gantt component (may be null before init) */
    getGantt: () => CanvasGanttFacade | null;
    
    // =========================================================================
    // SchedulerService Method Callbacks
    // =========================================================================
    
    /** Trigger view render */
    render: () => void;
    /** Save checkpoint for undo/redo */
    saveCheckpoint: () => void;
    /** Save data to storage */
    saveData: () => void;
    /** Recalculate all tasks */
    recalculateAll: () => void;
    /** Enter edit mode on current cell */
    enterEditMode: () => void;
    /** Exit edit mode */
    exitEditMode: () => void;
    /** Check if scheduler is initialized */
    isInitialized: () => boolean;
    /** Get column definitions */
    getColumnDefinitions: () => GridColumn[];
    /** Get column preferences */
    getColumnPreferences: () => ColumnPreferences;
    /** Get calendar configuration */
    getCalendar: () => Calendar;
    
    // =========================================================================
    // Selection/Navigation Callbacks
    // =========================================================================
    
    /** Handle selection change event */
    handleSelectionChange: (selectedIds: string[]) => void;
    
    // =========================================================================
    // Panel/Drawer Callbacks
    // =========================================================================
    
    /** Get callbacks for opening panels in RightSidebarManager */
    getOpenPanelCallbacks: () => Array<(panelId: string) => void>;
    /** Close drawer panel */
    closeDrawer: () => void;
    /** Check if drawer is open */
    isDrawerOpen: () => boolean;
    
    // =========================================================================
    // Event Handlers
    // =========================================================================
    
    /** Handle dependencies save */
    handleDependenciesSave: (taskId: string, deps: Dependency[]) => void;
    /** Handle calendar save */
    handleCalendarSave: (calendar: Calendar) => void;
    /** Update column preferences */
    updateColumnPreferences: (prefs: ColumnPreferences) => void;
    /** Notify data change listeners */
    notifyDataChange: () => void;
    
    // =========================================================================
    // Task Operations (for ContextMenuService)
    // =========================================================================
    
    /** Insert blank row above a task */
    insertBlankRowAbove: (taskId: string) => void;
    /** Insert blank row below a task */
    insertBlankRowBelow: (taskId: string) => void;
    /** Convert blank row to task */
    convertBlankToTask: (taskId: string) => void;
    /** Delete a task */
    deleteTask: (taskId: string) => void;
    /** Open properties panel for a task */
    openProperties: (taskId: string) => void;
    /** Toggle task collapse state */
    toggleCollapse: (taskId: string) => void;
    
    // =========================================================================
    // Keyboard Actions
    // =========================================================================
    
    /** Keyboard action callbacks */
    keyboardActions: {
        /** Check if app is ready */
        isAppReady: () => boolean;
        /** Undo last action */
        onUndo: () => void;
        /** Redo last undone action */
        onRedo: () => void;
        /** Delete selected tasks */
        onDelete: () => void;
        /** Copy selected tasks */
        onCopy: () => void;
        /** Cut selected tasks */
        onCut: () => void;
        /** Paste tasks */
        onPaste: () => void;
        /** Insert task below */
        onInsert: () => void;
        /** Insert task above */
        onShiftInsert: () => void;
        /** Add child task */
        onCtrlEnter: () => void;
        /** Arrow up navigation */
        onArrowUp: (shiftKey: boolean, ctrlKey: boolean) => void;
        /** Arrow down navigation */
        onArrowDown: (shiftKey: boolean, ctrlKey: boolean) => void;
        /** Arrow left navigation */
        onArrowLeft: (shiftKey: boolean, ctrlKey: boolean) => void;
        /** Arrow right navigation */
        onArrowRight: (shiftKey: boolean, ctrlKey: boolean) => void;
        /** Ctrl+Arrow left - collapse */
        onCtrlArrowLeft: () => void;
        /** Ctrl+Arrow right - expand */
        onCtrlArrowRight: () => void;
        /** Tab - indent */
        onTab: () => void;
        /** Shift+Tab - outdent */
        onShiftTab: () => void;
        /** Ctrl+Arrow up - move task up */
        onCtrlArrowUp: () => void;
        /** Ctrl+Arrow down - move task down */
        onCtrlArrowDown: () => void;
        /** F2 - enter edit mode */
        onF2: () => void;
        /** Escape - cancel/exit */
        onEscape: () => void;
        /** Link selected tasks */
        onLinkSelected: () => void;
        /** Toggle driving path mode */
        onDrivingPath: () => void;
    };
    
    // =========================================================================
    // Config
    // =========================================================================
    
    /** Storage key for localStorage */
    storageKey: string;
    /** Container element for modals */
    modalContainer: HTMLElement;
}

/**
 * Bundle of all subordinate services created by the factory
 */
export interface SubordinateServicesBundle {
    /** Column preferences and header management */
    columnPreferencesService: ColumnPreferencesService;
    /** Excel-style grid cell navigation */
    gridNavigationController: GridNavigationController;
    /** Viewport facade creation */
    viewportFactoryService: ViewportFactoryService;
    /** Task CRUD, hierarchy, movement */
    taskOperationsService: TaskOperationsService;
    /** View state, navigation, edit mode */
    viewStateService: ViewStateService;
    /** Right-click context menus */
    contextMenuService: ContextMenuService;
    /** Modal dialogs and panels */
    modalCoordinator: ModalCoordinator;
    /** File open, save, import, export */
    fileOperationsService: FileOperationsService;
    /** Baseline set, clear, variance */
    baselineService: BaselineService;
    /** Trade partner CRUD and task assignment */
    tradePartnerService: TradePartnerService;
    /** Dependency validation and cycle detection */
    dependencyValidationService: DependencyValidationService;
    /** Keyboard binding configuration */
    keyboardBindingService: KeyboardBindingService;
    /** Test data generation utility */
    testDataGenerator: TestDataGenerator;
}

/**
 * Factory interface for creating subordinate services
 * 
 * The factory captures static dependencies (ProjectController, SelectionModel, etc.)
 * in a closure and accepts runtime context from SchedulerService.
 * 
 * @example
 * ```typescript
 * // In main.ts - create factory with static deps
 * const factory = createSubordinateFactory({
 *     projectController,
 *     selectionModel,
 *     // ... other static deps
 * });
 * 
 * // In SchedulerService.init() - create services with runtime context
 * const services = factory.createAll({
 *     getGrid: () => this.grid,
 *     getGantt: () => this.gantt,
 *     // ... other runtime callbacks
 * });
 * ```
 */
export interface SchedulerSubordinateFactory {
    /**
     * Create all subordinate services with proper dependency wiring
     * 
     * @param context - Runtime context from SchedulerService
     * @returns Bundle of all created services
     */
    createAll(context: SubordinateFactoryContext): SubordinateServicesBundle;
}
