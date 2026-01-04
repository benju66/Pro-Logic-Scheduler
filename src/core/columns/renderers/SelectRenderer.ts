/**
 * @fileoverview Select Column Renderer
 * @module core/columns/renderers/SelectRenderer
 * 
 * Renders dropdown select columns.
 */

import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';

/**
 * Select Renderer - For dropdown select columns
 * 
 * Used by: constraintType, etc.
 */
export class SelectRenderer extends BaseRenderer {
    readonly type: ColumnType = 'select';
    
    /**
     * Render select dropdown
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        if (!cell.input || !(cell.input instanceof HTMLSelectElement)) return;
        
        const select = cell.input;
        const value = this.getValue(ctx.task, column);
        const isReadonly = this.isReadonly(ctx, column);
        
        // Only update value if not being edited
        if (!this.services.isEditingCell(ctx.task.id, column.field)) {
            select.value = value;
        }
        
        // Apply readonly state
        this.applyReadonlyState(select, isReadonly);
    }
    
    /**
     * Validate select value is in options
     */
    validate(value: string, _task: unknown, column: ColumnDefinition): boolean {
        if (!column.options) return true;
        return column.options.includes(value);
    }
}
