/**
 * @fileoverview Drag Handle Column Renderer
 * @module core/columns/renderers/DragRenderer
 * 
 * Renders drag handle for row reordering.
 */

import type { Task } from '../../../types';
import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { BaseRenderer } from './BaseRenderer';

/**
 * Drag Renderer - For drag handle columns
 * 
 * The drag handle DOM is created by PoolSystem.
 * This renderer just ensures proper state.
 */
export class DragRenderer extends BaseRenderer {
    readonly type: ColumnType = 'drag';
    
    /**
     * Render drag handle
     * DOM is pre-created by PoolSystem, just ensure visibility
     */
    render(cell: PooledCell, _ctx: ColumnContext, _column: ColumnDefinition): void {
        // Drag handle is pre-created in PoolSystem
        // Nothing to update - the handle is static
        const dragHandle = cell.container.querySelector('.vsg-drag-handle') as HTMLElement;
        if (dragHandle) {
            dragHandle.style.display = 'flex';
        }
    }
    
    /**
     * Get value (not applicable for drag handle)
     */
    getValue(_task: Task, _column: ColumnDefinition): string {
        return '';
    }
}
