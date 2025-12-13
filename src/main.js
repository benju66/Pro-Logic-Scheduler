/**
 * Pro Logic Scheduler - Main Entry Point
 * 
 * This module imports all components and initializes the application.
 * Works in both browser and Tauri environments.
 */

// Import components
import { CanvasGantt } from './CanvasGantt.js';
import { VirtualScrollGrid } from './VirtualScrollGrid.js';
import { SideDrawer } from './SideDrawer.js';
import { DependenciesModal } from './DependenciesModal.js';
import { CalendarModal } from './CalendarModal.js';
import { SchedulerEngine } from './SchedulerEngine.js';

// Make classes available globally for components that reference each other
window.CanvasGantt = CanvasGantt;
window.VirtualScrollGrid = VirtualScrollGrid;
window.SideDrawer = SideDrawer;
window.DependenciesModal = DependenciesModal;
window.CalendarModal = CalendarModal;
window.SchedulerEngine = SchedulerEngine;

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
    CanvasGantt,
    VirtualScrollGrid,
    SideDrawer,
    DependenciesModal,
    CalendarModal,
    SchedulerEngine,
    isTauri
};

// Initialize app when DOM is ready
let scheduler = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏎️ Pro Logic Scheduler - Ferrari Engine v2.0');
    console.log('==========================================');
    console.log(`Environment: ${isTauri ? 'Tauri Desktop' : 'Web Browser'}`);
    
    // Initialize scheduler with all containers
    scheduler = new SchedulerEngine({
        gridContainer: document.getElementById('grid-container'),
        ganttContainer: document.getElementById('gantt-container'),
        drawerContainer: document.getElementById('drawer-container'),
        modalContainer: document.getElementById('modal-container'),
        onToast: showToast,
    });
    
    // Make scheduler available globally
    window.scheduler = scheduler;
    
    // Set up UI handlers
    initResizer();
    initFileInputs();
    initDropdowns();
    initFileShortcuts();
    initColumnResizers();
    
    // Update stats periodically
    setInterval(updateStats, 500);
    updateStats();
    
    console.log('✅ Scheduler initialized');
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
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        }
    });
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
    
    if (scheduler?.tasks.length > 0) {
        if (!confirm('Create new project? Unsaved changes will be lost.')) return;
    }
    
    scheduler.tasks = [];
    scheduler.selectedIds.clear();
    scheduler.saveData();
    scheduler.render();
    showToast('New project created', 'info');
};

window.handleOpenFile = async function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (isTauri && window.tauriDialog && window.tauriFs) {
        // Use Tauri native dialog
        try {
            const selected = await window.tauriDialog.open({
                filters: [{ name: 'Schedule', extensions: ['json'] }]
            });
            
            if (selected) {
                const content = await window.tauriFs.readTextFile(selected);
                const parsed = JSON.parse(content);
                
                if (parsed.tasks) {
                    scheduler.saveCheckpoint();
                    scheduler.tasks = parsed.tasks;
                    scheduler.calendar = parsed.calendar || scheduler.calendar;
                    scheduler.recalculateAll();
                    scheduler.saveData();
                    scheduler.render();
                    showToast(`Loaded ${scheduler.tasks.length} tasks`, 'success');
                }
            }
        } catch (err) {
            console.error('Open failed:', err);
            showToast('Failed to open file', 'error');
        }
    } else if (SchedulerEngine.isFileSystemAccessSupported()) {
        try {
            await scheduler.openFromFile();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Open failed:', err);
            }
        }
    } else {
        document.getElementById('file-input-json')?.click();
    }
};

window.handleSaveFile = async function() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (isTauri && window.tauriDialog && window.tauriFs) {
        // Use Tauri native dialog
        try {
            const savePath = await window.tauriDialog.save({
                filters: [{ name: 'Schedule', extensions: ['json'] }],
                defaultPath: 'My_Schedule.json'
            });
            
            if (savePath) {
                const data = JSON.stringify({
                    tasks: scheduler.tasks,
                    calendar: scheduler.calendar,
                    exportedAt: new Date().toISOString(),
                    version: '2.0.0'
                }, null, 2);
                
                await window.tauriFs.writeTextFile(savePath, data);
                showToast('Schedule saved', 'success');
            }
        } catch (err) {
            console.error('Save failed:', err);
            showToast('Failed to save file', 'error');
        }
    } else if (SchedulerEngine.isFileSystemAccessSupported()) {
        try {
            await scheduler.saveToFile();
        } catch (err) {
            if (err.name !== 'AbortError') {
                scheduler.exportAsDownload();
            }
        }
    } else {
        scheduler.exportAsDownload();
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
    console.time('Generate 1,000 tasks');
    scheduler?.generateMockTasks(1000);
    console.timeEnd('Generate 1,000 tasks');
    showToast('Generated 1,000 tasks', 'success');
};

window.generate5000Tasks = function() {
    console.time('Generate 5,000 tasks');
    scheduler?.generateMockTasks(5000);
    console.timeEnd('Generate 5,000 tasks');
    showToast('Generated 5,000 tasks', 'success');
};

window.clearTasks = function() {
    if (!confirm('Clear all tasks?')) return;
    scheduler.tasks = [];
    scheduler.selectedIds.clear();
    scheduler.saveData();
    scheduler.render();
    showToast('All tasks cleared', 'info');
};

window.showStats = function() {
    const stats = scheduler?.getStats();
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
