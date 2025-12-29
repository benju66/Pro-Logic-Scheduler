/**
 * @fileoverview Binding System for Unified Scheduler V2
 * @module ui/components/scheduler/pool/BindingSystem
 * 
 * Updates DOM content on pooled elements using ONLY fast DOM operations.
 * Updates accessibility attributes.
 */

import type { Task, GridColumn, Calendar } from '../../../../types';
import type { PooledRow, PooledCell, BindingContext } from '../types';
import { getTaskFieldValue } from '../../../../types';
import { ICONS } from '../icons';
import { formatDateForDisplay, parseFlexibleDate, formatDateISO } from '../datepicker/DatePickerConfig';
import { getEditingStateManager } from '../../../../services/EditingStateManager';
import type { TaskStore } from '../../../../data/TaskStore';

/**
 * Binding System - Updates pooled DOM elements with task data
 */
export class BindingSystem {
    private columnMap: Map<string, GridColumn>;
    private calendar: Calendar | null = null;
    private taskStore: TaskStore | null = null; // O(1) lookup for fresh task data
    private onDateChange: ((taskId: string, field: string, value: string) => void) | null = null;
    private onOpenDatePicker: ((taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void) | null = null;

    constructor(columns: GridColumn[]) {
        this.columnMap = new Map();
        columns.forEach(col => {
            this.columnMap.set(col.field, col);
        });
    }
    
    /**
     * Set the TaskStore for querying fresh task data
     * This ensures we always read the latest values from the source of truth
     */
    setTaskStore(store: TaskStore): void {
        this.taskStore = store;
    }
    
    /**
     * Set the calendar for working day integration
     */
    setCalendar(calendar: Calendar): void {
        this.calendar = calendar;
    }
    
    /**
     * Set the date change callback
     */
    setOnDateChange(callback: (taskId: string, field: string, value: string) => void): void {
        this.onDateChange = callback;
    }

    /**
     * Set callback for opening the shared date picker popup
     */
    setOnOpenDatePicker(callback: (taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void): void {
        this.onOpenDatePicker = callback;
    }

    /**
     * Bind task data to a pooled row
     */
    bindRow(row: PooledRow, ctx: BindingContext): void {
        const { task, index, isSelected, isParent, isCollapsed, isCritical, depth } = ctx;
        
        // CRITICAL: Handle blank rows with explicit bidirectional state
        if (task.rowType === 'blank') {
            this._bindBlankRow(row, ctx);
            return;
        }
        
        // CRITICAL: Reset from blank row state if this row was previously a blank row
        // This ensures inputs become visible again when recycling
        this._resetFromBlankRowState(row);

        // Build className string (faster than classList)
        let rowClass = 'vsg-row';
        if (isSelected) rowClass += ' row-selected';
        if (isParent) rowClass += ' is-parent';
        if (isCollapsed) rowClass += ' is-collapsed';
        if (isCritical) rowClass += ' is-critical';
        if (task._health?.status === 'blocked') rowClass += ' is-blocked';

        // Single assignment (fast DOM operation)
        row.element.className = rowClass;
        row.element.dataset.taskId = task.id;
        row.element.dataset.index = String(index);

        // Accessibility attributes
        row.element.setAttribute('role', 'row');
        row.element.setAttribute('aria-rowindex', String(index + 1));
        row.element.setAttribute('aria-selected', String(isSelected));
        // Use freshTask for field values (name), task for structure (id)
        const freshTask = this.taskStore?.getById(task.id) ?? task;
        row.element.setAttribute('aria-label', `${freshTask.name}, row ${index + 1}`);

        // Bind cells
        for (const [field, cell] of row.cells) {
            const column = this.columnMap.get(field);
            if (column) {
                this._bindCell(cell, column, task, ctx);
            }
        }
    }
    
    /**
     * Reset a row from blank row state to normal task state
     * MUST be called when a pooled row that was a blank is reused for a task
     */
    private _resetFromBlankRowState(row: PooledRow): void {
        // Remove blank row markers
        row.element.classList.remove('blank-row');
        row.element.removeAttribute('data-blank');
        
        // Restore visibility of all cell inputs
        for (const [field, cell] of row.cells) {
            // SHOW inputs (they may have been hidden by blank row)
            if (cell.input) {
                cell.input.style.display = '';  // Reset to default
                cell.input.disabled = false;     // Re-enable (will be set readonly later if needed)
            }
            
            // Show checkbox
            if (cell.checkbox) {
                cell.checkbox.style.display = '';
            }
            
            // Show action buttons container (individual buttons controlled by column config)
            cell.actionButtons.forEach(btn => {
                btn.style.display = '';  // Reset to default, column config will hide if needed
            });
            
            // Show collapse button (will be hidden if not a parent)
            if (cell.collapseBtn) {
                cell.collapseBtn.style.display = '';
            }
            
            // Reset cell class
            cell.container.classList.remove('blank-cell');
            
            // Reset text alignment for name cell
            if (cell.text) {
                cell.text.style.textAlign = '';
                cell.text.style.color = '';
                cell.text.style.fontWeight = '';
            }
        }
    }
    
    /**
     * Bind a blank row - minimal rendering, all inputs hidden
     */
    private _bindBlankRow(row: PooledRow, ctx: BindingContext): void {
        const { task, index, isSelected } = ctx;
        
        // Set row class
        row.element.className = 'vsg-row blank-row';
        if (isSelected) row.element.className += ' row-selected';
        
        row.element.dataset.taskId = task.id;
        row.element.dataset.index = String(index);
        row.element.dataset.blank = 'true';
        
        // Accessibility
        row.element.setAttribute('role', 'row');
        row.element.setAttribute('aria-rowindex', String(index + 1));
        row.element.setAttribute('aria-label', `Blank row, row ${index + 1}`);
        
        // HIDE all cell inputs - explicit visibility management
        for (const [field, cell] of row.cells) {
            // Hide inputs
            if (cell.input) {
                cell.input.style.display = 'none';
                cell.input.value = '';
                cell.input.disabled = true;
            }
            
            // Clear text content
            if (cell.text) {
                cell.text.textContent = '';
            }
            
            // CHANGE: Show Checkbox for selection (enabled)
            if (cell.checkbox) {
                cell.checkbox.style.display = ''; // Remove 'none'
                cell.checkbox.disabled = false;   // Enable interaction
                cell.checkbox.checked = isSelected; // Sync state
            }
            
            // Hide action buttons
            cell.actionButtons.forEach(btn => {
                btn.style.display = 'none';
            });
            
            // Hide collapse button
            if (cell.collapseBtn) {
                cell.collapseBtn.style.display = 'none';
            }
            
            // Mark cell as blank
            cell.container.className = 'vsg-cell blank-cell';
        }
        
        // Show centered placeholder in name cell
        const nameCell = row.cells.get('name');
        if (nameCell?.text) {
            nameCell.text.textContent = '───';
            nameCell.text.style.textAlign = 'center';
            nameCell.text.style.color = '#94a3b8';
            nameCell.text.style.fontWeight = 'normal';
        }
    }

    /**
     * Bind data to a specific cell
     */
    private _bindCell(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        const { isParent, isCollapsed, depth } = ctx;

        // ═══════════════════════════════════════════════════════════════
        // QUERY TASKSTORE FOR FRESH DATA
        // Always read field values from TaskStore (source of truth)
        // Use task parameter only for structural fields (id, rowType, etc.)
        // ═══════════════════════════════════════════════════════════════
        const freshTask = this.taskStore?.getById(task.id) ?? task;

        // Handle special column: actions FIRST
        if (col.type === 'actions' && col.actions) {
            this._bindActionsCell(cell, col, task, ctx);
            return;
        }

        // Special handling for schedulingMode (skip renderer, handle icon + select separately)
        if (col.field === 'schedulingMode') {
            this._bindSchedulingModeCell(cell, col, freshTask, ctx);
            return;
        }

        // Handle custom renderer (check before standard binding)
        // Pass freshTask to ensure renderers get latest data
        if (col.renderer) {
            const rendered = col.renderer(freshTask, {
                isParent,
                depth,
                isCollapsed,
                index: ctx.index,
            });
            
            if (cell.text) {
                // Check if rendered content contains HTML
                if (rendered.includes('<')) {
                    cell.text.innerHTML = rendered;
                } else {
                    cell.text.textContent = rendered;
                }
            } else if (cell.container) {
                // Fallback to container if text node doesn't exist
                if (rendered.includes('<')) {
                    cell.container.innerHTML = rendered;
                } else {
                    cell.container.textContent = rendered;
                }
            }
            return;
        }

        // Use freshTask for field value reads (always up-to-date)
        const value = getTaskFieldValue(freshTask, col.field);

        // Handle different cell types
        if (cell.checkbox) {
            // Checkbox reflects selection state
            cell.checkbox.checked = ctx.isSelected;
        } else if (cell.input) {
            // Input/select element
            if (cell.input instanceof HTMLInputElement || cell.input instanceof HTMLSelectElement) {
                
                // ═══════════════════════════════════════════════════════════════
                // EDITING GUARD: Query EditingStateManager directly
                // This is the SINGLE SOURCE OF TRUTH for editing state
                // Handles both user-initiated and programmatic edits
                // ═══════════════════════════════════════════════════════════════
                const editingManager = getEditingStateManager();
                const isBeingEdited = editingManager.isEditingCell(task.id, col.field);
                
                if (!isBeingEdited) {
                    // Safe to update - cell is not being edited
                    if (col.type === 'date' && value) {
                        const displayValue = formatDateForDisplay(String(value));
                        cell.input.value = displayValue;
                        (cell.input as HTMLInputElement).dataset.isoValue = String(value);
                    } else {
                cell.input.value = value ? String(value) : '';
                    }
                }
                // If being edited, preserve DOM value (user's current input)

                // Handle readonly state (always apply, even if editing)
                const isReadonly = col.editable === false || (col.readonlyForParent && isParent);
                if (isReadonly) {
                    cell.input.classList.add('cell-readonly');
                    cell.input.disabled = true;
                } else {
                    cell.input.classList.remove('cell-readonly');
                    cell.input.disabled = false;
                }
            }
        } else if (cell.text) {
            // Text display cells - safe to always update
            cell.text.textContent = value ? String(value) : '';
        }

        // Apply cell class if specified
        // CRITICAL: Always start with base class and explicitly remove highlight
        // This ensures recycled cells don't retain old highlights
        if (col.cellClass) {
            const classes = col.cellClass.split(' ');
            cell.container.className = `vsg-cell ${classes.join(' ')}`;
        } else {
            // Ensure base class is set even if no cellClass specified
            cell.container.className = 'vsg-cell';
        }
        
        // Explicitly remove highlight class (will be re-applied by GridRenderer if this cell is focused)
        cell.container.classList.remove('vsg-cell-selected');

        // Handle special column: name with indent and collapse
        if (col.field === 'name') {
            this._bindNameCell(cell, ctx);
        }

        // Handle date inputs - text input with MM/DD/YYYY display format
        if (col.type === 'date' && cell.input) {
            const input = cell.input as HTMLInputElement;
            const field = col.field;
            
            cell.container.style.position = 'relative';
            const hasConstraintIcon = col.showConstraintIcon && (col.field === 'start' || col.field === 'end');
            
            // ═══════════════════════════════════════════════════════════════
            // EDITING GUARD: Query EditingStateManager directly for date inputs
            // ═══════════════════════════════════════════════════════════════
            const editingManager = getEditingStateManager();
            const isBeingEdited = editingManager.isEditingCell(ctx.task.id, col.field);
            
            if (!isBeingEdited) {
                // Get the stored value (YYYY-MM-DD format) from freshTask
                const storedValue = getTaskFieldValue(freshTask, col.field);
            
            // Display in MM/DD/YYYY format
            if (storedValue) {
                input.value = formatDateForDisplay(String(storedValue));
            } else {
                input.value = '';
            }
            
            // Store the ISO value as a data attribute for retrieval
            input.dataset.isoValue = storedValue ? String(storedValue) : '';
            }
            // If being edited, preserve DOM value (user's current input)
            
            // Handle readonly state
            const isReadonly = col.editable === false || (col.readonlyForParent && ctx.isParent);
            input.disabled = isReadonly;
            if (isReadonly) {
                input.classList.add('cell-readonly');
            } else {
                input.classList.remove('cell-readonly');
            }
            
            // Add constraint icon if needed
            if (hasConstraintIcon) {
                this._bindConstraintIcon(cell, col, freshTask, ctx);
            }
            
            // Add calendar icon that opens shared popup
            this._bindCalendarIcon(cell, col, ctx, hasConstraintIcon);
            
            // Reserve padding space for icons
            const iconSize = 12;
            const iconGap = 4;
            const iconMargin = 4;
            const totalPadding = hasConstraintIcon 
                ? iconMargin + iconSize + iconGap + iconSize + iconGap
                : iconMargin + iconSize + iconGap;
            input.style.paddingRight = `${totalPadding}px`;
            
            // Add focus class to cell for styling (fallback for browsers without :has())
            // Remove existing listeners to prevent duplicates (pooled elements get reused)
            const existingFocusHandler = (input as any)._focusHandler;
            const existingBlurHandler = (input as any)._blurHandler;
            if (existingFocusHandler) {
                input.removeEventListener('focus', existingFocusHandler);
            }
            if (existingBlurHandler) {
                input.removeEventListener('blur', existingBlurHandler);
            }
            
            // Create new handlers
            const focusHandler = () => {
                cell.container.classList.add('date-cell-focused');
            };
            const blurHandler = () => {
                cell.container.classList.remove('date-cell-focused');
            };
            
            // Store references for cleanup
            (input as any)._focusHandler = focusHandler;
            (input as any)._blurHandler = blurHandler;
            
            input.addEventListener('focus', focusHandler);
            input.addEventListener('blur', blurHandler);
            
            return; // Early return - we've handled this cell completely
        }

        // Handle constraint icons on non-date cells
        if (col.showConstraintIcon && (col.field === 'start' || col.field === 'end') && col.type !== 'date') {
            cell.container.style.position = 'relative';
            this._bindConstraintIcon(cell, col, freshTask, ctx);
        }

    }

    /**
     * Bind the scheduling mode cell with icon and select dropdown
     */
    private _bindSchedulingModeCell(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        const { isParent } = ctx;
        const mode = (getTaskFieldValue(task, col.field) as string) || 'Auto';
        
        // Find icon container and select element
        const iconContainer = cell.container.querySelector('.vsg-mode-icon') as HTMLElement | null;
        const select = cell.container.querySelector('select[data-field="schedulingMode"]') as HTMLSelectElement | null;
        
        // Update icon based on mode
        if (iconContainer) {
            if (isParent) {
                // Parent tasks show dash
                iconContainer.innerHTML = '<span style="color: #94a3b8; font-size: 11px;">—</span>';
                iconContainer.setAttribute('title', 'Parent tasks are auto-scheduled');
            } else if (mode === 'Manual') {
                // Manual Icon (Pin) - amber color
                iconContainer.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f59e0b;">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
                    </svg>
                `;
                iconContainer.setAttribute('title', 'Manually Scheduled (dates fixed)');
            } else {
                // Auto Icon (Clock) - blue color
                iconContainer.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #3b82f6;">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                `;
                iconContainer.setAttribute('title', 'Auto-Scheduled (CPM-driven)');
            }
        }
        
        // Update select value
        if (select) {
            select.value = mode;
            
            // Handle readonly state
            const isReadonly = col.editable === false || (col.readonlyForParent && isParent);
            if (isReadonly) {
                select.classList.add('cell-readonly');
                select.disabled = true;
            } else {
                select.classList.remove('cell-readonly');
                select.disabled = false;
            }
        }
    }

    /**
     * Bind the name cell with indent and collapse button
     */
    private _bindNameCell(cell: PooledCell, ctx: BindingContext): void {
        const { isParent, isCollapsed, depth } = ctx;

        if (!cell.input) return;

        // Calculate indent padding
        const indent = depth * 20;
        const collapseWidth = 24;

        // Find prefix container (created in PoolSystem)
        const prefix = cell.container.querySelector('.vsg-name-prefix') as HTMLElement | null;
        if (!prefix) return;

        // Update prefix content
        prefix.style.paddingLeft = `${indent}px`;
        prefix.style.width = `${indent + collapseWidth}px`;

        if (isParent && cell.collapseBtn) {
            // Show collapse button
            cell.collapseBtn.style.display = 'flex';

            // Update SVG path based on collapse state
            const svg = cell.collapseBtn.querySelector('svg');
            const path = svg?.querySelector('path');
            if (path) {
                path.setAttribute('d', isCollapsed
                    ? 'M9 18l6-6-6-6'  // chevron-right
                    : 'M6 9l6 6 6-6'   // chevron-down
                );
            }
        } else {
            // Hide collapse button for non-parent rows
            if (cell.collapseBtn) {
                cell.collapseBtn.style.display = 'none';
            }
            // Ensure spacer exists
            if (cell.indent) {
                cell.indent.style.display = 'block';
            }
        }
    }

    /**
     * Bind calendar icon that opens the shared date picker popup
     */
    private _bindCalendarIcon(cell: PooledCell, col: GridColumn, ctx: BindingContext, hasConstraintIcon: boolean): void {
        // Remove existing calendar icon if present
        const existingIcon = cell.container.querySelector('.vsg-calendar-icon');
        if (existingIcon) {
            existingIcon.remove();
        }

        // Don't add icon for readonly cells
        const isReadonly = col.editable === false || (col.readonlyForParent && ctx.isParent);
        if (isReadonly) return;

        // Create calendar icon using pre-rendered SVG
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-calendar-icon';
        iconEl.innerHTML = ICONS.calendar;

        const iconSize = 12;
        const iconGap = 4;
        const iconMargin = 4;
        const rightPosition = hasConstraintIcon ? `${iconMargin + iconSize + iconGap}px` : `${iconMargin}px`;

        iconEl.style.cssText = `
            position: absolute;
            right: ${rightPosition};
            top: 50%;
            transform: translateY(-50%);
            width: ${iconSize}px;
            height: ${iconSize}px;
            color: #94a3b8;
            opacity: 0.6;
            pointer-events: auto;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3;
            flex-shrink: 0;
            padding: 4px;
            margin: -4px;
            box-sizing: content-box;
        `;

        // Add hover effect
        iconEl.addEventListener('mouseenter', () => {
            iconEl.style.opacity = '1';
            iconEl.style.color = '#6366f1';
        });
        iconEl.addEventListener('mouseleave', () => {
            iconEl.style.opacity = '0.6';
            iconEl.style.color = '#94a3b8';
        });

        // Click handler to open shared date picker popup
        iconEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const input = cell.input as HTMLInputElement;
            if (!input || input.disabled) return;
            
            // Get current task ID from the row (may have changed due to pooling)
            const row = cell.container.closest('.vsg-row') as HTMLElement;
            const currentTaskId = row?.dataset.taskId;
            const field = col.field;
            
            // Get the ISO value for the picker
            const isoValue = input.dataset.isoValue || '';
            
            if (currentTaskId && this.onOpenDatePicker) {
                this.onOpenDatePicker(currentTaskId, field, cell.container, isoValue);
            }
        });

        cell.container.appendChild(iconEl);
    }

    /**
     * Bind constraint icon to a date cell
     */
    private _bindConstraintIcon(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        // Remove existing icon if any
        const existingIcon = cell.container.querySelector('.vsg-constraint-icon');
        if (existingIcon) {
            existingIcon.remove();
        }

        // Don't show icons for parent tasks
        if (ctx.isParent) return;

        // Query TaskStore for fresh constraint data
        const freshTask = this.taskStore?.getById(task.id) ?? task;
        const constraintType = freshTask.constraintType || 'asap';
        const constraintDate = freshTask.constraintDate || '';

        // Determine which icon to show
        let iconName: keyof typeof ICONS | null = null;
        let color = '';
        let title = '';

        if (col.field === 'start') {
            if (constraintType === 'snet') {
                iconName = 'constraintNoEarlier';
                color = '#93c5fd';
                title = `Start No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'snlt') {
                iconName = 'constraintNoLater';
                color = '#fcd34d';
                title = `Start No Later Than ${constraintDate}`;
            }
        } else if (col.field === 'end') {
            if (constraintType === 'fnet') {
                iconName = 'constraintNoEarlier';
                color = '#93c5fd';
                title = `Finish No Earlier Than ${constraintDate}`;
            } else if (constraintType === 'fnlt') {
                iconName = 'constraintNoLater';
                color = '#fcd34d';
                title = `Finish No Later Than ${constraintDate}`;
            } else if (constraintType === 'mfo') {
                iconName = 'constraintMustOn';
                color = '#fca5a5';
                title = `Must Finish On ${constraintDate}`;
            }
        }

        if (!iconName) return;

        // Create icon element using pre-rendered SVG
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-constraint-icon';
        iconEl.title = title;
        iconEl.innerHTML = ICONS[iconName];

        const iconSize = 12;
        const iconMargin = 4;

        iconEl.style.cssText = `
            position: absolute;
            right: ${iconMargin}px;
            top: 50%;
            transform: translateY(-50%);
            width: ${iconSize}px;
            height: ${iconSize}px;
            color: ${color};
            opacity: 0.8;
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2;
            flex-shrink: 0;
        `;

        // Update SVG color
        const svg = iconEl.querySelector('svg');
        if (svg) {
            svg.style.color = color;
            svg.setAttribute('stroke', color);
        }

        cell.container.appendChild(iconEl);
    }

    /**
     * Bind action buttons to a cell
     * v3.0: Now renders ONLY a single menu trigger button
     * REMOVED: Old loop that rendered 4 buttons (indent/outdent/links/delete)
     */
    private _bindActionsCell(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        const container = cell.container.querySelector('.vsg-actions') as HTMLElement | null;
        if (!container) return;

        // For blank rows, show minimal or different menu
        const isBlank = task.rowType === 'blank';

        // v3.0: Get ONLY the first (and only) action - the row-menu
        const action = col.actions?.[0];
        if (!action) {
            // Hide all action buttons if no action defined
            cell.actionButtons.forEach(btn => {
                btn.style.display = 'none';
            });
            // Clear container
            container.innerHTML = '';
            return;
        }

        // CRITICAL: Clear container first to remove any existing buttons
        // This ensures only the ellipsis button is visible
        container.innerHTML = '';

        // Reuse existing button from pool or create new one
        let btn: HTMLButtonElement;
        if (cell.actionButtons.length > 0) {
            btn = cell.actionButtons[0];
        } else {
            btn = document.createElement('button');
            btn.className = 'vsg-action-btn vsg-row-menu-btn';
            cell.actionButtons.push(btn);
        }

        // Set attributes for click handling
        btn.setAttribute('data-action', 'row-menu');
        btn.setAttribute('data-task-id', task.id);
        btn.setAttribute('data-is-blank', String(isBlank));
        btn.title = 'Row Menu';
        btn.style.cssText = `
            padding: 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 4px;
            color: #94a3b8;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            min-height: 24px;
            line-height: 1;
            transition: color 0.15s ease, background 0.15s ease;
        `;

        // Ellipsis icon (vertical three dots)
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
        </svg>`;

        // Append button to container (only one button - the ellipsis)
        container.appendChild(btn);

        // v3.0: Hide ALL other buttons in pool (cleanup from old implementation)
        for (let i = 1; i < cell.actionButtons.length; i++) {
            cell.actionButtons[i].style.display = 'none';
        }
    }

    /**
     * Update columns (when columns change)
     */
    updateColumns(columns: GridColumn[]): void {
        this.columnMap.clear();
        columns.forEach(col => {
            this.columnMap.set(col.field, col);
        });
    }
}

