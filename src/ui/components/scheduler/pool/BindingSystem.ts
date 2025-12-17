/**
 * @fileoverview Binding System for Unified Scheduler V2
 * @module ui/components/scheduler/pool/BindingSystem
 * 
 * Updates DOM content on pooled elements using ONLY fast DOM operations.
 * Updates accessibility attributes.
 */

import type { Task, GridColumn } from '../../../../types';
import type { PooledRow, PooledCell, BindingContext } from '../types';
import { getTaskFieldValue } from '../../../../types';
import { ICONS } from '../icons';

/**
 * Binding System - Updates pooled DOM elements with task data
 */
export class BindingSystem {
    private columnMap: Map<string, GridColumn>;

    constructor(columns: GridColumn[]) {
        this.columnMap = new Map();
        columns.forEach(col => {
            this.columnMap.set(col.field, col);
        });
    }

    /**
     * Bind task data to a pooled row
     */
    bindRow(row: PooledRow, ctx: BindingContext): void {
        const { task, index, isSelected, isParent, isCollapsed, isCritical, depth } = ctx;

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
        row.element.setAttribute('aria-label', `${task.name}, row ${index + 1}`);

        // Bind cells
        for (const [field, cell] of row.cells) {
            const column = this.columnMap.get(field);
            if (column) {
                this._bindCell(cell, column, task, ctx);
            }
        }
    }

    /**
     * Bind data to a specific cell
     */
    private _bindCell(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        const { isParent, isCollapsed, depth } = ctx;

        // Handle special column: actions FIRST
        if (col.type === 'actions' && col.actions) {
            this._bindActionsCell(cell, col, task, ctx);
            return;
        }

        const value = getTaskFieldValue(task, col.field);

        // Handle different cell types
        if (cell.checkbox) {
            // Checkbox reflects selection state
            cell.checkbox.checked = ctx.isSelected;
        } else if (cell.input) {
            // Input/select element
            if (cell.input instanceof HTMLInputElement || cell.input instanceof HTMLSelectElement) {
                // Don't update if being edited (handled by GridRenderer)
                cell.input.value = value ? String(value) : '';

                // Handle readonly state
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
            // Text/readonly display
            cell.text.textContent = value ? String(value) : '';
        }

        // Apply cell class if specified
        if (col.cellClass) {
            const classes = col.cellClass.split(' ');
            cell.container.className = `vsg-cell ${classes.join(' ')}`;
        }

        // Handle special column: name with indent and collapse
        if (col.field === 'name') {
            this._bindNameCell(cell, ctx);
        }

        // Handle date inputs - add calendar icon
        if (col.type === 'date' && cell.input && (cell.input as HTMLInputElement).type === 'date') {
            cell.container.style.position = 'relative';
            const hasConstraintIcon = col.showConstraintIcon && (col.field === 'start' || col.field === 'end');
            this._bindCalendarIcon(cell, hasConstraintIcon);

            // Reserve padding space for icons
            const iconSize = 12;
            const iconGap = 4;
            const iconMargin = 4;

            if (hasConstraintIcon) {
                const totalPadding = iconMargin + iconSize + iconGap + iconSize;
                (cell.input as HTMLInputElement).style.paddingRight = `${totalPadding}px`;
                this._bindConstraintIcon(cell, col, task, ctx);
            } else {
                const totalPadding = iconMargin + iconSize;
                (cell.input as HTMLInputElement).style.paddingRight = `${totalPadding}px`;
            }
        }

        // Handle constraint icons on non-date cells
        if (col.showConstraintIcon && (col.field === 'start' || col.field === 'end') && col.type !== 'date') {
            cell.container.style.position = 'relative';
            this._bindConstraintIcon(cell, col, task, ctx);
        }

        // Handle custom renderer
        if (col.renderer) {
            const rendered = col.renderer(task, {
                isParent,
                depth,
                isCollapsed,
                index: ctx.index,
            });
            if (typeof rendered === 'string') {
                // If renderer returns HTML (contains tags), always use innerHTML on container
                // Otherwise use textContent for text nodes
                const isHTML = rendered.includes('<') && rendered.includes('>');
                if (isHTML) {
                    // Force use of container for HTML rendering
                    cell.container.innerHTML = rendered;
                } else {
                    // Use text node if available, otherwise container
                    const container = cell.text || cell.container;
                    if (container === cell.text) {
                        container.textContent = rendered;
                    } else {
                        container.textContent = rendered;
                    }
                }
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
     * Bind calendar icon to date input cell
     */
    private _bindCalendarIcon(cell: PooledCell, hasConstraintIcon: boolean): void {
        // Remove existing calendar icon if present
        const existingIcon = cell.container.querySelector('.vsg-calendar-icon');
        if (existingIcon) {
            existingIcon.remove();
        }

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
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
            flex-shrink: 0;
        `;

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

        const constraintType = task.constraintType || 'asap';
        const constraintDate = task.constraintDate || '';

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
     */
    private _bindActionsCell(cell: PooledCell, col: GridColumn, task: Task, ctx: BindingContext): void {
        const container = cell.container.querySelector('.vsg-actions') as HTMLElement | null;
        if (!container) return;

        if (!col.actions || !Array.isArray(col.actions) || col.actions.length === 0) {
            // Hide all action buttons
            cell.actionButtons.forEach(btn => {
                btn.style.display = 'none';
            });
            return;
        }

        // Clear wrapper if exists
        let wrapper = container.querySelector('div');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 2px;';
            container.appendChild(wrapper);
        } else {
            // Clear existing buttons
            while (wrapper.firstChild) {
                wrapper.removeChild(wrapper.firstChild);
            }
        }

        // Show/hide and update action buttons
        let visibleCount = 0;
        col.actions.forEach((action, index) => {
            // Check if action should be shown
            if (action.showIf && !action.showIf(task, {
                isParent: ctx.isParent,
                depth: ctx.depth,
                isCollapsed: ctx.isCollapsed,
                index: ctx.index,
            })) {
                return;
            }

            const actionName = action.name || action.id;
            const actionContent = action.icon || action.label || actionName;

            // Determine color: purple for links if task has dependencies
            let actionColor = action.color || '#64748b';
            if (actionName === 'links' && task.dependencies && task.dependencies.length > 0) {
                actionColor = '#9333ea';
            }

            // Reuse existing button or create new one
            let btn: HTMLButtonElement;
            if (visibleCount < cell.actionButtons.length) {
                btn = cell.actionButtons[visibleCount];
                btn.style.display = 'flex';
            } else {
                btn = document.createElement('button');
                btn.className = 'vsg-action-btn';
                cell.actionButtons.push(btn);
            }

            btn.setAttribute('data-action', actionName);
            btn.title = action.title || actionName;
            btn.style.cssText = `
                padding: 4px 6px;
                border: none;
                background: transparent;
                cursor: pointer;
                border-radius: 4px;
                color: ${actionColor};
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 24px;
                min-height: 24px;
                line-height: 1;
            `;

            // Set button content
            btn.textContent = '';
            if (typeof actionContent === 'string' && actionContent.trim().startsWith('<')) {
                // HTML content
                btn.innerHTML = actionContent;
            } else {
                // Text content
                btn.textContent = actionContent;
            }

            wrapper.appendChild(btn);
            visibleCount++;
        });

        // Hide unused buttons
        for (let i = visibleCount; i < cell.actionButtons.length; i++) {
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

