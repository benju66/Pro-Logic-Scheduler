/**
 * @fileoverview Readonly Column Renderer
 * @module core/columns/renderers/ReadonlyRenderer
 * 
 * Renders readonly text display columns.
 */

import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { TextDisplayRenderer } from './BaseRenderer';

/**
 * Readonly Renderer - For non-editable text display columns
 * 
 * Used by: calculated fields, read-only displays
 */
export class ReadonlyRenderer extends TextDisplayRenderer {
    readonly type: ColumnType = 'readonly';
    
    /**
     * Render readonly text
     */
    protected renderHtml(ctx: ColumnContext, column: ColumnDefinition): string {
        const value = this.getValue(ctx.task, column);
        return value ? this.escapeHtml(value) : '';
    }
    
    /**
     * Override render to handle both text and input elements
     * Some readonly columns use inputs that are disabled
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        // If there's a text element, use it
        if (cell.text) {
            super.render(cell, ctx, column);
            return;
        }
        
        // If there's an input element, render as disabled input
        if (cell.input) {
            const value = this.getValue(ctx.task, column);
            cell.input.value = value;
            cell.input.disabled = true;
            cell.input.classList.add('cell-readonly');
        }
    }
}
