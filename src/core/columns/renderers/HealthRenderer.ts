/**
 * @fileoverview Health Column Renderer
 * @module core/columns/renderers/HealthRenderer
 * 
 * Renders task health status indicator.
 */

import type { Task } from '../../../types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { TextDisplayRenderer } from './BaseRenderer';

/**
 * Health Renderer - For task health indicator column
 * 
 * Shows:
 * - Status icon (green/yellow/red)
 * - Status text tooltip
 */
export class HealthRenderer extends TextDisplayRenderer {
    readonly type: ColumnType = 'health';
    
    /**
     * Render health indicator
     */
    protected renderHtml(ctx: ColumnContext, _column: ColumnDefinition): string {
        const health = ctx.task._health;
        
        if (!health) {
            return '<span style="color: #94a3b8;">-</span>';
        }
        
        const statusClass = `health-${health.status}`;
        return `<span class="health-indicator-inline ${statusClass}" title="${this.escapeHtml(health.summary)}">${health.icon}</span>`;
    }
    
    /**
     * Get health summary as text
     */
    getValue(task: Task, _column: ColumnDefinition): string {
        return task._health?.summary || '-';
    }
}
