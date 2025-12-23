/**
 * ============================================================================
 * SideDrawer.ts
 * ============================================================================
 * * Slide-in panel component for detailed task editing.
 * Provides a form interface for editing task properties including:
 * - Task name
 * - Duration
 * - Progress (% complete)
 * - Constraint type and date
 * * @author Pro Logic Scheduler
 * @version 2.0.2 - Full Implementation
 */

import type { Task, ConstraintType } from '../../types';
import { createElement, Anchor, AlarmClock, Hourglass, Flag, Lock } from 'lucide';

/**
 * Side drawer options
 */
export interface SideDrawerOptions {
  container: HTMLElement;
  isEmbedded?: boolean;
  onUpdate?: (taskId: string, field: string, value: unknown) => void;
  onDelete?: (taskId: string) => void;
  onOpenLinks?: (taskId: string) => void;
  getScheduler?: () => { hasBaseline: () => boolean; calculateVariance: (task: Task) => { start: number | null; finish: number | null } } | null;
}

/**
 * Side drawer DOM references
 */
interface SideDrawerDOM {
  name: HTMLInputElement;
  duration: HTMLInputElement;
  progress: HTMLInputElement;
  start: HTMLInputElement;
  end: HTMLInputElement;
  constraintType: HTMLSelectElement;
  constraintDate: HTMLInputElement;
  constraintDateGroup: HTMLElement;
  constraintDesc: HTMLElement;
  constraintIcon: HTMLElement;
  schedulingMode: HTMLSelectElement;
  modeDescription: HTMLElement;
  modeIconDisplay: HTMLElement;
  notes: HTMLTextAreaElement;
  totalFloat: HTMLElement;
  freeFloat: HTMLElement;
  lateStart: HTMLElement;
  lateFinish: HTMLElement;
  criticalBadge: HTMLElement;
  cpmSection: HTMLElement;
  healthStatus: HTMLElement;
  healthSection: HTMLElement;
  progressSection: HTMLElement;
  baselineStart: HTMLInputElement;
  baselineFinish: HTMLInputElement;
  actualStart: HTMLInputElement;
  actualFinish: HTMLInputElement;
  startVariance: HTMLInputElement;
  finishVariance: HTMLInputElement;
  closeBtn: HTMLButtonElement | null;
  deleteBtn: HTMLButtonElement;
  linksBtn: HTMLButtonElement;
}

export class SideDrawer {
    
    /**
     * Constraint type descriptions for help text
     */
    static readonly CONSTRAINT_DESCRIPTIONS: Readonly<Record<ConstraintType, string>> = {
        'asap': 'Task flows naturally based on predecessors.',
        'snet': 'Task cannot start before this date, but can start later if needed.',
        'snlt': 'Task must start by this date. Creates conflict if dependencies push later.',
        'fnet': 'Task cannot finish before this date. Useful for cure times, inspections.',
        'fnlt': 'Task must finish by this date. Common for contract deadlines.',
        'mfo': 'Task MUST finish exactly on this date. Hard constraint.',
    };

    private options: SideDrawerOptions;
    private container: HTMLElement;
    private element!: HTMLElement; 
    private dom!: SideDrawerDOM; 
    private activeTaskId: string | null = null;
    private isOpen: boolean = false;
    private isEmbedded: boolean;
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(options: SideDrawerOptions) {
        this.options = options;
        this.container = options.container;
        this.isEmbedded = options.isEmbedded ?? false;
        
        this._buildDOM();
        this._bindEvents();
    }

    private _buildDOM(): void {
        this.element = document.createElement('div');
        this.element.className = this.isEmbedded ? 'side-drawer-embedded' : 'side-drawer';
        
        const headerHtml = this.isEmbedded ? '' : `
            <div class="drawer-header">
                <h3 class="drawer-title">Task Details</h3>
                <button class="drawer-close" title="Close (Esc)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
        
        this.element.innerHTML = `${headerHtml}
            <div class="drawer-body">
                ${this._getFormBodyHTML()}
            </div>
            <div class="drawer-footer">
                <button class="btn btn-danger btn-block" id="drawer-delete-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Delete Task
                </button>
            </div>
        `;
        
        this.container.appendChild(this.element);
        this._cacheDOM();
    }

    private _cacheDOM(): void {
        const getElement = <T extends HTMLElement>(id: string): T => {
            const el = this.element.querySelector(`#${id}`) as T;
            if (!el) console.warn(`SideDrawer: Element #${id} not found`);
            return el;
        };

        this.dom = {
            name: getElement<HTMLInputElement>('drawer-name'),
            duration: getElement<HTMLInputElement>('drawer-duration'),
            progress: getElement<HTMLInputElement>('drawer-progress'),
            start: getElement<HTMLInputElement>('drawer-start'),
            end: getElement<HTMLInputElement>('drawer-end'),
            constraintType: getElement<HTMLSelectElement>('drawer-constraintType'),
            constraintDate: getElement<HTMLInputElement>('drawer-constraintDate'),
            constraintDateGroup: getElement<HTMLElement>('drawer-constraint-date-group'),
            constraintDesc: getElement<HTMLElement>('drawer-constraint-desc'),
            constraintIcon: getElement<HTMLElement>('drawer-constraint-icon'),
            schedulingMode: getElement<HTMLSelectElement>('drawer-schedulingMode'),
            modeDescription: getElement<HTMLElement>('drawer-mode-description'),
            modeIconDisplay: getElement<HTMLElement>('drawer-mode-icon-display'),
            notes: getElement<HTMLTextAreaElement>('drawer-notes'),
            totalFloat: getElement<HTMLElement>('drawer-total-float'),
            freeFloat: getElement<HTMLElement>('drawer-free-float'),
            lateStart: getElement<HTMLElement>('drawer-late-start'),
            lateFinish: getElement<HTMLElement>('drawer-late-finish'),
            criticalBadge: getElement<HTMLElement>('drawer-critical-badge'),
            cpmSection: getElement<HTMLElement>('drawer-cpm-section'),
            healthStatus: getElement<HTMLElement>('drawer-health-status'),
            healthSection: getElement<HTMLElement>('drawer-health-section'),
            progressSection: getElement<HTMLElement>('drawer-progress-section'),
            baselineStart: getElement<HTMLInputElement>('drawer-baseline-start'),
            baselineFinish: getElement<HTMLInputElement>('drawer-baseline-finish'),
            actualStart: getElement<HTMLInputElement>('drawer-actual-start'),
            actualFinish: getElement<HTMLInputElement>('drawer-actual-finish'),
            startVariance: getElement<HTMLInputElement>('drawer-start-variance'),
            finishVariance: getElement<HTMLInputElement>('drawer-finish-variance'),
            closeBtn: this.element.querySelector('.drawer-close') as HTMLButtonElement | null,
            deleteBtn: getElement<HTMLButtonElement>('drawer-delete-btn'),
            linksBtn: getElement<HTMLButtonElement>('drawer-links-btn'),
        };
    }

    private _bindEvents(): void {
        if (!this.dom) return;

        if (this.dom.closeBtn) {
            this.dom.closeBtn.addEventListener('click', () => this.close());
        }
        
        // Inputs
        const bindChange = (el: HTMLElement | null, field: string) => {
            if (el && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
                el.addEventListener('change', () => this._handleChange(field, el.value));
            }
        };

        bindChange(this.dom.name, 'name');
        bindChange(this.dom.duration, 'duration');
        bindChange(this.dom.progress, 'progress');
        bindChange(this.dom.notes, 'notes');
        bindChange(this.dom.start, 'start');
        bindChange(this.dom.end, 'end');
        bindChange(this.dom.actualStart, 'actualStart');
        bindChange(this.dom.actualFinish, 'actualFinish');

        if (this.dom.constraintType) {
            this.dom.constraintType.addEventListener('change', () => {
                const type = this.dom.constraintType.value as ConstraintType;
                this._updateConstraintDesc(type);
                this._handleChange('constraintType', type);
            });
        }
        
        if (this.dom.schedulingMode) {
            this.dom.schedulingMode.addEventListener('change', () => {
                const newMode = this.dom.schedulingMode.value as 'Auto' | 'Manual';
                this._updateModeDisplay(newMode);
                this._handleChange('schedulingMode', newMode);
            });
        }
        
        if (this.dom.constraintDate) {
            this.dom.constraintDate.addEventListener('change', () => {
                const type = this.dom.constraintType?.value as ConstraintType || 'asap';
                const constraintDate = this.dom.constraintDate.value || '';
                this._updateConstraintIcon(type, constraintDate);
                this._handleChange('constraintDate', constraintDate);
            });
        }
        
        if (this.dom.deleteBtn) {
            this.dom.deleteBtn.addEventListener('click', () => {
                if (this.activeTaskId && this.options.onDelete) {
                    this.options.onDelete(this.activeTaskId);
                }
            });
        }
        
        if (this.dom.linksBtn) {
            this.dom.linksBtn.addEventListener('click', () => {
                if (this.activeTaskId && this.options.onOpenLinks) {
                    this.options.onOpenLinks(this.activeTaskId);
                }
            });
        }
        
        // Keyboard
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    private _getFormBodyHTML(): string {
        return `
            <div class="form-group">
                <label class="form-label">Task Name</label>
                <input type="text" id="drawer-name" class="form-input" placeholder="Enter task name">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Duration (Days)</label>
                    <input type="number" id="drawer-duration" class="form-input" min="1" placeholder="1">
                </div>
                <div class="form-group">
                    <label class="form-label">% Complete</label>
                    <input type="number" id="drawer-progress" class="form-input" min="0" max="100" placeholder="0">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Start Date</label>
                    <input type="date" id="drawer-start" class="form-input">
                    <p class="form-hint">Editing applies SNET constraint</p>
                </div>
                <div class="form-group">
                    <label class="form-label">Finish Date</label>
                    <input type="date" id="drawer-end" class="form-input">
                    <p class="form-hint">Editing applies FNLT deadline</p>
                </div>
            </div>
            <div class="form-section" id="drawer-cpm-section">
                <h4 class="form-section-title">Schedule Analysis</h4>
                <div class="cpm-grid">
                    <div class="cpm-item"><span class="cpm-label">Total Float</span><span class="cpm-value" id="drawer-total-float">-</span></div>
                    <div class="cpm-item"><span class="cpm-label">Free Float</span><span class="cpm-value" id="drawer-free-float">-</span></div>
                    <div class="cpm-item"><span class="cpm-label">Late Start</span><span class="cpm-value" id="drawer-late-start">-</span></div>
                    <div class="cpm-item"><span class="cpm-label">Late Finish</span><span class="cpm-value" id="drawer-late-finish">-</span></div>
                </div>
                <div class="cpm-critical" id="drawer-critical-badge" style="display: none;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    Critical Path Task
                </div>
            </div>
            <div class="form-group" id="drawer-health-section">
                <label class="form-label">Schedule Health</label>
                <div class="health-status" id="drawer-health-status"></div>
            </div>
            <div class="form-section" id="drawer-progress-section" style="display: none;">
                <h4 class="form-section-title">Progress Tracking</h4>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Baseline Start</label><input type="text" id="drawer-baseline-start" class="form-input" readonly style="background: #f1f5f9; color: #64748b;"></div>
                    <div class="form-group"><label class="form-label">Baseline Finish</label><input type="text" id="drawer-baseline-finish" class="form-input" readonly style="background: #f1f5f9; color: #64748b;"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Actual Start</label><input type="date" id="drawer-actual-start" class="form-input"></div>
                    <div class="form-group"><label class="form-label">Actual Finish</label><input type="date" id="drawer-actual-finish" class="form-input"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Start Variance</label><input type="text" id="drawer-start-variance" class="form-input" readonly style="background: #f1f5f9;"></div>
                    <div class="form-group"><label class="form-label">Finish Variance</label><input type="text" id="drawer-finish-variance" class="form-input" readonly style="background: #f1f5f9;"></div>
                </div>
            </div>
            <div class="form-section">
                <h4 class="form-section-title">Constraints & Logic</h4>
                <div class="form-group">
                    <label class="form-label">Constraint Type <span id="drawer-constraint-icon" class="drawer-constraint-icon"></span></label>
                    <select id="drawer-constraintType" class="form-input form-select">
                        <option value="asap">As Soon As Possible (Default)</option>
                        <optgroup label="Start Constraints">
                            <option value="snet">Start No Earlier Than (SNET)</option>
                            <option value="snlt">Start No Later Than (SNLT)</option>
                        </optgroup>
                        <optgroup label="Finish Constraints">
                            <option value="fnet">Finish No Earlier Than (FNET)</option>
                            <option value="fnlt">Finish No Later Than (FNLT)</option>
                            <option value="mfo">Must Finish On (MFO)</option>
                        </optgroup>
                    </select>
                    <p class="form-hint" id="drawer-constraint-desc"></p>
                </div>
                <div class="form-group" id="drawer-constraint-date-group">
                    <label class="form-label">Constraint Date</label>
                    <input type="date" id="drawer-constraintDate" class="form-input">
                </div>
                <div class="form-group">
                    <button class="btn btn-outline btn-block" id="drawer-links-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
                            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                        </svg>
                        Manage Dependencies
                    </button>
                </div>
            </div>
            <div class="form-section">
                <h4 class="form-section-title">Scheduling Mode</h4>
                <div class="form-group">
                    <label class="form-label flex items-center gap-2"><span>Scheduling Mode</span><span id="drawer-mode-icon-display" class="drawer-mode-icon-display"></span></label>
                    <select id="drawer-schedulingMode" class="form-input form-select">
                        <option value="Auto">Auto (CPM-driven)</option>
                        <option value="Manual">Manual (User-fixed)</option>
                    </select>
                    <p class="form-hint" id="drawer-mode-description"></p>
                </div>
            </div>
            <div class="form-section">
                <h4 class="form-section-title">Notes</h4>
                <div class="form-group">
                    <textarea id="drawer-notes" class="form-input form-textarea" rows="3" placeholder="Add notes..."></textarea>
                </div>
            </div>
        `;
    }

    public showEmptyState(): void {
        this.activeTaskId = null;
        this.isOpen = false;
        
        const body = this.element.querySelector('.drawer-body');
        if (body) {
            body.innerHTML = `
                <div class="drawer-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>Select a task to view details</p>
                </div>
            `;
        }
    }

    open(task: Task, options: { isParent?: boolean; focusField?: string } = {}): void {
        if (!task) return;
        
        if (!this.isEmbedded && this.activeTaskId === task.id && this.isOpen) {
            this.close();
            return;
        }
        
        // Rebuild DOM if it was cleared
        if (!this.element.querySelector('#drawer-name')) {
            const body = this.element.querySelector('.drawer-body');
            if (body) {
                body.innerHTML = this._getFormBodyHTML();
                this._cacheDOM();
                this._bindEvents();
            }
        }
        
        this.activeTaskId = task.id;
        this.isOpen = true;
        
        // Populate fields (Null-safe)
        if (this.dom.name) this.dom.name.value = task.name || '';
        if (this.dom.duration) this.dom.duration.value = String(task.duration || 1);
        if (this.dom.progress) this.dom.progress.value = String(task.progress || 0);
        if (this.dom.start) this.dom.start.value = task.start || '';
        if (this.dom.end) this.dom.end.value = task.end || '';
        if (this.dom.constraintType) this.dom.constraintType.value = task.constraintType || 'asap';
        if (this.dom.constraintDate) this.dom.constraintDate.value = task.constraintDate || '';
        if (this.dom.notes) this.dom.notes.value = task.notes || '';
        
        // Update derived state
        if (this.dom.constraintType) {
            const type = task.constraintType || 'asap';
            this._updateConstraintDesc(type);
            this._updateConstraintIcon(type, task.constraintDate || '');
        }
        
        if (this.dom.schedulingMode) {
            const mode = task.schedulingMode || 'Auto';
            this.dom.schedulingMode.value = mode;
            this._updateModeDisplay(mode);
            
            // Handle parent task restriction
            const isParent = options.isParent || false;
            this.dom.schedulingMode.disabled = isParent;
            if (isParent && this.dom.modeDescription) {
                this.dom.modeDescription.textContent = 'Parent tasks are always auto-scheduled.';
            }
        }
        
        // Handle read-only fields for parents
        const isParent = options.isParent || false;
        const setReadOnly = (el: HTMLInputElement | HTMLSelectElement | null, readonly: boolean) => {
            if (!el) return;
            el.disabled = readonly;
            if (readonly) el.classList.add('form-input-readonly');
            else el.classList.remove('form-input-readonly');
        };
        
        setReadOnly(this.dom.duration, isParent);
        setReadOnly(this.dom.start, isParent);
        setReadOnly(this.dom.end, isParent);
        setReadOnly(this.dom.constraintType, isParent);
        setReadOnly(this.dom.constraintDate, isParent);
        setReadOnly(this.dom.actualStart, isParent);
        setReadOnly(this.dom.actualFinish, isParent);
        
        if (this.dom.linksBtn) {
            this.dom.linksBtn.style.display = isParent ? 'none' : 'block';
        }

        // CPM & Progress Data
        this._updateCPMData(task);
        this._updateHealthStatus(task);
        this._updateProgressSection(task);

        if (!this.isEmbedded) {
            this.element.classList.add('open');
        }
        
        // Focus handling
        if (options.focusField) {
            const el = this._getFocusableFieldElement(options.focusField);
            if (el) {
                requestAnimationFrame(() => el.focus());
            }
        }
    }

    sync(task: Task): void {
       if (!task || task.id !== this.activeTaskId) return;
       
       if (this.dom.start) this.dom.start.value = task.start || '';
       if (this.dom.end) this.dom.end.value = task.end || '';
       if (this.dom.duration) this.dom.duration.value = String(task.duration || 1);
       if (this.dom.progress) this.dom.progress.value = String(task.progress || 0);
       
       // Sync Constraint
       if (this.dom.constraintType) {
           this.dom.constraintType.value = task.constraintType || 'asap';
           this._updateConstraintDesc(task.constraintType || 'asap');
           this._updateConstraintIcon(task.constraintType || 'asap', task.constraintDate || '');
       }
       if (this.dom.constraintDate) this.dom.constraintDate.value = task.constraintDate || '';
       
       // Sync Mode
       if (this.dom.schedulingMode) {
           const mode = task.schedulingMode || 'Auto';
           this.dom.schedulingMode.value = mode;
           this._updateModeDisplay(mode);
       }
       
       this._updateCPMData(task);
       this._updateHealthStatus(task);
       this._updateProgressSection(task);
    }
    
    close(): void {
        this.element.classList.remove('open');
        this.isOpen = false;
        this.activeTaskId = null;
    }
    
    destroy(): void {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        this.element.remove();
    }
    
    getElement(): HTMLElement {
        return this.element;
    }
    
    // --- Helpers ---

    private _handleChange(field: string, value: unknown): void {
        if (!this.activeTaskId) return;
        if (this.options.onUpdate) {
            this.options.onUpdate(this.activeTaskId, field, value);
        }
    }

    private _formatDateForDisplay(dateStr: string | null | undefined): string {
        if (!dateStr) return '-';
        const date = new Date(dateStr + 'T12:00:00');
        return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' });
    }
    
    private _updateConstraintIcon(type: ConstraintType, constraintDate: string = ''): void {
        if (!this.dom.constraintIcon) return;
        this.dom.constraintIcon.innerHTML = '';
        
        if (type === 'asap') return;
        
        let iconComponent: any = null;
        let color = '#64748b';
        
        switch (type) {
            case 'snet': iconComponent = Anchor; color = '#3b82f6'; break;
            case 'snlt': iconComponent = AlarmClock; color = '#f59e0b'; break;
            case 'fnet': iconComponent = Hourglass; color = '#3b82f6'; break;
            case 'fnlt': iconComponent = Flag; color = '#f59e0b'; break;
            case 'mfo': iconComponent = Lock; color = '#ef4444'; break;
        }
        
        if (iconComponent) {
            const svg = createElement(iconComponent, { size: 14, strokeWidth: 2, color });
            this.dom.constraintIcon.appendChild(svg);
            this.dom.constraintIcon.title = `${type.toUpperCase()} ${constraintDate}`;
        }
    }
    
    private _updateConstraintDesc(type: ConstraintType): void {
        if (!this.dom.constraintDesc) return;
        this.dom.constraintDesc.textContent = SideDrawer.CONSTRAINT_DESCRIPTIONS[type] || '';
        
        if (this.dom.constraintDateGroup) {
            this.dom.constraintDateGroup.style.display = type === 'asap' ? 'none' : 'block';
        }
    }
    
    private _updateModeDisplay(mode: 'Auto' | 'Manual'): void {
        if (!this.dom.modeDescription) return;
        
        if (mode === 'Manual') {
            this.dom.modeDescription.textContent = 'Dates are fixed. Task is pinned.';
            if (this.dom.modeIconDisplay) {
                this.dom.modeIconDisplay.innerHTML = `<svg class="w-4 h-4 text-amber-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>`;
            }
        } else {
            this.dom.modeDescription.textContent = 'Dates calculated by dependencies.';
            if (this.dom.modeIconDisplay) {
                this.dom.modeIconDisplay.innerHTML = `<svg class="w-4 h-4 text-blue-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
            }
        }
    }
    
    private _updateCPMData(task: Task): void {
        if (this.dom.totalFloat) this.dom.totalFloat.textContent = task.totalFloat !== undefined ? `${task.totalFloat}d` : '-';
        if (this.dom.freeFloat) this.dom.freeFloat.textContent = task.freeFloat !== undefined ? `${task.freeFloat}d` : '-';
        if (this.dom.lateStart) this.dom.lateStart.textContent = this._formatDateForDisplay(task.lateStart);
        if (this.dom.lateFinish) this.dom.lateFinish.textContent = this._formatDateForDisplay(task.lateFinish);
        
        if (this.dom.criticalBadge) {
            this.dom.criticalBadge.style.display = task._isCritical ? 'flex' : 'none';
        }
    }
    
    private _updateHealthStatus(task: Task): void {
        if (!this.dom.healthSection || !this.dom.healthStatus) return;
        
        if (task._health) {
            this.dom.healthSection.style.display = 'block';
            this.dom.healthStatus.innerHTML = `
                <div class="health-indicator health-${task._health.status}">
                    <span>${task._health.icon}</span>
                    <span>${task._health.summary}</span>
                </div>
            `;
        } else {
            this.dom.healthSection.style.display = 'none';
        }
    }
    
    private _updateProgressSection(task: Task): void {
        if (!this.dom.progressSection) return;
        
        const hasBaseline = task.baselineStart || task.baselineFinish;
        const hasActuals = task.actualStart || task.actualFinish;
        
        if (hasBaseline || hasActuals) {
            this.dom.progressSection.style.display = 'block';
            
            if (this.dom.baselineStart) this.dom.baselineStart.value = this._formatDateForDisplay(task.baselineStart);
            if (this.dom.baselineFinish) this.dom.baselineFinish.value = this._formatDateForDisplay(task.baselineFinish);
            if (this.dom.actualStart) this.dom.actualStart.value = task.actualStart || '';
            if (this.dom.actualFinish) this.dom.actualFinish.value = task.actualFinish || '';
            
            this._updateVarianceDisplay(task);
        } else {
            this.dom.progressSection.style.display = 'none';
        }
    }
    
    private _updateVarianceDisplay(task: Task): void {
        if (!this.options.getScheduler) return;
        const scheduler = this.options.getScheduler();
        if (!scheduler) return;
        
        const variance = scheduler.calculateVariance(task);
        
        const formatVariance = (el: HTMLInputElement | null, val: number | null) => {
            if (!el) return;
            if (val === null) {
                el.value = '-';
                el.style.color = '#94a3b8';
            } else {
                el.value = val > 0 ? `${val}d early` : val < 0 ? `${Math.abs(val)}d late` : 'On time';
                el.style.color = val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#22c55e';
            }
        };
        
        formatVariance(this.dom.startVariance, variance.start);
        formatVariance(this.dom.finishVariance, variance.finish);
    }

    private _getFocusableFieldElement(fieldName: string): HTMLElement | null {
        // Simple mapping based on known IDs
        // Try direct ID match first
        const el = this.element.querySelector(`#drawer-${fieldName}`) as HTMLElement;
        if (el) return el;
        
        // Try kebab case for compound names
        const kebab = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        return this.element.querySelector(`#drawer-${kebab}`) as HTMLElement;
    }
}