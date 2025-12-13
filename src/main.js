// @ts-check
/**
 * Pro Logic Scheduler - Main Entry Point
 * 
 * This module imports all components and initializes the application.
 * Works in both browser and Tauri environments.
 */

// Import main service
import { SchedulerService } from './services/SchedulerService.js';
import { AppInitializer } from './services/AppInitializer.js';
import { UIEventManager } from './services/UIEventManager.js';

// NOTE: Using clean architecture - no globals, dependency injection only

// Detect if running in Tauri
const isTauri = window.__TAURI__ !== undefined;

// Export for use in other modules
export {
    SchedulerService,
    isTauri
};

// Initialize app when DOM is ready
let appInitializer = null;
let scheduler = null;
let uiEventManager = null;

// Initialize app
function initApp() {
    if (appInitializer) {
        console.log('⚠️ Already initializing, skipping duplicate initApp() call');
        return;
    }
    
    appInitializer = new AppInitializer({ isTauri });
    appInitializer.initialize().then(sched => {
        scheduler = sched;
        
        // Initialize UI event manager
        uiEventManager = new UIEventManager({
            getScheduler: () => scheduler,
            toastService: scheduler?.toastService || null,
            isTauri: isTauri
        });
        uiEventManager.initialize();
        
        // Make UIEventManager available globally for window functions (backward compatibility)
        window.uiEventManager = uiEventManager;
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
    if (!window.scheduler && (!appInitializer || !appInitializer.isInitialized)) {
        console.warn('⚠️ Scheduler not initialized on DOMContentLoaded, trying again on window load');
        initApp();
    } else {
        console.log('✅ Scheduler already initialized or initializing, skipping window load init');
    }
});

// ================================================================
// UI HELPER FUNCTIONS (Backward Compatibility)
// ================================================================
// NOTE: All UI handlers have been moved to UIEventManager.js
// These functions delegate to UIEventManager for backward compatibility

function showToast(message, type = 'info') {
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

window.showToast = showToast;

// ================================================================
// WINDOW FUNCTIONS (Backward Compatibility)
// ================================================================
// These functions delegate to UIEventManager for backward compatibility
// They're kept here because they may be called from HTML or other scripts

window.toggleDropdown = function(menuId) {
    if (uiEventManager) {
        uiEventManager.toggleDropdown(menuId);
    }
};

window.handleNewProject = function() {
    if (uiEventManager) {
        uiEventManager.handleNewProject();
    }
};

window.handleOpenFile = async function() {
    if (uiEventManager) {
        await uiEventManager.handleOpenFile();
    }
};

window.handleSaveFile = async function() {
    if (uiEventManager) {
        await uiEventManager.handleSaveFile();
    }
};

window.handleExportJSON = function() {
    if (uiEventManager) {
        uiEventManager.handleExportJSON();
    }
};

window.handleImportXML = function() {
    if (uiEventManager) {
        uiEventManager.handleImportXML();
    }
};

window.handleExportXML = function() {
    if (uiEventManager) {
        uiEventManager.handleExportXML();
    }
};

window.generate1000Tasks = function() {
    if (uiEventManager) {
        uiEventManager.generate1000Tasks();
    }
};

window.generate5000Tasks = function() {
    if (uiEventManager) {
        uiEventManager.generate5000Tasks();
    }
};

window.clearTasks = function() {
    if (uiEventManager) {
        uiEventManager.clearTasks();
    }
};

window.showStats = function() {
    if (uiEventManager) {
        uiEventManager.showStats();
    }
};

window.popoutGantt = function() {
    if (uiEventManager) {
        uiEventManager.popoutGantt();
    }
};

window.copyConsoleOutput = function() {
    if (uiEventManager) {
        uiEventManager.copyConsoleOutput();
    }
};
