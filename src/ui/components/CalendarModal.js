// @ts-check
/**
 * ============================================================================
 * CalendarModal.js
 * ============================================================================
 * 
 * Modal dialog for configuring the project calendar.
 * Allows users to:
 * - Set working days (Mon-Fri by default)
 * - Add calendar exceptions (holidays, weather delays)
 * - Remove exceptions
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

export class CalendarModal {
    
    /**
     * Day names for display
     */
    static DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    /**
     * Day abbreviations for buttons
     */
    static DAY_ABBREVS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    /**
     * Create a new CalendarModal instance
     * 
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.container - Parent container for the modal
     * @param {Function} options.onSave - Callback when calendar is saved (calendar)
     */
    constructor(options = {}) {
        this.options = options;
        this.container = options.container || document.body;
        
        this.tempCalendar = {
            workingDays: [1, 2, 3, 4, 5],
            exceptions: {},
        };
        
        this._buildDOM();
        this._bindEvents();
    }

    /**
     * Build the modal DOM structure
     * @private
     */
    _buildDOM() {
        this.element = document.createElement('dialog');
        this.element.className = 'modal-dialog calendar-modal';
        this.element.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-header-left">
                        <div class="modal-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                <line x1="16" y1="2" x2="16" y2="6"/>
                                <line x1="8" y1="2" x2="8" y2="6"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                        </div>
                        <div>
                            <h3 class="modal-title">Project Calendar</h3>
                            <p class="modal-subtitle">Configure working days and exceptions</p>
                        </div>
                    </div>
                    <button class="modal-close" title="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="modal-body">
                    <!-- Working Days Section -->
                    <div class="calendar-section">
                        <h4 class="section-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12,6 12,12 16,14"/>
                            </svg>
                            Standard Work Week
                        </h4>
                        <p class="section-desc">Select which days are working days for your project.</p>
                        
                        <div class="weekday-grid" id="weekday-grid">
                            <!-- Populated dynamically -->
                        </div>
                        
                        <div class="work-week-summary" id="work-week-summary">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                    
                    <!-- Exceptions Section -->
                    <div class="calendar-section">
                        <h4 class="section-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            Exceptions & Holidays
                        </h4>
                        <p class="section-desc">Add non-working days like holidays, weather delays, or site closures.</p>
                        
                        <div class="add-exception-form">
                            <input type="date" class="form-input" id="exception-date" title="Exception date">
                            <input type="text" class="form-input" id="exception-desc" placeholder="Description (e.g., Holiday, Weather)" title="Description">
                            <button class="btn btn-primary" id="add-exception-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 5v14M5 12h14"/>
                                </svg>
                                Add
                            </button>
                        </div>
                        
                        <div class="exceptions-list-wrapper">
                            <table class="exceptions-table">
                                <thead>
                                    <tr>
                                        <th style="width: 120px;">Date</th>
                                        <th>Description</th>
                                        <th style="width: 40px;"></th>
                                    </tr>
                                </thead>
                                <tbody id="exceptions-body">
                                    <tr class="empty-row">
                                        <td colspan="3">No exceptions added.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
                    <button class="btn btn-primary" id="save-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Apply Changes
                    </button>
                </div>
            </div>
        `;
        
        this.container.appendChild(this.element);
        
        // Cache DOM references
        this.dom = {
            weekdayGrid: this.element.querySelector('#weekday-grid'),
            workWeekSummary: this.element.querySelector('#work-week-summary'),
            exceptionDate: this.element.querySelector('#exception-date'),
            exceptionDesc: this.element.querySelector('#exception-desc'),
            addExceptionBtn: this.element.querySelector('#add-exception-btn'),
            exceptionsBody: this.element.querySelector('#exceptions-body'),
            closeBtn: this.element.querySelector('.modal-close'),
            cancelBtn: this.element.querySelector('#cancel-btn'),
            saveBtn: this.element.querySelector('#save-btn'),
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    _bindEvents() {
        // Close buttons
        this.dom.closeBtn.addEventListener('click', () => this.close());
        this.dom.cancelBtn.addEventListener('click', () => this.close());
        
        // Save button
        this.dom.saveBtn.addEventListener('click', () => this._save());
        
        // Add exception
        this.dom.addExceptionBtn.addEventListener('click', () => this._addException());
        
        // Enter key in description field
        this.dom.exceptionDesc.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this._addException();
            }
        });
        
        // Close on backdrop click
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });
        
        // Close on Escape
        this.element.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    /**
     * Render the modal content
     * @private
     */
    _render() {
        this._renderWeekdays();
        this._renderExceptions();
        this._updateWorkWeekSummary();
    }

    /**
     * Render weekday toggle buttons
     * @private
     */
    _renderWeekdays() {
        const grid = this.dom.weekdayGrid;
        
        grid.innerHTML = CalendarModal.DAY_NAMES.map((day, index) => {
            const isWorking = this.tempCalendar.workingDays.includes(index);
            const abbrev = CalendarModal.DAY_ABBREVS[index];
            const isWeekend = index === 0 || index === 6;
            
            return `
                <button class="weekday-btn ${isWorking ? 'active' : ''} ${isWeekend ? 'weekend' : ''}"
                        data-day="${index}"
                        title="${day}">
                    <span class="weekday-abbrev">${abbrev}</span>
                    <span class="weekday-name">${day}</span>
                </button>
            `;
        }).join('');
        
        // Bind click events
        grid.querySelectorAll('.weekday-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const dayIndex = parseInt(btn.dataset.day);
                this._toggleWeekday(dayIndex);
            });
        });
    }

    /**
     * Toggle a weekday working status
     * @private
     */
    _toggleWeekday(dayIndex) {
        const index = this.tempCalendar.workingDays.indexOf(dayIndex);
        
        if (index === -1) {
            // Add to working days
            this.tempCalendar.workingDays.push(dayIndex);
            this.tempCalendar.workingDays.sort((a, b) => a - b);
        } else {
            // Remove from working days (must have at least 1 working day)
            if (this.tempCalendar.workingDays.length > 1) {
                this.tempCalendar.workingDays.splice(index, 1);
            }
        }
        
        this._renderWeekdays();
        this._updateWorkWeekSummary();
    }

    /**
     * Update work week summary text
     * @private
     */
    _updateWorkWeekSummary() {
        const workDays = this.tempCalendar.workingDays
            .map(i => CalendarModal.DAY_NAMES[i])
            .join(', ');
        
        const count = this.tempCalendar.workingDays.length;
        
        this.dom.workWeekSummary.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
            <span><strong>${count} working days:</strong> ${workDays}</span>
        `;
    }

    /**
     * Render exceptions list
     * @private
     */
    _renderExceptions() {
        const tbody = this.dom.exceptionsBody;
        const dates = Object.keys(this.tempCalendar.exceptions).sort();
        
        if (dates.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="3">No exceptions added. The schedule uses only the standard work week.</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = dates.map(date => {
            const desc = this.tempCalendar.exceptions[date];
            const dateObj = new Date(date + 'T12:00:00');
            const dayName = CalendarModal.DAY_NAMES[dateObj.getDay()];
            const formattedDate = this._formatDate(date);
            
            return `
                <tr>
                    <td>
                        <span class="exception-date-badge">${formattedDate}</span>
                        <span class="exception-day">${dayName}</span>
                    </td>
                    <td class="exception-desc">${this._escapeHtml(desc)}</td>
                    <td>
                        <button class="btn-icon btn-danger-icon remove-exception-btn" 
                                data-date="${date}" 
                                title="Remove exception">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Bind remove buttons
        tbody.querySelectorAll('.remove-exception-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const date = btn.dataset.date;
                this._removeException(date);
            });
        });
    }

    /**
     * Add a new exception
     * @private
     */
    _addException() {
        const date = this.dom.exceptionDate.value;
        const desc = this.dom.exceptionDesc.value.trim();
        
        if (!date) {
            this._showError('Please select a date');
            this.dom.exceptionDate.focus();
            return;
        }
        
        if (!desc) {
            this._showError('Please enter a description');
            this.dom.exceptionDesc.focus();
            return;
        }
        
        // Add exception
        this.tempCalendar.exceptions[date] = desc;
        
        // Clear inputs
        this.dom.exceptionDate.value = '';
        this.dom.exceptionDesc.value = '';
        this.dom.exceptionDate.focus();
        
        // Re-render
        this._renderExceptions();
    }

    /**
     * Remove an exception
     * @private
     */
    _removeException(date) {
        delete this.tempCalendar.exceptions[date];
        this._renderExceptions();
    }

    /**
     * Show error message (toast-style)
     * @private
     */
    _showError(message) {
        // Simple alert for now - could be replaced with toast
        console.warn(message);
    }

    /**
     * Format date for display
     * @private
     */
    _formatDate(dateStr) {
        const date = new Date(dateStr + 'T12:00:00');
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    }

    /**
     * Escape HTML special characters
     * @private
     */
    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
    }

    /**
     * Save calendar and close
     * @private
     */
    _save() {
        if (this.options.onSave) {
            this.options.onSave({
                workingDays: [...this.tempCalendar.workingDays],
                exceptions: { ...this.tempCalendar.exceptions },
            });
        }
        this.close();
    }

    /**
     * Open the modal with a calendar configuration
     * 
     * @param {Object} calendar - Current calendar configuration
     * @param {number[]} calendar.workingDays - Array of working day indices (0-6)
     * @param {Object} calendar.exceptions - Map of date strings to descriptions
     */
    open(calendar) {
        // Clone calendar to temp
        this.tempCalendar = {
            workingDays: [...(calendar?.workingDays || [1, 2, 3, 4, 5])],
            exceptions: { ...(calendar?.exceptions || {}) },
        };
        
        // Set default date to today
        this.dom.exceptionDate.value = new Date().toISOString().split('T')[0];
        this.dom.exceptionDesc.value = '';
        
        // Render
        this._render();
        
        // Show modal
        this.element.showModal();
    }

    /**
     * Close the modal
     */
    close() {
        this.element.close();
    }

    /**
     * Destroy the modal
     */
    destroy() {
        this.element.remove();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalendarModal;
}
