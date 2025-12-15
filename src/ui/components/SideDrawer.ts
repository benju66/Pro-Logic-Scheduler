/**
 * ============================================================================
 * SideDrawer.ts
 * ============================================================================
 * 
 * Slide-in panel component for detailed task editing.
 * Provides a form interface for editing task properties including:
 * - Task name
 * - Duration
 * - Progress (% complete)
 * - Constraint type and date
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import type { Task, ConstraintType } from '../../types';

/**
 * Side drawer options
 */
export interface SideDrawerOptions {
  container: HTMLElement;
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
  closeBtn: HTMLButtonElement;
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
    private element!: HTMLElement; // Initialized in _buildDOM()
    private dom!: SideDrawerDOM; // Initialized in _buildDOM()
    private activeTaskId: string | null = null;
    private isOpen: boolean = false;
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    /**
     * Create a new SideDrawer instance
     * 
     * @param options - Configuration options
     */
    constructor(options: SideDrawerOptions) {
        this.options = options;
        this.container = options.container;
        
        this._buildDOM();
        this._bindEvents();
    }

    /**
     * Build the drawer DOM structure
     * @private
     */
    private _buildDOM(): void {
        this.element = document.createElement('div');
        this.element.className = 'side-drawer';
        this.element.innerHTML = `
            <div class="drawer-header">
                <h3 class="drawer-title">Task Details</h3>
                <button class="drawer-close" title="Close (Esc)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            
            <div class="drawer-body">
                <!-- Task Name -->
                <div class="form-group">
                    <label class="form-label">Task Name</label>
                    <input type="text" id="drawer-name" class="form-input" placeholder="Enter task name">
                </div>
                
                <!-- Duration & Progress -->
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
                
                <!-- Dates (Editable - applies constraints like grid) -->
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
                
                <!-- CPM Data -->
                <div class="form-section" id="drawer-cpm-section">
                    <h4 class="form-section-title">Schedule Analysis</h4>
                    <div class="cpm-grid">
                        <div class="cpm-item">
                            <span class="cpm-label">Total Float</span>
                            <span class="cpm-value" id="drawer-total-float">-</span>
                        </div>
                        <div class="cpm-item">
                            <span class="cpm-label">Free Float</span>
                            <span class="cpm-value" id="drawer-free-float">-</span>
                        </div>
                        <div class="cpm-item">
                            <span class="cpm-label">Late Start</span>
                            <span class="cpm-value" id="drawer-late-start">-</span>
                        </div>
                        <div class="cpm-item">
                            <span class="cpm-label">Late Finish</span>
                            <span class="cpm-value" id="drawer-late-finish">-</span>
                        </div>
                    </div>
                    <div class="cpm-critical" id="drawer-critical-badge" style="display: none;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Critical Path Task
                    </div>
                </div>
                
                <!-- Schedule Health -->
                <div class="form-group" id="drawer-health-section">
                    <label class="form-label">Schedule Health</label>
                    <div class="health-status" id="drawer-health-status"></div>
                </div>
                
                <!-- Progress Tracking Section (shown when baseline exists) -->
                <div class="form-section" id="drawer-progress-section" style="display: none;">
                    <h4 class="form-section-title">Progress Tracking</h4>
                    
                    <!-- Baseline Dates (readonly) -->
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Baseline Start</label>
                            <input type="text" id="drawer-baseline-start" class="form-input" readonly style="background: #f1f5f9; color: #64748b;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Baseline Finish</label>
                            <input type="text" id="drawer-baseline-finish" class="form-input" readonly style="background: #f1f5f9; color: #64748b;">
                        </div>
                    </div>
                    
                    <!-- Actual Dates (editable) -->
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Actual Start</label>
                            <input type="date" id="drawer-actual-start" class="form-input">
                            <p class="form-hint">When work actually began</p>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Actual Finish</label>
                            <input type="date" id="drawer-actual-finish" class="form-input">
                            <p class="form-hint">When work actually completed</p>
                        </div>
                    </div>
                    
                    <!-- Variance Display (readonly) -->
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Start Variance</label>
                            <input type="text" id="drawer-start-variance" class="form-input" readonly style="background: #f1f5f9;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Finish Variance</label>
                            <input type="text" id="drawer-finish-variance" class="form-input" readonly style="background: #f1f5f9;">
                        </div>
                    </div>
                </div>
                
                <!-- Constraints Section -->
                <div class="form-section">
                    <h4 class="form-section-title">Constraints & Logic</h4>
                    
                    <div class="form-group">
                        <label class="form-label">Constraint Type</label>
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
                        <p class="form-hint" id="drawer-constraint-desc">Task flows naturally based on predecessors.</p>
                    </div>
                    
                    <div class="form-group" id="drawer-constraint-date-group">
                        <label class="form-label">Constraint Date</label>
                        <input type="date" id="drawer-constraintDate" class="form-input">
                    </div>
                    
                    <div class="form-group">
                        <button class="btn btn-outline btn-block" id="drawer-links-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                            </svg>
                            Manage Dependencies
                        </button>
                    </div>
                </div>
                
                <!-- Notes Section -->
                <div class="form-section">
                    <h4 class="form-section-title">Notes</h4>
                    <div class="form-group">
                        <textarea id="drawer-notes" class="form-input form-textarea" rows="3" placeholder="Add notes..."></textarea>
                    </div>
                </div>
            </div>
            
            <div class="drawer-footer">
                <button class="btn btn-danger btn-block" id="drawer-delete-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Delete Task
                </button>
            </div>
        `;
        
        this.container.appendChild(this.element);
        
        // Cache DOM references with type assertions
        const getElement = <T extends HTMLElement>(id: string): T => {
            const el = this.element.querySelector(`#${id}`) as T;
            if (!el) throw new Error(`Element #${id} not found`);
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
            closeBtn: this.element.querySelector('.drawer-close') as HTMLButtonElement,
            deleteBtn: getElement<HTMLButtonElement>('drawer-delete-btn'),
            linksBtn: getElement<HTMLButtonElement>('drawer-links-btn'),
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    private _bindEvents(): void {
        // Close button
        this.dom.closeBtn.addEventListener('click', () => this.close());
        
        // Field changes
        this.dom.name.addEventListener('change', () => this._handleChange('name', this.dom.name.value));
        this.dom.duration.addEventListener('change', () => this._handleChange('duration', this.dom.duration.value));
        this.dom.progress.addEventListener('change', () => this._handleChange('progress', this.dom.progress.value));
        this.dom.notes.addEventListener('change', () => this._handleChange('notes', this.dom.notes.value));
        
        // Start/End changes (these will apply constraints via the handler)
        this.dom.start.addEventListener('change', () => this._handleChange('start', this.dom.start.value));
        this.dom.end.addEventListener('change', () => this._handleChange('end', this.dom.end.value));
        
        // Constraint type change
        this.dom.constraintType.addEventListener('change', () => {
            const type = this.dom.constraintType.value as ConstraintType;
            this._updateConstraintDesc(type);
            this._handleChange('constraintType', type);
        });
        
        // Constraint date change
        this.dom.constraintDate.addEventListener('change', () => {
            this._handleChange('constraintDate', this.dom.constraintDate.value);
        });
        
        // Actual dates change handlers
        this.dom.actualStart.addEventListener('change', () => {
            if (this.activeTaskId) {
                this.options.onUpdate(this.activeTaskId, 'actualStart', this.dom.actualStart.value || null);
            }
        });
        
        this.dom.actualFinish.addEventListener('change', () => {
            if (this.activeTaskId) {
                this.options.onUpdate(this.activeTaskId, 'actualFinish', this.dom.actualFinish.value || null);
            }
        });
        
        // Delete button
        this.dom.deleteBtn.addEventListener('click', () => {
            if (this.activeTaskId && this.options.onDelete) {
                this.options.onDelete(this.activeTaskId);
            }
        });
        
        // Links button
        this.dom.linksBtn.addEventListener('click', () => {
            if (this.activeTaskId && this.options.onOpenLinks) {
                this.options.onOpenLinks(this.activeTaskId);
            }
        });
        
        // Keyboard shortcuts
        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    /**
     * Handle field change
     * @private
     */
    private _handleChange(field: string, value: unknown): void {
        if (!this.activeTaskId) return;
        
        if (this.options.onUpdate) {
            this.options.onUpdate(this.activeTaskId, field, value);
        }
    }

    /**
     * Update constraint description text
     * @private
     */
    private _updateConstraintDesc(type: ConstraintType): void {
        this.dom.constraintDesc.textContent = SideDrawer.CONSTRAINT_DESCRIPTIONS[type] || '';
        
        // Show/hide constraint date based on type
        if (type === 'asap') {
            this.dom.constraintDateGroup.style.display = 'none';
        } else {
            this.dom.constraintDateGroup.style.display = 'block';
        }
    }

    /**
     * Open the drawer with a task
     * 
     * @param task - The task object to edit
     * @param options - Additional options
     */
    open(task: Task, options: { isParent?: boolean } = {}): void {
        if (!task) return;
        
        // Toggle if same task
        if (this.activeTaskId === task.id && this.isOpen) {
            this.close();
            return;
        }
        
        this.activeTaskId = task.id;
        
        // Populate fields
        this.dom.name.value = task.name || '';
        this.dom.duration.value = String(task.duration || 1);
        this.dom.progress.value = String(task.progress || 0);
        this.dom.start.value = task.start || '';
        this.dom.end.value = task.end || '';
        this.dom.constraintType.value = task.constraintType || 'asap';
        this.dom.constraintDate.value = task.constraintDate || '';
        this.dom.notes.value = task.notes || '';
        
        // Update constraint description
        this._updateConstraintDesc(task.constraintType || 'asap');
        
        // Update CPM data
        this._updateCPMData(task);
        
        // Update health display
        if (this.dom.healthStatus && task._health) {
            const health = task._health;
            const statusClass = `health-${health.status}`;
            
            this.dom.healthStatus.innerHTML = `
                <div class="health-indicator ${statusClass}">
                    <span class="health-icon">${health.icon}</span>
                    <span class="health-summary">${health.summary}</span>
                </div>
                ${health.details.length > 0 ? `
                    <ul class="health-details">
                        ${health.details.map(d => `<li>${d}</li>`).join('')}
                    </ul>
                ` : ''}
            `;
            this.dom.healthSection.style.display = 'block';
        } else if (this.dom.healthSection) {
            this.dom.healthSection.style.display = 'none';
        }
        
        // Show/hide Progress Tracking section based on task data availability
        if (this.dom.progressSection) {
            const hasBaseline = task.baselineStart || task.baselineFinish;
            const hasActuals = task.actualStart || task.actualFinish;
            
            if (hasBaseline || hasActuals) {
                this.dom.progressSection.style.display = 'block';
                
                // Populate baseline fields (readonly display)
                if (this.dom.baselineStart) {
                    this.dom.baselineStart.value = task.baselineStart || '-';
                }
                if (this.dom.baselineFinish) {
                    this.dom.baselineFinish.value = task.baselineFinish || '-';
                }
                
                // Populate actual fields (editable)
                if (this.dom.actualStart) {
                    this.dom.actualStart.value = task.actualStart || '';
                }
                if (this.dom.actualFinish) {
                    this.dom.actualFinish.value = task.actualFinish || '';
                }
                
                // Calculate and display variances
                this._updateVarianceDisplay(task);
            } else {
                this.dom.progressSection.style.display = 'none';
            }
        }
        
        // Handle parent tasks (dates roll up from children, not directly editable)
        const isParent = options.isParent || false;
        this.dom.duration.disabled = isParent;
        this.dom.start.disabled = isParent;
        this.dom.end.disabled = isParent;
        this.dom.constraintType.disabled = isParent;
        this.dom.constraintDate.disabled = isParent;
        this.dom.linksBtn.style.display = isParent ? 'none' : 'flex';
        
        // Add visual styling for disabled state
        if (isParent) {
            this.dom.duration.classList.add('form-input-readonly');
            this.dom.start.classList.add('form-input-readonly');
            this.dom.end.classList.add('form-input-readonly');
        } else {
            this.dom.duration.classList.remove('form-input-readonly');
            this.dom.start.classList.remove('form-input-readonly');
            this.dom.end.classList.remove('form-input-readonly');
        }
        
        // Show drawer
        this.element.classList.add('open');
        this.isOpen = true;
        
        // Focus name field
        setTimeout(() => this.dom.name.focus(), 100);
    }

    /**
     * Update CPM analysis data display
     * @private
     */
    private _updateCPMData(task: Task): void {
        // Total Float
        if (task.totalFloat !== undefined && task.totalFloat !== null) {
            this.dom.totalFloat.textContent = `${task.totalFloat} days`;
            this.dom.totalFloat.className = 'cpm-value' + (task.totalFloat <= 0 ? ' critical' : '');
        } else {
            this.dom.totalFloat.textContent = '-';
        }
        
        // Free Float
        if (task.freeFloat !== undefined && task.freeFloat !== null) {
            this.dom.freeFloat.textContent = `${task.freeFloat} days`;
        } else {
            this.dom.freeFloat.textContent = '-';
        }
        
        // Late Start
        this.dom.lateStart.textContent = task.lateStart || '-';
        
        // Late Finish
        this.dom.lateFinish.textContent = task.lateFinish || '-';
        
        // Critical badge
        if (task._isCritical) {
            this.dom.criticalBadge.style.display = 'flex';
        } else {
            this.dom.criticalBadge.style.display = 'none';
        }
    }

    /**
     * Update the variance display fields
     * Calculates the difference between baseline and actual dates
     * 
     * @param task - Task to calculate variance for
     * @private
     */
    private _updateVarianceDisplay(task: Task): void {
        // Try to use scheduler's variance calculation if available (uses work days)
        if (this.options.getScheduler) {
            const scheduler = this.options.getScheduler();
            if (scheduler && scheduler.calculateVariance) {
                const variance = scheduler.calculateVariance(task);
                
                // Start Variance
                if (this.dom.startVariance) {
                    if (variance.start !== null) {
                        const startVar = variance.start;
                        if (startVar > 0) {
                            this.dom.startVariance.value = `${startVar}d late`;
                            this.dom.startVariance.style.color = '#ef4444'; // Red
                        } else if (startVar < 0) {
                            this.dom.startVariance.value = `${Math.abs(startVar)}d early`;
                            this.dom.startVariance.style.color = '#22c55e'; // Green
                        } else {
                            this.dom.startVariance.value = 'On time';
                            this.dom.startVariance.style.color = '#22c55e'; // Green
                        }
                    } else if (task.baselineStart && !task.actualStart) {
                        this.dom.startVariance.value = 'Not started';
                        this.dom.startVariance.style.color = '#94a3b8'; // Gray
                    } else {
                        this.dom.startVariance.value = '-';
                        this.dom.startVariance.style.color = '#94a3b8';
                    }
                }
                
                // Finish Variance
                if (this.dom.finishVariance) {
                    if (variance.finish !== null) {
                        const finishVar = variance.finish;
                        if (finishVar > 0) {
                            this.dom.finishVariance.value = `${finishVar}d late`;
                            this.dom.finishVariance.style.color = '#ef4444'; // Red
                        } else if (finishVar < 0) {
                            this.dom.finishVariance.value = `${Math.abs(finishVar)}d early`;
                            this.dom.finishVariance.style.color = '#22c55e'; // Green
                        } else {
                            this.dom.finishVariance.value = 'On time';
                            this.dom.finishVariance.style.color = '#22c55e'; // Green
                        }
                    } else if (task.baselineFinish && !task.actualFinish) {
                        this.dom.finishVariance.value = 'In progress';
                        this.dom.finishVariance.style.color = '#94a3b8'; // Gray
                    } else {
                        this.dom.finishVariance.value = '-';
                        this.dom.finishVariance.style.color = '#94a3b8';
                    }
                }
                return;
            }
        }
        
        // Fallback: Simple calendar day calculation if scheduler not available
        // Start Variance: actualStart vs baselineStart
        if (this.dom.startVariance) {
            if (task.actualStart && task.baselineStart) {
                const actualDate = new Date(task.actualStart);
                const baselineDate = new Date(task.baselineStart);
                const diffTime = actualDate.getTime() - baselineDate.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays > 0) {
                    this.dom.startVariance.value = `${diffDays}d late`;
                    this.dom.startVariance.style.color = '#ef4444'; // Red
                } else if (diffDays < 0) {
                    this.dom.startVariance.value = `${Math.abs(diffDays)}d early`;
                    this.dom.startVariance.style.color = '#22c55e'; // Green
                } else {
                    this.dom.startVariance.value = 'On time';
                    this.dom.startVariance.style.color = '#22c55e'; // Green
                }
            } else if (task.baselineStart && !task.actualStart) {
                this.dom.startVariance.value = 'Not started';
                this.dom.startVariance.style.color = '#94a3b8'; // Gray
            } else {
                this.dom.startVariance.value = '-';
                this.dom.startVariance.style.color = '#94a3b8';
            }
        }
        
        // Finish Variance: actualFinish vs baselineFinish
        if (this.dom.finishVariance) {
            if (task.actualFinish && task.baselineFinish) {
                const actualDate = new Date(task.actualFinish);
                const baselineDate = new Date(task.baselineFinish);
                const diffTime = actualDate.getTime() - baselineDate.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays > 0) {
                    this.dom.finishVariance.value = `${diffDays}d late`;
                    this.dom.finishVariance.style.color = '#ef4444'; // Red
                } else if (diffDays < 0) {
                    this.dom.finishVariance.value = `${Math.abs(diffDays)}d early`;
                    this.dom.finishVariance.style.color = '#22c55e'; // Green
                } else {
                    this.dom.finishVariance.value = 'On time';
                    this.dom.finishVariance.style.color = '#22c55e'; // Green
                }
            } else if (task.baselineFinish && !task.actualFinish) {
                this.dom.finishVariance.value = 'In progress';
                this.dom.finishVariance.style.color = '#94a3b8'; // Gray
            } else {
                this.dom.finishVariance.value = '-';
                this.dom.finishVariance.style.color = '#94a3b8';
            }
        }
    }

    /**
     * Sync drawer with updated task data (without reopening)
     * @param task - Updated task object
     */
    sync(task: Task): void {
        if (!task || task.id !== this.activeTaskId) return;
        
        // Update date fields (these may have changed from CPM recalculation)
        this.dom.start.value = task.start || '';
        this.dom.end.value = task.end || '';
        this.dom.duration.value = String(task.duration || 1);
        
        // Update constraint fields
        this.dom.constraintType.value = task.constraintType || 'asap';
        this.dom.constraintDate.value = task.constraintDate || '';
        this._updateConstraintDesc(task.constraintType || 'asap');
        
        // Update CPM data display
        this._updateCPMData(task);
        
        // Update health display
        if (this.dom.healthStatus && task._health) {
            const health = task._health;
            const statusClass = `health-${health.status}`;
            
            this.dom.healthStatus.innerHTML = `
                <div class="health-indicator ${statusClass}">
                    <span class="health-icon">${health.icon}</span>
                    <span class="health-summary">${health.summary}</span>
                </div>
                ${health.details.length > 0 ? `
                    <ul class="health-details">
                        ${health.details.map(d => `<li>${d}</li>`).join('')}
                    </ul>
                ` : ''}
            `;
            this.dom.healthSection.style.display = 'block';
        } else if (this.dom.healthSection) {
            this.dom.healthSection.style.display = 'none';
        }
        
        // Update Progress Tracking section
        if (this.dom.progressSection) {
            const hasBaseline = task.baselineStart || task.baselineFinish;
            const hasActuals = task.actualStart || task.actualFinish;
            
            if (hasBaseline || hasActuals) {
                this.dom.progressSection.style.display = 'block';
                
                // Update baseline fields
                if (this.dom.baselineStart) {
                    this.dom.baselineStart.value = task.baselineStart || '-';
                }
                if (this.dom.baselineFinish) {
                    this.dom.baselineFinish.value = task.baselineFinish || '-';
                }
                
                // Update actual fields
                if (this.dom.actualStart) {
                    this.dom.actualStart.value = task.actualStart || '';
                }
                if (this.dom.actualFinish) {
                    this.dom.actualFinish.value = task.actualFinish || '';
                }
                
                // Update variance display
                this._updateVarianceDisplay(task);
            } else {
                this.dom.progressSection.style.display = 'none';
            }
        }
    }

    /**
     * Close the drawer
     */
    close(): void {
        this.element.classList.remove('open');
        this.isOpen = false;
        this.activeTaskId = null;
    }

    /**
     * Get the currently active task ID
     * @returns Active task ID or null
     */
    getActiveTaskId(): string | null {
        return this.activeTaskId;
    }

    /**
     * Check if drawer is currently open
     * @returns True if open
     */
    isDrawerOpen(): boolean {
        return this.isOpen;
    }

    /**
     * Destroy the drawer
     */
    destroy(): void {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        this.element.remove();
    }
}
