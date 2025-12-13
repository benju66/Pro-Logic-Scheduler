// @ts-check
/**
 * @fileoverview UI Event Manager - Handles all UI interactions and event delegation
 * @module services/UIEventManager
 * 
 * Manages button handlers, window functions, and UI initialization.
 * Centralizes all UI event handling for better maintainability.
 */

/**
 * UI Event Manager Service
 * Handles all UI interactions including buttons, resizers, and window functions
 * @class
 */
export class UIEventManager {
    /**
     * Create a new UIEventManager instance
     * @param {Object} options - Configuration
     * @param {Function} options.getScheduler - Function to get scheduler instance
     * @param {Object} options.toastService - ToastService instance
     * @param {boolean} options.isTauri - Whether running in Tauri environment
     */
    constructor(options = {}) {
        this.getScheduler = options.getScheduler || (() => null);
        this.toastService = options.toastService || null;
        this.isTauri = options.isTauri || false;
        this._buttonClickHandler = null;
    }

    /**
     * Initialize all UI handlers
     */
    initialize() {
        this.initResizer();
        this.initFileInputs();
        this.initFileShortcuts();
        this.initColumnResizers();
        this.initButtonHandlers();
    }

    /**
     * Initialize pane resizer (between grid and Gantt)
     */
    initResizer() {
        const resizer = document.getElementById('resizer');
        const gridPane = document.querySelector('.grid-pane');
        
        if (!resizer || !gridPane) return;
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = gridPane.getBoundingClientRect().width;
            
            resizer.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        
        const handleMouseMove = (e) => {
            if (!isResizing) return;
            
            const diff = e.clientX - startX;
            const newWidth = Math.max(300, Math.min(startWidth + diff, window.innerWidth - 300));
            gridPane.style.width = `${newWidth}px`;
        };
        
        const handleMouseUp = () => {
            if (!isResizing) return;
            
            isResizing = false;
            resizer.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Trigger resize on components
            const scheduler = this.getScheduler();
            if (scheduler?.grid) scheduler.grid.refresh();
            if (scheduler?.gantt) scheduler.gantt.refresh();
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    /**
     * Initialize file input handlers
     */
    initFileInputs() {
        // JSON file input
        const jsonInput = document.getElementById('file-input-json');
        if (jsonInput) {
            jsonInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                const scheduler = this.getScheduler();
                if (file && scheduler) {
                    await scheduler.importFromFile(file);
                }
                e.target.value = '';
            });
        }
        
        // XML file input
        const xmlInput = document.getElementById('file-input-xml');
        if (xmlInput) {
            xmlInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                const scheduler = this.getScheduler();
                if (file && scheduler) {
                    await scheduler.importFromMSProjectXML(file);
                }
                e.target.value = '';
            });
        }
    }

    /**
     * Initialize file operation keyboard shortcuts
     */
    initFileShortcuts() {
        document.addEventListener('keydown', (e) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            
            if (isCtrl && e.key === 'o') {
                e.preventDefault();
                this.handleOpenFile();
            }
            
            if (isCtrl && e.key === 's') {
                e.preventDefault();
                this.handleSaveFile();
            }
        });
    }

    /**
     * Initialize column resizers
     */
    initColumnResizers() {
        const gridPane = document.getElementById('grid-pane');
        const resizers = document.querySelectorAll('.col-resizer');
        
        if (!gridPane || resizers.length === 0) return;
        
        const minWidths = {
            rowNum: 30,
            name: 100,
            duration: 40,
            start: 80,
            end: 80,
            constraintType: 50,
            actions: 80,
        };
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let currentField = null;
        let currentResizer = null;
        
        resizers.forEach(resizer => {
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                isResizing = true;
                currentResizer = resizer;
                currentField = resizer.dataset.field;
                startX = e.clientX;
                
                const headerCell = resizer.closest('.grid-header-cell');
                startWidth = headerCell ? headerCell.getBoundingClientRect().width : 100;
                
                resizer.classList.add('active');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !currentField) return;
            
            const diff = e.clientX - startX;
            const minWidth = minWidths[currentField] || 40;
            const newWidth = Math.max(minWidth, startWidth + diff);
            
            gridPane.style.setProperty(`--w-${currentField}`, `${newWidth}px`);
        });
        
        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            
            isResizing = false;
            if (currentResizer) {
                currentResizer.classList.remove('active');
            }
            currentResizer = null;
            currentField = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            const scheduler = this.getScheduler();
            if (scheduler?.grid) {
                scheduler.grid.refresh();
            }
        });
    }

    /**
     * Initialize button click handlers using event delegation
     */
    initButtonHandlers() {
        console.log('🔧 Initializing button handlers...');
        console.log('🔧 Environment:', this.isTauri ? 'Tauri' : 'Browser');
        
        const clickHandler = (e) => {
            // Find the clicked button (closest handles SVG/icon clicks inside buttons)
            const button = e.target.closest('[data-action]');
            
            // If no button clicked, just handle dropdown closing
            if (!button) {
                if (!e.target.closest('.dropdown')) {
                    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
                }
                return;
            }
            
            // Don't handle clicks on disabled buttons
            if (button.disabled || button.hasAttribute('disabled') || button.classList.contains('disabled')) {
                return;
            }
            
            const action = button.dataset.action;
            const isInHeader = button.closest('.header');
            const isInGridRows = button.closest('.vsg-row-container');
            const gridActions = ['collapse', 'indent', 'outdent', 'links', 'delete'];
            
            // Skip grid-specific actions ONLY if they're in grid rows (not header buttons)
            if (gridActions.includes(action) && isInGridRows && !isInHeader) {
                return; // Let grid handle these
            }
            
            // Handle dropdown toggle separately
            if (action === 'toggle-dropdown') {
                const targetId = button.dataset.target;
                this.toggleDropdown(targetId);
                e.stopPropagation();
                return;
            }
            
            // Close dropdowns when clicking menu items
            if (button.closest('.dropdown-menu')) {
                document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
            }
            
            // Route actions to appropriate handlers
            this._handleAction(action, button);
        };
        
        // Store handler reference for potential removal
        this._buttonClickHandler = clickHandler;
        
        // Attach the click handler with capture phase to catch events early
        document.addEventListener('click', clickHandler, true);
        
        console.log('✅ Button handlers initialized');
    }

    /**
     * Handle button action
     * @private
     * @param {string} action - Action name
     * @param {HTMLElement} button - Button element
     */
    _handleAction(action, button) {
        const scheduler = this.getScheduler();
        
        try {
            // Verify scheduler is ready
            if (!scheduler) {
                console.error('Scheduler not initialized - cannot handle action:', action);
                this._showToast('Scheduler not ready. Please refresh the page.', 'error');
                return;
            }
            
            // Verify scheduler components are ready
            if (action.startsWith('zoom') || action === 'add-task' || action === 'open-calendar') {
                if (!scheduler.grid || !scheduler.gantt) {
                    console.error('Scheduler components not ready - cannot handle action:', action);
                    this._showToast('Scheduler components not ready. Please refresh.', 'error');
                    return;
                }
            }
            
            // Route to appropriate handler
            switch (action) {
                case 'undo':
                    scheduler.undo();
                    break;
                case 'redo':
                    scheduler.redo();
                    break;
                case 'add-task':
                    scheduler.addTask();
                    break;
                case 'zoom-out':
                    scheduler.zoomOut();
                    break;
                case 'zoom-in':
                    scheduler.zoomIn();
                    break;
                case 'open-calendar':
                    scheduler.openCalendar();
                    break;
                case 'new-project':
                    this.handleNewProject();
                    break;
                case 'open-file':
                    this.handleOpenFile();
                    break;
                case 'save-file':
                    this.handleSaveFile();
                    break;
                case 'export-json':
                    this.handleExportJSON();
                    break;
                case 'import-xml':
                    this.handleImportXML();
                    break;
                case 'export-xml':
                    this.handleExportXML();
                    break;
                case 'generate-1000':
                    this.generate1000Tasks();
                    break;
                case 'generate-5000':
                    this.generate5000Tasks();
                    break;
                case 'clear-tasks':
                    this.clearTasks();
                    break;
                case 'show-stats':
                    this.showStats();
                    break;
                case 'popout-gantt':
                    this.popoutGantt();
                    break;
                case 'copy-console':
                    this.copyConsoleOutput();
                    break;
                default:
                    // Don't warn for grid actions or modal actions
                    const gridActions = ['collapse', 'indent', 'outdent', 'links', 'delete'];
                    if (!gridActions.includes(action) && !button.closest('.modal-dialog')) {
                        console.warn('Unknown action:', action);
                    }
            }
        } catch (error) {
            console.error('Error handling button action:', action, error);
            this._showToast(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Show toast message
     * @private
     * @param {string} message - Message to show
     * @param {string} type - Toast type
     */
    _showToast(message, type = 'info') {
        if (this.toastService) {
            this.toastService.show(message, type);
        } else {
            // Fallback to DOM-based toast
            const toast = document.getElementById('toast');
            if (toast) {
                toast.textContent = message;
                toast.className = `toast ${type}`;
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 3000);
            }
        }
    }

    // =========================================================================
    // WINDOW FUNCTIONS (File Menu Handlers)
    // =========================================================================

    /**
     * Toggle dropdown menu
     * @param {string} menuId - Menu ID to toggle
     */
    toggleDropdown(menuId) {
        const menu = document.getElementById(menuId);
        const isOpen = menu?.classList.contains('show');
        
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        
        if (menu && !isOpen) {
            menu.classList.add('show');
        }
    }

    /**
     * Handle new project action
     */
    handleNewProject() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        
        const scheduler = this.getScheduler();
        if (scheduler && scheduler.tasks.length > 0) {
            if (!confirm('Create new project? Unsaved changes will be lost.')) return;
        }
        
        if (scheduler) {
            scheduler.tasks = [];
            scheduler.selectedIds.clear();
            scheduler.saveData();
            scheduler.render();
        }
    }

    /**
     * Handle open file action
     */
    async handleOpenFile() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        
        const scheduler = this.getScheduler();
        if (scheduler) {
            await scheduler.openFromFile();
        }
    }

    /**
     * Handle save file action
     */
    async handleSaveFile() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        
        const scheduler = this.getScheduler();
        if (scheduler) {
            await scheduler.saveToFile();
        }
    }

    /**
     * Handle export JSON action
     */
    handleExportJSON() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        const scheduler = this.getScheduler();
        scheduler?.exportAsDownload();
    }

    /**
     * Handle import XML action
     */
    handleImportXML() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        document.getElementById('file-input-xml')?.click();
    }

    /**
     * Handle export XML action
     */
    handleExportXML() {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        const scheduler = this.getScheduler();
        scheduler?.exportToMSProjectXML();
    }

    // =========================================================================
    // DEMO FUNCTIONS
    // =========================================================================

    /**
     * Generate 1000 mock tasks
     */
    generate1000Tasks() {
        const scheduler = this.getScheduler();
        if (!scheduler) {
            console.error('Scheduler not initialized');
            return;
        }
        console.time('Generate 1,000 tasks');
        scheduler.generateMockTasks(1000);
        console.timeEnd('Generate 1,000 tasks');
        this._showToast('Generated 1,000 tasks', 'success');
    }

    /**
     * Generate 5000 mock tasks
     */
    generate5000Tasks() {
        const scheduler = this.getScheduler();
        if (!scheduler) {
            console.error('Scheduler not initialized');
            return;
        }
        console.time('Generate 5,000 tasks');
        scheduler.generateMockTasks(5000);
        console.timeEnd('Generate 5,000 tasks');
        this._showToast('Generated 5,000 tasks', 'success');
    }

    /**
     * Clear all tasks
     */
    clearTasks() {
        const scheduler = this.getScheduler();
        if (!scheduler) {
            console.error('Scheduler not initialized');
            return;
        }
        if (!confirm('Clear all tasks?')) return;
        scheduler.tasks = [];
        scheduler.selectedIds.clear();
        scheduler.saveData();
        scheduler.render();
        this._showToast('All tasks cleared', 'info');
    }

    /**
     * Show performance statistics
     */
    showStats() {
        const scheduler = this.getScheduler();
        if (!scheduler) {
            console.error('Scheduler not initialized');
            return;
        }
        const stats = scheduler.getStats();
        console.log('📊 Performance Stats:', stats);
        alert(JSON.stringify(stats, null, 2));
    }

    /**
     * Popout Gantt chart (browser only)
     */
    popoutGantt() {
        if (this.isTauri) {
            this._showToast('Popout not yet supported in desktop app', 'info');
            return;
        }
        
        // Browser implementation - open new window
        const width = 1200;
        const height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        
        const popup = window.open('', 'GanttPopout',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes`);
        
        if (!popup) {
            this._showToast('Popup blocked', 'error');
            return;
        }
        
        // Create minimal Gantt view in popup
        popup.document.write(`
            <html>
            <head><title>Pro Logic - Gantt View</title></head>
            <body style="margin:0;font-family:system-ui;">
                <div style="padding:20px;background:#6366f1;color:white;">
                    <h2>Gantt Popout</h2>
                    <p>Full popout implementation requires additional setup.</p>
                </div>
            </body>
            </html>
        `);
        
        this._showToast('Gantt opened in new window', 'info');
    }

    /**
     * Copy console output to clipboard
     */
    copyConsoleOutput() {
        const scheduler = this.getScheduler();
        const summary = {
            timestamp: new Date().toISOString(),
            schedulerReady: !!scheduler,
            buttonCount: document.querySelectorAll('[data-action]').length,
            gridReady: !!scheduler?.grid,
            ganttReady: !!scheduler?.gantt,
            taskCount: scheduler?.tasks?.length || 0,
            message: 'Console output cannot be read directly due to browser security. ' +
                     'Please manually copy console messages or use browser DevTools export feature.'
        };
        
        const text = `Pro Logic Scheduler - Debug Info
${'='.repeat(50)}
Timestamp: ${summary.timestamp}
Scheduler Ready: ${summary.schedulerReady}
Buttons Found: ${summary.buttonCount}
Grid Ready: ${summary.gridReady}
Gantt Ready: ${summary.ganttReady}
Task Count: ${summary.taskCount}

${summary.message}

To copy console output:
1. Open DevTools (F12)
2. Right-click in Console tab
3. Select "Save as..." or manually select and copy messages
`;
        
        // Copy to clipboard
        navigator.clipboard.writeText(text).then(() => {
            this._showToast('Debug info copied to clipboard!', 'success');
            console.log('📋 Debug info copied to clipboard');
            console.log(text);
        }).catch(err => {
            // Fallback: show in alert
            alert(text);
            console.error('Failed to copy to clipboard:', err);
        });
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this._buttonClickHandler) {
            document.removeEventListener('click', this._buttonClickHandler, true);
            this._buttonClickHandler = null;
        }
    }
}

