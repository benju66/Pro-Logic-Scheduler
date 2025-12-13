/**
 * Pro Logic Scheduler - Main Entry Point
 * 
 * This module imports all components and initializes the application.
 * Works in both browser and Tauri environments.
 */

// Import main service
import { SchedulerService } from './services/SchedulerService.js';

// NOTE: Using clean architecture - no globals, dependency injection only

// Detect if running in Tauri
const isTauri = window.__TAURI__ !== undefined;

// Override file operations for Tauri
if (isTauri) {
    console.log('🦀 Running in Tauri environment');
    
    // Import Tauri APIs when available
    import('@tauri-apps/api/dialog').then(({ open, save }) => {
        window.tauriDialog = { open, save };
    });
    
    import('@tauri-apps/api/fs').then(({ readTextFile, writeTextFile }) => {
        window.tauriFs = { readTextFile, writeTextFile };
    });
}

// Export for use in other modules
export {
    SchedulerService,
    isTauri
};

// Initialize app when DOM is ready
let scheduler = null;
let isInitializing = false;
let isInitialized = false;

// Initialize app - synchronous version for better compatibility
function initApp() {
    // Prevent double initialization
    if (isInitializing || isInitialized) {
        console.log('⚠️ Already initializing or initialized, skipping duplicate initApp() call');
        return;
    }
    
    isInitializing = true;
    console.log('🏎️ Pro Logic Scheduler - VS Code of Scheduling Tools');
    console.log('==================================================');
    console.log(`Environment: ${isTauri ? 'Tauri Desktop' : 'Web Browser'}`);
    console.log('🦀 Tauri detected:', isTauri);
    console.log('📄 Document ready state:', document.readyState);
    
    // In Tauri, give it a moment to fully initialize
    if (isTauri) {
        // Use setTimeout instead of async/await for better compatibility
        setTimeout(async () => {
            console.log('🦀 Tauri initialization delay complete');
            await doInit();
            isInitialized = true;
            isInitializing = false;
        }, 200);
    } else {
        doInit().then(() => {
            isInitialized = true;
            isInitializing = false;
        }).catch(() => {
            isInitializing = false;
        });
    }
}

async function doInit() {
    try {
        console.log('🚀 Starting doInit()...');
        // Get containers
        const gridContainer = document.getElementById('grid-container');
        const ganttContainer = document.getElementById('gantt-container');
        const drawerContainer = document.getElementById('drawer-container');
        const modalContainer = document.getElementById('modal-container');
        
        if (!gridContainer || !ganttContainer) {
            console.error('❌ Missing required containers!', {
                gridContainer: !!gridContainer,
                ganttContainer: !!ganttContainer
            });
            return;
        }
        
        // Initialize scheduler service with all containers
        console.log('🔧 Creating SchedulerService...');
        try {
            scheduler = new SchedulerService({
                gridContainer: gridContainer,
                ganttContainer: ganttContainer,
                drawerContainer: drawerContainer,
                modalContainer: modalContainer,
                isTauri: isTauri,
            });
            console.log('✅ SchedulerService created');
            console.log('  - grid:', !!scheduler.grid);
            console.log('  - gantt:', !!scheduler.gantt);
        } catch (error) {
            console.error('❌ Error creating SchedulerService:', error);
            console.error('Error stack:', error.stack);
            throw error; // Re-throw to be caught by outer try-catch
        }
        
        // Verify scheduler initialized successfully
        console.log('🔍 Verifying scheduler components...');
        console.log('  - scheduler exists:', !!scheduler);
        console.log('  - scheduler.grid:', !!scheduler?.grid);
        console.log('  - scheduler.gantt:', !!scheduler?.gantt);
        
        if (!scheduler || !scheduler.grid || !scheduler.gantt) {
            throw new Error('Scheduler initialization incomplete - components missing');
        }
        
        // Make scheduler available globally IMMEDIATELY (for button onclick handlers)
        window.scheduler = scheduler;
        console.log('✅ window.scheduler set');
        
        // Wait a moment for scheduler to fully initialize (async operations might be happening)
        console.log('⏳ Waiting for scheduler to fully initialize...');
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('✅ Wait complete');
        
        // Set up UI handlers (order matters - button handlers should be last)
        console.log('🔧 Setting up UI handlers...');
        initResizer();
        console.log('  ✅ Resizer initialized');
        initFileInputs();
        console.log('  ✅ File inputs initialized');
        initDropdowns();
        console.log('  ✅ Dropdowns initialized');
        initFileShortcuts();
        console.log('  ✅ File shortcuts initialized');
        initColumnResizers();
        console.log('  ✅ Column resizers initialized');
        initButtonHandlers(); // Must be after scheduler is ready
        console.log('  ✅ Button handlers initialized');
        
        // Update stats periodically
        setInterval(updateStats, 500);
        updateStats();
        
        console.log('✅ Scheduler initialized');
        console.log('✅ window.scheduler available:', typeof window.scheduler);
        console.log('✅ Initial task count:', scheduler.tasks?.length || 0);
        console.log('✅ Grid initialized:', !!scheduler.grid);
        console.log('✅ Gantt initialized:', !!scheduler.gantt);
        
        // Verify buttons exist
        setTimeout(() => {
            const buttons = document.querySelectorAll('[data-action]');
            console.log('✅ Found', buttons.length, 'buttons with data-action attributes');
            if (buttons.length === 0) {
                console.error('❌ NO BUTTONS FOUND! This is the problem!');
            } else {
                buttons.forEach((btn, i) => {
                    console.log(`  Button ${i + 1}:`, btn.dataset.action, btn.textContent?.trim().substring(0, 20));
                });
            }
        }, 200);
    } catch (error) {
        console.error('❌ Failed to initialize scheduler:', error);
        console.error('Error stack:', error.stack);
        // Clear scheduler if initialization failed
        window.scheduler = null;
        scheduler = null;
        alert('Failed to initialize scheduler. Check console for details.');
    }
}

// Wait for DOM to be ready, then initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOMContentLoaded fired');
        initApp();
    });
} else {
    // DOM already loaded
    console.log('📄 DOM already loaded, initializing immediately');
    initApp();
}

// Also try on window load as fallback
window.addEventListener('load', () => {
    console.log('📄 Window load event fired');
    // Only initialize if scheduler wasn't already initialized
    if (!window.scheduler && !isInitializing && !isInitialized) {
        console.warn('⚠️ Scheduler not initialized on DOMContentLoaded, trying again on window load');
        initApp();
    } else {
        console.log('✅ Scheduler already initialized or initializing, skipping window load init');
    }
});

// ================================================================
// UI HELPER FUNCTIONS
// ================================================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function updateStats() {
    if (!scheduler) return;
    
    const stats = scheduler.getStats();
    
    const setEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    
    setEl('stat-tasks', stats.taskCount?.toLocaleString() || '0');
    setEl('stat-visible', stats.visibleCount?.toLocaleString() || '0');
    setEl('stat-rendered', stats.gridStats?.renderedRows || '0');
    setEl('stat-calc', stats.lastCalcTime || '0ms');
    setEl('stat-gantt', stats.ganttStats?.lastRenderTime || '0ms');
    
    // Memory usage (if available)
    if (performance.memory) {
        const mb = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
        setEl('stat-memory', `${mb} MB`);
        
        const memEl = document.getElementById('stat-memory');
        if (memEl) {
            memEl.classList.remove('warning', 'error');
            if (mb > 200) memEl.classList.add('error');
            else if (mb > 100) memEl.classList.add('warning');
        }
    }
    
    // Update zoom label
    const zoomLabel = document.getElementById('zoom-label');
    if (zoomLabel && scheduler.viewMode) {
        zoomLabel.textContent = scheduler.viewMode;
    }
    
    // Update button count (for debugging)
    const buttonCount = document.querySelectorAll('[data-action]').length;
    setEl('stat-buttons', buttonCount);
}

function initResizer() {
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
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const diff = e.clientX - startX;
        const newWidth = Math.max(300, Math.min(startWidth + diff, window.innerWidth - 300));
        gridPane.style.width = `${newWidth}px`;
    });
    
    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Trigger resize on components
        if (scheduler?.grid) scheduler.grid.refresh();
        if (scheduler?.gantt) scheduler.gantt.refresh();
    });
}

function initDropdowns() {
    // Dropdown closing is now handled by initButtonHandlers()
    // This function is kept for backwards compatibility but is redundant
    // The click handler in initButtonHandlers already closes dropdowns
}

function initFileInputs() {
    // JSON file input
    const jsonInput = document.getElementById('file-input-json');
    if (jsonInput) {
        jsonInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
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
            if (file && scheduler) {
                await scheduler.importFromMSProjectXML(file);
            }
            e.target.value = '';
        });
    }
}

function initFileShortcuts() {
    document.addEventListener('keydown', (e) => {
        const isCtrl = e.ctrlKey || e.metaKey;
        
        if (isCtrl && e.key === 'o') {
            e.preventDefault();
            handleOpenFile();
        }
        
        if (isCtrl && e.key === 's') {
            e.preventDefault();
            handleSaveFile();
        }
    });
}

function initColumnResizers() {
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
        
        if (scheduler?.grid) {
            scheduler.grid.refresh();
        }
    });
}

function initButtonHandlers() {
    console.log('🔧 Initializing button handlers...');
    console.log('🔧 Environment:', isTauri ? 'Tauri' : 'Browser');
    
    // Remove any existing click listeners to prevent duplicates
    // (We can't easily remove anonymous listeners, but this ensures we only add one)
    const clickHandler = (e) => {
        // Find the clicked button (closest handles SVG/icon clicks inside buttons)
        const button = e.target.closest('[data-action]');
        
        // Debug: Log ALL clicks in header area to see what's happening
        if (e.target.closest('.header')) {
            console.log('🖱️ Header click detected:', {
                target: e.target.tagName,
                className: e.target.className,
                hasButton: !!button,
                action: button?.dataset.action,
                buttonText: button?.textContent?.trim().substring(0, 30),
                fullPath: e.composedPath().map(el => el.tagName).join(' > ')
            });
        }
        
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
        
        // All other buttons (header buttons, etc.) are handled here
        console.log('🖱️ Button clicked:', action, 'in header:', !!isInHeader);
        
        // Update debug display
        const lastClickEl = document.getElementById('stat-last-click');
        if (lastClickEl) {
            lastClickEl.textContent = action || 'none';
            lastClickEl.style.color = '#10b981';
            setTimeout(() => {
                if (lastClickEl.textContent === action) {
                    lastClickEl.style.color = '#94a3b8';
                }
            }, 1000);
        }
        
        // Handle dropdown toggle separately
        if (action === 'toggle-dropdown') {
            const targetId = button.dataset.target;
            toggleDropdown(targetId);
            e.stopPropagation(); // Prevent closing dropdown immediately
            return;
        }
        
        // Close dropdowns when clicking menu items
        if (button.closest('.dropdown-menu')) {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        }
        
        // Route actions to appropriate handlers with error handling
        try {
            // Verify scheduler is ready before calling methods
            if (!scheduler) {
                console.error('Scheduler not initialized - cannot handle action:', action);
                if (window.showToast) {
                    window.showToast('Scheduler not ready. Please refresh the page.', 'error');
                }
                return;
            }
            
            // Verify scheduler components are ready
            if (action.startsWith('zoom') || action === 'add-task' || action === 'open-calendar') {
                if (!scheduler.grid || !scheduler.gantt) {
                    console.error('Scheduler components not ready - cannot handle action:', action);
                    if (window.showToast) {
                        window.showToast('Scheduler components not ready. Please refresh.', 'error');
                    }
                    return;
                }
            }
            
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
                    if (scheduler) scheduler.zoomOut();
                    break;
                case 'zoom-in':
                    if (scheduler) scheduler.zoomIn();
                    break;
                case 'open-calendar':
                    if (scheduler) scheduler.openCalendar();
                    break;
                case 'new-project':
                    if (window.handleNewProject) window.handleNewProject();
                    else console.error('handleNewProject not available');
                    break;
                case 'open-file':
                    if (window.handleOpenFile) window.handleOpenFile();
                    else console.error('handleOpenFile not available');
                    break;
                case 'save-file':
                    if (window.handleSaveFile) window.handleSaveFile();
                    else console.error('handleSaveFile not available');
                    break;
                case 'export-json':
                    if (window.handleExportJSON) window.handleExportJSON();
                    else console.error('handleExportJSON not available');
                    break;
                case 'import-xml':
                    if (window.handleImportXML) window.handleImportXML();
                    else console.error('handleImportXML not available');
                    break;
                case 'export-xml':
                    if (window.handleExportXML) window.handleExportXML();
                    else console.error('handleExportXML not available');
                    break;
                case 'generate-1000':
                    if (window.generate1000Tasks) window.generate1000Tasks();
                    else console.error('generate1000Tasks not available');
                    break;
                case 'generate-5000':
                    if (window.generate5000Tasks) window.generate5000Tasks();
                    else console.error('generate5000Tasks not available');
                    break;
                case 'clear-tasks':
                    if (window.clearTasks) window.clearTasks();
                    else console.error('clearTasks not available');
                    break;
                case 'show-stats':
                    if (window.showStats) window.showStats();
                    else console.error('showStats not available');
                    break;
                case 'popout-gantt':
                    if (window.popoutGantt) window.popoutGantt();
                    else console.error('popoutGantt not available');
                    break;
                case 'copy-console':
                    copyConsoleOutput();
                    break;
                default:
                    // Don't warn for grid actions or modal actions
                    if (!gridActions.includes(action) && !button.closest('.modal-dialog')) {
                        console.warn('Unknown action:', action);
                    }
            }
        } catch (error) {
            console.error('Error handling button action:', action, error);
            if (window.showToast) {
                window.showToast(`Error: ${error.message}`, 'error');
            }
        }
    };
    
    // Store handler reference globally for potential removal
    window._buttonClickHandler = clickHandler;
    
    // Attach the click handler with capture phase to catch events early
    document.addEventListener('click', clickHandler, true); // true = use capture phase
    
    console.log('✅ Button handlers initialized');
    console.log('✅ Click handler attached to document with capture phase');
    
    // Test handler immediately
    const testBtn = document.querySelector('[data-action="add-task"]');
    if (testBtn) {
        console.log('🧪 Test button found:', testBtn);
        console.log('🧪 Test button styles:', {
            pointerEvents: window.getComputedStyle(testBtn).pointerEvents,
            cursor: window.getComputedStyle(testBtn).cursor,
            display: window.getComputedStyle(testBtn).display,
            visibility: window.getComputedStyle(testBtn).visibility,
            zIndex: window.getComputedStyle(testBtn).zIndex
        });
    } else {
        console.warn('⚠️ Test button (add-task) not found!');
    }
    
    // Verify handler is attached and buttons exist
    setTimeout(() => {
        const buttons = document.querySelectorAll('[data-action]');
        console.log('✅ Found', buttons.length, 'buttons with data-action attributes');
        console.log('✅ Click handler attached:', typeof clickHandler === 'function');
        console.log('✅ Environment:', isTauri ? 'Tauri' : 'Browser');
        
        if (buttons.length === 0) {
            console.error('❌ NO BUTTONS FOUND! This is the problem!');
            console.error('❌ HTML may not be loaded or buttons missing data-action attributes');
        } else {
            console.log('✅ Sample buttons:');
            Array.from(buttons).slice(0, 5).forEach((btn, i) => {
                const style = window.getComputedStyle(btn);
                console.log(`  ${i + 1}. ${btn.dataset.action}: "${btn.textContent?.trim().substring(0, 30)}"`);
                console.log(`     - pointer-events: ${style.pointerEvents}, cursor: ${style.cursor}, display: ${style.display}`);
            });
            
            // In Tauri, add extra verification
            if (isTauri) {
                console.log('🦀 Tauri-specific checks:');
                console.log('  - window.__TAURI__:', !!window.__TAURI__);
                console.log('  - document.readyState:', document.readyState);
                console.log('  - scheduler available:', !!window.scheduler);
                
                // Test if event delegation is working
                const testEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
                console.log('  - Can create MouseEvent:', !!testEvent);
            }
        }
    }, 500);
}

// ================================================================
// FILE MENU HANDLERS
// ================================================================

window.toggleDropdown = function(menuId) {
    const menu = document.getElementById(menuId);
    const isOpen = menu?.classList.contains('show');
    
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (menu && !isOpen) {
        menu.classList.add('show');
    }
};

window.handleNewProject = function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (scheduler && scheduler.tasks.length > 0) {
        if (!confirm('Create new project? Unsaved changes will be lost.')) return;
    }
    
    if (scheduler) {
        scheduler.tasks = [];
        scheduler.selectedIds.clear();
        scheduler.saveData();
        scheduler.render();
    }
};

window.handleOpenFile = async function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (scheduler) {
        await scheduler.openFromFile();
    }
};

window.handleSaveFile = async function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (scheduler) {
        await scheduler.saveToFile();
    }
};

window.handleExportJSON = function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    scheduler?.exportAsDownload();
};

window.handleImportXML = function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    document.getElementById('file-input-xml')?.click();
};

window.handleExportXML = function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    scheduler?.exportToMSProjectXML();
};

// ================================================================
// DEMO FUNCTIONS
// ================================================================

window.generate1000Tasks = function() {
    if (!window.scheduler) {
        console.error('Scheduler not initialized');
        return;
    }
    console.time('Generate 1,000 tasks');
    window.scheduler.generateMockTasks(1000);
    console.timeEnd('Generate 1,000 tasks');
    showToast('Generated 1,000 tasks', 'success');
};

window.generate5000Tasks = function() {
    if (!window.scheduler) {
        console.error('Scheduler not initialized');
        return;
    }
    console.time('Generate 5,000 tasks');
    window.scheduler.generateMockTasks(5000);
    console.timeEnd('Generate 5,000 tasks');
    showToast('Generated 5,000 tasks', 'success');
};

window.clearTasks = function() {
    if (!window.scheduler) {
        console.error('Scheduler not initialized');
        return;
    }
    if (!confirm('Clear all tasks?')) return;
    window.scheduler.tasks = [];
    window.scheduler.selectedIds.clear();
    window.scheduler.saveData();
    window.scheduler.render();
    showToast('All tasks cleared', 'info');
};

window.showStats = function() {
    if (!window.scheduler) {
        console.error('Scheduler not initialized');
        return;
    }
    const stats = window.scheduler.getStats();
    console.log('📊 Performance Stats:', stats);
    alert(JSON.stringify(stats, null, 2));
};

// ================================================================
// POPOUT GANTT
// ================================================================

window.popoutGantt = function() {
    // Simplified popout for Tauri - just log for now
    if (isTauri) {
        showToast('Popout not yet supported in desktop app', 'info');
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
        showToast('Popup blocked', 'error');
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
    
    showToast('Gantt opened in new window', 'info');
};

// Make showToast available globally
window.showToast = showToast;

// Copy console output to clipboard
function copyConsoleOutput() {
    // Get all console messages (if console API supports it)
    // Note: Browser security prevents reading console history directly
    // So we'll create a summary instead
    
    const summary = {
        timestamp: new Date().toISOString(),
        schedulerReady: !!window.scheduler,
        buttonCount: document.querySelectorAll('[data-action]').length,
        gridReady: !!window.scheduler?.grid,
        ganttReady: !!window.scheduler?.gantt,
        taskCount: window.scheduler?.tasks?.length || 0,
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
        showToast('Debug info copied to clipboard!', 'success');
        console.log('📋 Debug info copied to clipboard');
        console.log(text);
    }).catch(err => {
        // Fallback: show in alert
        alert(text);
        console.error('Failed to copy to clipboard:', err);
    });
}

window.copyConsoleOutput = copyConsoleOutput;
