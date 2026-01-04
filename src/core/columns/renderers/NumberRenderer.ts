/**
 * @fileoverview Number Column Renderer
 * @module core/columns/renderers/NumberRenderer
 * 
 * Renders editable number input columns.
 */

import type { ColumnType, ColumnDefinition } from '../types';
import { InputRenderer } from './BaseRenderer';

/**
 * Number Renderer - For editable number columns
 * 
 * Used by: duration, progress, etc.
 */
export class NumberRenderer extends InputRenderer {
    readonly type: ColumnType = 'number';
    
    /**
     * Validate number input
     */
    validate(value: string): boolean {
        if (value === '') return true; // Allow empty
        const num = parseFloat(value);
        return !isNaN(num) && isFinite(num);
    }
    
    /**
     * Parse string to number
     */
    parse(value: string, _column: ColumnDefinition): number | null {
        if (value === '') return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }
}
