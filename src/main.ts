/**
 * Pro Logic Scheduler - Main Entry Point
 * 
 * This module imports all components and initializes the application.
 * Works in both browser and Tauri environments.
 */

/// <reference path="./types/globals.d.ts" />

// Import main service
import { SchedulerService } from './services/SchedulerService';
import { AppInitializer } from './services/AppInitializer';
import { UIEventManager } from './services/UIEventManager';
import type { ToastType } from './types';

// Import Unified Scheduler V2 styles
import './ui/components/scheduler/styles/scheduler.css';

// NOTE: Using clean architecture - no globals, dependency injection only

// Detect if running in Tauri
const isTauri: boolean = (window as Window & { __TAURI__?: unknown }).__TAURI__ !== undefined;

// Export for use in other modules
export {
    SchedulerService,
    isTauri
};

// Initialize app when DOM is ready
let appInitializer: AppInitializer | null = null;
let scheduler: SchedulerService | null = null;
let uiEventManager: UIEventManager | null = null;

// Initialize app
function initApp(): void {
    if (appInitializer) {
        console.log('⚠️ Already initializing, skipping duplicate initApp() call');
        return;
    }
    
    appInitializer = new AppInitializer({ isTauri });
    appInitializer.initialize().then(sched => {
        scheduler = sched;
        
        // Initialize keyboard shortcuts (after scheduler is fully initialized)
        scheduler.initKeyboard();
        
        // Initialize UI event manager
        uiEventManager = new UIEventManager({
            getScheduler: () => scheduler,
            toastService: scheduler?.toastService || null,
            isTauri: isTauri
        });
        uiEventManager.initialize();
        
        // Make UIEventManager available globally for window functions (backward compatibility)
        window.uiEventManager = uiEventManager;
        
        // Initialize zoom controls
        initZoomControls();
    }).catch(error => {
        console.error('Failed to initialize app:', error);
    });
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
    if (!(window as Window & { scheduler?: SchedulerService }).scheduler && (!appInitializer || !appInitializer.isInitialized)) {
        console.warn('⚠️ Scheduler not initialized on DOMContentLoaded, trying again on window load');
        initApp();
    } else {
        console.log('✅ Scheduler already initialized or initializing, skipping window load init');
    }
});

// ================================================================
// UI HELPER FUNCTIONS (Backward Compatibility)
// ================================================================
// NOTE: All UI handlers have been moved to UIEventManager.ts
// These functions delegate to UIEventManager for backward compatibility

function showToast(message: string, type: ToastType = 'info'): void {
    if (uiEventManager?.toastService) {
        uiEventManager.toastService.show(message, type);
    } else if (scheduler?.toastService) {
        scheduler.toastService.show(message, type);
    } else {
        // Fallback to DOM-based toast
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = message;
            toast.className = 'toast ' + type;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }
    }
}

window.showToast = showToast as (message: string, type?: string) => void;

// ================================================================
// WINDOW FUNCTIONS (Backward Compatibility)
// ================================================================
// These functions delegate to UIEventManager for backward compatibility
// They're kept here because they may be called from HTML or other scripts

(window as Window & { toggleDropdown?: (menuId: string) => void }).toggleDropdown = function(menuId: string): void {
    if (uiEventManager) {
        uiEventManager.toggleDropdown(menuId);
    }
};

(window as Window & { handleNewProject?: () => void }).handleNewProject = function(): void {
    if (uiEventManager) {
        uiEventManager.handleNewProject();
    }
};

(window as Window & { handleOpenFile?: () => Promise<void> }).handleOpenFile = async function(): Promise<void> {
    if (uiEventManager) {
        await uiEventManager.handleOpenFile();
    }
};

(window as Window & { handleSaveFile?: () => Promise<void> }).handleSaveFile = async function(): Promise<void> {
    if (uiEventManager) {
        await uiEventManager.handleSaveFile();
    }
};

(window as Window & { handleExportJSON?: () => void }).handleExportJSON = function(): void {
    if (uiEventManager) {
        uiEventManager.handleExportJSON();
    }
};

(window as Window & { handleImportXML?: () => void }).handleImportXML = function(): void {
    if (uiEventManager) {
        uiEventManager.handleImportXML();
    }
};

(window as Window & { handleExportXML?: () => void }).handleExportXML = function(): void {
    if (uiEventManager) {
        uiEventManager.handleExportXML();
    }
};

(window as Window & { generate1000Tasks?: () => void }).generate1000Tasks = function(): void {
    if (uiEventManager) {
        uiEventManager.generate1000Tasks();
    }
};

(window as Window & { generate5000Tasks?: () => void }).generate5000Tasks = function(): void {
    if (uiEventManager) {
        uiEventManager.generate5000Tasks();
    }
};

(window as Window & { clearTasks?: () => void }).clearTasks = function(): void {
    if (uiEventManager) {
        uiEventManager.clearTasks();
    }
};

(window as Window & { showStats?: () => void }).showStats = function(): void {
    if (uiEventManager) {
        uiEventManager.showStats();
    }
};

(window as Window & { popoutGantt?: () => void }).popoutGantt = function(): void {
    if (uiEventManager) {
        uiEventManager.popoutGantt();
    }
};

(window as Window & { copyConsoleOutput?: () => void }).copyConsoleOutput = function(): void {
    if (uiEventManager) {
        uiEventManager.copyConsoleOutput();
    }
};

// ================================================================
// ZOOM CONTROLS
// ================================================================
function initZoomControls(): void {
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const fitToViewBtn = document.getElementById('fit-to-view-btn');
    const resetZoomBtn = document.getElementById('reset-zoom-btn');
    const zoomLevelDisplay = document.getElementById('zoom-level');
    
    // Update zoom level display
    function updateZoomDisplay(): void {
        if (zoomLevelDisplay && scheduler) {
            const zoom = scheduler.getGanttZoom();
            const percentage = Math.round((zoom / 20) * 100); // 20 = 100%
            zoomLevelDisplay.textContent = `${percentage}%`;
        }
    }
    
    // Zoom in
    zoomInBtn?.addEventListener('click', () => {
        scheduler?.zoomGanttIn();
        updateZoomDisplay();
    });
    
    // Zoom out
    zoomOutBtn?.addEventListener('click', () => {
        scheduler?.zoomGanttOut();
        updateZoomDisplay();
    });
    
    // Fit to view
    fitToViewBtn?.addEventListener('click', () => {
        scheduler?.fitGanttToView();
        updateZoomDisplay();
    });
    
    // Reset zoom
    resetZoomBtn?.addEventListener('click', () => {
        scheduler?.resetGanttZoom();
        updateZoomDisplay();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                scheduler?.zoomGanttIn();
                updateZoomDisplay();
            } else if (e.key === '-') {
                e.preventDefault();
                scheduler?.zoomGanttOut();
                updateZoomDisplay();
            } else if (e.key === '0') {
                e.preventDefault();
                scheduler?.resetGanttZoom();
                updateZoomDisplay();
            }
        }
    });
    
    // Initial display update (with delay to ensure scheduler is ready)
    setTimeout(() => {
        updateZoomDisplay();
    }, 100);
    
    // Update display periodically (in case zoom changes from other sources)
    setInterval(() => {
        updateZoomDisplay();
    }, 500);
}
