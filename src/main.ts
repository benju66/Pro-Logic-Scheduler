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
import { ProjectController } from './services/ProjectController';
import { SelectionModel } from './services/SelectionModel';
import { EditingStateManager } from './services/EditingStateManager';
import { ClipboardManager } from './services/ClipboardManager';
import { CommandService } from './commands';
import { ColumnRegistry } from './core/columns/ColumnRegistry';
import { ServiceContainer } from './core/columns/ServiceContainer';
import { FeatureFlags } from './core/FeatureFlags';
import type { ToastType } from './types';

// Import Unified Scheduler V2 styles
import './ui/components/scheduler/styles/scheduler.css';
import './styles/trade-partners.css';

// Import UI Blocking Diagnostic (run diagnoseUIBlocking() in console)
import './debug/UIBlockingDiagnostic';

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
    // Check for test mode (allows running without Tauri for E2E tests)
    const { isTestMode, isTauriAvailable } = await import('./utils/testMode');
    const testMode = isTestMode();
    const tauriAvailable = await isTauriAvailable();
    
    // Allow test mode to bypass Tauri requirement
    if (!tauriAvailable && !testMode) {
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
        
        // =====================================================================
        // COMPOSITION ROOT - Pure DI Service Wiring
        // All singletons are created here and registered via setInstance()
        // This enables testing with mock injection while maintaining backward
        // compatibility with existing getInstance() calls.
        // 
        // @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
        // =====================================================================
        
        console.log('[Composition Root] 🔧 Initializing services...');
        
        // Level 0: Leaf services (no dependencies)
        const featureFlags = new FeatureFlags();
        FeatureFlags.setInstance(featureFlags);
        
        const clipboardManager = new ClipboardManager();
        ClipboardManager.setInstance(clipboardManager);
        
        const selectionModel = new SelectionModel();
        SelectionModel.setInstance(selectionModel);
        
        const editingStateManager = new EditingStateManager();
        EditingStateManager.setInstance(editingStateManager);
        
        // Level 1: Column system
        const columnRegistry = new ColumnRegistry();
        ColumnRegistry.setInstance(columnRegistry);
        
        const serviceContainer = new ServiceContainer();
        ServiceContainer.setInstance(serviceContainer);
        
        // Level 1: Core data (worker initialization happens in constructor)
        const projectController = new ProjectController();
        ProjectController.setInstance(projectController);
        
        // Level 2: Command system
        const commandService = new CommandService();
        CommandService.setInstance(commandService);
        
        console.log('[Composition Root] ✅ Services initialized');
        
        // =====================================================================
        // END COMPOSITION ROOT
        // AppInitializer will wire remaining dependencies (persistence, UI, etc.)
        // =====================================================================
        
        appInitializer = new AppInitializer({ isTauri: tauriAvailable });
        
        // Expose AppInitializer for E2E testing
        (window as any).appInitializer = appInitializer;
        
        appInitializer.initialize().then(sched => {
            scheduler = sched;
            
            // Expose for E2E testing and debugging
            (window as any).scheduler = scheduler;
            
            // Expose ProjectController for new architecture tests
            (window as any).projectController = ProjectController.getInstance();

            // Initialize keyboard shortcuts (after scheduler is fully initialized)
            scheduler.initKeyboard();
            
            // Initialize UI event manager
            uiEventManager = new UIEventManager({
                getScheduler: () => scheduler,
                toastService: scheduler?.toastService || null,
                isTauri: tauriAvailable
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
    // Import test mode check
    const { isTestMode } = await import('./utils/testMode');
    
    if (!window.__TAURI__) {
        // Only log error if not in test mode
        if (!isTestMode()) {
            console.error('[main] FATAL: Tauri environment required');
        } else {
            console.log('[main] Skipping shutdown handler in test mode');
        }
        return;
    }
    
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { invoke } = await import('@tauri-apps/api/core');
    
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.listen('shutdown-requested', async () => {
        console.log('[main] Shutdown requested - flushing data...');
        
        // Create a promise that rejects after timeout
        const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Shutdown timeout')), 3000);
        });
        
        try {
            if (window.scheduler) {
                // Race between shutdown and timeout
                await Promise.race([
                    window.scheduler.onShutdown(),
                    timeoutPromise
                ]);
            }
            console.log('[main] Shutdown complete');
        } catch (error) {
            console.error('[main] Shutdown error (proceeding to close):', error);
        }
        
        // Always try to close the window
        try {
            await invoke('close_window');
        } catch (error) {
            console.error('[main] Failed to close window:', error);
            // Force close as last resort
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
    
    // Get ZoomController from scheduler
    const zoomController = scheduler?.getZoomController();
    
    // Subscribe to zoom state changes (replaces polling!)
    if (zoomController && zoomLevelDisplay) {
        zoomController.zoomState$.subscribe(state => {
            zoomLevelDisplay.textContent = `${state.percentage}%`;
        });
    }
    
    // Zoom in - use Command Registry
    zoomInBtn?.addEventListener('click', () => {
        CommandService.getInstance().execute('view.zoomIn');
    });
    
    // Zoom out - use Command Registry
    zoomOutBtn?.addEventListener('click', () => {
        CommandService.getInstance().execute('view.zoomOut');
    });
    
    // Fit to view - use Command Registry
    fitToViewBtn?.addEventListener('click', () => {
        CommandService.getInstance().execute('view.fitToView');
    });
    
    // Reset zoom - use Command Registry
    resetZoomBtn?.addEventListener('click', () => {
        CommandService.getInstance().execute('view.resetZoom');
    });
    
    // Keyboard shortcuts for zoom are now handled by CommandService via KeyboardService
    // The commands view.zoomIn, view.zoomOut, view.resetZoom have shortcuts registered
    // ZoomController keyboard shortcuts can still be initialized for redundancy/fallback
    if (zoomController) {
        zoomController.initKeyboardShortcuts();
    }
}
