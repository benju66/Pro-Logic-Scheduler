/**
 * ============================================================================
 * RightSidebarManager.ts
 * ============================================================================
 * 
 * Traffic controller for the right side of the application.
 * Manages the activity bar and panel visibility/layout.
 * 
 * Features:
 * - Toggle individual panels (Details, Links)
 * - Support simultaneous panel display (twin drawers)
 * - Sync panels with task selection
 * - Zen Mode (hide entire sidebar)
 * - State persistence
 * - Keyboard shortcuts
 * 
 * @author Pro Logic Scheduler
 * @version 1.0.0
 */

import type { SchedulerService } from '../../services/SchedulerService';
import type { Task, RightPanelId, RightSidebarState, PanelOpenOptions } from '../../types';
import { SideDrawer } from './SideDrawer';
import { DependenciesModal } from './DependenciesModal';
import { TaskTradePartnersPanel } from '../panels/TaskTradePartnersPanel';

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY = 'pls_right_sidebar_state';
const PANEL_WIDTH = 400;
const PANEL_ORDER: RightPanelId[] = ['details', 'links', 'tradePartners'];
const PANEL_TITLES: Record<RightPanelId, string> = {
    details: 'Properties',
    links: 'Logic Network',
    tradePartners: 'Trade Partners',
};

// ============================================================================
// TYPES
// ============================================================================

export interface RightSidebarManagerOptions {
    containerId: string;
    activityBarId: string;
    scheduler: SchedulerService;
    onLayoutChange?: (width: number) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export class RightSidebarManager {
    private container: HTMLElement;
    private activityBar: HTMLElement;
    private scheduler: SchedulerService;
    private options: RightSidebarManagerOptions;
    
    // State
    private activePanels = new Set<RightPanelId>();
    private isBarVisible = true;
    private currentTaskId: string | null = null;
    
    // Panel instances
    private detailsPanel: SideDrawer | null = null;
    private dependenciesPanel: DependenciesModal | null = null;
    private tradePartnersPanel: TaskTradePartnersPanel | null = null;
    
    // Panel wrappers (for layout)
    private panelWrappers: Map<RightPanelId, HTMLElement> = new Map();
    
    // Cleanup
    private _unsubscribeSelection: (() => void) | null = null;
    private _unsubscribePanelOpen: (() => void) | null = null;
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(options: RightSidebarManagerOptions) {
        this.options = options;
        this.scheduler = options.scheduler;
        
        const container = document.getElementById(options.containerId);
        const activityBar = document.getElementById(options.activityBarId);
        
        if (!container || !activityBar) {
            console.error('[RightSidebarManager] Required elements not found:', {
                containerId: options.containerId,
                activityBarId: options.activityBarId,
            });
            throw new Error('RightSidebarManager: Required elements not found');
        }
        
        this.container = container;
        this.activityBar = activityBar;
        
        this._loadState();
        this._initializePanels();
        this._bindEvents();
        this._renderLayout();
        
        console.log('[RightSidebarManager] Initialized');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Load persisted state from localStorage
     */
    private _loadState(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const state: RightSidebarState = JSON.parse(stored);
                this.activePanels = new Set(state.activePanels || []);
                this.isBarVisible = state.isBarVisible ?? true;
            }
        } catch (e) {
            console.warn('[RightSidebarManager] Failed to load state:', e);
        }
    }

    /**
     * Save state to localStorage
     */
    private _saveState(): void {
        try {
            const state: RightSidebarState = {
                activePanels: Array.from(this.activePanels) as RightPanelId[],
                isBarVisible: this.isBarVisible,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[RightSidebarManager] Failed to save state:', e);
        }
    }

    /**
     * Initialize panel instances
     */
    private _initializePanels(): void {
        // Create wrapper elements for panels
        const detailsWrapper = document.createElement('div');
        detailsWrapper.className = 'sidebar-panel-content';
        
        const linksWrapper = document.createElement('div');
        linksWrapper.className = 'sidebar-panel-content';

        // Initialize Details Panel (SideDrawer in embedded mode)
        this.detailsPanel = new SideDrawer({
            container: detailsWrapper,
            isEmbedded: true, // NEW: Flag for embedded mode
            onUpdate: (taskId, field, value) => this.scheduler.handleTaskUpdate(taskId, field, value),
            onDelete: (taskId) => this.scheduler.deleteTask(taskId),
            onOpenLinks: (taskId) => this.openPanel('links'),
            getScheduler: () => ({
                hasBaseline: () => this.scheduler.hasBaseline(),
                calculateVariance: (task: Task) => this.scheduler.calculateVariance(task),
            }),
        });

        // Initialize Dependencies Panel (in panel mode)
        this.dependenciesPanel = new DependenciesModal({
            container: linksWrapper,
            isPanel: true, // Flag for panel mode
            getTasks: () => this.scheduler.tasks,
            isParent: (id) => this.scheduler.isParent(id),
            getDepth: (id) => this.scheduler.getDepth(id),
            onSave: (taskId, deps) => this.scheduler.updateDependencies(taskId, deps),
        });

        // Initialize Trade Partners Panel
        const tradePartnersWrapper = document.createElement('div');
        tradePartnersWrapper.className = 'sidebar-panel-content';
        this.panelWrappers.set('tradePartners', tradePartnersWrapper);
        
        this.tradePartnersPanel = new TaskTradePartnersPanel({
            container: tradePartnersWrapper,
            getTask: (taskId) => this.scheduler.getTask(taskId),
            getTradePartners: () => this.scheduler.getTradePartners(),
            getTaskTradePartners: (taskId) => this.scheduler.getTaskTradePartners(taskId) || [],
            onAssign: (taskId, tradePartnerId) => {
                this.scheduler.assignTradePartner(taskId, tradePartnerId);
            },
            onUnassign: (taskId, tradePartnerId) => {
                this.scheduler.unassignTradePartner(taskId, tradePartnerId);
            },
        });
    }

    /**
     * Bind event listeners
     */
    private _bindEvents(): void {
        // Activity bar button clicks
        this.activityBar.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('[data-panel]') as HTMLElement | null;
            if (btn) {
                const panelId = btn.dataset.panel as RightPanelId;
                if (panelId) {
                    this.togglePanel(panelId);
                }
            }
        });

        // Subscribe to selection changes
        this._unsubscribeSelection = this.scheduler.onTaskSelect((taskId, task, field) => {
            this._onSelectionChange(taskId, task, field);
        });
        
        // Also sync with current selection if a task is already selected
        const currentTask = this.scheduler.getSelectedTask();
        if (currentTask) {
            this._onSelectionChange(currentTask.id, currentTask);
        }

        // Subscribe to panel open requests (e.g., double-click to open)
        this._unsubscribePanelOpen = this.scheduler.onPanelOpenRequest((panelId) => {
            this.openPanel(panelId as RightPanelId);
        });

        // Keyboard shortcuts
        this._keydownHandler = (e: KeyboardEvent) => {
            // Don't handle if typing in an input
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                return;
            }

            // Escape closes the rightmost open panel
            if (e.key === 'Escape' && this.activePanels.size > 0) {
                const panelsArray = Array.from(this.activePanels);
                const lastPanel = panelsArray[panelsArray.length - 1];
                this.togglePanel(lastPanel);
                e.preventDefault();
                return;
            }

            // Ctrl+Shift+D: Toggle Details panel
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                this.togglePanel('details');
                return;
            }

            // Ctrl+Shift+L: Toggle Links panel
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                this.togglePanel('links');
                return;
            }

            // Ctrl+Shift+B: Toggle activity bar (Zen Mode)
            if (e.ctrlKey && e.shiftKey && e.key === 'B') {
                e.preventDefault();
                this.toggleActivityBar();
                return;
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Toggle a panel's visibility
     */
    togglePanel(panelId: RightPanelId): void {
        if (this.activePanels.has(panelId)) {
            this.activePanels.delete(panelId);
        } else {
            this.activePanels.add(panelId);
            
            // If opening a panel, sync with current selection
            if (this.currentTaskId) {
                const task = this.scheduler.getTask(this.currentTaskId);
                if (task) {
                    this._syncPanelWithTask(panelId, task);
                }
            }
        }
        
        this._renderLayout();
        this._saveState();
    }

    /**
     * Open a panel (if not already open)
     * Also restores activity bar if in Zen Mode
     */
    openPanel(panelId: RightPanelId): void {
        // If activity bar is hidden (Zen Mode), restore it first
        if (!this.isBarVisible) {
            this.isBarVisible = true;
            this.activityBar.style.display = 'flex';
        }
        
        if (!this.activePanels.has(panelId)) {
            this.activePanels.add(panelId);
            this._renderLayout();
            
            // Sync with current selection after rendering
            const currentTask = this.scheduler.getSelectedTask();
            if (currentTask) {
                this._syncPanelWithTask(panelId, currentTask);
            } else if (this.currentTaskId) {
                // Fallback to stored currentTaskId
                const task = this.scheduler.getTask(this.currentTaskId);
                if (task) {
                    this._syncPanelWithTask(panelId, task);
                }
            }
            
            this._saveState();
        }
    }

    /**
     * Close a panel
     */
    closePanel(panelId: RightPanelId): void {
        if (this.activePanels.has(panelId)) {
            this.activePanels.delete(panelId);
            this._renderLayout();
            this._saveState();
        }
    }

    /**
     * Toggle activity bar visibility (Zen Mode)
     */
    toggleActivityBar(): void {
        this.isBarVisible = !this.isBarVisible;
        
        this.activityBar.style.display = this.isBarVisible ? 'flex' : 'none';
        
        if (!this.isBarVisible) {
            // Hide panels too
            this.container.style.width = '0px';
            this.container.style.borderLeft = 'none';
        } else {
            this._renderLayout();
        }
        
        this._saveState();
        this._notifyLayoutChange();
    }

    /**
     * Check if a panel is open
     */
    isPanelOpen(panelId: RightPanelId): boolean {
        return this.activePanels.has(panelId);
    }

    /**
     * Get current layout width
     */
    getLayoutWidth(): number {
        if (!this.isBarVisible) return 0;
        return this.activePanels.size * PANEL_WIDTH;
    }

    /**
     * Destroy the manager and clean up
     */
    destroy(): void {
        if (this._unsubscribeSelection) {
            this._unsubscribeSelection();
            this._unsubscribeSelection = null;
        }
        
        if (this._unsubscribePanelOpen) {
            this._unsubscribePanelOpen();
            this._unsubscribePanelOpen = null;
        }
        
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        
        this.detailsPanel?.destroy();
        this.dependenciesPanel?.destroy();
        
        this.panelWrappers.clear();
        this.container.innerHTML = '';
    }

    // =========================================================================
    // SELECTION HANDLING
    // =========================================================================

    /**
     * Handle selection change from SchedulerService
     */
    private _onSelectionChange(taskId: string | null, task: Task | null, field?: string): void {
        this.currentTaskId = taskId;
        
        if (!taskId || !task) {
            // Show empty state in open panels
            this._showEmptyState();
            return;
        }
        
        // Sync all open panels with the selected task
        const isParent = this.scheduler.isParent(taskId);
        
        if (this.activePanels.has('details') && this.detailsPanel) {
            try {
                this.detailsPanel.open(task, { isParent, focusField: field });
            } catch (e) {
                console.error('[RightSidebarManager] Error opening details panel:', e);
            }
        }
        
        if (this.activePanels.has('links') && this.dependenciesPanel) {
            try {
                this.dependenciesPanel.syncPanel(task);
            } catch (e) {
                console.error('[RightSidebarManager] Error syncing links panel:', e);
            }
        }
        
        if (this.activePanels.has('tradePartners') && this.tradePartnersPanel) {
            try {
                this.tradePartnersPanel.show(taskId);
            } catch (e) {
                console.error('[RightSidebarManager] Error syncing trade partners panel:', e);
            }
        }
    }

    /**
     * Sync a specific panel with a task
     */
    private _syncPanelWithTask(panelId: RightPanelId, task: Task): void {
        const isParent = this.scheduler.isParent(task.id);
        
        if (panelId === 'details' && this.detailsPanel) {
            this.detailsPanel.open(task, { isParent });
        } else if (panelId === 'links' && this.dependenciesPanel) {
            this.dependenciesPanel.syncPanel(task);
        } else if (panelId === 'tradePartners' && this.tradePartnersPanel) {
            this.tradePartnersPanel.show(task.id);
        }
    }

    /**
     * Show empty state when no task selected
     */
    private _showEmptyState(): void {
        if (this.activePanels.has('details') && this.detailsPanel) {
            this.detailsPanel.showEmptyState();
        }
        
        if (this.activePanels.has('links') && this.dependenciesPanel) {
            this.dependenciesPanel.showEmptyState();
        }
        
        if (this.activePanels.has('tradePartners') && this.tradePartnersPanel) {
            this.tradePartnersPanel.hide();
        }
    }

    // =========================================================================
    // LAYOUT RENDERING
    // =========================================================================

    /**
     * Render the panel layout
     */
    private _renderLayout(): void {
        if (!this.isBarVisible) return;

        const count = this.activePanels.size;
        const totalWidth = count * PANEL_WIDTH;
        
        // Update container dimensions
        this.container.style.width = `${totalWidth}px`;
        this.container.style.borderLeft = count > 0 ? '1px solid #e2e8f0' : 'none';

        // Update activity bar button states
        this.activityBar.querySelectorAll('.activity-btn').forEach(btn => {
            const panelId = (btn as HTMLElement).dataset.panel as RightPanelId;
            if (panelId) {
                btn.classList.toggle('active', this.activePanels.has(panelId));
            }
        });

        // Clear and rebuild container
        this.container.innerHTML = '';
        
        // Recreate panel wrappers map (but preserve tradePartners wrapper)
        const tradePartnersWrapper = this.panelWrappers.get('tradePartners');
        this.panelWrappers.clear();
        if (tradePartnersWrapper) {
            this.panelWrappers.set('tradePartners', tradePartnersWrapper);
        }
        
        // Render panels in defined order
        PANEL_ORDER.forEach(panelId => {
            if (this.activePanels.has(panelId)) {
                const wrapper = this._createPanelWrapper(panelId);
                if (panelId !== 'tradePartners') {
                    this.panelWrappers.set(panelId, wrapper);
                }
                this.container.appendChild(wrapper);
            }
        });
        
        this._notifyLayoutChange();
    }

    /**
     * Create wrapper element for a panel
     */
    private _createPanelWrapper(panelId: RightPanelId): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'sidebar-panel-wrapper';
        wrapper.style.width = `${PANEL_WIDTH}px`;
        wrapper.dataset.panel = panelId;
        
        // Header with close button
        const header = document.createElement('div');
        header.className = 'panel-header-simple';
        header.innerHTML = `
            <span class="panel-title">${PANEL_TITLES[panelId]}</span>
            <button class="panel-close-btn" title="Close Panel (Esc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;
        
        header.querySelector('.panel-close-btn')?.addEventListener('click', () => {
            this.togglePanel(panelId);
        });

        wrapper.appendChild(header);

        // Append panel content
        const content = document.createElement('div');
        content.className = 'panel-body';
        
        if (panelId === 'details' && this.detailsPanel) {
            const el = this.detailsPanel.getElement();
            if (el) content.appendChild(el);
        } else if (panelId === 'links' && this.dependenciesPanel) {
            const el = this.dependenciesPanel.getElement();
            if (el) content.appendChild(el);
        } else if (panelId === 'tradePartners' && this.tradePartnersPanel) {
            // Trade partners panel - get or create wrapper
            let panelWrapper = this.panelWrappers.get('tradePartners');
            if (!panelWrapper) {
                panelWrapper = document.createElement('div');
                panelWrapper.className = 'sidebar-panel-content';
                this.panelWrappers.set('tradePartners', panelWrapper);
                
                // Update panel container reference
                (this.tradePartnersPanel as any).container = panelWrapper;
            }
            content.appendChild(panelWrapper);
        }
        
        wrapper.appendChild(content);
        
        return wrapper;
    }

    /**
     * Notify layout change for viewport resize
     */
    private _notifyLayoutChange(): void {
        // Use viewport refresh instead of setTimeout + resize event
        const viewport = (this.scheduler as any).viewport;
        if (viewport && typeof viewport.refresh === 'function') {
            // Small delay to allow CSS transition to complete
            requestAnimationFrame(() => {
                viewport.refresh();
            });
        }
        
        // Also notify via callback if provided
        if (this.options.onLayoutChange) {
            this.options.onLayoutChange(this.getLayoutWidth());
        }
    }
}

