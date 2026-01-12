/**
 * @fileoverview Date Column Renderer
 * @module core/columns/renderers/DateRenderer
 * 
 * Renders date input columns with constraint icon and calendar popup.
 */

import type { Task } from '../../../types';
import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';
import { formatDateForDisplay } from '../../../ui/components/scheduler/datepicker/DatePickerConfig';
import { ICONS } from '../../../ui/components/scheduler/icons';

/**
 * Date Renderer - For date input columns
 * 
 * Features:
 * - MM/DD/YYYY display format (stores as YYYY-MM-DD)
 * - Constraint icon for start/end dates
 * - Calendar icon to open date picker popup
 */
export class DateRenderer extends BaseRenderer {
    readonly type: ColumnType = 'date';
    
    /**
     * Render date input with icons
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        if (!cell.input || !(cell.input instanceof HTMLInputElement)) return;
        
        const input = cell.input;
        const task = ctx.task;
        const isReadonly = this.isReadonly(ctx, column);
        
        // Position container for absolute icons
        cell.container.style.position = 'relative';
        
        // Check if should show constraint icon
        const hasConstraintIcon = !!(column.showConstraintIcon && 
            (column.field === 'start' || column.field === 'end'));
        
        // Only update value if not being edited
        if (!this.services.isEditingCell(task.id, column.field)) {
            const storedValue = this.getValue(task, column);
            
            // Display in MM/DD/YYYY format
            if (storedValue) {
                input.value = formatDateForDisplay(storedValue);
            } else {
                input.value = '';
            }
            
            // Store the ISO value as a data attribute
            input.dataset.isoValue = storedValue || '';
        }
        
        // Apply readonly state
        this.applyReadonlyState(input, isReadonly);
        
        // Add constraint icon if needed
        if (hasConstraintIcon) {
            this._bindConstraintIcon(cell, task, column);
        }
        
        // Add calendar icon (only for editable cells)
        if (!isReadonly) {
            this._bindCalendarIcon(cell, column, ctx, hasConstraintIcon);
        }
        
        // Reserve padding space for icons
        const iconSize = 12;
        const iconGap = 4;
        const iconMargin = 4;
        const totalPadding = hasConstraintIcon 
            ? iconMargin + iconSize + iconGap + iconSize + iconGap
            : iconMargin + iconSize + iconGap;
        input.style.paddingRight = `${totalPadding}px`;
        
        // Handle focus styling
        this._bindFocusHandlers(cell, input);
    }
    
    /**
     * Format date for display (MM/DD/YYYY)
     */
    protected formatForDisplay(value: string, _column: ColumnDefinition): string {
        if (!value) return '';
        return formatDateForDisplay(value);
    }
    
    /**
     * Validate date input
     */
    validate(value: string): boolean {
        if (value === '') return true;
        // Accept MM/DD/YYYY or YYYY-MM-DD formats
        const mmddyyyy = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
        const isoFormat = /^\d{4}-\d{2}-\d{2}$/;
        return mmddyyyy.test(value) || isoFormat.test(value);
    }
    
    /**
     * Bind constraint icon to cell
     */
    private _bindConstraintIcon(cell: PooledCell, task: Task, column: ColumnDefinition): void {
        // Remove existing constraint icon
        const existingIcon = cell.container.querySelector('.vsg-constraint-icon');
        if (existingIcon) {
            existingIcon.remove();
        }
        
        // Check if task has a constraint that affects this field
        const constraintType = task.constraintType;
        if (!constraintType || constraintType === 'asap') return;
        
        // Determine if this field is affected by the constraint
        const isStartField = column.field === 'start';
        const isFinishField = column.field === 'end';
        
        const startConstraints = ['snet', 'snlt'];
        const finishConstraints = ['fnet', 'fnlt', 'mfo'];
        
        const isAffected = (isStartField && startConstraints.includes(constraintType)) ||
                          (isFinishField && finishConstraints.includes(constraintType));
        
        if (!isAffected) return;
        
        // Create constraint icon
        const iconEl = document.createElement('span');
        iconEl.className = 'vsg-constraint-icon';
        
        // Different icons/colors based on constraint type
        let iconHtml = '';
        let color = '#64748b';
        
        switch (constraintType) {
            case 'snet':
            case 'fnet':
                // "No Earlier Than" - push forward icon
                iconHtml = ICONS.constraintNoEarlier;
                color = '#3b82f6'; // Blue
                break;
            case 'snlt':
            case 'fnlt':
                // "No Later Than" - deadline icon
                iconHtml = ICONS.constraintNoLater;
                color = '#f59e0b'; // Amber
                break;
            case 'mfo':
                // "Must Finish On" - locked icon
                iconHtml = ICONS.constraintMustOn;
                color = '#ef4444'; // Red
                break;
        }
        
        iconEl.innerHTML = iconHtml;
        iconEl.style.cssText = `
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: 12px;
            height: 12px;
            color: ${color};
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 4;
            pointer-events: none;
        `;
        iconEl.setAttribute('title', this._getConstraintTooltip(constraintType));
        
        cell.container.appendChild(iconEl);
    }
    
    /**
     * Get tooltip text for constraint type
     */
    private _getConstraintTooltip(constraintType: string): string {
        const tooltips: Record<string, string> = {
            'snet': 'Start No Earlier Than',
            'snlt': 'Start No Later Than',
            'fnet': 'Finish No Earlier Than',
            'fnlt': 'Finish No Later Than',
            'mfo': 'Must Finish On',
        };
        return tooltips[constraintType] || constraintType;
    }
    
    /**
     * Bind calendar icon to cell
     */
    private _bindCalendarIcon(cell: PooledCell, column: ColumnDefinition, ctx: ColumnContext, hasConstraintIcon: boolean): void {
        // Remove existing calendar icon
        const existingIcon = cell.container.querySelector('.vsg-calendar-icon');
        if (existingIcon) {
            existingIcon.remove();
        }
        
        // Create calendar icon
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
        
        // Click handler to open date picker popup
        iconEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const input = cell.input as HTMLInputElement;
            if (!input || input.disabled) return;
            
            // Get current task ID from the row (may have changed due to pooling)
            const row = cell.container.closest('.vsg-row') as HTMLElement;
            const currentTaskId = row?.dataset.taskId || ctx.task.id;
            const field = column.field;
            
            // Get the ISO value for the picker
            const isoValue = input.dataset.isoValue || '';
            
            // Open date picker via service
            this.services.openDatePicker(currentTaskId, field, cell.container, isoValue);
        });
        
        cell.container.appendChild(iconEl);
    }
    
    /**
     * Bind focus handlers for styling
     */
    private _bindFocusHandlers(cell: PooledCell, input: HTMLInputElement): void {
        // Remove existing handlers
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
    }
}
