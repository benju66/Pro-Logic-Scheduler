/**
 * @fileoverview Row Number Column Renderer
 * @module core/columns/renderers/RowNumberRenderer
 * 
 * Renders visual row numbers (skipping blank/phantom rows).
 */

import type { Task } from '../../../types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { TextDisplayRenderer } from './BaseRenderer';

/**
 * Row Number Renderer - For row number display
 * 
 * Shows logical row numbering that skips blank/phantom rows.
 */
export class RowNumberRenderer extends TextDisplayRenderer {
    readonly type: ColumnType = 'rowNumber';
    
    /**
     * Render row number
     */
    protected renderHtml(ctx: ColumnContext, _column: ColumnDefinition): string {
        const task = ctx.task;
        
        // Skip blank and phantom rows
        if (task.rowType === 'blank' || task.rowType === 'phantom') {
            return '';
        }
        
        // Use visual row number if available, otherwise use index+1
        const rowNum = this.services.getVisualRowNumber(task) ?? (ctx.index + 1);
        
        return `<span style="color: #94a3b8; font-size: 11px;">${rowNum}</span>`;
    }
    
    /**
     * Get value as string
     */
    getValue(task: Task, _column: ColumnDefinition): string {
        if (task.rowType === 'blank' || task.rowType === 'phantom') {
            return '';
        }
        const rowNum = this.services.getVisualRowNumber(task);
        return rowNum !== null && rowNum !== undefined ? String(rowNum) : '';
    }
}
