// @ts-check
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

import { CPM } from '../core/CPM.js';
import { DateUtils } from '../core/DateUtils.js';
import { TaskStore } from '../data/TaskStore.js';
import { CalendarStore } from '../data/CalendarStore.js';
import { HistoryManager } from '../data/HistoryManager.js';
import { ToastService } from '../ui/services/ToastService.js';
import { FileService } from '../ui/services/FileService.js';
import { KeyboardService } from '../ui/services/KeyboardService.js';
import { SyncService } from './SyncService.js';
import { VirtualScrollGrid } from '../ui/components/VirtualScrollGrid.js';
import { CanvasGantt } from '../ui/components/CanvasGantt.js';
import { SideDrawer } from '../ui/components/SideDrawer.js';
import { DependenciesModal } from '../ui/components/DependenciesModal.js';
import { CalendarModal } from '../ui/components/CalendarModal.js';

/**
 * Main scheduler service - orchestrates the entire application
 * @class
 */
export class SchedulerService {
    /**
     * Storage key for localStorage persistence
     * @type {string}
     */
    static STORAGE_KEY = 'pro_scheduler_v10';

    /**
     * Link types supported
     * @type {string[]}
     */
    static LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

    /**
     * Constraint types supported
     * @type {string[]}
     */
    static CONSTRAINT_TYPES = ['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'];

    /**
     * Create a new SchedulerService instance
     * 
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.gridContainer - Container for the grid
     * @param {HTMLElement} options.ganttContainer - Container for the Gantt
     * @param {HTMLElement} options.drawerContainer - Container for side drawer
     * @param {HTMLElement} options.modalContainer - Container for modals
     * @param {boolean} options.isTauri - Whether running in Tauri environment
     */
    constructor(options = {}) {
        this.options = options;
        this.isTauri = options.isTauri || false;

        // Initialize services
        this._initServices();

        // Selection state (managed here, not in store - UI concern)
        this.selectedIds = new Set();
        this.focusedId = null;
        this.anchorId = null;

        // View state
        this.viewMode = 'Week';
        this.clipboard = null;

        // UI components (initialized in init())
        this.grid = null;
        this.gantt = null;
        this.drawer = null;
        this.dependenciesModal = null;
        this.calendarModal = null;

        // Performance tracking
        this._lastCalcTime = 0;
        this._renderScheduled = false;
        this._isRecalculating = false; // Prevent infinite recursion

        // Initialize if containers provided
        if (options.gridContainer && options.ganttContainer) {
            this.init();
        }
    }

    /**
     * Initialize all services
     * @private
     */
    _initServices() {
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
    init() {
        const { gridContainer, ganttContainer, drawerContainer, modalContainer } = this.options;

        // Create grid component
        this.grid = new VirtualScrollGrid(gridContainer, {
            rowHeight: 38,
            columns: this._getColumnDefinitions(),
            isParent: (id) => this.taskStore.isParent(id),
            getDepth: (id) => this.taskStore.getDepth(id),
            onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
            onRowDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onCellChange: (taskId, field, value) => this._handleCellChange(taskId, field, value),
            onAction: (taskId, action, e) => this._handleAction(taskId, action, e),
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onScroll: (scrollTop) => this._syncScrollToGantt(scrollTop),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
        });

        // Create Gantt component
        this.gantt = new CanvasGantt(ganttContainer, {
            rowHeight: 38,
            isParent: (id) => this.taskStore.isParent(id),
            onBarClick: (taskId, e) => this._handleRowClick(taskId, e),
            onBarDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onBarDrag: (task, start, end) => this._handleBarDrag(task, start, end),
            onScroll: (scrollTop) => this._syncScrollToGrid(scrollTop),
        });

        // Create sync service
        this.syncService = new SyncService({
            grid: this.grid,
            gantt: this.gantt
        });

        // Create side drawer
        if (drawerContainer) {
            this.drawer = new SideDrawer({
                container: drawerContainer,
                onUpdate: (taskId, field, value) => this._handleDrawerUpdate(taskId, field, value),
                onDelete: (taskId) => this.deleteTask(taskId),
                onOpenLinks: (taskId) => this.openDependencies(taskId),
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

        // Initialize keyboard shortcuts
        this._initKeyboard();

        // Load persisted data
        try {
            this.loadData();
            console.log('[SchedulerService] Data loaded');
        } catch (error) {
            console.error('[SchedulerService] Error loading data:', error);
            // Continue anyway - start with empty tasks
        }

        // Initial render (with error handling)
        try {
            this.recalculateAll();
            console.log('[SchedulerService] Initial recalculation complete');
        } catch (error) {
            console.error('[SchedulerService] Error in initial recalculation:', error);
            // Continue anyway - scheduler can work without CPM calculation
        }
        
        try {
            this.render();
            console.log('[SchedulerService] Initial render complete');
        } catch (error) {
            console.error('[SchedulerService] Error in initial render:', error);
            // Continue anyway - UI might still work
        }

        console.log('[SchedulerService] Initialized - VS Code of Scheduling Tools');
    }

    /**
     * Initialize keyboard shortcuts
     * @private
     */
    _initKeyboard() {
        this.keyboardService = new KeyboardService({
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
    }

    /**
     * Get column definitions for the grid
     * @private
     * @returns {Array<Object>} Column definitions
     */
    _getColumnDefinitions() {
        return [
            {
                field: 'drag',
                type: 'drag',
                width: 28,
                align: 'center',
            },
            {
                field: 'checkbox',
                type: 'checkbox',
                width: 30,
                align: 'center',
            },
            {
                field: 'rowNum',
                type: 'readonly',
                width: 35,
                align: 'center',
                render: (task, meta) => `<span style="color: #94a3b8; font-size: 11px;">${meta.index + 1}</span>`,
            },
            {
                field: 'name',
                type: 'text',
                width: 220,
            },
            {
                field: 'duration',
                type: 'number',
                width: 50,
                align: 'center',
                readonlyForParent: true,
            },
            {
                field: 'start',
                type: 'date',
                width: 100,
                showConstraintIcon: true,
                readonlyForParent: true,
            },
            {
                field: 'end',
                type: 'date',
                width: 100,
                showConstraintIcon: true,
                readonlyForParent: true,
            },
            {
                field: 'constraintType',
                type: 'select',
                width: 80,
                options: [
                    { value: 'asap', label: 'ASAP' },
                    { value: 'snet', label: 'SNET' },
                    { value: 'snlt', label: 'SNLT' },
                    { value: 'fnet', label: 'FNET' },
                    { value: 'fnlt', label: 'FNLT' },
                    { value: 'mfo', label: 'MFO' },
                ],
                readonlyForParent: true,
            },
            {
                field: 'actions',
                type: 'actions',
                width: 80,
                actions: [
                    { id: 'collapse', label: '▼', title: 'Collapse/Expand' },
                    { id: 'indent', label: '→', title: 'Indent' },
                    { id: 'outdent', label: '←', title: 'Outdent' },
                    { id: 'links', label: '🔗', title: 'Dependencies' },
                    { id: 'delete', label: '🗑', title: 'Delete' },
                ],
            },
        ];
    }

    // =========================================================================
    // DATA ACCESS (delegated to stores)
    // =========================================================================

    /**
     * Get all tasks
     * @returns {Array<Object>} All tasks
     */
    get tasks() {
        return this.taskStore.getAll();
    }

    /**
     * Set all tasks
     * @param {Array<Object>} tasks - Tasks array
     */
    set tasks(tasks) {
        this.taskStore.setAll(tasks);
    }

    /**
     * Get calendar configuration
     * @returns {Object} Calendar object
     */
    get calendar() {
        return this.calendarStore.get();
    }

    /**
     * Set calendar configuration
     * @param {Object} calendar - Calendar object
     */
    set calendar(calendar) {
        this.calendarStore.set(calendar);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    /**
     * Handle row click
     * @private
     * @param {string} taskId - Task ID
     * @param {Event} e - Click event
     */
    _handleRowClick(taskId, e) {
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
    }

    /**
     * Handle row double-click
     * @private
     * @param {string} taskId - Task ID
     * @param {Event} e - Double-click event
     */
    _handleRowDoubleClick(taskId, e) {
        this.openDrawer(taskId);
    }

    /**
     * Handle cell change
     * @private
     * @param {string} taskId - Task ID
     * @param {string} field - Field name
     * @param {*} value - New value
     */
    _handleCellChange(taskId, field, value) {
        this.saveCheckpoint();
        
        const task = this.taskStore.getById(taskId);
        if (!task) return;

        // Update task
        this.taskStore.update(taskId, { [field]: value });

        // Recalculate if date/duration changed
        if (['start', 'end', 'duration'].includes(field)) {
            this.recalculateAll();
        } else {
            this.render();
        }

        this.saveData();
    }

    /**
     * Handle action button click
     * @private
     * @param {string} taskId - Task ID
     * @param {string} action - Action ID
     * @param {Event} e - Click event
     */
    _handleAction(taskId, action, e) {
        switch (action) {
            case 'collapse':
                this.toggleCollapse(taskId);
                break;
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
     * Handle drawer update
     * @private
     * @param {string} taskId - Task ID
     * @param {string} field - Field name
     * @param {*} value - New value
     */
    _handleDrawerUpdate(taskId, field, value) {
        this.saveCheckpoint();
        this.taskStore.update(taskId, { [field]: value });
        
        if (['start', 'end', 'duration'].includes(field)) {
            this.recalculateAll();
        } else {
            this.render();
        }
        
        this.saveData();
    }

    /**
     * Handle dependencies save
     * @private
     * @param {string} taskId - Task ID
     * @param {Array<Object>} dependencies - Dependencies array
     */
    _handleDependenciesSave(taskId, dependencies) {
        this.saveCheckpoint();
        this.taskStore.update(taskId, { dependencies });
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Handle calendar save
     * @private
     * @param {Object} calendar - Calendar configuration
     */
    _handleCalendarSave(calendar) {
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
     * @param {Array<string>} taskIds - Task IDs being moved
     * @param {string} targetId - Target task ID
     * @param {string} position - 'above' or 'below'
     */
    _handleRowMove(taskIds, targetId, position) {
        // TODO: Implement drag and drop reordering
        this.toastService.info('Drag and drop reordering coming soon');
    }

    /**
     * Handle bar drag in Gantt
     * @private
     * @param {Object} task - Task object
     * @param {string} start - New start date
     * @param {string} end - New end date
     */
    _handleBarDrag(task, start, end) {
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
     * @param {string} key - 'ArrowUp' or 'ArrowDown'
     * @param {boolean} shiftKey - Shift key pressed
     * @param {boolean} ctrlKey - Ctrl key pressed
     */
    _handleArrowNavigation(key, shiftKey, ctrlKey) {
        const visibleTasks = this.taskStore.getVisibleTasks((id) => {
            const task = this.taskStore.getById(id);
            return task?._collapsed || false;
        });
        
        if (visibleTasks.length === 0) return;

        let currentIndex = -1;
        if (this.focusedId) {
            currentIndex = visibleTasks.findIndex(t => t.id === this.focusedId);
        }

        let newIndex;
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
     * @param {string} key - 'ArrowLeft' or 'ArrowRight'
     */
    _handleArrowCollapse(key) {
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
     * Handle Tab indent
     * @private
     */
    _handleTabIndent() {
        if (this.selectedIds.size === 0) return;
        this.selectedIds.forEach(id => this.indent(id));
    }

    /**
     * Handle Shift+Tab outdent
     * @private
     */
    _handleTabOutdent() {
        if (this.selectedIds.size === 0) return;
        this.selectedIds.forEach(id => this.outdent(id));
    }

    /**
     * Handle Escape key
     * @private
     */
    _handleEscape() {
        if (this.drawer && this.drawer.isDrawerOpen()) {
            this.drawer.close();
        } else {
            this.selectedIds.clear();
            this._updateSelection();
        }
    }

    // =========================================================================
    // SCROLL SYNCHRONIZATION
    // =========================================================================

    /**
     * Sync scroll from grid to Gantt
     * @private
     * @param {number} scrollTop - Scroll position
     */
    _syncScrollToGantt(scrollTop) {
        if (this.syncService) {
            this.syncService.syncGridToGantt(scrollTop);
        }
    }

    /**
     * Sync scroll from Gantt to grid
     * @private
     * @param {number} scrollTop - Scroll position
     */
    _syncScrollToGrid(scrollTop) {
        if (this.syncService) {
            this.syncService.syncGanttToGrid(scrollTop);
        }
    }

    // =========================================================================
    // TASK OPERATIONS
    // =========================================================================

    /**
     * Get a task by ID
     * @param {string} id - Task ID
     * @returns {Object|undefined} Task or undefined
     */
    getTask(id) {
        return this.taskStore.getById(id);
    }

    /**
     * Check if task is a parent
     * @param {string} id - Task ID
     * @returns {boolean} True if parent
     */
    isParent(id) {
        return this.taskStore.isParent(id);
    }

    /**
     * Get task depth
     * @param {string} id - Task ID
     * @returns {number} Depth level
     */
    getDepth(id) {
        return this.taskStore.getDepth(id);
    }

    /**
     * Add a new task
     * @param {Object} taskData - Task data
     * @returns {Object} Created task
     */
    addTask(taskData = {}) {
        try {
            this.saveCheckpoint();
            
            const today = DateUtils.today();
            const task = {
                id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: taskData.name || 'New Task',
                start: taskData.start || today,
                end: taskData.end || today,
                duration: taskData.duration || 1,
                parentId: taskData.parentId || null,
                dependencies: taskData.dependencies || [],
                progress: taskData.progress || 0,
                constraintType: taskData.constraintType || 'asap',
                constraintDate: taskData.constraintDate || '',
                notes: taskData.notes || '',
                _collapsed: false,
                ...taskData
            };

            console.log('[SchedulerService] Adding task:', task);
            this.taskStore.add(task);
            console.log('[SchedulerService] Task added to store. Total tasks:', this.taskStore.getAll().length);
            
            this.recalculateAll();
            this.saveData();
            
            // Select and focus the new task
            this.selectedIds.clear();
            this.selectedIds.add(task.id);
            this.focusedId = task.id;
            this._updateSelection();
            
            // Render and scroll to new task
            this.render();
            
            // Scroll to task after render completes
            requestAnimationFrame(() => {
                if (this.grid) {
                    this.grid.scrollToTask(task.id);
                    // Focus the name cell for immediate editing
                    setTimeout(() => {
                        this.grid.focusCell(task.id, 'name');
                    }, 100);
                }
            });
            
            this.toastService.success('Task added');
            
            return task;
        } catch (error) {
            console.error('[SchedulerService] Error adding task:', error);
            this.toastService.error('Failed to add task: ' + error.message);
            throw error;
        }
    }

    /**
     * Delete a task
     * @param {string} taskId - Task ID
     */
    deleteTask(taskId) {
        this.saveCheckpoint();
        
        // Delete children recursively
        const deleteRecursive = (id) => {
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
    _deleteSelected() {
        if (this.selectedIds.size === 0) return;
        
        this.saveCheckpoint();
        const idsToDelete = Array.from(this.selectedIds);
        
        idsToDelete.forEach(id => {
            const deleteRecursive = (taskId) => {
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
     * @param {string} taskId - Task ID
     */
    toggleCollapse(taskId) {
        const task = this.taskStore.getById(taskId);
        if (!task) return;

        this.taskStore.update(taskId, {
            _collapsed: !task._collapsed
        });
        
        this.render();
    }

    /**
     * Indent a task (make it a child)
     * @param {string} taskId - Task ID
     */
    indent(taskId) {
        this.saveCheckpoint();
        
        const task = this.taskStore.getById(taskId);
        if (!task || task.parentId) return; // Already has parent

        const tasks = this.taskStore.getAll();
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        
        // Find previous sibling or parent
        for (let i = taskIndex - 1; i >= 0; i--) {
            const potentialParent = tasks[i];
            const depth = this.taskStore.getDepth(potentialParent.id);
            const taskDepth = this.taskStore.getDepth(taskId);
            
            if (depth < taskDepth) {
                // Found a parent-level task
                this.taskStore.update(taskId, { parentId: potentialParent.id });
                break;
            } else if (depth === taskDepth && potentialParent.parentId) {
                // Found a sibling with a parent
                this.taskStore.update(taskId, { parentId: potentialParent.parentId });
                break;
            }
        }

        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Outdent a task (remove from parent)
     * @param {string} taskId - Task ID
     */
    outdent(taskId) {
        this.saveCheckpoint();
        
        const task = this.taskStore.getById(taskId);
        if (!task || !task.parentId) return;

        const parent = this.taskStore.getById(task.parentId);
        this.taskStore.update(taskId, {
            parentId: parent ? parent.parentId : null
        });

        this.recalculateAll();
        this.saveData();
        this.render();
    }

    /**
     * Insert task above focused task
     */
    insertTaskAbove() {
        if (!this.focusedId) {
            this.addTask();
            return;
        }

        const tasks = this.taskStore.getAll();
        const focusedIndex = tasks.findIndex(t => t.id === this.focusedId);
        const focusedTask = tasks[focusedIndex];
        
        const newTask = this.addTask({
            parentId: focusedTask.parentId
        });

        // Move to correct position (simplified - would need proper reordering)
        this.selectedIds.clear();
        this.selectedIds.add(newTask.id);
        this.focusedId = newTask.id;
        this._updateSelection();
    }

    /**
     * Move selected tasks vertically
     * @param {number} direction - -1 for up, 1 for down
     */
    moveSelectedTasks(direction) {
        // TODO: Implement task reordering
        this.toastService.info('Task reordering coming soon');
    }

    /**
     * Enter edit mode for focused task
     */
    enterEditMode() {
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
    _updateSelection() {
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId);
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
    }

    /**
     * Copy selected tasks
     */
    copySelected() {
        if (this.selectedIds.size === 0) {
            this.toastService.info('No tasks selected');
            return;
        }

        const selected = this.taskStore.getAll().filter(t => this.selectedIds.has(t.id));
        
        // Include children
        const payload = new Set();
        const getDescendants = (parentId) => {
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

        this.clipboard = Array.from(payload).map(t => ({ ...t }));
        this.toastService.success(`Copied ${this.clipboard.length} task(s)`);
    }

    /**
     * Cut selected tasks
     */
    cutSelected() {
        this.copySelected();
        this._deleteSelected();
    }

    /**
     * Paste tasks
     */
    paste() {
        if (!this.clipboard || this.clipboard.length === 0) {
            this.toastService.info('Nothing to paste');
            return;
        }

        this.saveCheckpoint();

        const targetId = this.focusedId;
        const tasks = this.taskStore.getAll();
        let targetIndex = targetId ? tasks.findIndex(t => t.id === targetId) : tasks.length - 1;
        if (targetIndex === -1) targetIndex = tasks.length - 1;

        const targetTask = tasks[targetIndex];
        const targetParentId = targetTask ? targetTask.parentId : null;

        const idMap = new Map();
        const newTasks = [];

        // Create new tasks with new IDs
        this.clipboard.forEach(task => {
            const newId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            idMap.set(task.id, newId);
            const newTask = { ...task, id: newId };
            newTasks.push(newTask);
        });

        // Update parent IDs and dependencies
        newTasks.forEach(task => {
            if (task.parentId && idMap.has(task.parentId)) {
                task.parentId = idMap.get(task.parentId);
            } else {
                task.parentId = targetParentId;
            }

            task.dependencies = task.dependencies.map(dep => {
                if (idMap.has(dep.id)) {
                    return { ...dep, id: idMap.get(dep.id) };
                }
                return dep;
            }).filter(dep => idMap.has(dep.id) || this.taskStore.getById(dep.id));
        });

        // Insert tasks
        newTasks.forEach(task => {
            this.taskStore.add(task);
        });

        // Select new tasks
        this.selectedIds.clear();
        newTasks.forEach(t => this.selectedIds.add(t.id));

        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.toastService.success(`Pasted ${newTasks.length} task(s)`);
    }

    // =========================================================================
    // UI MODAL OPERATIONS
    // =========================================================================

    /**
     * Open drawer for a task
     * @param {string} taskId - Task ID
     */
    openDrawer(taskId) {
        const task = this.taskStore.getById(taskId);
        if (!task || !this.drawer) return;
        this.drawer.open(task);
    }

    /**
     * Close drawer
     */
    closeDrawer() {
        if (this.drawer) {
            this.drawer.close();
        }
    }

    /**
     * Open dependencies modal
     * @param {string} taskId - Task ID
     */
    openDependencies(taskId) {
        const task = this.taskStore.getById(taskId);
        if (!task || !this.dependenciesModal) return;
        this.dependenciesModal.open(task);
    }

    /**
     * Open calendar modal
     */
    openCalendar() {
        if (!this.calendarModal) return;
        this.calendarModal.open(this.calendarStore.get());
    }

    // =========================================================================
    // CPM CALCULATIONS
    // =========================================================================

    /**
     * Recalculate all tasks using CPM
     */
    recalculateAll() {
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
            const originalOnChange = this.taskStore.options.onChange;
            this.taskStore.options.onChange = null;

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
                    });
                }
            });

            // Restore onChange
            this.taskStore.options.onChange = originalOnChange;

            // Roll up parent dates
            this._rollupParentDates();

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
    _rollupParentDates() {
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
    _onTasksChanged() {
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
    _onCalendarChanged() {
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
    render() {
        // Batch renders for performance
        if (this._renderScheduled) return;
        
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderScheduled = false;
            
            // Get all tasks (not just visible) for the grid
            // The grid handles its own visibility filtering
            const allTasks = this.taskStore.getAll();
            
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
    loadData() {
        try {
            const saved = localStorage.getItem(SchedulerService.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.tasks) {
                    // Temporarily disable onChange to prevent recursion during load
                    const originalOnChange = this.taskStore.options.onChange;
                    this.taskStore.options.onChange = null;
                    this.taskStore.setAll(parsed.tasks);
                    this.taskStore.options.onChange = originalOnChange;
                }
                if (parsed.calendar) {
                    this.calendarStore.set(parsed.calendar);
                }
            } else {
                // Create sample data for first-time users
                this._createSampleData();
            }
        } catch (err) {
            console.error('[SchedulerService] Load data failed:', err);
            // Don't create sample data if load failed - might cause more errors
            // Just start with empty tasks
            const originalOnChange = this.taskStore.options.onChange;
            this.taskStore.options.onChange = null;
            this.taskStore.setAll([]);
            this.taskStore.options.onChange = originalOnChange;
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
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
    _createSampleData() {
        const today = DateUtils.today();
        const calendar = this.calendarStore.get(); // Get calendar from store
        
        const tasks = [
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
                constraintDate: '',
                notes: 'Initial project setup and planning',
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
                constraintDate: '',
                notes: '',
                _collapsed: false,
            },
        ];

        console.log('[SchedulerService] Creating sample data:', tasks.length, 'tasks');
        
        // Temporarily disable onChange to prevent recursion
        const originalOnChange = this.taskStore.options.onChange;
        this.taskStore.options.onChange = null;
        this.taskStore.setAll(tasks);
        this.taskStore.options.onChange = originalOnChange;
        
        // Recalculate after a brief delay to ensure everything is set up
        setTimeout(() => {
            try {
                this.recalculateAll();
            } catch (error) {
                console.error('[SchedulerService] Error recalculating sample data:', error);
            }
        }, 100);
        
        console.log('[SchedulerService] Sample data created. Total tasks:', this.taskStore.getAll().length);
    }

    // =========================================================================
    // HISTORY (UNDO/REDO)
    // =========================================================================

    /**
     * Save checkpoint for undo/redo
     */
    saveCheckpoint() {
        const snapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });
        this.historyManager.saveCheckpoint(snapshot);
    }

    /**
     * Undo last action
     */
    undo() {
        const currentSnapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });

        const previousSnapshot = this.historyManager.undo(currentSnapshot);
        if (!previousSnapshot) {
            this.toastService.info('Nothing to undo');
            return;
        }

        const previous = JSON.parse(previousSnapshot);
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
    redo() {
        const currentSnapshot = JSON.stringify({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });

        const nextSnapshot = this.historyManager.redo(currentSnapshot);
        if (!nextSnapshot) {
            this.toastService.info('Nothing to redo');
            return;
        }

        const next = JSON.parse(nextSnapshot);
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
     * @returns {Promise<void>}
     */
    async saveToFile() {
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
     * @returns {Promise<void>}
     */
    async openFromFile() {
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
    exportAsDownload() {
        this.fileService.exportAsDownload({
            tasks: this.taskStore.getAll(),
            calendar: this.calendarStore.get(),
        });
    }

    /**
     * Import from file
     * @param {File} file - File object
     * @returns {Promise<void>}
     */
    async importFromFile(file) {
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
     * @param {File} file - XML file
     * @returns {Promise<void>}
     */
    async importFromMSProjectXML(file) {
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
    exportToMSProjectXML() {
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
    zoomIn() {
        const modes = ['Month', 'Week', 'Day'];
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
    zoomOut() {
        const modes = ['Month', 'Week', 'Day'];
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
     * @param {string} mode - View mode: 'Day', 'Week', or 'Month'
     */
    setViewMode(mode) {
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
     * @returns {Object} Stats object
     */
    getStats() {
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
     * @param {number} count - Number of tasks to generate
     */
    generateMockTasks(count) {
        this.saveCheckpoint();
        
        const today = new Date();
        const calendar = this.calendarStore.get();
        const tasks = [];
        
        for (let i = 0; i < count; i++) {
            const duration = Math.floor(Math.random() * 10) + 1;
            const startOffset = Math.floor(Math.random() * 200);
            const startDate = DateUtils.addWorkDays(DateUtils.today(), startOffset, calendar);
            const endDate = DateUtils.addWorkDays(startDate, duration - 1, calendar);
            
            const task = {
                id: `mock_${i}_${Date.now()}`,
                name: `Task ${i + 1} - ${this._randomTaskName()}`,
                start: startDate,
                end: endDate,
                duration: duration,
                parentId: null,
                dependencies: [],
                progress: Math.floor(Math.random() * 100),
                constraintType: 'asap',
                constraintDate: '',
                notes: '',
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
     * @returns {string} Random task name
     */
    _randomTaskName() {
        const prefixes = ['Install', 'Frame', 'Pour', 'Paint', 'Finish', 'Inspect', 'Test', 'Review'];
        const suffixes = ['Foundation', 'Walls', 'Roof', 'Windows', 'Doors', 'Electrical', 'Plumbing', 'HVAC'];
        return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
    }

    /**
     * Clean up resources
     */
    destroy() {
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

