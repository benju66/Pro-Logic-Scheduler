/**
 * @fileoverview Variance Column Renderer
 * @module core/columns/renderers/VarianceRenderer
 * 
 * Renders variance between baseline and actual dates.
 */

import type { Task } from '../../../types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { TextDisplayRenderer } from './BaseRenderer';

/**
 * Variance Renderer - For start/finish variance columns
 * 
 * Shows:
 * - Green for ahead of schedule
 * - Red for behind schedule
 * - Gray for on time
 * 
 * Uses ServiceContainer for variance calculation (dependency injection).
 */
export class VarianceRenderer extends TextDisplayRenderer {
    readonly type: ColumnType = 'variance';
    
    /**
     * Render variance value with color coding
     */
    protected renderHtml(ctx: ColumnContext, column: ColumnDefinition): string {
        // Use injected service to calculate variance
        const variance = this.services.calculateVariance(ctx.task);
        
        // Determine which variance to show (start or finish)
        const field = column.config?.varianceField as 'start' | 'finish';
        const value = field === 'finish' ? variance.finish : variance.start;
        
        if (value === null) {
            return '<span style="color: #94a3b8;">-</span>';
        }
        
        const absValue = Math.abs(value);
        const isPositive = value > 0;
        const isNegative = value < 0;
        
        let className = 'variance-on-time';
        let prefix = '';
        
        if (isPositive) {
            className = 'variance-ahead';
            prefix = '+';
        } else if (isNegative) {
            className = 'variance-behind';
            prefix = '';
        }
        
        const tooltip = `${isPositive ? 'Ahead' : isNegative ? 'Behind' : 'On time'} by ${absValue} day${absValue !== 1 ? 's' : ''}`;
        
        return `<span class="${className}" title="${tooltip}">${prefix}${value}</span>`;
    }
    
    /**
     * Get variance as number string
     */
    getValue(task: Task, column: ColumnDefinition): string {
        const variance = this.services.calculateVariance(task);
        const field = column.config?.varianceField as 'start' | 'finish';
        const value = field === 'finish' ? variance.finish : variance.start;
        
        return value !== null ? String(value) : '-';
    }
}
