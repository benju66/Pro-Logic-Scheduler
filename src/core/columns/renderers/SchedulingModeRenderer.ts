/**
 * @fileoverview Scheduling Mode Column Renderer
 * @module core/columns/renderers/SchedulingModeRenderer
 * 
 * Renders scheduling mode column with icon and select dropdown.
 */

import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';
import { getTaskFieldValue } from '../../../types';

/**
 * Scheduling Mode Renderer - For Auto/Manual mode column
 * 
 * Features:
 * - Icon showing current mode (clock for Auto, pin for Manual)
 * - Select dropdown to change mode
 */
export class SchedulingModeRenderer extends BaseRenderer {
    readonly type: ColumnType = 'schedulingMode';
    
    /**
     * Render scheduling mode cell
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        const { isParent } = ctx;
        const mode = (getTaskFieldValue(ctx.task, column.field) as string) || 'Auto';
        
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
                // Manual Icon (Bookmark/Pin) - amber color
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
            // Only update if not being edited
            if (!this.services.isEditingCell(ctx.task.id, column.field)) {
                select.value = mode;
            }
            
            // Handle readonly state
            const isReadonly = this.isReadonly(ctx, column);
            this.applyReadonlyState(select, isReadonly);
        }
    }
}
