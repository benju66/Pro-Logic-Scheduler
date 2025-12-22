/**
 * ============================================================================
 * DependenciesModal.ts
 * ============================================================================
 * 
 * Modal dialog for managing task dependencies (predecessors/successors).
 * Allows users to:
 * - View and edit predecessor links
 * - Add new predecessors
 * - Change link type (FS, SS, FF, SF)
 * - Set lag/lead time
 * - View successors (read-only)
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import { LINK_TYPE_LABELS } from '../../core/Constants';
import type { Task, Dependency, LinkType } from '../../types';

/**
 * Dependencies modal options
 */
export interface DependenciesModalOptions {
  container?: HTMLElement;
  isPanel?: boolean; // NEW: Flag for panel mode
  onSave?: (taskId: string, dependencies: Dependency[]) => void;
  onSaveSuccessors?: (taskId: string, successorIds: string[]) => void; // NEW: For saving successors
  getTasks?: () => Task[];
  isParent?: (taskId: string) => boolean;
  getDepth?: (taskId: string) => number;
}

/**
 * Dependencies modal DOM references
 */
interface DependenciesModalDOM {
  taskName: HTMLElement;
  predCount: HTMLElement;
  succCount: HTMLElement;
  tabBtns: NodeListOf<HTMLElement>;
  panels: NodeListOf<HTMLElement>;
  predSelect: HTMLSelectElement;
  addPredBtn: HTMLButtonElement;
  predBody: HTMLElement;
  succBody: HTMLElement;
  closeBtn: HTMLElement;
  cancelBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
}

export class DependenciesModal {
    
    /**
     * Link type labels for display
     * @deprecated Use LINK_TYPE_LABELS from core/Constants.ts instead
     */
    static get LINK_TYPES(): Readonly<Record<LinkType, string>> {
        return LINK_TYPE_LABELS;
    }

    private options: DependenciesModalOptions;
    private container: HTMLElement;
    private element!: HTMLDialogElement; // Initialized in _buildDOM()
    private dom!: DependenciesModalDOM; // Initialized in _buildDOM()
    private activeTaskId: string | null = null;
    private tempDependencies: Dependency[] = [];
    private tempSuccessors: Array<{id: string, type: LinkType, lag: number}> = []; // NEW: Track selected successors
    private isPanel: boolean; // NEW
    private panelElement: HTMLElement | null = null; // NEW: Separate element for panel mode

    /**
     * Create a new DependenciesModal instance
     * 
     * @param options - Configuration options
     */
    constructor(options: DependenciesModalOptions = {}) {
        this.options = options;
        this.container = options.container || document.body;
        this.isPanel = options.isPanel ?? false;
        
        this._buildDOM();
        this._bindEvents();
    }

    /**
     * Get element for embedding (panel mode)
     */
    public getElement(): HTMLElement {
        if (this.isPanel) {
            if (!this.panelElement) {
                throw new Error('DependenciesModal: panelElement not initialized in panel mode');
            }
            return this.panelElement;
        }
        if (!this.element) {
            throw new Error('DependenciesModal: element not initialized in modal mode');
        }
        return this.element;
    }

    /**
     * Sync panel with task (for panel mode - no modal open/close)
     */
    public syncPanel(task: Task): void {
        if (!this.isPanel) return;
        
        // Ensure panel element exists
        if (!this.panelElement) {
            console.warn('[DependenciesModal] Panel element not initialized');
            return;
        }
        
        // If panel body was cleared by showEmptyState(), restore it
        const body = this.panelElement.querySelector('.deps-panel-body');
        if (body && !body.querySelector('#panel-pred')) {
            // Restore the panel body structure
            body.innerHTML = this._getPanelBodyHTML();
            // Re-cache DOM references
            this._cachePanelDOM();
            // Re-bind events
            this._bindEvents();
        }
        
        this.activeTaskId = task.id;
        this.tempDependencies = JSON.parse(JSON.stringify(task.dependencies || [])) as Dependency[];
        
        // Initialize tempSuccessors from existing successors (tasks that have this task as a dependency)
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        const existingSuccessors = tasks.filter(t => 
            t.dependencies && t.dependencies.some(d => d.id === task.id)
        );
        this.tempSuccessors = existingSuccessors.map(succ => {
            const link = succ.dependencies.find(d => d.id === task.id);
            return {
                id: succ.id,
                type: link?.type || 'FS',
                lag: link?.lag || 0,
            };
        });
        
        // Update task name display
        const taskNameEl = this.panelElement.querySelector('.panel-task-name');
        if (taskNameEl) {
            taskNameEl.textContent = task.name;
        }
        
        // Switch to Predecessors tab (default view)
        this._switchTab('pred');
        
        // Ensure the Predecessors tab is visible before rendering
        const predTab = this.panelElement.querySelector('#panel-pred') as HTMLElement;
        if (predTab) {
            predTab.classList.add('active');
        }
        
        // Render the dependencies (this will render the tree)
        this._render();
    }

    /**
     * Get panel body HTML (for rebuilding after showEmptyState)
     * @private
     */
    private _getPanelBodyHTML(): string {
        return `
                <!-- Predecessors Tab -->
                <div class="deps-tab-panel active" id="panel-pred">
                    <div class="deps-tree-selector">
                        <div class="deps-tree-header">Select Predecessors</div>
                        <div class="deps-tree-container" id="panel-pred-tree"></div>
                    </div>
                    <div class="deps-table-wrapper">
                        <table class="deps-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Task</th>
                                    <th>Type</th>
                                    <th>Lag</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="panel-pred-body"></tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Successors Tab -->
                <div class="deps-tab-panel" id="panel-succ">
                    <div class="deps-tree-selector">
                        <div class="deps-tree-header">Select Successors</div>
                        <div class="deps-tree-container" id="panel-succ-tree"></div>
                    </div>
                    <div class="deps-table-wrapper">
                        <table class="deps-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Task</th>
                                    <th>Type</th>
                                    <th>Lag</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="panel-succ-body"></tbody>
                        </table>
                    </div>
                </div>
        `;
    }

    /**
     * Show empty state (panel mode)
     */
    public showEmptyState(): void {
        if (!this.isPanel || !this.panelElement) return;
        
        this.activeTaskId = null;
        this.tempDependencies = [];
        this.tempSuccessors = [];
        
        const body = this.panelElement.querySelector('.deps-panel-body');
        if (body) {
            body.innerHTML = `
                <div class="deps-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    <p>Select a task to view dependencies</p>
                </div>
            `;
        }
    }

    /**
     * Build the modal DOM structure
     * @private
     */
    private _buildDOM(): void {
        if (this.isPanel) {
            this._buildPanelDOM();
        } else {
            this._buildModalDOM();
        }
    }

    /**
     * Build panel DOM structure (for embedded panel mode)
     * @private
     */
    private _buildPanelDOM(): void {
        this.panelElement = document.createElement('div');
        this.panelElement.className = 'dependencies-panel';
        
        this.panelElement.innerHTML = `
            <div class="deps-panel-header">
                <span class="panel-task-name">Select a task</span>
            </div>
            
            <div class="deps-panel-tabs">
                <button class="deps-tab-btn active" data-tab="pred">
                    Predecessors <span class="tab-count" id="panel-pred-count">0</span>
                </button>
                <button class="deps-tab-btn" data-tab="succ">
                    Successors <span class="tab-count" id="panel-succ-count">0</span>
                </button>
            </div>
            
            <div class="deps-panel-body">
                <!-- Predecessors Tab -->
                <div class="deps-tab-panel active" id="panel-pred">
                    <div class="deps-tree-selector">
                        <div class="deps-tree-header">Select Predecessors</div>
                        <div class="deps-tree-container" id="panel-pred-tree"></div>
                    </div>
                    <div class="deps-table-wrapper">
                        <table class="deps-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Task</th>
                                    <th>Type</th>
                                    <th>Lag</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="panel-pred-body"></tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Successors Tab -->
                <div class="deps-tab-panel" id="panel-succ">
                    <div class="deps-tree-selector">
                        <div class="deps-tree-header">Select Successors</div>
                        <div class="deps-tree-container" id="panel-succ-tree"></div>
                    </div>
                    <div class="deps-table-wrapper">
                        <table class="deps-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Task</th>
                                    <th>Type</th>
                                    <th>Lag</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="panel-succ-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <div class="deps-panel-footer">
                <button class="btn btn-primary" id="panel-save-btn">Apply Changes</button>
            </div>
        `;
        
        // Store DOM references for panel mode
        this._cachePanelDOM();
        
        // Append to container
        if (this.container) {
            this.container.appendChild(this.panelElement);
        }
    }

    /**
     * Cache panel DOM references
     * @private
     */
    private _cachePanelDOM(): void {
        if (!this.panelElement) return;
        
        const getElement = <T extends HTMLElement>(id: string): T => {
            const el = this.panelElement!.querySelector(`#${id}`) as T;
            if (!el) throw new Error(`Panel element #${id} not found`);
            return el;
        };

        // Cache panel-specific DOM references using the same interface
        // but pointing to panel elements
        this.dom = {
            taskName: this.panelElement.querySelector('.panel-task-name') as HTMLElement,
            predCount: getElement<HTMLElement>('panel-pred-count'),
            succCount: getElement<HTMLElement>('panel-succ-count'),
            tabBtns: this.panelElement.querySelectorAll('.deps-tab-btn'),
            panels: this.panelElement.querySelectorAll('.deps-tab-panel'),
            predSelect: null as any, // Not used in panel mode - replaced with tree
            addPredBtn: null as any, // Not used in panel mode - replaced with tree
            predBody: getElement<HTMLElement>('panel-pred-body'),
            succBody: getElement<HTMLElement>('panel-succ-body'),
            closeBtn: this.panelElement.querySelector('.panel-close-btn') as HTMLElement || document.createElement('div'), // Not used in panel mode
            cancelBtn: document.createElement('button'), // Not used in panel mode
            saveBtn: getElement<HTMLButtonElement>('panel-save-btn'),
        };
    }

    /**
     * Build modal DOM structure (for dialog mode)
     * @private
     */
    private _buildModalDOM(): void {
        this.element = document.createElement('dialog');
        this.element.className = 'modal-dialog dependencies-modal';
        this.element.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-header-left">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                        </svg>
                        <div>
                            <h3 class="modal-title">Task Dependencies</h3>
                            <p class="modal-subtitle" id="modal-task-name">Task Name</p>
                        </div>
                    </div>
                    <button class="modal-close" title="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="modal-tabs">
                    <button class="tab-btn active" data-tab="pred">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                        Predecessors
                        <span class="tab-count" id="pred-count">0</span>
                    </button>
                    <button class="tab-btn" data-tab="succ">
                        Successors
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18l6-6-6-6"/>
                        </svg>
                        <span class="tab-count" id="succ-count">0</span>
                    </button>
                </div>
                
                <div class="modal-body">
                    <!-- Predecessors Tab -->
                    <div class="tab-panel active" id="panel-pred">
                        <div class="add-link-row">
                            <select class="form-input" id="new-pred-select">
                                <option value="">Select a task to link...</option>
                            </select>
                            <button class="btn btn-primary" id="add-pred-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 5v14M5 12h14"/>
                                </svg>
                                Add
                            </button>
                        </div>
                        
                        <div class="links-table-wrapper">
                            <table class="links-table">
                                <thead>
                                    <tr>
                                        <th>Task Name</th>
                                        <th style="width: 140px;">Type</th>
                                        <th style="width: 80px;">Lag</th>
                                        <th style="width: 40px;"></th>
                                    </tr>
                                </thead>
                                <tbody id="pred-list-body">
                                    <tr class="empty-row">
                                        <td colspan="4">No predecessors. Add one above.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="link-help">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                            </svg>
                            <span>Predecessors are tasks that must complete (or start) before this task.</span>
                        </div>
                    </div>
                    
                    <!-- Successors Tab -->
                    <div class="tab-panel" id="panel-succ">
                        <div class="links-table-wrapper">
                            <table class="links-table">
                                <thead>
                                    <tr>
                                        <th>Task Name</th>
                                        <th style="width: 140px;">Relationship</th>
                                        <th style="width: 80px;">Lag</th>
                                    </tr>
                                </thead>
                                <tbody id="succ-list-body">
                                    <tr class="empty-row">
                                        <td colspan="3">No successors found.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="link-help">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                            </svg>
                            <span>Successors are tasks waiting on this task. Edit them from their own details.</span>
                        </div>
                    </div>
                </div>
                
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
                    <button class="btn btn-primary" id="save-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Save Changes
                    </button>
                </div>
            </div>
        `;
        
        this.container.appendChild(this.element);
        
        // Cache DOM references
        const getElement = <T extends HTMLElement>(id: string): T => {
            const el = this.element.querySelector(`#${id}`) as T;
            if (!el) throw new Error(`Element #${id} not found`);
            return el;
        };

        this.dom = {
            taskName: getElement<HTMLElement>('modal-task-name'),
            predCount: getElement<HTMLElement>('pred-count'),
            succCount: getElement<HTMLElement>('succ-count'),
            tabBtns: this.element.querySelectorAll('.tab-btn'),
            panels: this.element.querySelectorAll('.tab-panel'),
            predSelect: getElement<HTMLSelectElement>('new-pred-select'),
            addPredBtn: getElement<HTMLButtonElement>('add-pred-btn'),
            predBody: getElement<HTMLElement>('pred-list-body'),
            succBody: getElement<HTMLElement>('succ-list-body'),
            closeBtn: this.element.querySelector('.modal-close') as HTMLElement,
            cancelBtn: getElement<HTMLButtonElement>('cancel-btn'),
            saveBtn: getElement<HTMLButtonElement>('save-btn'),
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    private _bindEvents(): void {
        // Close buttons (only in modal mode)
        if (!this.isPanel) {
            if (this.dom.closeBtn) {
                this.dom.closeBtn.addEventListener('click', () => this.close());
            }
            if (this.dom.cancelBtn) {
                this.dom.cancelBtn.addEventListener('click', () => this.close());
            }
        }
        
        // Save button
        this.dom.saveBtn.addEventListener('click', () => this._save());
        
        // Tab switching
        this.dom.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab') as 'pred' | 'succ' | null;
                if (tab) this._switchTab(tab);
            });
        });
        
        // Add predecessor (only in modal mode - panel mode uses tree checkboxes)
        if (!this.isPanel && this.dom.addPredBtn) {
            this.dom.addPredBtn.addEventListener('click', () => this._addPredecessor());
        }
        
        // Close on backdrop click (only in modal mode)
        if (!this.isPanel && this.element) {
            this.element.addEventListener('click', (e: MouseEvent) => {
                if (e.target === this.element) {
                    this.close();
                }
            });
            
            // Close on Escape (only in modal mode)
            this.element.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    this.close();
                }
            });
        }
    }

    /**
     * Switch active tab
     * @private
     */
    private _switchTab(tab: 'pred' | 'succ'): void {
        // Update tab buttons
        this.dom.tabBtns.forEach(btn => {
            const btnTab = btn.getAttribute('data-tab');
            btn.classList.toggle('active', btnTab === tab);
        });
        
        // Update panels
        this.dom.panels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `panel-${tab}`);
        });
    }

    /**
     * Render the modal content
     * @private
     */
    private _render(): void {
        this._renderPredecessors();
        this._renderSuccessors();
        if (this.isPanel) {
            this._renderPredTree();
            this._renderSuccTree();
        } else {
            this._populatePredSelect();
        }
        this._updateCounts();
    }

    /**
     * Render predecessors list
     * @private
     */
    private _renderPredecessors(): void {
        const tbody = this.dom.predBody;
        
        if (this.tempDependencies.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="5">No predecessors. Add one above.</td>
                </tr>
            `;
            return;
        }
        
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        
        // Build task index map (same logic as tree)
        const buildFlatList = (parentId: string | null, list: Array<{task: Task, index: number}> = [], index: number = 1): number => {
            const children = tasks.filter(t => t.parentId === parentId).sort((a, b) => {
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            
            for (const child of children) {
                list.push({ task: child, index });
                index = buildFlatList(child.id, list, index + 1);
            }
            
            return index;
        };
        
        const flatList: Array<{task: Task, index: number}> = [];
        buildFlatList(null, flatList);
        const taskIndexMap = new Map(flatList.map(item => [item.task.id, item.index]));
        
        tbody.innerHTML = this.tempDependencies.map((dep, idx) => {
            const task = tasks.find(t => t.id === dep.id);
            if (!task) return '';
            const taskIndex = taskIndexMap.get(task.id) || 0;
            
            return `
                <tr data-index="${idx}">
                    <td class="task-id-cell" style="text-align: right; font-weight: 600; color: #94a3b8; font-variant-numeric: tabular-nums;">
                        ${taskIndex}
                    </td>
                    <td class="task-name-cell">
                        <span class="task-name">${this._escapeHtml(task.name)}</span>
                    </td>
                    <td>
                        <select class="form-input form-select-sm link-type-select" data-index="${idx}">
                            <option value="FS" ${dep.type === 'FS' ? 'selected' : ''}>Finish to Start</option>
                            <option value="SS" ${dep.type === 'SS' ? 'selected' : ''}>Start to Start</option>
                            <option value="FF" ${dep.type === 'FF' ? 'selected' : ''}>Finish to Finish</option>
                            <option value="SF" ${dep.type === 'SF' ? 'selected' : ''}>Start to Finish</option>
                        </select>
                    </td>
                    <td>
                        <input type="number" class="form-input form-input-sm lag-input" 
                               value="${dep.lag || 0}" data-index="${idx}" 
                               title="Positive = lag, Negative = lead">
                    </td>
                    <td>
                        <button class="btn-icon btn-danger-icon remove-link-btn" data-index="${idx}" title="Remove link">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Bind events to new elements
        tbody.querySelectorAll('.link-type-select').forEach(select => {
            const selectEl = select as HTMLSelectElement;
            selectEl.addEventListener('change', () => {
                const idx = parseInt(selectEl.getAttribute('data-index') || '0');
                const type = selectEl.value as LinkType;
                if (this.tempDependencies[idx]) {
                    this.tempDependencies[idx].type = type;
                }
            });
        });
        
        tbody.querySelectorAll('.lag-input').forEach(input => {
            const inputEl = input as HTMLInputElement;
            inputEl.addEventListener('change', () => {
                const idx = parseInt(inputEl.getAttribute('data-index') || '0');
                const lag = parseInt(inputEl.value) || 0;
                if (this.tempDependencies[idx]) {
                    this.tempDependencies[idx].lag = lag;
                }
            });
        });
        
        tbody.querySelectorAll('.remove-link-btn').forEach(btn => {
            const btnEl = btn as HTMLButtonElement;
            btnEl.addEventListener('click', () => {
                const idx = parseInt(btnEl.getAttribute('data-index') || '0');
                this._removePredecessor(idx);
            });
        });
    }

    /**
     * Render successors list (editable in panel mode)
     * @private
     */
    private _renderSuccessors(): void {
        const tbody = this.dom.succBody;
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        
        // Update count
        this.dom.succCount.textContent = String(this.tempSuccessors.length);
        
        if (this.tempSuccessors.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="${this.isPanel ? '5' : '3'}">No successors. Add one above.</td>
                </tr>
            `;
            return;
        }
        
        // Build task index map (same logic as tree)
        const buildFlatList = (parentId: string | null, list: Array<{task: Task, index: number}> = [], index: number = 1): number => {
            const children = tasks.filter(t => t.parentId === parentId).sort((a, b) => {
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            
            for (const child of children) {
                list.push({ task: child, index });
                index = buildFlatList(child.id, list, index + 1);
            }
            
            return index;
        };
        
        const flatList: Array<{task: Task, index: number}> = [];
        buildFlatList(null, flatList);
        const taskIndexMap = new Map(flatList.map(item => [item.task.id, item.index]));
        
        tbody.innerHTML = this.tempSuccessors.map((succ, idx) => {
            const task = tasks.find(t => t.id === succ.id);
            if (!task) return '';
            const taskIndex = taskIndexMap.get(task.id) || 0;
            
            return `
                <tr data-index="${idx}">
                    <td class="task-id-cell" style="text-align: right; font-weight: 600; color: #94a3b8; font-variant-numeric: tabular-nums;">
                        ${taskIndex}
                    </td>
                    <td class="task-name-cell">
                        <span class="task-name">${this._escapeHtml(task.name)}</span>
                    </td>
                    <td>
                        <select class="form-input form-select-sm link-type-select" data-index="${idx}">
                            <option value="FS" ${succ.type === 'FS' ? 'selected' : ''}>Finish to Start</option>
                            <option value="SS" ${succ.type === 'SS' ? 'selected' : ''}>Start to Start</option>
                            <option value="FF" ${succ.type === 'FF' ? 'selected' : ''}>Finish to Finish</option>
                            <option value="SF" ${succ.type === 'SF' ? 'selected' : ''}>Start to Finish</option>
                        </select>
                    </td>
                    <td>
                        <input type="number" class="form-input form-input-sm lag-input" 
                               value="${succ.lag || 0}" data-index="${idx}" 
                               title="Positive = lag, Negative = lead">
                    </td>
                    ${this.isPanel ? `
                    <td>
                        <button class="btn-icon btn-danger-icon remove-link-btn" data-index="${idx}" title="Remove link">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </td>
                    ` : ''}
                </tr>
            `;
        }).join('');
        
        // Bind events to new elements (only in panel mode)
        if (this.isPanel) {
            tbody.querySelectorAll('.link-type-select').forEach(select => {
                const selectEl = select as HTMLSelectElement;
                selectEl.addEventListener('change', () => {
                    const idx = parseInt(selectEl.getAttribute('data-index') || '0');
                    const type = selectEl.value as LinkType;
                    if (this.tempSuccessors[idx]) {
                        this.tempSuccessors[idx].type = type;
                    }
                });
            });
            
            tbody.querySelectorAll('.lag-input').forEach(input => {
                const inputEl = input as HTMLInputElement;
                inputEl.addEventListener('change', () => {
                    const idx = parseInt(inputEl.getAttribute('data-index') || '0');
                    const lag = parseInt(inputEl.value) || 0;
                    if (this.tempSuccessors[idx]) {
                        this.tempSuccessors[idx].lag = lag;
                    }
                });
            });
            
            tbody.querySelectorAll('.remove-link-btn').forEach(btn => {
                const btnEl = btn as HTMLButtonElement;
                btnEl.addEventListener('click', () => {
                    const idx = parseInt(btnEl.getAttribute('data-index') || '0');
                    this._removeSuccessor(idx);
                });
            });
        }
    }

    /**
     * Render predecessor selection tree (panel mode)
     * @private
     */
    private _renderPredTree(): void {
        if (!this.panelElement) {
            console.warn('[DependenciesModal] Panel element not initialized');
            return;
        }
        
        // Find the tree container - it's inside the Predecessors tab panel
        const predTab = this.panelElement.querySelector('#panel-pred') as HTMLElement;
        if (!predTab) {
            console.warn('[DependenciesModal] Predecessors tab not found, panelElement:', this.panelElement);
            return;
        }
        
        const treeContainer = predTab.querySelector('#panel-pred-tree') as HTMLElement;
        if (!treeContainer) {
            console.warn('[DependenciesModal] Tree container not found in Predecessors tab. predTab:', predTab);
            return;
        }
        
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        const isParent = this.options.isParent || (() => false);
        
        if (tasks.length === 0) {
            treeContainer.innerHTML = '<div class="deps-tree-empty">No tasks available</div>';
            return;
        }
        
        // Get selected predecessor IDs for checkbox state
        const selectedIds = new Set(this.tempDependencies.map(d => d.id));
        
        // Build flat list with indices (similar to grid view)
        const buildFlatList = (parentId: string | null, list: Array<{task: Task, index: number}> = [], index: number = 1): number => {
            const children = tasks.filter(t => t.parentId === parentId).sort((a, b) => {
                // Sort by sortKey if available, otherwise by name
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            
            for (const child of children) {
                list.push({ task: child, index });
                index = buildFlatList(child.id, list, index + 1);
            }
            
            return index;
        };
        
        const flatList: Array<{task: Task, index: number}> = [];
        buildFlatList(null, flatList);
        const taskIndexMap = new Map(flatList.map(item => [item.task.id, item.index]));
        
        // Build hierarchical structure
        const rootTasks = tasks.filter(t => !t.parentId).sort((a, b) => {
            if (a.sortKey && b.sortKey) {
                return a.sortKey.localeCompare(b.sortKey);
            }
            return a.name.localeCompare(b.name);
        });
        
        const renderTask = (task: Task, depth: number = 0): string => {
            // Check if this task should be disabled (can't link to self or parent tasks)
            const isDisabled = task.id === this.activeTaskId || isParent(task.id);
            const isSelected = selectedIds.has(task.id);
            const padding = depth * 20;
            const children = tasks.filter(t => t.parentId === task.id).sort((a, b) => {
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            const taskIndex = taskIndexMap.get(task.id) || 0;
            
            // Render the task (always visible, but checkbox may be disabled)
            let html = `
                <div class="deps-tree-item ${isDisabled ? 'deps-tree-item-disabled' : ''}" data-task-id="${task.id}" style="padding-left: ${padding}px;">
                    <label class="deps-tree-label">
                        <input type="checkbox" class="deps-tree-checkbox" 
                               ${isSelected ? 'checked' : ''} 
                               ${isDisabled ? 'disabled' : ''}
                               data-task-id="${task.id}">
                        <span class="deps-tree-id">${taskIndex}</span>
                        <span class="deps-tree-name">${this._escapeHtml(task.name)}</span>
                    </label>
                </div>
            `;
            
            // Render children
            children.forEach(child => {
                html += renderTask(child, depth + 1);
            });
            
            return html;
        };
        
        let treeHTML = '<div class="deps-tree-list">';
        if (rootTasks.length === 0) {
            treeHTML += '<div class="deps-tree-empty">No tasks available</div>';
        } else {
            rootTasks.forEach(task => {
                treeHTML += renderTask(task);
            });
        }
        treeHTML += '</div>';
        
        treeContainer.innerHTML = treeHTML;
        
        // Bind checkbox events
        treeContainer.querySelectorAll('.deps-tree-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const taskId = target.dataset.taskId;
                if (!taskId || target.disabled) return; // Don't process disabled checkboxes
                
                if (target.checked) {
                    // Add as predecessor (only if not already in list)
                    if (!this.tempDependencies.some(d => d.id === taskId)) {
                        this.tempDependencies.push({
                            id: taskId,
                            type: 'FS',
                            lag: 0,
                        });
                    }
                } else {
                    // Remove predecessor
                    const index = this.tempDependencies.findIndex(d => d.id === taskId);
                    if (index > -1) {
                        this.tempDependencies.splice(index, 1);
                    }
                }
                
                // Re-render to update the table and tree
                this._renderPredecessors();
                this._updateCounts();
                this._renderPredTree(); // Update tree checkboxes (syncs state)
            });
        });
    }

    /**
     * Render successor selection tree (panel mode)
     * @private
     */
    private _renderSuccTree(): void {
        if (!this.panelElement) {
            console.warn('[DependenciesModal] Panel element not initialized');
            return;
        }
        
        // Find the tree container - it's inside the Successors tab panel
        const succTab = this.panelElement.querySelector('#panel-succ') as HTMLElement;
        if (!succTab) {
            console.warn('[DependenciesModal] Successors tab not found');
            return;
        }
        
        const treeContainer = succTab.querySelector('#panel-succ-tree') as HTMLElement;
        if (!treeContainer) {
            console.warn('[DependenciesModal] Successor tree container not found');
            return;
        }
        
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        const isParent = this.options.isParent || (() => false);
        
        if (tasks.length === 0) {
            treeContainer.innerHTML = '<div class="deps-tree-empty">No tasks available</div>';
            return;
        }
        
        // Get selected successor IDs for checkbox state
        const selectedIds = new Set(this.tempSuccessors.map(s => s.id));
        
        // Build flat list with indices (similar to grid view)
        const buildFlatList = (parentId: string | null, list: Array<{task: Task, index: number}> = [], index: number = 1): number => {
            const children = tasks.filter(t => t.parentId === parentId).sort((a, b) => {
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            
            for (const child of children) {
                list.push({ task: child, index });
                index = buildFlatList(child.id, list, index + 1);
            }
            
            return index;
        };
        
        const flatList: Array<{task: Task, index: number}> = [];
        buildFlatList(null, flatList);
        const taskIndexMap = new Map(flatList.map(item => [item.task.id, item.index]));
        
        // Build hierarchical structure
        const rootTasks = tasks.filter(t => !t.parentId).sort((a, b) => {
            if (a.sortKey && b.sortKey) {
                return a.sortKey.localeCompare(b.sortKey);
            }
            return a.name.localeCompare(b.name);
        });
        
        const renderTask = (task: Task, depth: number = 0): string => {
            // Check if this task should be disabled (can't link to self or parent tasks)
            const isDisabled = task.id === this.activeTaskId || isParent(task.id);
            const isSelected = selectedIds.has(task.id);
            const padding = depth * 20;
            const children = tasks.filter(t => t.parentId === task.id).sort((a, b) => {
                if (a.sortKey && b.sortKey) {
                    return a.sortKey.localeCompare(b.sortKey);
                }
                return a.name.localeCompare(b.name);
            });
            const taskIndex = taskIndexMap.get(task.id) || 0;
            
            // Render the task (always visible, but checkbox may be disabled)
            let html = `
                <div class="deps-tree-item ${isDisabled ? 'deps-tree-item-disabled' : ''}" data-task-id="${task.id}" style="padding-left: ${padding}px;">
                    <label class="deps-tree-label">
                        <input type="checkbox" class="deps-tree-checkbox" 
                               ${isSelected ? 'checked' : ''} 
                               ${isDisabled ? 'disabled' : ''}
                               data-task-id="${task.id}">
                        <span class="deps-tree-id">${taskIndex}</span>
                        <span class="deps-tree-name">${this._escapeHtml(task.name)}</span>
                    </label>
                </div>
            `;
            
            // Render children
            children.forEach(child => {
                html += renderTask(child, depth + 1);
            });
            
            return html;
        };
        
        let treeHTML = '<div class="deps-tree-list">';
        if (rootTasks.length === 0) {
            treeHTML += '<div class="deps-tree-empty">No tasks available</div>';
        } else {
            rootTasks.forEach(task => {
                treeHTML += renderTask(task);
            });
        }
        treeHTML += '</div>';
        
        treeContainer.innerHTML = treeHTML;
        
        // Bind checkbox events
        treeContainer.querySelectorAll('.deps-tree-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const taskId = target.dataset.taskId;
                if (!taskId || target.disabled) return; // Don't process disabled checkboxes
                
                if (target.checked) {
                    // Add as successor (only if not already in list)
                    if (!this.tempSuccessors.some(s => s.id === taskId)) {
                        this.tempSuccessors.push({
                            id: taskId,
                            type: 'FS',
                            lag: 0,
                        });
                    }
                } else {
                    // Remove successor
                    const index = this.tempSuccessors.findIndex(s => s.id === taskId);
                    if (index > -1) {
                        this.tempSuccessors.splice(index, 1);
                    }
                }
                
                // Re-render to update the table and tree
                this._renderSuccessors();
                this._updateCounts();
                this._renderSuccTree(); // Update tree checkboxes (syncs state)
            });
        });
    }

    /**
     * Populate the predecessor select dropdown (modal mode)
     * @private
     */
    private _populatePredSelect(): void {
        if (this.isPanel) return; // Not used in panel mode
        
        const select = this.dom.predSelect;
        if (!select) return;
        
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        const isParent = this.options.isParent || (() => false);
        
        // Get existing predecessor IDs
        const existingIds = new Set(this.tempDependencies.map(d => d.id));
        if (this.activeTaskId) {
            existingIds.add(this.activeTaskId); // Can't link to self
        }
        
        // Filter available tasks
        const availableTasks = tasks.filter(t => 
            !existingIds.has(t.id) && !isParent(t.id)
        );
        
        select.innerHTML = '<option value="">Select a task to link...</option>';
        
        availableTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task.id;
            option.textContent = task.name;
            select.appendChild(option);
        });
    }

    /**
     * Update predecessor/successor counts
     * @private
     */
    private _updateCounts(): void {
        this.dom.predCount.textContent = String(this.tempDependencies.length);
        this.dom.succCount.textContent = String(this.tempSuccessors.length);
    }

    /**
     * Add a new predecessor
     * @private
     */
    private _addPredecessor(): void {
        const select = this.dom.predSelect;
        const taskId = select.value;
        
        if (!taskId) return;
        
        // Add new dependency
        this.tempDependencies.push({
            id: taskId,
            type: 'FS',
            lag: 0,
        });
        
        // Re-render
        this._render();
        
        // Reset select
        select.value = '';
    }

    /**
     * Remove a predecessor
     * @private
     */
    private _removePredecessor(index: number): void {
        this.tempDependencies.splice(index, 1);
        this._render();
    }

    /**
     * Remove a successor from the list
     * @private
     */
    private _removeSuccessor(index: number): void {
        this.tempSuccessors.splice(index, 1);
        this._render();
    }

    /**
     * Save dependencies and close
     * @private
     */
    private _save(): void {
        if (!this.activeTaskId) return;
        
        // Save predecessors (stored in current task's dependencies)
        if (this.options.onSave) {
            this.options.onSave(this.activeTaskId, [...this.tempDependencies]);
        }
        
        // Save successors (stored in each successor task's dependencies)
        if (this.isPanel && this.options.getTasks) {
            const tasks = this.options.getTasks();
            const currentTaskId = this.activeTaskId;
            
            // Get all tasks that currently have this task as a dependency
            const currentSuccessors = tasks.filter(t => 
                t.dependencies && t.dependencies.some(d => d.id === currentTaskId)
            );
            
            // Update each successor task's dependencies
            const successorIds = new Set(this.tempSuccessors.map(s => s.id));
            
            // Remove dependencies from tasks that are no longer successors
            currentSuccessors.forEach(succ => {
                if (!successorIds.has(succ.id)) {
                    // Remove the dependency
                    const updatedDeps = succ.dependencies.filter(d => d.id !== currentTaskId);
                    if (this.options.onSave) {
                        this.options.onSave(succ.id, updatedDeps);
                    }
                }
            });
            
            // Add/update dependencies for tasks that are now successors
            this.tempSuccessors.forEach(succ => {
                const succTask = tasks.find(t => t.id === succ.id);
                if (!succTask) return;
                
                // Get current dependencies, removing any existing link to current task
                const updatedDeps = (succTask.dependencies || []).filter(d => d.id !== currentTaskId);
                
                // Add the new dependency
                updatedDeps.push({
                    id: currentTaskId,
                    type: succ.type,
                    lag: succ.lag,
                });
                
                if (this.options.onSave) {
                    this.options.onSave(succ.id, updatedDeps);
                }
            });
        }
        
        // Only close if in modal mode (panel mode stays open)
        if (!this.isPanel) {
            this.close();
        }
    }

    /**
     * Escape HTML special characters
     * @private
     */
    private _escapeHtml(str: string): string {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
    }

    /**
     * Open the modal for a task
     * 
     * @param task - The task to edit dependencies for
     */
    open(task: Task): void {
        if (!task) return;
        
        // If in panel mode, use syncPanel instead
        if (this.isPanel) {
            this.syncPanel(task);
            return;
        }
        
        this.activeTaskId = task.id;
        this.tempDependencies = JSON.parse(JSON.stringify(task.dependencies || [])) as Dependency[];
        
        // Update UI
        this.dom.taskName.textContent = task.name;
        this._switchTab('pred');
        this._render();
        
        // Show modal (only in modal mode)
        if (this.element) {
            this.element.showModal();
        }
    }

    /**
     * Close the modal
     */
    close(): void {
        this.element.close();
        this.activeTaskId = null;
        this.tempDependencies = [];
    }

    /**
     * Destroy the modal
     */
    destroy(): void {
        if (this.isPanel && this.panelElement) {
            this.panelElement.remove();
        } else if (this.element) {
            this.element.remove();
        }
    }
}
