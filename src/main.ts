/**
 * Pro Logic Scheduler - Main Entry Point
 * 
 * This module imports all components and initializes the application.
 * Desktop-only: Requires Tauri environment.
 */

/// <reference path="./types/globals.d.ts" />

// Import main service
import { SchedulerService } from './services/SchedulerService';
import { AppInitializer } from './services/AppInitializer';
import { UIEventManager } from './services/UIEventManager';
import type { ToastType } from './types';

// Import Unified Scheduler V2 styles
import './ui/components/scheduler/styles/scheduler.css';
import './styles/trade-partners.css';

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
async function initApp(): Promise<void> {
    // Fatal error boundary - desktop-only requirement
    // Check for Tauri environment (works for both v1 and v2)
    // In Tauri v2, window.__TAURI__ might not exist, so we check by trying to use the API
    let tauriAvailable = false;
    
    // Quick check: window.__TAURI__ (Tauri v1, or v2 if available)
    if ((window as Window & { __TAURI__?: unknown }).__TAURI__) {
        tauriAvailable = true;
    } else {
        // Try to detect Tauri v2 by attempting to use the API
        // This is async, so we need to wait
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            // If we can import and invoke exists, we're in Tauri
            if (invoke && typeof invoke === 'function') {
                tauriAvailable = true;
            }
        } catch (e) {
            // Can't import Tauri API - not in Tauri environment
            tauriAvailable = false;
        }
    }
    
    if (!tauriAvailable) {
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#1a1a2e;color:#eee;">
                <h1 style="color:#ff6b6b;">⚠️ Desktop Application Required</h1>
                <p>Pro Logic Scheduler must be run as a desktop application.</p>
                <p style="margin-top:1em;font-size:0.9em;color:#999;">Please use: <code style="background:#000;padding:0.2em 0.4em;border-radius:3px;">npm run tauri dev</code></p>
            </div>
        `;
        console.error('[main] FATAL: Tauri environment required');
        return;
    }
    
    try {
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
            console.error('[main] FATAL: App initialization failed:', error);
            document.body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#1a1a2e;color:#eee;">
                    <h1 style="color:#ff6b6b;">❌ Initialization Failed</h1>
                    <p>Failed to initialize application.</p>
                    <pre style="margin-top:1em;padding:1em;background:#000;border-radius:4px;font-size:0.8em;max-width:80%;overflow:auto;">${String(error)}</pre>
                </div>
            `;
        });
    } catch (error) {
        console.error('[main] FATAL: App initialization failed:', error);
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#1a1a2e;color:#eee;">
                <h1 style="color:#ff6b6b;">❌ Initialization Failed</h1>
                <p>Failed to initialize application.</p>
                <pre style="margin-top:1em;padding:1em;background:#000;border-radius:4px;font-size:0.8em;max-width:80%;overflow:auto;">${String(error)}</pre>
            </div>
        `;
    }
}

// Wait for DOM to be ready, then initialize
// Give Tauri a moment to inject its APIs (especially important in dev mode)
async function waitForTauriAndInit(): Promise<void> {
    // Small delay to allow Tauri to inject APIs
    await new Promise(resolve => setTimeout(resolve, 100));
    await initApp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOMContentLoaded fired');
        waitForTauriAndInit().catch(console.error);
    });
} else {
    // DOM already loaded
    console.log('📄 DOM already loaded, initializing immediately');
    waitForTauriAndInit().catch(console.error);
}

// Also try on window load as fallback
window.addEventListener('load', () => {
    console.log('📄 Window load event fired');
    // Only initialize if scheduler wasn't already initialized
    if (!(window as Window & { scheduler?: SchedulerService }).scheduler && (!appInitializer || !appInitializer.isInitialized)) {
        console.warn('⚠️ Scheduler not initialized on DOMContentLoaded, trying again on window load');
        initApp().catch(console.error);
    } else {
        console.log('✅ Scheduler already initialized or initializing, skipping window load init');
    }
});

/**
 * Setup Tauri shutdown handler
 */
async function setupShutdownHandler(): Promise<void> {
    if (!window.__TAURI__) {
        console.error('[main] FATAL: Tauri environment required');
        return;
    }
    
    const { listen } = await import('@tauri-apps/api/event');
    const { invoke } = await import('@tauri-apps/api/core');
    
    await listen('shutdown-requested', async () => {
        console.log('[main] Shutdown requested - flushing data...');
        
        try {
            if (window.scheduler) {
                await window.scheduler.onShutdown();
            }
            console.log('[main] Shutdown complete');
        } catch (error) {
            console.error('[main] Shutdown error:', error);
        }
        
        try {
            await invoke('close_window');
        } catch (error) {
            console.error('[main] Failed to close window:', error);
            window.close();
        }
    });
    
    console.log('[main] ✅ Tauri shutdown handler registered');
}

// Call setup during initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setupShutdownHandler().catch(console.error);
    });
} else {
    setupShutdownHandler().catch(console.error);
}

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

(window as Window & { clearTasks?: () => Promise<void> }).clearTasks = async function(): Promise<void> {
    if (uiEventManager) {
        await uiEventManager.clearTasks();
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
