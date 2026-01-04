/**
 * @fileoverview Base Renderer Classes
 * @module core/columns/renderers/BaseRenderer
 * 
 * Abstract base classes for column renderers.
 * Provides common functionality and enforces consistent patterns.
 */

import type { Task } from '../../../types';
import type { PooledCell } from '../../../ui/components/scheduler/types';
import type { 
    ColumnType, 
    ColumnDefinition, 
    ColumnContext, 
    IColumnRenderer 
} from '../types';
import { ServiceContainer } from '../ServiceContainer';
import { getTaskFieldValue } from '../../../types';

/**
 * Base Renderer - Abstract base for all renderers
 * 
 * Provides:
 * - Service container access
 * - Default getValue implementation
 * - Common utility methods
 */
export abstract class BaseRenderer implements IColumnRenderer {
    /** The column type this renderer handles */
    abstract readonly type: ColumnType;
    
    /** Service container for dependency injection */
    protected services: ServiceContainer;
    
    constructor() {
        this.services = ServiceContainer.getInstance();
    }
    
    /**
     * Render cell content - must be implemented by subclasses
     */
    abstract render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
    
    /**
     * Get raw display value
     * Default implementation reads from task field
     */
    getValue(task: Task, column: ColumnDefinition): string {
        const value = getTaskFieldValue(task, column.field);
        return value !== undefined && value !== null ? String(value) : '';
    }
    
    /**
     * Check if column is readonly for this context
     */
    protected isReadonly(ctx: ColumnContext, column: ColumnDefinition): boolean {
        if (column.editable === false) return true;
        if (column.readonlyForParent && ctx.isParent) return true;
        return false;
    }
    
    /**
     * Apply readonly styling to an input element
     */
    protected applyReadonlyState(input: HTMLInputElement | HTMLSelectElement, isReadonly: boolean): void {
        input.disabled = isReadonly;
        if (isReadonly) {
            input.classList.add('cell-readonly');
        } else {
            input.classList.remove('cell-readonly');
        }
    }
    
    /**
     * Escape HTML special characters
     */
    protected escapeHtml(str: string): string {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

/**
 * Input Renderer - Base for editable text/number columns
 * 
 * Handles:
 * - Input value binding
 * - Readonly state
 * - Editing guard (don't overwrite while editing)
 */
export abstract class InputRenderer extends BaseRenderer {
    /**
     * Render an input-based cell
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        if (!cell.input) return;
        
        const isReadonly = this.isReadonly(ctx, column);
        
        // Only update value if not being edited
        if (!this.services.isEditingCell(ctx.task.id, column.field)) {
            const value = this.getValue(ctx.task, column);
            cell.input.value = this.formatForDisplay(value, column);
        }
        
        // Always apply readonly state
        this.applyReadonlyState(cell.input, isReadonly);
    }
    
    /**
     * Format value for display
     * Override in subclasses for custom formatting (e.g., dates)
     */
    protected formatForDisplay(value: string, _column: ColumnDefinition): string {
        return value;
    }
}

/**
 * Text Display Renderer - Base for readonly text columns
 * 
 * Renders to a span element (cell.text)
 */
export abstract class TextDisplayRenderer extends BaseRenderer {
    /**
     * Render a text display cell
     */
    render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
        if (!cell.text) return;
        
        const html = this.renderHtml(ctx, column);
        
        // Use innerHTML if contains HTML tags, textContent otherwise
        if (html.includes('<')) {
            cell.text.innerHTML = html;
        } else {
            cell.text.textContent = html;
        }
    }
    
    /**
     * Generate HTML content for the cell
     * Override in subclasses
     */
    protected abstract renderHtml(ctx: ColumnContext, column: ColumnDefinition): string;
}
