/**
 * ============================================================================
 * SchedulerEngine.js
 * ============================================================================
 * 
 * Integration layer that connects VirtualScrollGrid, CanvasGantt, and UI modals.
 * Handles synchronization, state management, and provides a unified API.
 * 
 * RESPONSIBILITIES:
 * 1. Data Management - Tasks, calendar, undo/redo history
 * 2. View Coordination - Sync scrolling between grid and Gantt
 * 3. Selection Management - Multi-select, range select, focus
 * 4. Event Routing - User actions to state mutations
 * 5. Modal Coordination - Side drawer, dependencies, calendar modals
 * 6. CPM Delegation - Delegates calculations to CPM module
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import { CPM } from './core/CPM.js';
import { DateUtils } from './core/DateUtils.js';
import { VirtualScrollGrid } from './ui/components/VirtualScrollGrid.js';
import { CanvasGantt } from './ui/components/CanvasGantt.js';
import { SideDrawer } from './ui/components/SideDrawer.js';
import { DependenciesModal } from './ui/components/DependenciesModal.js';
import { CalendarModal } from './ui/components/CalendarModal.js';

/**
 * @fileoverview Scheduler engine - main application orchestrator
 * @module services/SchedulerEngine
 * 
 * Integration layer that connects VirtualScrollGrid, CanvasGantt, and UI modals.
 * Handles synchronization, state management, and provides a unified API.
 * 
 * RESPONSIBILITIES:
 * 1. Data Management - Tasks, calendar, undo/redo history
 * 2. View Coordination - Sync scrolling between grid and Gantt
 * 3. Selection Management - Multi-select, range select, focus
 * 4. Event Routing - User actions to state mutations
 * 5. Modal Coordination - Side drawer, dependencies, calendar modals
 * 6. CPM Delegation - Delegates calculations to CPM module
 */
export class SchedulerEngine {
    
    // =========================================================================
    // STATIC CONSTANTS
    // =========================================================================
    
    static STORAGE_KEY = 'pro_scheduler_v10';
    static MAX_HISTORY = 50;
    static LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
    static CONSTRAINT_TYPES = ['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'];

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================
    
    /**
     * Create a new SchedulerEngine instance
     * 
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.gridContainer - Container for the grid
     * @param {HTMLElement} options.ganttContainer - Container for the Gantt
     * @param {HTMLElement} options.drawerContainer - Container for side drawer
     * @param {HTMLElement} options.modalContainer - Container for modals
     * @param {Function} options.onToast - Callback for toast notifications
     */
    constructor(options = {}) {
        // Configuration
        this.options = options;
        
        // Core data state
        this.tasks = [];
        this.calendar = {
            workingDays: [1, 2, 3, 4, 5], // Mon(1) - Fri(5)
            exceptions: {},               // "YYYY-MM-DD": "Reason"
        };
        
        // Selection state
        this.selectedIds = new Set();
        this.focusedId = null;
        this.anchorId = null;
        
        // History state (for undo/redo)
        this.history = [];
        this.future = [];
        
        // View state
        this.viewMode = 'Week';
        this.clipboard = null;
        
        // Child components
        this.grid = null;
        this.gantt = null;
        this.drawer = null;
        this.dependenciesModal = null;
        this.calendarModal = null;
        
        // Sync state
        this._isSyncingScroll = false;
        
        // Performance tracking
        this._lastCalcTime = 0;
        
        // Initialize if containers provided
        if (options.gridContainer && options.ganttContainer) {
            this.init();
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize the scheduler with containers
     */
    init() {
        const { gridContainer, ganttContainer, drawerContainer, modalContainer } = this.options;
        
        // Create VirtualScrollGrid
        this.grid = new VirtualScrollGrid(gridContainer, {
            rowHeight: 38,
            columns: this._getColumnDefinitions(),
            isParent: (id) => this.isParent(id),
            getDepth: (id) => this.getDepth(id),
            onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
            onRowDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onCellChange: (taskId, field, value) => this._handleCellChange(taskId, field, value),
            onAction: (taskId, action, e) => this._handleAction(taskId, action, e),
            onToggleCollapse: (taskId) => this.toggleCollapse(taskId),
            onScroll: (scrollTop) => this._syncScrollToGantt(scrollTop),
            onRowMove: (taskIds, targetId, position) => this._handleRowMove(taskIds, targetId, position),
        });
        
        // Create CanvasGantt
        this.gantt = new CanvasGantt(ganttContainer, {
            rowHeight: 38,
            isParent: (id) => this.isParent(id),
            onBarClick: (taskId, e) => this._handleRowClick(taskId, e),
            onBarDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
            onBarDrag: (task, start, end) => this._handleBarDrag(task, start, end),
            onScroll: (scrollTop) => this._syncScrollToGrid(scrollTop),
        });
        
        // Create Side Drawer
        if (drawerContainer) {
            this.drawer = new SideDrawer({
                container: drawerContainer,
                onUpdate: (taskId, field, value) => this._handleDrawerUpdate(taskId, field, value),
                onDelete: (taskId) => this.deleteTask(taskId),
                onOpenLinks: (taskId) => this.openDependencies(taskId),
            });
        }
        
        // Create Modals
        const modalsContainer = modalContainer || document.body;
        
        this.dependenciesModal = new DependenciesModal({
            container: modalsContainer,
            getTasks: () => this.tasks,
            isParent: (id) => this.isParent(id),
            onSave: (taskId, deps) => this._handleDependenciesSave(taskId, deps),
        });
        
        this.calendarModal = new CalendarModal({
            container: modalsContainer,
            onSave: (calendar) => this._handleCalendarSave(calendar),
        });
        
        // Bind keyboard shortcuts
        this._bindKeyboardShortcuts();
        
        // Load persisted data
        this.loadData();
        
        // Initial render
        this.recalculateAll();
        this.render();
        
        console.log('[SchedulerEngine] Initialized with modals');
    }

    /**
     * Get column definitions for the grid
     * @private
     * @returns {Array} Column definitions
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
                width: 110,
                showConstraintIcon: true,
            },
            {
                field: 'end',
                type: 'date',
                width: 95,
                showConstraintIcon: true,
            },
            {
                field: 'constraintType',
                type: 'select',
                width: 70,
                align: 'center',
                options: [
                    { value: 'asap', label: 'ASAP' },
                    { value: 'snet', label: 'SNET' },
                    { value: 'snlt', label: 'SNLT' },
                    { value: 'fnet', label: 'FNET' },
                    { value: 'fnlt', label: 'FNLT' },
                    { value: 'mfo', label: 'MFO' },
                ],
            },
            {
                field: 'actions',
                type: 'actions',
                width: 120,
                actions: [
                    {
                        name: 'outdent',
                        icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 9l-5 5-5-5"/></svg>`,
                        title: 'Outdent',
                        color: '#64748b',
                    },
                    {
                        name: 'indent',
                        icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 9l5 5 5-5"/></svg>`,
                        title: 'Indent',
                        color: '#64748b',
                    },
                    {
                        name: 'links',
                        icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
                        title: 'Dependencies',
                        color: '#6366f1',
                        showIf: (task, meta) => !meta.isParent,
                    },
                    {
                        name: 'delete',
                        icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
                        title: 'Delete',
                        color: '#ef4444',
                    },
                ],
            },
        ];
    }

    // =========================================================================
    // MODAL HANDLERS
    // =========================================================================
    
    /**
     * Open the side drawer for a task
     * @param {string} taskId 
     */
    openDrawer(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !this.drawer) return;
        
        this.drawer.open(task, {
            isParent: this.isParent(taskId),
        });
    }
    
    /**
     * Close the side drawer
     */
    closeDrawer() {
        if (this.drawer) {
            this.drawer.close();
        }
    }

    /**
     * Open dependencies modal for a task
     * @param {string} taskId 
     */
    openDependencies(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !this.dependenciesModal) return;
        
        this.dependenciesModal.open(task);
    }

    /**
     * Open the calendar modal
     */
    openCalendar() {
        if (!this.calendarModal) return;
        this.calendarModal.open(this.calendar);
    }

    /**
     * Handle drawer field update
     * @private
     */
    _handleDrawerUpdate(taskId, field, value) {
        this._handleCellChange(taskId, field, value);
        
        // Sync drawer with updated task
        const task = this.tasks.find(t => t.id === taskId);
        if (task && this.drawer) {
            this.drawer.sync(task);
        }
    }

    /**
     * Handle dependencies save from modal
     * @private
     */
    _handleDependenciesSave(taskId, dependencies) {
        this.saveCheckpoint();
        
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        task.dependencies = dependencies;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast('Dependencies updated', 'success');
    }

    /**
     * Handle calendar save from modal
     * @private
     */
    _handleCalendarSave(calendar) {
        this.saveCheckpoint();
        
        this.calendar = calendar;
        
        this._toast('Calendar updated. Recalculating...', 'success');
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    // =========================================================================
    // DATA MANAGEMENT
    // =========================================================================
    
    /**
     * Load data from localStorage
     */
    loadData() {
        try {
            const saved = localStorage.getItem(SchedulerEngine.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                this.tasks = parsed.tasks || [];
                this.calendar = parsed.calendar || this.calendar;
            } else {
                // Create sample data if none exists
                this._createSampleData();
            }
        } catch (e) {
            console.warn('[SchedulerEngine] Failed to load data:', e);
            this._createSampleData();
        }
    }

    /**
     * Create sample data for new users
     * @private
     */
    _createSampleData() {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        this.tasks = [
            {
                id: '1',
                name: 'Project Phase 1',
                start: '',
                end: '',
                duration: 0,
                parentId: null,
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: '',
                _collapsed: false,
            },
            {
                id: '2',
                name: 'Planning & Setup',
                start: todayStr,
                end: '',
                duration: 3,
                parentId: '1',
                dependencies: [],
                progress: 0,
                constraintType: 'asap',
                constraintDate: '',
            },
            {
                id: '3',
                name: 'Development',
                start: '',
                end: '',
                duration: 5,
                parentId: '1',
                dependencies: [{ id: '2', type: 'FS', lag: 0 }],
                progress: 0,
                constraintType: 'asap',
                constraintDate: '',
            },
        ];
        
        this.calendar = { workingDays: [1, 2, 3, 4, 5], exceptions: {} };
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        try {
            localStorage.setItem(SchedulerEngine.STORAGE_KEY, JSON.stringify({
                tasks: this.tasks,
                calendar: this.calendar,
            }));
        } catch (e) {
            console.warn('[SchedulerEngine] Failed to save data:', e);
        }
    }

    /**
     * Save a checkpoint for undo
     */
    saveCheckpoint() {
        const snapshot = JSON.stringify({
            tasks: this.tasks,
            calendar: this.calendar,
        });
        
        // Don't save if nothing changed
        if (this.history.length > 0 && this.history[this.history.length - 1] === snapshot) {
            return;
        }
        
        this.history.push(snapshot);
        
        // Limit history size
        if (this.history.length > SchedulerEngine.MAX_HISTORY) {
            this.history.shift();
        }
        
        // Clear future on new action
        this.future = [];
    }

    /**
     * Undo the last action
     */
    undo() {
        if (this.history.length === 0) {
            this._toast('Nothing to undo', 'info');
            return;
        }
        
        this.future.push(JSON.stringify({
            tasks: this.tasks,
            calendar: this.calendar,
        }));
        
        const previous = JSON.parse(this.history.pop());
        this.tasks = previous.tasks;
        this.calendar = previous.calendar || this.calendar;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        this._toast('Undone', 'info');
    }

    /**
     * Redo the last undone action
     */
    redo() {
        if (this.future.length === 0) {
            this._toast('Nothing to redo', 'info');
            return;
        }
        
        this.history.push(JSON.stringify({
            tasks: this.tasks,
            calendar: this.calendar,
        }));
        
        const next = JSON.parse(this.future.pop());
        this.tasks = next.tasks;
        this.calendar = next.calendar || this.calendar;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        this._toast('Redone', 'info');
    }

    // =========================================================================
    // FILE SYSTEM I/O
    // =========================================================================
    
    /**
     * Check if File System Access API is supported
     * @returns {boolean}
     */
    static isFileSystemAccessSupported() {
        return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
    }
    
    /**
     * Save schedule to local file system using File System Access API
     */
    async saveToFile() {
        try {
            const options = {
                suggestedName: 'My_Schedule.json',
                types: [{
                    description: 'Pro Logic Schedule',
                    accept: { 'application/json': ['.json'] },
                }],
            };
            const handle = await window.showSaveFilePicker(options);
            
            const writable = await handle.createWritable();
            const data = JSON.stringify({ 
                tasks: this.tasks, 
                calendar: this.calendar,
                exportedAt: new Date().toISOString(),
                version: '2.0.0',
            }, null, 2);
            
            await writable.write(data);
            await writable.close();
            
            this._toast('Saved to disk successfully', 'success');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[SchedulerEngine] Save to file failed:', err);
                throw err;
            }
        }
    }

    /**
     * Open schedule from local file system using File System Access API
     */
    async openFromFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Pro Logic Schedule',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            
            const file = await handle.getFile();
            const text = await file.text();
            const parsed = JSON.parse(text);
            
            if (parsed.tasks) {
                this.saveCheckpoint();
                this.tasks = parsed.tasks;
                this.calendar = parsed.calendar || this.calendar;
                this.recalculateAll();
                this.saveData();
                this.render();
                this._toast(`Schedule loaded (${this.tasks.length} tasks)`, 'success');
            } else {
                throw new Error('Invalid schedule file format');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[SchedulerEngine] Open from file failed:', err);
                this._toast('Failed to open file - invalid format', 'error');
                throw err;
            }
        }
    }

    /**
     * Export schedule as downloadable JSON
     */
    exportAsDownload() {
        const data = JSON.stringify({ 
            tasks: this.tasks, 
            calendar: this.calendar,
            exportedAt: new Date().toISOString(),
            version: '2.0.0',
        }, null, 2);
        
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `Schedule_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this._toast('Schedule exported', 'success');
    }

    /**
     * Import schedule from file input
     * @param {File} file - The file object from an input element
     */
    async importFromFile(file) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            
            if (parsed.tasks) {
                this.saveCheckpoint();
                this.tasks = parsed.tasks;
                this.calendar = parsed.calendar || this.calendar;
                this.recalculateAll();
                this.saveData();
                this.render();
                this._toast(`Schedule imported (${this.tasks.length} tasks)`, 'success');
            } else {
                throw new Error('Invalid format');
            }
        } catch (err) {
            console.error('[SchedulerEngine] Import failed:', err);
            this._toast('Failed to import - invalid file', 'error');
        }
    }

    // =========================================================================
    // MS PROJECT XML IMPORT/EXPORT
    // =========================================================================
    
    /**
     * Import schedule from MS Project XML file
     * @param {File} file - The XML file
     */
    async importFromMSProjectXML(file) {
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            
            // Check for parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML file');
            }
            
            // Find tasks in the XML
            // MS Project XML uses namespace, but we'll try both with and without
            let xmlTasks = xmlDoc.querySelectorAll('Task');
            if (xmlTasks.length === 0) {
                xmlTasks = xmlDoc.getElementsByTagName('Task');
            }
            
            if (xmlTasks.length === 0) {
                throw new Error('No tasks found in XML file');
            }
            
            this.saveCheckpoint();
            
            const importedTasks = [];
            const uidToIdMap = new Map(); // Map MS Project UID to our ID
            
            // First pass: Create tasks
            Array.from(xmlTasks).forEach((xmlTask, index) => {
                const uid = this._getXMLValue(xmlTask, 'UID');
                const name = this._getXMLValue(xmlTask, 'Name');
                const duration = this._getXMLValue(xmlTask, 'Duration');
                const start = this._getXMLValue(xmlTask, 'Start');
                const finish = this._getXMLValue(xmlTask, 'Finish');
                const outlineLevel = parseInt(this._getXMLValue(xmlTask, 'OutlineLevel') || '1');
                const summary = this._getXMLValue(xmlTask, 'Summary') === '1';
                const percentComplete = parseInt(this._getXMLValue(xmlTask, 'PercentComplete') || '0');
                const constraintType = this._getXMLValue(xmlTask, 'ConstraintType');
                const constraintDate = this._getXMLValue(xmlTask, 'ConstraintDate');
                const notes = this._getXMLValue(xmlTask, 'Notes');
                
                // Skip empty names or summary task "0"
                if (!name || uid === '0') return;
                
                const taskId = `imported_${uid}_${Date.now()}`;
                uidToIdMap.set(uid, taskId);
                
                // Parse duration (PT8H0M0S format or just days)
                let durationDays = 1;
                if (duration) {
                    const durationMatch = duration.match(/PT(\d+)H/);
                    if (durationMatch) {
                        durationDays = Math.max(1, Math.round(parseInt(durationMatch[1]) / 8));
                    } else {
                        durationDays = parseInt(duration) || 1;
                    }
                }
                
                // Parse dates
                const startDate = start ? start.split('T')[0] : '';
                const endDate = finish ? finish.split('T')[0] : '';
                
                // Map constraint types
                const constraintMap = {
                    '0': 'asap',   // As Soon As Possible
                    '1': 'alap',   // As Late As Possible
                    '2': 'mso',    // Must Start On
                    '3': 'mfo',    // Must Finish On
                    '4': 'snet',   // Start No Earlier Than
                    '5': 'snlt',   // Start No Later Than
                    '6': 'fnet',   // Finish No Earlier Than
                    '7': 'fnlt',   // Finish No Later Than
                };
                
                const task = {
                    id: taskId,
                    name: name,
                    start: startDate,
                    end: endDate,
                    duration: durationDays,
                    parentId: null,
                    dependencies: [],
                    progress: percentComplete,
                    constraintType: constraintMap[constraintType] || 'asap',
                    constraintDate: constraintDate ? constraintDate.split('T')[0] : '',
                    notes: notes || '',
                    _collapsed: false,
                    _outlineLevel: outlineLevel,
                    _msProjectUID: uid,
                };
                
                importedTasks.push(task);
            });
            
            // Second pass: Set up hierarchy based on outline levels
            for (let i = 0; i < importedTasks.length; i++) {
                const task = importedTasks[i];
                const level = task._outlineLevel || 1;
                
                // Find parent (previous task with lower outline level)
                for (let j = i - 1; j >= 0; j--) {
                    const potentialParent = importedTasks[j];
                    if ((potentialParent._outlineLevel || 1) < level) {
                        task.parentId = potentialParent.id;
                        break;
                    }
                }
            }
            
            // Third pass: Parse dependencies
            Array.from(xmlTasks).forEach((xmlTask) => {
                const uid = this._getXMLValue(xmlTask, 'UID');
                const taskId = uidToIdMap.get(uid);
                if (!taskId) return;
                
                const task = importedTasks.find(t => t.id === taskId);
                if (!task) return;
                
                // Find predecessor links
                const predLinks = xmlTask.querySelectorAll('PredecessorLink');
                Array.from(predLinks).forEach(link => {
                    const predUID = this._getXMLValue(link, 'PredecessorUID');
                    const linkType = this._getXMLValue(link, 'Type');
                    const lagDuration = this._getXMLValue(link, 'LinkLag');
                    
                    const predTaskId = uidToIdMap.get(predUID);
                    if (predTaskId) {
                        // Link types: 0=FF, 1=FS, 2=SF, 3=SS
                        const typeMap = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
                        
                        // Lag is in tenths of minutes, convert to days
                        let lagDays = 0;
                        if (lagDuration) {
                            lagDays = Math.round(parseInt(lagDuration) / (10 * 60 * 8));
                        }
                        
                        task.dependencies.push({
                            id: predTaskId,
                            type: typeMap[linkType] || 'FS',
                            lag: lagDays,
                        });
                    }
                });
            });
            
            // Clean up temporary properties
            importedTasks.forEach(task => {
                delete task._outlineLevel;
                delete task._msProjectUID;
            });
            
            this.tasks = importedTasks;
            this.recalculateAll();
            this.saveData();
            this.render();
            
            this._toast(`Imported ${importedTasks.length} tasks from MS Project`, 'success');
            
        } catch (err) {
            console.error('[SchedulerEngine] MS Project XML import failed:', err);
            this._toast('Failed to import MS Project XML: ' + err.message, 'error');
        }
    }
    
    /**
     * Helper to get value from XML element
     * @private
     */
    _getXMLValue(parent, tagName) {
        const el = parent.querySelector(tagName) || parent.getElementsByTagName(tagName)[0];
        return el ? el.textContent : '';
    }
    
    /**
     * Export schedule to MS Project XML format
     */
    exportToMSProjectXML() {
        const today = new Date().toISOString();
        const projectName = 'Pro Logic Schedule';
        
        // Build XML string
        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
    <Name>${projectName}</Name>
    <CreationDate>${today}</CreationDate>
    <LastSaved>${today}</LastSaved>
    <ScheduleFromStart>1</ScheduleFromStart>
    <StartDate>${this._getProjectStartDate()}</StartDate>
    <FinishDate>${this._getProjectEndDate()}</FinishDate>
    <DefaultStartTime>08:00:00</DefaultStartTime>
    <DefaultFinishTime>17:00:00</DefaultFinishTime>
    <MinutesPerDay>480</MinutesPerDay>
    <MinutesPerWeek>2400</MinutesPerWeek>
    <DaysPerMonth>20</DaysPerMonth>
    <CalendarUID>1</CalendarUID>
    
    <Calendars>
        <Calendar>
            <UID>1</UID>
            <Name>Standard</Name>
            <IsBaseCalendar>1</IsBaseCalendar>
            <WeekDays>
${this._generateCalendarWeekDays()}
            </WeekDays>
${this._generateCalendarExceptions()}
        </Calendar>
    </Calendars>
    
    <Tasks>
        <Task>
            <UID>0</UID>
            <ID>0</ID>
            <Name>${projectName}</Name>
            <Type>1</Type>
            <IsNull>0</IsNull>
            <CreateDate>${today}</CreateDate>
            <WBS>0</WBS>
            <OutlineNumber>0</OutlineNumber>
            <OutlineLevel>0</OutlineLevel>
            <Priority>500</Priority>
            <Start>${this._getProjectStartDate()}T08:00:00</Start>
            <Finish>${this._getProjectEndDate()}T17:00:00</Finish>
            <Duration>${this._formatDuration(this._getProjectDuration())}</Duration>
            <DurationFormat>7</DurationFormat>
            <Summary>1</Summary>
            <Critical>0</Critical>
            <Milestone>0</Milestone>
            <PercentComplete>0</PercentComplete>
            <CalendarUID>1</CalendarUID>
        </Task>
${this._generateTasksXML()}
    </Tasks>
</Project>`;
        
        // Download the XML file
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `Schedule_${new Date().toISOString().split('T')[0]}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this._toast('Exported to MS Project XML', 'success');
    }
    
    /**
     * Generate tasks XML
     * @private
     */
    _generateTasksXML() {
        let xml = '';
        const flatList = this.getFlatList();
        
        // Create ID to UID mapping (UIDs start at 1 for actual tasks)
        const idToUID = new Map();
        flatList.forEach((task, index) => {
            idToUID.set(task.id, index + 1);
        });
        
        flatList.forEach((task, index) => {
            const uid = index + 1;
            const depth = this.getDepth(task.id);
            const isParent = this.isParent(task.id);
            const isCritical = task._isCritical ? 1 : 0;
            
            // Calculate WBS number
            const wbs = this._calculateWBS(task, flatList);
            
            // Constraint type mapping
            const constraintMap = {
                'asap': '0',
                'alap': '1',
                'mso': '2',
                'mfo': '3',
                'snet': '4',
                'snlt': '5',
                'fnet': '6',
                'fnlt': '7',
            };
            
            xml += `        <Task>
            <UID>${uid}</UID>
            <ID>${uid}</ID>
            <Name>${this._escapeXML(task.name)}</Name>
            <Type>1</Type>
            <IsNull>0</IsNull>
            <WBS>${wbs}</WBS>
            <OutlineNumber>${wbs}</OutlineNumber>
            <OutlineLevel>${depth + 1}</OutlineLevel>
            <Priority>500</Priority>
            <Start>${task.start || this._getProjectStartDate()}T08:00:00</Start>
            <Finish>${task.end || task.start || this._getProjectStartDate()}T17:00:00</Finish>
            <Duration>${this._formatDuration(task.duration || 1)}</Duration>
            <DurationFormat>7</DurationFormat>
            <Summary>${isParent ? 1 : 0}</Summary>
            <Critical>${isCritical}</Critical>
            <Milestone>${task.duration === 0 ? 1 : 0}</Milestone>
            <PercentComplete>${task.progress || 0}</PercentComplete>
            <ConstraintType>${constraintMap[task.constraintType] || '0'}</ConstraintType>
${task.constraintDate ? `            <ConstraintDate>${task.constraintDate}T08:00:00</ConstraintDate>\n` : ''}${task.notes ? `            <Notes>${this._escapeXML(task.notes)}</Notes>\n` : ''}${this._generatePredecessorLinks(task, idToUID)}
        </Task>\n`;
        });
        
        return xml;
    }
    
    /**
     * Generate predecessor links XML for a task
     * @private
     */
    _generatePredecessorLinks(task, idToUID) {
        if (!task.dependencies || task.dependencies.length === 0) return '';
        
        // Link types: 0=FF, 1=FS, 2=SF, 3=SS
        const typeMap = { 'FF': '0', 'FS': '1', 'SF': '2', 'SS': '3' };
        
        let xml = '';
        task.dependencies.forEach(dep => {
            const predUID = idToUID.get(dep.id);
            if (predUID) {
                // Lag in tenths of minutes (8 hours = 480 minutes = 4800 tenths per day)
                const lagTenths = (dep.lag || 0) * 4800;
                
                xml += `            <PredecessorLink>
                <PredecessorUID>${predUID}</PredecessorUID>
                <Type>${typeMap[dep.type] || '1'}</Type>
                <CrossProject>0</CrossProject>
                <LinkLag>${lagTenths}</LinkLag>
                <LagFormat>7</LagFormat>
            </PredecessorLink>\n`;
            }
        });
        
        return xml;
    }
    
    /**
     * Calculate WBS number for a task
     * @private
     */
    _calculateWBS(task, flatList) {
        const parts = [];
        let current = task;
        
        while (current) {
            // Find position among siblings
            const siblings = flatList.filter(t => t.parentId === current.parentId);
            const position = siblings.indexOf(current) + 1;
            parts.unshift(position);
            
            if (current.parentId) {
                current = flatList.find(t => t.id === current.parentId);
            } else {
                break;
            }
        }
        
        return parts.join('.');
    }
    
    /**
     * Generate calendar week days XML
     * @private
     */
    _generateCalendarWeekDays() {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let xml = '';
        
        for (let i = 1; i <= 7; i++) {
            const dayOfWeek = i % 7; // 1=Sun, 2=Mon, ..., 7=Sat in MS Project (0-indexed for JS)
            const isWorking = this.calendar.workingDays.includes(dayOfWeek === 0 ? 0 : dayOfWeek);
            
            xml += `                <WeekDay>
                    <DayType>${i}</DayType>
                    <DayWorking>${isWorking ? 1 : 0}</DayWorking>
${isWorking ? `                    <WorkingTimes>
                        <WorkingTime>
                            <FromTime>08:00:00</FromTime>
                            <ToTime>12:00:00</ToTime>
                        </WorkingTime>
                        <WorkingTime>
                            <FromTime>13:00:00</FromTime>
                            <ToTime>17:00:00</ToTime>
                        </WorkingTime>
                    </WorkingTimes>\n` : ''}                </WeekDay>\n`;
        }
        
        return xml;
    }
    
    /**
     * Generate calendar exceptions XML
     * @private
     */
    _generateCalendarExceptions() {
        if (!this.calendar.exceptions || Object.keys(this.calendar.exceptions).length === 0) {
            return '';
        }
        
        let xml = '            <Exceptions>\n';
        let exceptionIndex = 1;
        
        for (const [date, reason] of Object.entries(this.calendar.exceptions)) {
            xml += `                <Exception>
                    <UID>${exceptionIndex}</UID>
                    <Name>${this._escapeXML(reason)}</Name>
                    <Type>1</Type>
                    <Start>${date}T00:00:00</Start>
                    <Finish>${date}T23:59:00</Finish>
                    <DayWorking>0</DayWorking>
                </Exception>\n`;
            exceptionIndex++;
        }
        
        xml += '            </Exceptions>\n';
        return xml;
    }
    
    /**
     * Format duration in MS Project format (PT8H0M0S per day)
     * @private
     */
    _formatDuration(days) {
        const hours = days * 8;
        return `PT${hours}H0M0S`;
    }
    
    /**
     * Escape XML special characters
     * @private
     */
    _escapeXML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    
    /**
     * Get project start date
     * @private
     */
    _getProjectStartDate() {
        const dates = this.tasks.filter(t => t.start).map(t => t.start).sort();
        return dates[0] || new Date().toISOString().split('T')[0];
    }
    
    /**
     * Get project end date
     * @private
     */
    _getProjectEndDate() {
        const dates = this.tasks.filter(t => t.end).map(t => t.end).sort();
        return dates[dates.length - 1] || new Date().toISOString().split('T')[0];
    }
    
    /**
     * Get project duration in days
     * @private
     */
    _getProjectDuration() {
        const start = this._getProjectStartDate();
        const end = this._getProjectEndDate();
        return this._calcWorkDays(start, end) || 1;
    }

    // =========================================================================
    // CPM SCHEDULING
    // =========================================================================
    
    /**
     * Recalculate all task dates using CPM
     */
    recalculateAll() {
        const startTime = performance.now();
        
        // Forward pass
        let changed = true;
        let loops = 0;
        const maxLoops = 50;
        
        while (changed && loops < maxLoops) {
            changed = false;
            loops++;
            
            this.tasks.forEach(t => {
                if (this.isParent(t.id)) return;
                
                let earliestStart = null;
                
                // Calculate based on dependencies
                if (t.dependencies && t.dependencies.length > 0) {
                    t.dependencies.forEach(dep => {
                        const pred = this.tasks.find(x => x.id === dep.id);
                        if (pred && pred.start && pred.end) {
                            const lag = dep.lag || 0;
                            let depStart;
                            
                            switch (dep.type) {
                                case 'FS':
                                    depStart = this._addWorkDays(pred.end, 1 + lag);
                                    break;
                                case 'SS':
                                    depStart = this._addWorkDays(pred.start, lag);
                                    break;
                                case 'FF':
                                    depStart = this._addWorkDays(pred.end, lag - t.duration + 1);
                                    break;
                                case 'SF':
                                    depStart = this._addWorkDays(pred.start, lag - t.duration + 1);
                                    break;
                                default:
                                    depStart = this._addWorkDays(pred.end, 1 + lag);
                            }
                            
                            if (!earliestStart || depStart > earliestStart) {
                                earliestStart = depStart;
                            }
                        }
                    });
                }
                
                // Apply constraints
                const constType = t.constraintType || 'asap';
                const constDate = t.constraintDate;
                let finalStart = earliestStart;
                
                switch (constType) {
                    case 'snet':
                        if (constDate && (!finalStart || constDate > finalStart)) {
                            finalStart = constDate;
                        }
                        break;
                    case 'snlt':
                        if (constDate && (!finalStart || finalStart > constDate)) {
                            finalStart = constDate;
                        }
                        break;
                    case 'fnet':
                        if (constDate) {
                            const impliedStart = this._addWorkDays(constDate, -(t.duration - 1));
                            if (!finalStart || impliedStart > finalStart) {
                                finalStart = impliedStart;
                            }
                        }
                        break;
                    case 'fnlt':
                        if (constDate && !finalStart) {
                            finalStart = this._addWorkDays(constDate, -(t.duration - 1));
                        }
                        break;
                    case 'mfo':
                        if (constDate) {
                            t.end = constDate;
                            t.start = this._addWorkDays(constDate, -(t.duration - 1));
                            return;
                        }
                        break;
                    case 'asap':
                    default:
                        if (!finalStart && !t.start) {
                            finalStart = new Date().toISOString().split('T')[0];
                        }
                        break;
                }
                
                if (!finalStart) finalStart = t.start;
                
                if (t.start !== finalStart) {
                    t.start = finalStart;
                    changed = true;
                }
                
                if (t.start && t.duration >= 0) {
                    const newEnd = this._addWorkDays(t.start, t.duration - 1);
                    if (t.end !== newEnd) {
                        t.end = newEnd;
                        changed = true;
                    }
                }
            });
            
            // Calculate parent dates
            this.tasks.forEach(p => {
                if (!this.isParent(p.id)) return;
                const children = this.tasks.filter(c => c.parentId === p.id && c.start && c.end);
                if (children.length > 0) {
                    const starts = children.map(c => c.start).sort();
                    const ends = children.map(c => c.end).sort();
                    const minStart = starts[0];
                    const maxEnd = ends[ends.length - 1];
                    if (p.start !== minStart || p.end !== maxEnd) {
                        p.start = minStart;
                        p.end = maxEnd;
                        p.duration = this._calcWorkDays(minStart, maxEnd);
                        changed = true;
                    }
                }
            });
        }
        
        // Calculate critical path
        this._calcCriticalPath();
        
        this._lastCalcTime = performance.now() - startTime;
    }

    /**
     * Calculate critical path
     * @private
     */
    _calcCriticalPath() {
        this.tasks.forEach(t => t._isCritical = false);
        
        const validEnds = this.tasks.filter(t => t.end && !this.isParent(t.id)).map(t => t.end);
        if (validEnds.length === 0) return;
        
        const projectEnd = validEnds.sort().reverse()[0];
        
        const markCritical = (task) => {
            if (task._isCritical) return;
            task._isCritical = true;
            
            if (task.dependencies) {
                task.dependencies.forEach(dep => {
                    const pred = this.tasks.find(x => x.id === dep.id);
                    if (pred) markCritical(pred);
                });
            }
            
            if (task.parentId) {
                const parent = this.tasks.find(x => x.id === task.parentId);
                if (parent) parent._isCritical = true;
            }
        };
        
        this.tasks.forEach(t => {
            if (t.end === projectEnd && !this.isParent(t.id)) {
                const hasSuccessors = this.tasks.some(other => 
                    other.dependencies && other.dependencies.some(d => d.id === t.id)
                );
                if (!hasSuccessors) markCritical(t);
            }
        });
    }

    // =========================================================================
    // DATE UTILITIES
    // =========================================================================
    
    /**
     * Check if a date is a working day
     * @param {Date} date 
     * @returns {boolean}
     */
    isWorkDay(date) {
        const dayOfWeek = date.getDay();
        const dateStr = date.toISOString().split('T')[0];
        
        if (!this.calendar.workingDays.includes(dayOfWeek)) return false;
        if (this.calendar.exceptions[dateStr]) return false;
        
        return true;
    }

    /**
     * Add working days to a date
     * @private
     */
    _addWorkDays(dateStr, days) {
        if (!dateStr) return '';
        
        const date = new Date(dateStr + 'T12:00:00');
        if (days === 0) return dateStr;
        
        const direction = days >= 0 ? 1 : -1;
        let remaining = Math.abs(days);
        
        while (remaining > 0) {
            date.setDate(date.getDate() + direction);
            if (this.isWorkDay(date)) {
                remaining--;
            }
        }
        
        while (!this.isWorkDay(date)) {
            date.setDate(date.getDate() + direction);
        }
        
        return date.toISOString().split('T')[0];
    }

    /**
     * Calculate working days between two dates
     * @private
     */
    _calcWorkDays(startStr, endStr) {
        if (!startStr || !endStr) return 0;
        
        let current = new Date(startStr + 'T12:00:00');
        const end = new Date(endStr + 'T12:00:00');
        
        if (current > end) {
            [current, end] = [end, current];
        }
        
        let count = 0;
        while (current <= end) {
            if (this.isWorkDay(current)) count++;
            current.setDate(current.getDate() + 1);
        }
        
        return Math.max(1, count);
    }

    // =========================================================================
    // HIERARCHY HELPERS
    // =========================================================================
    
    isParent(id) {
        return this.tasks.some(t => t.parentId === id);
    }

    getDepth(id, depth = 0) {
        const task = this.tasks.find(t => t.id === id);
        if (task && task.parentId) {
            return this.getDepth(task.parentId, depth + 1);
        }
        return depth;
    }

    isVisible(taskId) {
        let curr = this.tasks.find(t => t.id === taskId);
        while (curr && curr.parentId) {
            const parent = this.tasks.find(p => p.id === curr.parentId);
            if (parent && parent._collapsed) return false;
            curr = parent;
        }
        return true;
    }

    toggleCollapse(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task && this.isParent(taskId)) {
            task._collapsed = !task._collapsed;
            this.render();
        }
    }

    getFlatList() {
        const result = [];
        
        const addChildren = (parentId) => {
            this.tasks
                .filter(t => t.parentId === parentId)
                .forEach(task => {
                    result.push(task);
                    addChildren(task.id);
                });
        };
        
        addChildren(null);
        
        const knownIds = new Set(result.map(t => t.id));
        this.tasks.forEach(t => {
            if (!knownIds.has(t.id)) {
                t.parentId = null;
                result.push(t);
            }
        });
        
        return result;
    }

    getVisibleTasks() {
        return this.getFlatList().filter(t => this.isVisible(t.id));
    }

    // =========================================================================
    // RENDERING
    // =========================================================================
    
    render() {
        const visibleTasks = this.getVisibleTasks();
        
        if (this.grid) {
            this.grid.setVisibleData(visibleTasks);
            this.grid.setSelection(this.selectedIds, this.focusedId);
        }
        
        if (this.gantt) {
            this.gantt.setData(visibleTasks);
            this.gantt.setSelection(this.selectedIds);
        }
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================
    
    _handleRowClick(taskId, e) {
        const visibleTasks = this.getVisibleTasks();
        const clickedIndex = visibleTasks.findIndex(t => t.id === taskId);
        
        this.focusedId = taskId;
        
        if (e.shiftKey && this.anchorId) {
            const anchorIndex = visibleTasks.findIndex(t => t.id === this.anchorId);
            const start = Math.min(anchorIndex, clickedIndex);
            const end = Math.max(anchorIndex, clickedIndex);
            
            this.selectedIds.clear();
            for (let i = start; i <= end; i++) {
                this.selectedIds.add(visibleTasks[i].id);
            }
        } else if (e.ctrlKey || e.metaKey) {
            if (this.selectedIds.has(taskId)) {
                this.selectedIds.delete(taskId);
            } else {
                this.selectedIds.add(taskId);
                this.anchorId = taskId;
            }
        } else {
            this.selectedIds.clear();
            this.selectedIds.add(taskId);
            this.anchorId = taskId;
        }
        
        this._updateSelection();
    }

    _handleRowDoubleClick(taskId, e) {
        this.openDrawer(taskId);
    }

    _handleCellChange(taskId, field, value) {
        this.saveCheckpoint();
        
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        switch (field) {
            case 'name':
                task.name = value;
                break;
            case 'duration':
                task.duration = Math.max(1, parseInt(value) || 1);
                break;
            case 'start':
                if (value) {
                    task.constraintType = 'snet';
                    task.constraintDate = value;
                }
                break;
            case 'end':
                if (value && !this.isParent(taskId)) {
                    task.duration = this._calcWorkDays(task.start, value);
                }
                break;
            case 'constraintType':
                task.constraintType = value;
                if (value === 'asap') {
                    task.constraintDate = '';
                }
                break;
            case 'constraintDate':
                task.constraintDate = value;
                break;
            case 'progress':
                task.progress = Math.min(100, Math.max(0, parseInt(value) || 0));
                break;
            case 'notes':
                task.notes = value;
                break;
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    _handleAction(taskId, action, e) {
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

    _handleBarDrag(task, start, end) {
        this.saveCheckpoint();
        
        const t = this.tasks.find(x => x.id === task.id);
        if (!t || this.isParent(t.id)) return;
        
        t.start = start;
        t.duration = this._calcWorkDays(start, end);
        t.constraintType = 'snet';
        t.constraintDate = start;
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    _updateSelection() {
        if (this.grid) {
            this.grid.setSelection(this.selectedIds, this.focusedId);
        }
        if (this.gantt) {
            this.gantt.setSelection(this.selectedIds);
        }
    }
    
    /**
     * Handle row move from drag and drop
     * @private
     */
    _handleRowMove(taskIds, targetId, position) {
        if (!taskIds || taskIds.length === 0 || !targetId) return;
        
        // Validate - can't drop on self or descendants
        for (const taskId of taskIds) {
            if (taskId === targetId) return;
            
            // Check if target is a descendant of any dragged task
            let current = this.tasks.find(t => t.id === targetId);
            while (current) {
                if (taskIds.includes(current.parentId)) {
                    this._toast('Cannot move task into its own children', 'error');
                    return;
                }
                current = this.tasks.find(t => t.id === current.parentId);
            }
        }
        
        this.saveCheckpoint();
        
        const target = this.tasks.find(t => t.id === targetId);
        if (!target) return;
        
        // Move each task
        for (const taskId of taskIds) {
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) continue;
            
            // Remove from current position
            const taskIndex = this.tasks.findIndex(t => t.id === taskId);
            this.tasks.splice(taskIndex, 1);
            
            // Update parent based on position
            if (position === 'child') {
                task.parentId = targetId;
            } else {
                task.parentId = target.parentId;
            }
            
            // Find new insertion point
            let insertIndex = this.tasks.findIndex(t => t.id === targetId);
            
            if (position === 'after' || position === 'child') {
                // Find the last descendant of target
                const getLastDescendantIndex = (id) => {
                    let lastIdx = this.tasks.findIndex(t => t.id === id);
                    this.tasks.forEach((t, idx) => {
                        if (t.parentId === id) {
                            const descIdx = getLastDescendantIndex(t.id);
                            if (descIdx > lastIdx) lastIdx = descIdx;
                        }
                    });
                    return lastIdx;
                };
                insertIndex = getLastDescendantIndex(targetId) + 1;
            }
            
            // Insert at new position
            this.tasks.splice(insertIndex, 0, task);
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast(`Moved ${taskIds.length} task(s)`, 'info');
    }

    // =========================================================================
    // SCROLL SYNCHRONIZATION
    // =========================================================================
    
    _syncScrollToGantt(scrollTop) {
        if (this._isSyncingScroll) return;
        this._isSyncingScroll = true;
        
        if (this.gantt) {
            this.gantt.setScrollTop(scrollTop);
        }
        
        requestAnimationFrame(() => {
            this._isSyncingScroll = false;
        });
    }

    _syncScrollToGrid(scrollTop) {
        if (this._isSyncingScroll) return;
        this._isSyncingScroll = true;
        
        if (this.grid) {
            this.grid.setScrollTop(scrollTop);
        }
        
        requestAnimationFrame(() => {
            this._isSyncingScroll = false;
        });
    }

    // =========================================================================
    // TASK OPERATIONS
    // =========================================================================
    
    addTask(options = {}) {
        this.saveCheckpoint();
        
        const today = new Date().toISOString().split('T')[0];
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
        
        const task = {
            id,
            name: options.name || 'New Task',
            start: options.start || today,
            end: options.end || today,
            duration: options.duration || 1,
            parentId: options.parentId || null,
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: '',
            _collapsed: false,
            ...options,
        };
        
        this.tasks.push(task);
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this.selectedIds.clear();
        this.selectedIds.add(id);
        this.focusedId = id;
        this._updateSelection();
        
        return task;
    }

    deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        const isParentTask = this.isParent(taskId);
        const message = isParentTask 
            ? `Delete "${task.name}" and all its children?`
            : `Delete "${task.name}"?`;
        
        if (!confirm(message)) return;
        
        this.saveCheckpoint();
        
        const idsToRemove = [taskId];
        
        if (isParentTask) {
            const getDescendants = (pid) => {
                this.tasks.filter(c => c.parentId === pid).forEach(c => {
                    idsToRemove.push(c.id);
                    getDescendants(c.id);
                });
            };
            getDescendants(taskId);
        }
        
        this.tasks = this.tasks.filter(t => !idsToRemove.includes(t.id));
        
        this.tasks.forEach(t => {
            t.dependencies = t.dependencies.filter(d => !idsToRemove.includes(d.id));
        });
        
        idsToRemove.forEach(id => this.selectedIds.delete(id));
        
        // Close drawer if showing deleted task
        if (this.drawer && idsToRemove.includes(this.drawer.getActiveTaskId())) {
            this.drawer.close();
        }
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast(`Deleted ${idsToRemove.length} task(s)`, 'info');
    }

    indent(taskId) {
        this.saveCheckpoint();
        
        const list = this.getFlatList();
        const idx = list.findIndex(t => t.id === taskId);
        
        if (idx <= 0) return;
        
        const task = list[idx];
        const prev = list[idx - 1];
        
        task.parentId = prev.id;
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    outdent(taskId) {
        this.saveCheckpoint();
        
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !task.parentId) return;
        
        const parent = this.tasks.find(p => p.id === task.parentId);
        task.parentId = parent ? parent.parentId : null;
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    // =========================================================================
    // KEYBOARD SHORTCUTS
    // =========================================================================
    
    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const isEditing = e.target.classList.contains('vsg-input') ||
                             e.target.classList.contains('form-input') ||
                             e.target.tagName === 'INPUT' ||
                             e.target.tagName === 'TEXTAREA' ||
                             e.target.tagName === 'SELECT';
            
            const isCtrl = e.ctrlKey || e.metaKey;
            
            // Undo/Redo (always active)
            if (isCtrl && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
                return;
            }
            if ((isCtrl && e.key === 'y') || (isCtrl && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                this.redo();
                return;
            }
            
            // Skip other shortcuts when editing
            if (isEditing) return;
            
            // Escape - close drawer or deselect
            if (e.key === 'Escape') {
                if (this.drawer && this.drawer.isDrawerOpen()) {
                    this.drawer.close();
                } else {
                    this.selectedIds.clear();
                    this._updateSelection();
                }
                return;
            }
            
            // Delete selected
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIds.size > 0) {
                e.preventDefault();
                this._deleteSelected();
                return;
            }
            
            // Tab = indent, Shift+Tab = outdent
            if (e.key === 'Tab' && this.selectedIds.size > 0) {
                e.preventDefault();
                if (e.shiftKey) {
                    this.selectedIds.forEach(id => this.outdent(id));
                } else {
                    this.selectedIds.forEach(id => this.indent(id));
                }
                return;
            }
            
            // Copy (Ctrl+C)
            if (isCtrl && e.key === 'c' && this.selectedIds.size > 0) {
                e.preventDefault();
                this.copySelected();
                return;
            }
            
            // Cut (Ctrl+X)
            if (isCtrl && e.key === 'x' && this.selectedIds.size > 0) {
                e.preventDefault();
                this.cutSelected();
                return;
            }
            
            // Paste (Ctrl+V)
            if (isCtrl && e.key === 'v' && this.clipboard) {
                e.preventDefault();
                this.paste();
                return;
            }
            
            // Insert key - add task above
            if (e.key === 'Insert') {
                e.preventDefault();
                this.insertTaskAbove();
                return;
            }
            
            // Ctrl+Arrow Up/Down - move task (check before regular arrow nav)
            if (isCtrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.selectedIds.size > 0) {
                e.preventDefault();
                this.moveSelectedTasks(e.key === 'ArrowUp' ? -1 : 1);
                return;
            }
            
            // Arrow key navigation (up/down)
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                this._handleArrowNavigation(e.key, e.shiftKey, isCtrl);
                return;
            }
            
            // Arrow Left/Right - collapse/expand
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.focusedId) {
                e.preventDefault();
                this._handleArrowCollapse(e.key);
                return;
            }
            
            // F2 - enter edit mode on focused task
            if (e.key === 'F2' && this.focusedId) {
                e.preventDefault();
                this.enterEditMode(this.focusedId);
                return;
            }
        });
    }
    
    /**
     * Enter edit mode for a task (focus the name input)
     * @param {string} taskId 
     */
    enterEditMode(taskId) {
        if (this.grid) {
            this.grid.focusCell(taskId, 'name');
        }
    }
    
    // =========================================================================
    // CLIPBOARD OPERATIONS
    // =========================================================================
    
    /**
     * Copy selected tasks to clipboard
     */
    copySelected() {
        if (this.selectedIds.size === 0) return;
        
        // Gather selected tasks and their descendants
        const tasksToCopy = [];
        const processedIds = new Set();
        
        const addTaskAndDescendants = (taskId) => {
            if (processedIds.has(taskId)) return;
            processedIds.add(taskId);
            
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;
            
            tasksToCopy.push(JSON.parse(JSON.stringify(task)));
            
            // Add descendants
            this.tasks.filter(t => t.parentId === taskId).forEach(child => {
                addTaskAndDescendants(child.id);
            });
        };
        
        this.selectedIds.forEach(id => addTaskAndDescendants(id));
        
        this.clipboard = {
            tasks: tasksToCopy,
            isCut: false,
        };
        
        this._toast(`Copied ${tasksToCopy.length} task(s)`, 'info');
    }
    
    /**
     * Cut selected tasks to clipboard
     */
    cutSelected() {
        if (this.selectedIds.size === 0) return;
        
        this.copySelected();
        this.clipboard.isCut = true;
        this.clipboard.originalIds = new Set(this.selectedIds);
        
        this._toast(`Cut ${this.clipboard.tasks.length} task(s)`, 'info');
    }
    
    /**
     * Paste tasks from clipboard
     */
    paste() {
        if (!this.clipboard || this.clipboard.tasks.length === 0) return;
        
        this.saveCheckpoint();
        
        // If cut, remove original tasks first
        if (this.clipboard.isCut && this.clipboard.originalIds) {
            this.tasks = this.tasks.filter(t => !this.clipboard.originalIds.has(t.id));
            this.tasks.forEach(t => {
                t.dependencies = t.dependencies.filter(d => !this.clipboard.originalIds.has(d.id));
            });
        }
        
        // Generate new IDs and update references
        const idMap = new Map();
        const newTasks = [];
        
        this.clipboard.tasks.forEach(task => {
            const newId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
            idMap.set(task.id, newId);
        });
        
        this.clipboard.tasks.forEach(task => {
            const newTask = { ...task };
            newTask.id = idMap.get(task.id);
            
            // Update parent reference
            if (task.parentId && idMap.has(task.parentId)) {
                newTask.parentId = idMap.get(task.parentId);
            } else if (this.focusedId && !idMap.has(task.parentId)) {
                // If pasting and there's a focused task, make it sibling
                const focusedTask = this.tasks.find(t => t.id === this.focusedId);
                newTask.parentId = focusedTask?.parentId || null;
            }
            
            // Update dependency references (only internal ones)
            newTask.dependencies = (task.dependencies || [])
                .filter(d => idMap.has(d.id))
                .map(d => ({
                    ...d,
                    id: idMap.get(d.id),
                }));
            
            // Append " (Copy)" to name if not cut
            if (!this.clipboard.isCut) {
                newTask.name = task.name + ' (Copy)';
            }
            
            newTasks.push(newTask);
        });
        
        // Insert tasks after focused task or at end
        if (this.focusedId) {
            const focusedIndex = this.tasks.findIndex(t => t.id === this.focusedId);
            this.tasks.splice(focusedIndex + 1, 0, ...newTasks);
        } else {
            this.tasks.push(...newTasks);
        }
        
        // Clear cut clipboard after paste
        if (this.clipboard.isCut) {
            this.clipboard = null;
        }
        
        // Select pasted tasks
        this.selectedIds.clear();
        newTasks.forEach(t => this.selectedIds.add(t.id));
        this.focusedId = newTasks[0]?.id;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast(`Pasted ${newTasks.length} task(s)`, 'success');
    }
    
    /**
     * Insert a new task above the current selection
     */
    insertTaskAbove() {
        this.saveCheckpoint();
        
        const visibleTasks = this.getVisibleTasks();
        const today = new Date().toISOString().split('T')[0];
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
        
        // Determine insert position and parent
        let insertIndex = 0;
        let parentId = null;
        
        if (this.focusedId) {
            const focusedTask = this.tasks.find(t => t.id === this.focusedId);
            insertIndex = this.tasks.findIndex(t => t.id === this.focusedId);
            parentId = focusedTask?.parentId || null;
        }
        
        const task = {
            id,
            name: 'New Task',
            start: today,
            end: today,
            duration: 1,
            parentId: parentId,
            dependencies: [],
            progress: 0,
            constraintType: 'asap',
            constraintDate: '',
            _collapsed: false,
        };
        
        this.tasks.splice(insertIndex, 0, task);
        
        this.selectedIds.clear();
        this.selectedIds.add(id);
        this.focusedId = id;
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast('Task inserted above', 'success');
    }
    
    // =========================================================================
    // ARROW KEY NAVIGATION
    // =========================================================================
    
    /**
     * Handle arrow up/down navigation
     * @private
     */
    _handleArrowNavigation(key, shiftKey, ctrlKey) {
        const visibleTasks = this.getVisibleTasks();
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
        
        // Scroll to task if needed
        if (this.grid) {
            this.grid.scrollToTask(newTaskId);
        }
    }
    
    /**
     * Handle arrow left/right for collapse/expand
     * @private
     */
    _handleArrowCollapse(key) {
        if (!this.focusedId) return;
        
        const isParentTask = this.isParent(this.focusedId);
        const task = this.tasks.find(t => t.id === this.focusedId);
        
        if (key === 'ArrowLeft') {
            if (isParentTask && !task._collapsed) {
                // Collapse
                task._collapsed = true;
                this.render();
            } else if (task.parentId) {
                // Go to parent
                this.selectedIds.clear();
                this.selectedIds.add(task.parentId);
                this.focusedId = task.parentId;
                this.anchorId = task.parentId;
                this._updateSelection();
            }
        } else if (key === 'ArrowRight') {
            if (isParentTask && task._collapsed) {
                // Expand
                task._collapsed = false;
                this.render();
            } else if (isParentTask) {
                // Go to first child
                const firstChild = this.tasks.find(t => t.parentId === this.focusedId);
                if (firstChild) {
                    this.selectedIds.clear();
                    this.selectedIds.add(firstChild.id);
                    this.focusedId = firstChild.id;
                    this.anchorId = firstChild.id;
                    this._updateSelection();
                }
            }
        }
    }
    
    // =========================================================================
    // ROW REORDERING
    // =========================================================================
    
    /**
     * Move selected tasks up or down
     * @param {number} direction - -1 for up, 1 for down
     */
    moveSelectedTasks(direction) {
        if (this.selectedIds.size === 0) return;
        
        this.saveCheckpoint();
        
        const flatList = this.getFlatList();
        const selectedIndices = [];
        
        // Get indices of selected tasks (only top-level of selection)
        flatList.forEach((task, idx) => {
            if (this.selectedIds.has(task.id)) {
                // Check if parent is also selected (skip if so)
                if (!task.parentId || !this.selectedIds.has(task.parentId)) {
                    selectedIndices.push(idx);
                }
            }
        });
        
        if (selectedIndices.length === 0) return;
        
        // Sort indices
        selectedIndices.sort((a, b) => direction === -1 ? a - b : b - a);
        
        // Check if move is possible
        if (direction === -1 && selectedIndices[0] === 0) return;
        if (direction === 1 && selectedIndices[selectedIndices.length - 1] === flatList.length - 1) return;
        
        // Perform the move
        selectedIndices.forEach(idx => {
            const targetIdx = idx + direction;
            if (targetIdx < 0 || targetIdx >= flatList.length) return;
            
            // Swap in the flat list
            const temp = flatList[idx];
            flatList[idx] = flatList[targetIdx];
            flatList[targetIdx] = temp;
        });
        
        // Rebuild tasks array from flat list
        this.tasks = flatList;
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }
    
    /**
     * Move a task to a new position (for drag and drop)
     * @param {string} taskId - Task to move
     * @param {string} targetId - Target task to insert before/after
     * @param {string} position - 'before', 'after', or 'child'
     */
    moveTask(taskId, targetId, position = 'after') {
        if (taskId === targetId) return;
        
        this.saveCheckpoint();
        
        const task = this.tasks.find(t => t.id === taskId);
        const target = this.tasks.find(t => t.id === targetId);
        
        if (!task || !target) return;
        
        // Prevent moving a parent into its own descendants
        const isDescendant = (parentId, childId) => {
            let curr = this.tasks.find(t => t.id === childId);
            while (curr) {
                if (curr.parentId === parentId) return true;
                curr = this.tasks.find(t => t.id === curr.parentId);
            }
            return false;
        };
        
        if (isDescendant(taskId, targetId)) {
            this._toast('Cannot move task into its own children', 'error');
            return;
        }
        
        // Remove task from current position
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        this.tasks.splice(taskIndex, 1);
        
        // Update parent based on position
        if (position === 'child') {
            task.parentId = targetId;
        } else {
            task.parentId = target.parentId;
        }
        
        // Find new insertion point
        let targetIndex = this.tasks.findIndex(t => t.id === targetId);
        
        if (position === 'after' || position === 'child') {
            // Insert after target (and its descendants)
            const getLastDescendantIndex = (id) => {
                let lastIdx = this.tasks.findIndex(t => t.id === id);
                this.tasks.forEach((t, idx) => {
                    if (t.parentId === id) {
                        const descIdx = getLastDescendantIndex(t.id);
                        if (descIdx > lastIdx) lastIdx = descIdx;
                    }
                });
                return lastIdx;
            };
            targetIndex = getLastDescendantIndex(targetId) + 1;
        }
        
        // Insert at new position
        this.tasks.splice(targetIndex, 0, task);
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast('Task moved', 'info');
    }

    _deleteSelected() {
        if (this.selectedIds.size === 0) return;
        
        if (!confirm(`Delete ${this.selectedIds.size} selected task(s)?`)) return;
        
        this.saveCheckpoint();
        
        const idsToRemove = new Set(this.selectedIds);
        
        const addDescendants = (pid) => {
            this.tasks.filter(c => c.parentId === pid).forEach(c => {
                idsToRemove.add(c.id);
                addDescendants(c.id);
            });
        };
        
        this.selectedIds.forEach(id => {
            if (this.isParent(id)) {
                addDescendants(id);
            }
        });
        
        this.tasks = this.tasks.filter(t => !idsToRemove.has(t.id));
        
        this.tasks.forEach(t => {
            t.dependencies = t.dependencies.filter(d => !idsToRemove.has(d.id));
        });
        
        this.selectedIds.clear();
        
        this.recalculateAll();
        this.saveData();
        this.render();
        
        this._toast(`Deleted ${idsToRemove.size} task(s)`, 'info');
    }

    // =========================================================================
    // VIEW MODE
    // =========================================================================
    
    setViewMode(mode) {
        this.viewMode = mode;
        if (this.gantt) {
            this.gantt.setViewMode(mode);
        }
    }

    zoomIn() {
        const modes = ['Month', 'Week', 'Day'];
        const idx = modes.indexOf(this.viewMode);
        if (idx < modes.length - 1) {
            this.setViewMode(modes[idx + 1]);
        }
    }

    zoomOut() {
        const modes = ['Month', 'Week', 'Day'];
        const idx = modes.indexOf(this.viewMode);
        if (idx > 0) {
            this.setViewMode(modes[idx - 1]);
        }
    }

    // =========================================================================
    // UTILITIES
    // =========================================================================
    
    _toast(message, type = 'info') {
        if (this.options.onToast) {
            this.options.onToast(message, type);
        } else {
            console.log(`[Toast] ${type}: ${message}`);
        }
    }

    generateMockTasks(count) {
        this.saveCheckpoint();
        
        const today = new Date();
        const tasks = [];
        
        for (let i = 0; i < count; i++) {
            const duration = Math.floor(Math.random() * 10) + 1;
            const startOffset = Math.floor(Math.random() * 200);
            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() + startOffset);
            
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + duration);
            
            const task = {
                id: `mock_${i}_${Date.now()}`,
                name: `Task ${i + 1} - ${this._randomTaskName()}`,
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
                duration: duration,
                parentId: null,
                dependencies: [],
                progress: Math.floor(Math.random() * 100),
                constraintType: 'asap',
                constraintDate: '',
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
        
        this.tasks = tasks;
        
        this.recalculateAll();
        this.saveData();
        this.render();
    }

    _randomTaskName() {
        const prefixes = ['Install', 'Frame', 'Pour', 'Set', 'Run', 'Rough', 'Finish', 'Paint', 'Trim'];
        const items = ['Foundation', 'Walls', 'Roof', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Cabinets', 'Flooring'];
        const areas = ['Level 1', 'Level 2', 'Bldg A', 'Bldg B', 'Unit 101', 'Common Area'];
        
        return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${items[Math.floor(Math.random() * items.length)]} - ${areas[Math.floor(Math.random() * areas.length)]}`;
    }

    getStats() {
        const criticalTasks = this.tasks.filter(t => t._isCritical && !this.isParent(t.id));
        
        return {
            taskCount: this.tasks.length,
            visibleCount: this.getVisibleTasks().length,
            criticalCount: criticalTasks.length,
            lastCalcTime: `${this._lastCalcTime.toFixed(2)}ms`,
            historySize: this.history.length,
            gridStats: this.grid?.getStats(),
            ganttStats: this.gantt?.getStats(),
        };
    }

    destroy() {
        if (this.grid) this.grid.destroy();
        if (this.gantt) this.gantt.destroy();
        if (this.drawer) this.drawer.destroy();
        if (this.dependenciesModal) this.dependenciesModal.destroy();
        if (this.calendarModal) this.calendarModal.destroy();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SchedulerEngine;
}
