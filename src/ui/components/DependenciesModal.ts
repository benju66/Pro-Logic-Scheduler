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
  onSave?: (taskId: string, dependencies: Dependency[]) => void;
  getTasks?: () => Task[];
  isParent?: (taskId: string) => boolean;
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

    /**
     * Create a new DependenciesModal instance
     * 
     * @param options - Configuration options
     */
    constructor(options: DependenciesModalOptions = {}) {
        this.options = options;
        this.container = options.container || document.body;
        
        this._buildDOM();
        this._bindEvents();
    }

    /**
     * Build the modal DOM structure
     * @private
     */
    private _buildDOM(): void {
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
        // Close buttons
        this.dom.closeBtn.addEventListener('click', () => this.close());
        this.dom.cancelBtn.addEventListener('click', () => this.close());
        
        // Save button
        this.dom.saveBtn.addEventListener('click', () => this._save());
        
        // Tab switching
        this.dom.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab') as 'pred' | 'succ' | null;
                if (tab) this._switchTab(tab);
            });
        });
        
        // Add predecessor
        this.dom.addPredBtn.addEventListener('click', () => this._addPredecessor());
        
        // Close on backdrop click
        this.element.addEventListener('click', (e: MouseEvent) => {
            if (e.target === this.element) {
                this.close();
            }
        });
        
        // Close on Escape
        this.element.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
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
        this._populatePredSelect();
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
                    <td colspan="4">No predecessors. Add one above.</td>
                </tr>
            `;
            return;
        }
        
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        
        tbody.innerHTML = this.tempDependencies.map((dep, idx) => {
            const task = tasks.find(t => t.id === dep.id);
            if (!task) return '';
            
            return `
                <tr data-index="${idx}">
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
     * Render successors list (read-only)
     * @private
     */
    private _renderSuccessors(): void {
        const tbody = this.dom.succBody;
        const tasks = this.options.getTasks ? this.options.getTasks() : [];
        
        if (!this.activeTaskId) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="3">No successors found.</td>
                </tr>
            `;
            return;
        }
        
        // Find tasks that have this task as a dependency
        const successors = tasks.filter(t => 
            t.dependencies && t.dependencies.some(d => d.id === this.activeTaskId)
        );
        
        this.dom.succCount.textContent = String(successors.length);
        
        if (successors.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="3">No successors found.</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = successors.map(succ => {
            const link = succ.dependencies.find(d => d.id === this.activeTaskId);
            if (!link) return '';
            const typeLabel = DependenciesModal.LINK_TYPES[link.type] || link.type;
            
            return `
                <tr>
                    <td class="task-name-cell">
                        <span class="task-name">${this._escapeHtml(succ.name)}</span>
                    </td>
                    <td class="text-muted">${typeLabel}</td>
                    <td class="text-muted">${link.lag || 0} days</td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Populate the predecessor select dropdown
     * @private
     */
    private _populatePredSelect(): void {
        const select = this.dom.predSelect;
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
     * Save dependencies and close
     * @private
     */
    private _save(): void {
        if (this.options.onSave && this.activeTaskId) {
            this.options.onSave(this.activeTaskId, [...this.tempDependencies]);
        }
        this.close();
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
        
        this.activeTaskId = task.id;
        this.tempDependencies = JSON.parse(JSON.stringify(task.dependencies || [])) as Dependency[];
        
        // Update UI
        this.dom.taskName.textContent = task.name;
        this._switchTab('pred');
        this._render();
        
        // Show modal
        this.element.showModal();
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
        this.element.remove();
    }
}
