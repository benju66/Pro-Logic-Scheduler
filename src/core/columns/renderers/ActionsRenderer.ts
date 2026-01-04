/**
 * @fileoverview Actions Column Renderer
 * @module core/columns/renderers/ActionsRenderer
 * 
 * Renders action buttons column (row menu).
 */

import type { Task } from '../../../types';
import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';

/**
 * Actions Renderer - For action button columns
 * 
 * Used by: row menu (ellipsis button)
 */
export class ActionsRenderer extends BaseRenderer {
    readonly type: ColumnType = 'actions';
    
    /**
     * Render action buttons
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        const container = cell.container.querySelector('.vsg-actions') as HTMLElement | null;
        if (!container) return;
        
        const task = ctx.task;
        const isBlank = task.rowType === 'blank';
        
        // Get the first (and only) action - the row-menu
        const action = column.actions?.[0];
        if (!action) {
            // Hide all action buttons if no action defined
            cell.actionButtons.forEach(btn => {
                btn.style.display = 'none';
            });
            container.innerHTML = '';
            return;
        }
        
        // Clear container to remove any existing buttons
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
        btn.title = action.title || 'Row Menu';
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
        btn.innerHTML = action.icon || `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
        </svg>`;
        
        container.appendChild(btn);
    }
    
    /**
     * Get value (not applicable for actions)
     */
    getValue(_task: Task, _column: ColumnDefinition): string {
        return '';
    }
}
