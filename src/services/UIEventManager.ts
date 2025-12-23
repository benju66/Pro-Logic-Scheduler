/**
 * @fileoverview UI Event Manager - Handles all UI interactions and event delegation
 * @module services/UIEventManager
 * 
 * Manages button handlers, window functions, and UI initialization.
 * Centralizes all UI event handling for better maintainability.
 */

import type { SchedulerService } from './SchedulerService';
import type { ToastService } from '../ui/services/ToastService';
import type { ToastType } from '../types';

/**
 * UI event manager options
 */
export interface UIEventManagerOptions {
  getScheduler?: () => SchedulerService | null;
  toastService?: ToastService | null;
  isTauri?: boolean;
}

/**
 * UI Event Manager Service
 * Handles all UI interactions including buttons, resizers, and window functions
 */
export class UIEventManager {
  private getScheduler: () => SchedulerService | null;
  public toastService: ToastService | null;  // Public for access from main.ts
  private isTauri: boolean;
  private _buttonClickHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Create a new UIEventManager instance
   * @param options - Configuration
   */
  constructor(options: UIEventManagerOptions = {}) {
    this.getScheduler = options.getScheduler || (() => null);
    this.toastService = options.toastService || null;
    this.isTauri = options.isTauri || false;
    this._buttonClickHandler = null;
  }

  /**
   * Initialize all UI handlers
   */
  initialize(): void {
    this.initResizer();
    this.initFileShortcuts();
    this.initColumnResizers();
    this.initButtonHandlers();
    // Restore Gantt visibility preference
    this._restoreGanttVisibility();
  }

  /**
   * Initialize pane resizer (between grid and Gantt)
   */
  initResizer(): void {
    const resizer = document.getElementById('resizer');
    const gridPane = document.querySelector('.grid-pane') as HTMLElement | null;
    
    if (!resizer || !gridPane) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizer.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent event bubbling to grid
      
      isResizing = true;
      startX = e.clientX;
      startWidth = gridPane.getBoundingClientRect().width;
      
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isResizing) return;
      
      const diff = e.clientX - startX;
      const newWidth = Math.max(300, Math.min(startWidth + diff, window.innerWidth - 300));
      gridPane.style.width = `${newWidth}px`;
    };
    
    const handleMouseUp = (): void => {
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
   * Initialize file operation keyboard shortcuts
   */
  initFileShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
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
   * Initialize column resizers with localStorage persistence
   * Implements industry-standard column resizing with smooth feedback
   * 
   * Works identically in both browser and Tauri desktop environments:
   * - Uses standard DOM APIs (compatible with Tauri webview)
   * - localStorage persistence works in both environments
   * - Mouse event handling is cross-platform compatible
   * - Includes Tauri-specific window blur handling for edge cases
   */
  initColumnResizers(): void {
    const gridPane = document.getElementById('grid-pane');
    const resizers = document.querySelectorAll('.col-resizer');
    
    if (!gridPane) {
      console.warn('[UIEventManager] Grid pane not found for column resizers, retrying in 100ms...');
      // Retry if DOM not ready yet
      setTimeout(() => this.initColumnResizers(), 100);
      return;
    }
    
    if (resizers.length === 0) {
      console.warn('[UIEventManager] No column resizers found. Expected resizers in grid header. Retrying in 100ms...');
      // Retry if resizers not rendered yet
      setTimeout(() => this.initColumnResizers(), 100);
      return;
    }
    
    console.log(`[UIEventManager] ✅ Initializing ${resizers.length} column resizers`);
    
    // Load saved column widths from localStorage
    this._loadColumnWidths(gridPane);
    
    // Get minimum widths from column definitions (single source of truth)
    const scheduler = this.getScheduler();
    let minWidths: Record<string, number> = {};
    
    if (scheduler) {
      const columns = scheduler.getColumnDefinitions();
      columns.forEach(col => {
        minWidths[col.field] = col.minWidth ?? Math.max(20, col.width * 0.5);
      });
    } else {
      // Fallback to defaults if scheduler not available (shouldn't happen)
      console.warn('[UIEventManager] Scheduler not available, using fallback min widths');
      minWidths = {
        drag: 20,
        checkbox: 25,
        rowNum: 30,
        name: 100,
        duration: 40,
        start: 80,
        end: 80,
        constraintType: 50,
        health: 60,
        actions: 80,
      };
    }
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let currentField: string | null = null;
    let currentResizer: HTMLElement | null = null;
    let rafId: number | null = null;
    
    // Handle mousedown on resizers
    resizers.forEach((resizer, index) => {
      const resizerEl = resizer as HTMLElement;
      const field = resizerEl.dataset.field;
      
      if (!field) {
        console.warn(`[UIEventManager] Resizer at index ${index} missing data-field attribute`);
        return;
      }
      
      // Single click: start resize
      resizerEl.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log(`[UIEventManager] Resize started for column: ${field}`);
        
        isResizing = true;
        currentResizer = resizerEl;
        currentField = field;
        
        startX = e.clientX;
        
        // Read current CSS variable value
        const varName = `--w-${currentField}`;
        const computedStyle = getComputedStyle(gridPane);
        const currentValue = computedStyle.getPropertyValue(varName).trim();
        startWidth = currentValue ? parseInt(currentValue) : 100;
        
        // Visual feedback
        currentResizer.classList.add('active');
        document.body.classList.add('resizing');
        
        // Prevent text selection during resize
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      });
      
      // Double-click: auto-fit column width (industry standard feature)
      resizer.addEventListener('dblclick', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const field = (resizer as HTMLElement).dataset.field;
        if (!field) return;
        
        // Calculate optimal width based on content
        const headerCell = resizer.closest('.grid-header-cell') as HTMLElement;
        if (!headerCell) return;
        
        // Get all cells in this column
        const gridContainer = document.getElementById('grid-container');
        if (!gridContainer) return;
        
        const cells = gridContainer.querySelectorAll(`[data-field="${field}"]`);
        let maxWidth = 0;
        
        // Measure header text width
        const headerText = headerCell.textContent?.trim() || '';
        const tempSpan = document.createElement('span');
        tempSpan.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap; font-size: 11px; font-weight: 700; padding: 0 8px;';
        tempSpan.textContent = headerText;
        document.body.appendChild(tempSpan);
        maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
        document.body.removeChild(tempSpan);
        
        // Measure content in visible cells
        cells.forEach(cell => {
          const cellElement = cell as HTMLElement;
          if (cellElement.offsetWidth > 0) { // Only measure visible cells
            const input = cellElement.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
            if (input) {
              const tempInput = document.createElement(input.tagName.toLowerCase()) as HTMLInputElement | HTMLSelectElement;
              tempInput.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap;';
              tempInput.value = input.value || input.textContent || '';
              if (input.tagName === 'INPUT') {
                (tempInput as HTMLInputElement).type = (input as HTMLInputElement).type;
              }
              document.body.appendChild(tempInput);
              maxWidth = Math.max(maxWidth, tempInput.offsetWidth + 20); // Add padding
              document.body.removeChild(tempInput);
            } else {
              const text = cellElement.textContent?.trim() || '';
              if (text) {
                const tempSpan = document.createElement('span');
                tempSpan.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap; font-size: 13px; padding: 0 8px;';
                tempSpan.textContent = text;
                document.body.appendChild(tempSpan);
                maxWidth = Math.max(maxWidth, tempSpan.offsetWidth);
                document.body.removeChild(tempSpan);
              }
            }
          }
        });
        
        // Apply auto-fit width with minimum constraint
        const minWidth = minWidths[field] || 40;
        const autoFitWidth = Math.max(minWidth, maxWidth + 16); // Add extra padding
        
        gridPane.style.setProperty(`--w-${field}`, `${autoFitWidth}px`);
        this._saveColumnWidths(gridPane);
        
        // Refresh grid
        const scheduler = this.getScheduler();
        if (scheduler?.grid) {
          scheduler.grid.refresh();
        }
      });
    });
    
    // Smooth resize handling with requestAnimationFrame
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isResizing || !currentField) return;
      
      // Cancel any pending animation frame
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      
      // Use RAF for smooth resizing (industry standard)
      rafId = requestAnimationFrame(() => {
        if (!isResizing || !currentField || !gridPane) return;
        
        const diff = e.clientX - startX;
        const minWidth = minWidths[currentField] || 40;
        const newWidth = Math.max(minWidth, startWidth + diff);
        
        // Update CSS variable (triggers automatic grid cell updates)
        gridPane.style.setProperty(`--w-${currentField}`, `${newWidth}px`);
        
        // Refresh grid to ensure cells update
        const scheduler = this.getScheduler();
        if (scheduler?.grid) {
          scheduler.grid.refresh();
        }
      });
    };
    
    // Handle mouseup
    const handleMouseUp = (): void => {
      if (!isResizing) return;
      
      // Cancel any pending animation frame
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      
      isResizing = false;
      
      // Remove visual feedback
      if (currentResizer) {
        currentResizer.classList.remove('active');
      }
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // Save column widths to localStorage
      if (currentField && gridPane) {
        this._saveColumnWidths(gridPane);
      }
      
      // Final refresh
      const scheduler = this.getScheduler();
      if (scheduler?.grid) {
        scheduler.grid.refresh();
      }
      
      // Reset state
      currentResizer = null;
      currentField = null;
    };
    
    // Add event listeners (using capture phase for better control)
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    
    // Handle mouse leave (cleanup if mouse leaves window)
    // Important for both browser and Tauri desktop
    document.addEventListener('mouseleave', handleMouseUp);
    
    // Tauri-specific: Handle window blur (user switches away during resize)
    if (this.isTauri) {
      window.addEventListener('blur', () => {
        if (isResizing) {
          handleMouseUp();
        }
      });
    }
  }

  /**
   * Load column widths from localStorage
   * @private
   */
  private _loadColumnWidths(gridPane: HTMLElement): void {
    try {
      const saved = localStorage.getItem('pro_scheduler_column_widths');
      if (saved) {
        const widths = JSON.parse(saved) as Record<string, number>;
        Object.entries(widths).forEach(([field, width]) => {
          gridPane.style.setProperty(`--w-${field}`, `${width}px`);
        });
      }
    } catch (err) {
      console.warn('[UIEventManager] Failed to load column widths:', err);
    }
  }

  /**
   * Save column widths to localStorage
   * @private
   */
  private _saveColumnWidths(gridPane: HTMLElement): void {
    try {
      const widths: Record<string, number> = {};
      const computedStyle = getComputedStyle(gridPane);
      
      // Save all column width variables
      ['drag', 'checkbox', 'rowNum', 'name', 'duration', 'start', 'end', 'constraintType', 'actions'].forEach(field => {
        const value = computedStyle.getPropertyValue(`--w-${field}`).trim();
        if (value) {
          widths[field] = parseInt(value);
        }
      });
      
      localStorage.setItem('pro_scheduler_column_widths', JSON.stringify(widths));
    } catch (err) {
      console.warn('[UIEventManager] Failed to save column widths:', err);
    }
  }

  /**
   * Initialize button click handlers using event delegation
   */
  initButtonHandlers(): void {
    console.log('🔧 Initializing button handlers...');
    console.log('🔧 Environment:', this.isTauri ? 'Tauri' : 'Browser');
    
    const clickHandler = (e: MouseEvent): void => {
      // Find the clicked button (closest handles SVG/icon clicks inside buttons)
      const button = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      
      // If no button clicked, just handle dropdown closing
      if (!button) {
        if (!(e.target as HTMLElement).closest('.dropdown')) {
          document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
        }
        return;
      }
      
      // Don't handle clicks on disabled buttons
      if ((button as HTMLButtonElement).disabled || button.hasAttribute('disabled') || button.classList.contains('disabled')) {
        return;
      }
      
      const action = button.dataset.action;
      const isInHeader = button.closest('.header');
      const isInGridRows = button.closest('.vsg-row-container');
      const gridActions = ['collapse', 'indent', 'outdent', 'links', 'delete'];
      
      // Skip grid-specific actions ONLY if they're in grid rows (not header buttons)
      if (action && gridActions.includes(action) && isInGridRows && !isInHeader) {
        return; // Let grid handle these
      }
      
      // Handle dropdown toggle separately
      if (action === 'toggle-dropdown') {
        const targetId = button.dataset.target;
        this.toggleDropdown(targetId || '');
        e.stopPropagation();
        return;
      }
      
      // Close dropdowns when clicking menu items
      if (button.closest('.dropdown-menu')) {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
      }
      
      // Route actions to appropriate handlers
      if (action) {
        // Handle async actions (don't await - let them run)
        this._handleAction(action, button).catch(error => {
          console.error('[UIEventManager] Action handler error:', error);
        });
      }
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
   * @param action - Action name
   * @param button - Button element
   */
  private async _handleAction(action: string, button: HTMLElement): Promise<void> {
    const scheduler = this.getScheduler();
    
    try {
      // Verify scheduler is ready
      if (!scheduler) {
        console.error('Scheduler not initialized - cannot handle action:', action);
        this._showToast('Scheduler not ready. Please refresh the page.', 'error');
        return;
      }
      
      // Verify scheduler is fully initialized
      if (!scheduler.isInitialized) {
        console.warn('[UIEventManager] ⚠️ Action blocked - scheduler not initialized:', action);
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
        case 'clear-tasks':
          await this.clearTasks();
          break;
        case 'show-stats':
          this.showStats();
          break;
        case 'popout-gantt':
          this.popoutGantt();
          break;
        case 'save-baseline':
          this.handleSaveBaseline();
          break;
        case 'clear-baseline':
          this.handleClearBaseline();
          break;
        case 'toggle-gantt':
          this._toggleGantt();
          break;
        case 'column-settings':
          this._openColumnSettings();
          break;
        case 'toggle-driving-path':
          this.getScheduler()?.toggleDrivingPathMode();
          break;
        default:
          // Don't warn for grid actions or modal actions
          const gridActions = ['collapse', 'indent', 'outdent', 'links', 'delete'];
          if (!gridActions.includes(action) && !button.closest('.modal-dialog')) {
            console.warn('Unknown action:', action);
          }
      }
    } catch (error) {
      const err = error as Error;
      console.error('Error handling button action:', action, err);
      this._showToast(`Error: ${err.message}`, 'error');
    }
  }

  /**
   * Show toast message
   * @private
   * @param message - Message to show
   * @param type - Toast type
   */
  private _showToast(message: string, type: ToastType = 'info'): void {
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

  /**
   * Open column settings modal
   * @private
   */
  private _openColumnSettings(): void {
    const scheduler = this.getScheduler();
    if (!scheduler) return;
    
    scheduler.openColumnSettings();
  }

  // =========================================================================
  // WINDOW FUNCTIONS (File Menu Handlers)
  // =========================================================================

  /**
   * Toggle dropdown menu
   * @param menuId - Menu ID to toggle
   */
  toggleDropdown(menuId: string): void {
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
  handleNewProject(): void {
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
  async handleOpenFile(): Promise<void> {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    const scheduler = this.getScheduler();
    if (scheduler) {
      await scheduler.openFromFile();
    }
  }

  /**
   * Handle save file action
   */
  async handleSaveFile(): Promise<void> {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    const scheduler = this.getScheduler();
    if (scheduler) {
      await scheduler.saveToFile();
    }
  }

  /**
   * Handle export JSON action
   */
  handleExportJSON(): void {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    const scheduler = this.getScheduler();
    scheduler?.exportAsDownload();
  }

  /**
   * Handle import XML action using native Tauri dialog
   */
  async handleImportXML(): Promise<void> {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    const scheduler = this.getScheduler();
    if (!scheduler) return;
    
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'MS Project XML', extensions: ['xml'] }],
        multiple: false
      });
      
      if (selected && typeof selected === 'string') {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const content = await readTextFile(selected);
        
        // Use SchedulerService's import method (handles all logic)
        await scheduler.importFromMSProjectXMLContent(content);
      }
    } catch (error) {
      console.error('[UIEventManager] XML import failed:', error);
      this.toastService?.show('Failed to import XML file', 'error');
    }
  }

  /**
   * Handle export XML action
   */
  handleExportXML(): void {
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
  generate1000Tasks(): void {
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
  generate5000Tasks(): void {
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
  async clearTasks(): Promise<void> {
    const scheduler = this.getScheduler();
    if (!scheduler) {
      console.error('Scheduler not initialized');
      return;
    }
    
    // Use the centralized clearAllData method which handles SQLite purging
    await scheduler.clearAllData();
    
    this._showToast('All tasks cleared', 'info');
  }

  /**
   * Show performance statistics
   */
  showStats(): void {
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
  popoutGantt(): void {
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
  copyConsoleOutput(): void {
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
  destroy(): void {
    if (this._buttonClickHandler) {
      document.removeEventListener('click', this._buttonClickHandler, true);
      this._buttonClickHandler = null;
    }
  }

  /**
   * Handle Save/Update Baseline button click
   * Context-aware: saves new baseline or updates existing
   */
  handleSaveBaseline(): void {
    const scheduler = this.getScheduler();
    if (!scheduler) {
      this._showToast('Scheduler not ready', 'error');
      return;
    }
    
    // If baseline exists, confirm overwrite
    if (scheduler.hasBaseline()) {
      if (!confirm('Update baseline?\n\nThis will overwrite the existing baseline with the current schedule.')) {
        return;
      }
    }
    
    scheduler.setBaseline();
  }

  /**
   * Handle Clear Baseline menu item click
   * Destructive action - requires confirmation
   */
  handleClearBaseline(): void {
    const scheduler = this.getScheduler();
    if (!scheduler) {
      this._showToast('Scheduler not ready', 'error');
      return;
    }
    
    // Check if baseline exists
    if (!scheduler.hasBaseline()) {
      this._showToast('No baseline to clear', 'info');
      return;
    }
    
    // Confirm destructive action
    if (!confirm('Clear baseline?\n\nThis will permanently remove baseline data from all tasks. This action cannot be undone.')) {
      return;
    }
    
    scheduler.clearBaseline();
  }

  /**
   * Toggle Gantt chart visibility
   * @private
   */
  private _toggleGantt(): void {
    const ganttPane = document.getElementById('gantt-pane');
    const resizer = document.getElementById('resizer');
    const gridPane = document.querySelector('.grid-pane') as HTMLElement;
    const toggleBtn = document.getElementById('gantt-toggle-btn');
    
    if (!ganttPane || !resizer || !gridPane) return;
    
    const isCurrentlyVisible = !ganttPane.classList.contains('hidden');
    
    if (isCurrentlyVisible) {
      // Hide Gantt
      ganttPane.classList.add('hidden');
      resizer.classList.add('hidden');
      gridPane.classList.add('gantt-hidden');
      toggleBtn?.classList.add('gantt-off');
      toggleBtn?.setAttribute('title', 'Show Gantt Chart');
      localStorage.setItem('pro_scheduler_gantt_visible', 'false');
    } else {
      // Show Gantt
      ganttPane.classList.remove('hidden');
      resizer.classList.remove('hidden');
      gridPane.classList.remove('gantt-hidden');
      toggleBtn?.classList.remove('gantt-off');
      toggleBtn?.setAttribute('title', 'Hide Gantt Chart');
      localStorage.setItem('pro_scheduler_gantt_visible', 'true');
    }
    
    // Refresh grid after layout change
    const scheduler = this.getScheduler();
    if (scheduler?.grid) {
      scheduler.grid.refresh();
    }
  }

  /**
   * Restore Gantt visibility from localStorage
   * @private
   */
  private _restoreGanttVisibility(): void {
    const saved = localStorage.getItem('pro_scheduler_gantt_visible');
    if (saved === 'false') {
      this._toggleGantt();
    }
  }
}
