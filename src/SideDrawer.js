/**
 * ============================================================================
 * SideDrawer.js
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

export class SideDrawer {
    
    /**
     * Constraint type descriptions for help text
     */
    static CONSTRAINT_DESCRIPTIONS = {
        'asap': 'Task flows naturally based on predecessors.',
        'snet': 'Task cannot start before this date, but can start later if needed.',
        'snlt': 'Task must start by this date. Creates conflict if dependencies push later.',
        'fnet': 'Task cannot finish before this date. Useful for cure times, inspections.',
        'fnlt': 'Task must finish by this date. Common for contract deadlines.',
        'mfo': 'Task MUST finish exactly on this date. Hard constraint.',
    };

    /**
     * Create a new SideDrawer instance
     * 
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.container - Parent container element
     * @param {Function} options.onUpdate - Callback when field is updated (taskId, field, value)
     * @param {Function} options.onDelete - Callback when delete is clicked (taskId)
     * @param {Function} options.onOpenLinks - Callback to open dependencies modal (taskId)
     */
    constructor(options = {}) {
        this.options = options;
        this.container = options.container;
        this.activeTaskId = null;
        this.isOpen = false;
        
        this._buildDOM();
        this._bindEvents();
    }

    /**
     * Build the drawer DOM structure
     * @private
     */
    _buildDOM() {
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
                
                <!-- Dates (Read-only) -->
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Start Date</label>
                        <input type="date" id="drawer-start" class="form-input" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Finish Date</label>
                        <input type="date" id="drawer-end" class="form-input" readonly>
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
                
                <!-- Notes Section (optional future feature) -->
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
        
        // Cache DOM references
        this.dom = {
            name: this.element.querySelector('#drawer-name'),
            duration: this.element.querySelector('#drawer-duration'),
            progress: this.element.querySelector('#drawer-progress'),
            start: this.element.querySelector('#drawer-start'),
            end: this.element.querySelector('#drawer-end'),
            constraintType: this.element.querySelector('#drawer-constraintType'),
            constraintDate: this.element.querySelector('#drawer-constraintDate'),
            constraintDateGroup: this.element.querySelector('#drawer-constraint-date-group'),
            constraintDesc: this.element.querySelector('#drawer-constraint-desc'),
            notes: this.element.querySelector('#drawer-notes'),
            totalFloat: this.element.querySelector('#drawer-total-float'),
            freeFloat: this.element.querySelector('#drawer-free-float'),
            lateStart: this.element.querySelector('#drawer-late-start'),
            lateFinish: this.element.querySelector('#drawer-late-finish'),
            criticalBadge: this.element.querySelector('#drawer-critical-badge'),
            cpmSection: this.element.querySelector('#drawer-cpm-section'),
            closeBtn: this.element.querySelector('.drawer-close'),
            deleteBtn: this.element.querySelector('#drawer-delete-btn'),
            linksBtn: this.element.querySelector('#drawer-links-btn'),
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    _bindEvents() {
        // Close button
        this.dom.closeBtn.addEventListener('click', () => this.close());
        
        // Field changes
        this.dom.name.addEventListener('change', () => this._handleChange('name', this.dom.name.value));
        this.dom.duration.addEventListener('change', () => this._handleChange('duration', this.dom.duration.value));
        this.dom.progress.addEventListener('change', () => this._handleChange('progress', this.dom.progress.value));
        this.dom.notes.addEventListener('change', () => this._handleChange('notes', this.dom.notes.value));
        
        // Constraint type change
        this.dom.constraintType.addEventListener('change', () => {
            const type = this.dom.constraintType.value;
            this._updateConstraintDesc(type);
            this._handleChange('constraintType', type);
        });
        
        // Constraint date change
        this.dom.constraintDate.addEventListener('change', () => {
            this._handleChange('constraintDate', this.dom.constraintDate.value);
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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    /**
     * Handle field change
     * @private
     */
    _handleChange(field, value) {
        if (!this.activeTaskId) return;
        
        if (this.options.onUpdate) {
            this.options.onUpdate(this.activeTaskId, field, value);
        }
    }

    /**
     * Update constraint description text
     * @private
     */
    _updateConstraintDesc(type) {
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
     * @param {Object} task - The task object to edit
     * @param {Object} options - Additional options
     * @param {boolean} options.isParent - Whether the task is a parent/summary task
     */
    open(task, options = {}) {
        if (!task) return;
        
        // Toggle if same task
        if (this.activeTaskId === task.id && this.isOpen) {
            this.close();
            return;
        }
        
        this.activeTaskId = task.id;
        
        // Populate fields
        this.dom.name.value = task.name || '';
        this.dom.duration.value = task.duration || 1;
        this.dom.progress.value = task.progress || 0;
        this.dom.start.value = task.start || '';
        this.dom.end.value = task.end || '';
        this.dom.constraintType.value = task.constraintType || 'asap';
        this.dom.constraintDate.value = task.constraintDate || '';
        this.dom.notes.value = task.notes || '';
        
        // Update constraint description
        this._updateConstraintDesc(task.constraintType || 'asap');
        
        // Update CPM data
        this._updateCPMData(task);
        
        // Handle parent tasks (read-only duration)
        const isParent = options.isParent || false;
        this.dom.duration.disabled = isParent;
        this.dom.constraintType.disabled = isParent;
        this.dom.constraintDate.disabled = isParent;
        this.dom.linksBtn.style.display = isParent ? 'none' : 'flex';
        
        if (isParent) {
            this.dom.duration.classList.add('form-input-readonly');
        } else {
            this.dom.duration.classList.remove('form-input-readonly');
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
    _updateCPMData(task) {
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
     * Sync drawer with updated task data (without reopening)
     * @param {Object} task - Updated task object
     */
    sync(task) {
        if (!task || task.id !== this.activeTaskId) return;
        
        this.dom.start.value = task.start || '';
        this.dom.end.value = task.end || '';
        this.dom.duration.value = task.duration || 1;
        this._updateCPMData(task);
    }

    /**
     * Close the drawer
     */
    close() {
        this.element.classList.remove('open');
        this.isOpen = false;
        this.activeTaskId = null;
    }

    /**
     * Get the currently active task ID
     * @returns {string|null}
     */
    getActiveTaskId() {
        return this.activeTaskId;
    }

    /**
     * Check if drawer is currently open
     * @returns {boolean}
     */
    isDrawerOpen() {
        return this.isOpen;
    }

    /**
     * Destroy the drawer
     */
    destroy() {
        this.element.remove();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SideDrawer;
}
