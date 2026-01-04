/**
 * @fileoverview Checkbox Column Renderer
 * @module core/columns/renderers/CheckboxRenderer
 * 
 * Renders checkbox columns (typically for row selection).
 */

import type { Task } from '../../../types';
import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';

/**
 * Checkbox Renderer - For selection checkbox columns
 * 
 * Used by: row selection checkbox
 */
export class CheckboxRenderer extends BaseRenderer {
    readonly type: ColumnType = 'checkbox';
    
    /**
     * Render checkbox
     */
    render(cell: PooledCell, ctx: ColumnContext, _column: ColumnDefinition): void {
        if (!cell.checkbox) return;
        
        // Checkbox reflects selection state
        cell.checkbox.checked = ctx.isSelected;
    }
    
    /**
     * Get value (selected state as string)
     */
    getValue(_task: Task, _column: ColumnDefinition): string {
        // Checkbox value is based on context, not task data
        return '';
    }
}
