/**
 * @fileoverview Factory Implementation for SchedulerService Subordinates
 * @module services/scheduler/createSubordinateFactory
 * 
 * Creates the subordinate factory with all static dependencies captured in closure.
 * Cross-dependencies between services are handled using forward references.
 * 
 * ARCHITECTURE:
 * - Static dependencies (ProjectController, etc.) are captured in the factory closure
 * - Runtime context (getGrid, getGantt, callbacks) is provided by SchedulerService
 * - Cross-dependencies use forward references (let _viewStateService) resolved at runtime
 * 
 * @see docs/PURE_DI_SUBORDINATE_FACTORY_PLAN.md
 */

import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ColumnRegistry } from '../../core/columns/ColumnRegistry';
import type { ViewCoordinator } from '../migration/ViewCoordinator';
import type { ToastService } from '../../ui/services/ToastService';
import type { FileService } from '../../ui/services/FileService';
import type { TradePartnerStore } from '../../data/TradePartnerStore';
import type { PersistenceService } from '../../data/PersistenceService';
import { KeyboardService } from '../../ui/services/KeyboardService';

import { TaskOperationsService } from './TaskOperationsService';
import { ViewStateService } from './ViewStateService';
import { ColumnPreferencesService } from './ColumnPreferencesService';
import { GridNavigationController } from './GridNavigationController';
import { ContextMenuService } from './ContextMenuService';
import { ModalCoordinator } from './ModalCoordinator';
import { FileOperationsService } from './FileOperationsService';
import { BaselineService } from './BaselineService';
import { TradePartnerService } from './TradePartnerService';
import { DependencyValidationService } from './DependencyValidationService';
import { ViewportFactoryService } from './ViewportFactoryService';
import { KeyboardBindingService } from './KeyboardBindingService';
import { TestDataGenerator } from '../../utils/TestDataGenerator';

import type { 
    SchedulerSubordinateFactory, 
    SubordinateFactoryContext,
    SubordinateServicesBundle 
} from './SchedulerSubordinateFactory';

/**
 * Static dependencies captured by the factory closure
 * These are available at factory creation time (in main.ts)
 */
export interface FactoryDependencies {
    /** ProjectController for data operations */
    projectController: ProjectController;
    /** SelectionModel for selection state */
    selectionModel: SelectionModel;
    /** EditingStateManager for edit mode tracking */
    editingStateManager: EditingStateManager;
    /** CommandService for command execution */
    commandService: CommandService;
    /** ColumnRegistry for column definitions */
    columnRegistry: ColumnRegistry;
    /** ViewCoordinator for reactive rendering (may be null) */
    viewCoordinator: ViewCoordinator | null;
    /** ToastService for user notifications */
    toastService: ToastService;
    /** FileService for file operations */
    fileService: FileService;
    /** TradePartnerStore for trade partner data (may be null) */
    tradePartnerStore: TradePartnerStore | null;
    /** PersistenceService for database operations (may be null) */
    persistenceService: PersistenceService | null;
}

/**
 * Create the subordinate factory with captured dependencies
 * 
 * The factory captures static dependencies in a closure, allowing SchedulerService
 * to request service creation without knowing about the complex dependency graph.
 * 
 * @param deps - Static dependencies available at factory creation time
 * @returns Factory that can create all subordinate services
 * 
 * @example
 * ```typescript
 * // In main.ts
 * const factory = createSubordinateFactory({
 *     projectController,
 *     selectionModel,
 *     editingStateManager,
 *     // ... other deps
 * });
 * 
 * // Pass to SchedulerService
 * const scheduler = new SchedulerService({
 *     subordinateFactory: factory,
 *     // ... other options
 * });
 * ```
 */
export function createSubordinateFactory(deps: FactoryDependencies): SchedulerSubordinateFactory {
    const {
        projectController,
        selectionModel,
        editingStateManager,
        commandService,
        columnRegistry,
        viewCoordinator,
        toastService,
        fileService,
        tradePartnerStore,
        persistenceService,
    } = deps;

    return {
        createAll(ctx: SubordinateFactoryContext): SubordinateServicesBundle {
            console.log('[SubordinateFactory] Creating all subordinate services...');
            
            // ═══════════════════════════════════════════════════════════════════
            // PHASE 1: Independent Services (no sibling dependencies)
            // These services don't depend on other subordinates
            // ═══════════════════════════════════════════════════════════════════
            
            const viewportFactoryService = new ViewportFactoryService({});
            console.log('[SubordinateFactory] ✅ ViewportFactoryService');
            
            const gridNavigationController = new GridNavigationController({
                getVisibleTaskIds: () => {
                    return projectController.getVisibleTasks((id) => {
                        const task = projectController.getTaskById(id);
                        return task?._collapsed || false;
                    }).map(t => t.id);
                },
                getNavigableColumns: () => {
                    return ctx.getColumnDefinitions()
                        .filter(col => 
                            col.type === 'text' || 
                            col.type === 'number' || 
                            col.type === 'date' || 
                            col.type === 'select' || 
                            col.type === 'name' || 
                            col.type === 'schedulingMode'
                        )
                        .map(col => col.field);
                },
                isEditing: () => editingStateManager.isEditing(),
            });
            console.log('[SubordinateFactory] ✅ GridNavigationController');
            
            const dependencyValidationService = new DependencyValidationService({
                projectController,
            });
            console.log('[SubordinateFactory] ✅ DependencyValidationService');
            
            const testDataGenerator = new TestDataGenerator({
                projectController,
                toastService,
            });
            console.log('[SubordinateFactory] ✅ TestDataGenerator');

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 2: Cross-Dependent Services (use forward references)
            // ColumnPreferencesService ↔ ViewStateService have mutual dependencies
            // We use `let` variables that are assigned after creation
            // ═══════════════════════════════════════════════════════════════════
            
            // Forward references for circular dependencies
            // These are assigned after service creation but before callbacks are invoked
            let _viewStateService: ViewStateService;
            let _columnPreferencesService: ColumnPreferencesService;

            // Create ColumnPreferencesService first (needed early for header build)
            const columnPreferencesService = new ColumnPreferencesService({
                projectController,
                selectionModel,
                columnRegistry,
                toastService,
                getGrid: ctx.getGrid,
                render: ctx.render,
                // Forward reference - will be valid when callback is invoked at runtime
                updateSelection: () => _viewStateService?.updateSelection(),
            });
            _columnPreferencesService = columnPreferencesService;
            console.log('[SubordinateFactory] ✅ ColumnPreferencesService');

            // Create ViewStateService with forward reference to ColumnPreferencesService
            const viewStateService = new ViewStateService({
                projectController,
                selectionModel,
                editingStateManager,
                commandService,
                viewCoordinator: viewCoordinator!,
                getGrid: ctx.getGrid,
                getGantt: ctx.getGantt,
                // Forward references - use local variables (closure), NOT ctx accessors
                getColumnDefinitions: () => _columnPreferencesService.getColumnDefinitions(),
                closeDrawer: ctx.closeDrawer,
                isDrawerOpen: ctx.isDrawerOpen,
                onSelectionChange: ctx.handleSelectionChange,
                updateHeaderCheckboxState: (checkbox) => _columnPreferencesService.updateHeaderCheckboxState(checkbox),
            });
            _viewStateService = viewStateService;
            console.log('[SubordinateFactory] ✅ ViewStateService');

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 3: Services that depend on Phase 2 services
            // These use forward references to access Phase 2 services
            // ═══════════════════════════════════════════════════════════════════

            const taskOperationsService = new TaskOperationsService({
                projectController,
                selectionModel,
                editingStateManager,
                commandService,
                toastService,
                getGrid: ctx.getGrid,
                getGantt: ctx.getGantt,
                saveCheckpoint: ctx.saveCheckpoint,
                enterEditMode: ctx.enterEditMode,
                isInitialized: ctx.isInitialized,
                // Use local reference (closure) to ViewStateService
                updateHeaderCheckboxState: () => _viewStateService.updateHeaderCheckboxState(),
            });
            console.log('[SubordinateFactory] ✅ TaskOperationsService');

            const contextMenuService = new ContextMenuService({
                insertBlankRowAbove: ctx.insertBlankRowAbove,
                insertBlankRowBelow: ctx.insertBlankRowBelow,
                convertBlankToTask: ctx.convertBlankToTask,
                deleteTask: ctx.deleteTask,
                openProperties: ctx.openProperties,
            });
            console.log('[SubordinateFactory] ✅ ContextMenuService');

            const modalCoordinator = new ModalCoordinator({
                projectController,
                selectionModel,
                columnRegistry,
                onDependenciesSave: ctx.handleDependenciesSave,
                onCalendarSave: ctx.handleCalendarSave,
                onColumnPreferencesSave: ctx.updateColumnPreferences,
                getColumnPreferences: ctx.getColumnPreferences,
                // Use local reference (closure) to ViewStateService
                updateSelection: () => _viewStateService.updateSelection(),
            });
            console.log('[SubordinateFactory] ✅ ModalCoordinator');

            const fileOperationsService = new FileOperationsService({
                projectController,
                fileService,
                toastService,
                persistenceService,
                saveCheckpoint: ctx.saveCheckpoint,
                saveData: ctx.saveData,
                recalculateAll: ctx.recalculateAll,
                storageKey: ctx.storageKey,
            });
            console.log('[SubordinateFactory] ✅ FileOperationsService');

            const baselineService = new BaselineService({
                projectController,
                columnRegistry,
                toastService,
                saveCheckpoint: ctx.saveCheckpoint,
                saveData: ctx.saveData,
                // Use local reference (closure) to ColumnPreferencesService
                rebuildGridColumns: () => _columnPreferencesService.rebuildGridColumns(),
                getCalendar: ctx.getCalendar,
            });
            console.log('[SubordinateFactory] ✅ BaselineService');

            const tradePartnerService = new TradePartnerService({
                projectController,
                tradePartnerStore: tradePartnerStore!,
                persistenceService,
                toastService,
                viewCoordinator,
                notifyDataChange: ctx.notifyDataChange,
            });
            console.log('[SubordinateFactory] ✅ TradePartnerService');

            const keyboardBindingService = new KeyboardBindingService({
                actions: ctx.keyboardActions,
                KeyboardServiceClass: KeyboardService,
            });
            console.log('[SubordinateFactory] ✅ KeyboardBindingService');

            // NOTE: modalCoordinator.initialize() is NOT called here.
            // It must be called AFTER the bundle is assigned to SchedulerService
            // because getColumnPreferences() needs this.columnPreferencesService.

            console.log('[SubordinateFactory] ✅ All subordinate services created');

            // Return the complete bundle
            return {
                columnPreferencesService,
                gridNavigationController,
                viewportFactoryService,
                taskOperationsService,
                viewStateService,
                contextMenuService,
                modalCoordinator,
                fileOperationsService,
                baselineService,
                tradePartnerService,
                dependencyValidationService,
                keyboardBindingService,
                testDataGenerator,
            };
        }
    };
}
