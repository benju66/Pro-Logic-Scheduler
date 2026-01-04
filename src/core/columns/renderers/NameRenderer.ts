/**
 * @fileoverview Name Column Renderer
 * @module core/columns/renderers/NameRenderer
 * 
 * Renders task name column with hierarchy indent and collapse button.
 */

import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { InputRenderer } from './BaseRenderer';

/**
 * Name Renderer - For task name column
 * 
 * Features:
 * - Hierarchy indentation based on depth
 * - Collapse/expand button for parent tasks
 * - Editable text input
 */
export class NameRenderer extends InputRenderer {
    readonly type: ColumnType = 'name';
    
    /**
     * Render name cell with indent and collapse
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        // First, render the input using base class
        super.render(cell, ctx, column);
        
        // Then add name-specific features (indent, collapse)
        this._bindNameFeatures(cell, ctx);
    }
    
    /**
     * Bind name-specific features (indent, collapse button)
     */
    private _bindNameFeatures(cell: PooledCell, ctx: ColumnContext): void {
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
                    ? 'M9 18l6-6-6-6'  // chevron-right (collapsed)
                    : 'M6 9l6 6 6-6'   // chevron-down (expanded)
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
}
