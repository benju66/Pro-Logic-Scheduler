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
        
        // Use visual row number (skips blank/phantom rows)
        const rowNum = this.services.getVisualRowNumber(task);
        
        if (rowNum === null || rowNum === undefined) {
            return ''; // Blank and phantom rows show no number
        }
        
        return `<span style="color: #94a3b8; font-size: 11px;">${rowNum}</span>`;
    }
    
    /**
     * Get value as string
     */
    getValue(task: Task, _column: ColumnDefinition): string {
        const rowNum = this.services.getVisualRowNumber(task);
        return rowNum !== null ? String(rowNum) : '';
    }
}
