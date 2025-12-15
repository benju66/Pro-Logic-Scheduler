// =============================================================================
// GLOBAL TYPE EXTENSIONS
// =============================================================================

import type { SchedulerService } from '../services/SchedulerService';
import type { UIEventManager } from '../services/UIEventManager';
import type { StatsService } from '../services/StatsService';

/**
 * Global Window interface extensions
 * These types are used for backward compatibility with HTML onclick handlers
 * and Tauri API integration.
 */
declare global {
  interface Window {
    /** Tauri environment detection */
    __TAURI__?: unknown;
    
    /** Main scheduler service instance */
    scheduler?: SchedulerService;
    
    /** UI event manager instance */
    uiEventManager?: UIEventManager;
    
    /** Stats service instance */
    statsService?: StatsService;
    
    /** Tauri dialog API (dynamically imported) */
    tauriDialog?: {
      open: (options?: unknown) => Promise<string | null>;
      save: (options?: unknown) => Promise<string | null>;
    };
    
    /** Tauri filesystem API (dynamically imported) */
    tauriFs?: {
      readTextFile: (path: string) => Promise<string>;
      writeTextFile: (path: string, contents: string) => Promise<void>;
    };
    
    /** Toast notification function (backward compatibility) */
    showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning' | string) => void;
    
    /** Dropdown toggle function (backward compatibility) */
    toggleDropdown?: (menuId: string) => void;
    
    /** File operation handlers (backward compatibility) */
    handleNewProject?: () => void;
    handleOpenFile?: () => Promise<void>;
    handleSaveFile?: () => Promise<void>;
    handleExportJSON?: () => void;
    handleImportXML?: () => void;
    handleExportXML?: () => void;
    
    /** Task generation handlers (backward compatibility) */
    generate1000Tasks?: () => void;
    generate5000Tasks?: () => void;
    clearTasks?: () => void;
    
    /** UI handlers (backward compatibility) */
    showStats?: () => void;
    popoutGantt?: () => void;
    copyConsoleOutput?: () => void;
  }
}

export {};
