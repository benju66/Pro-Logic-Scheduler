/**
 * @fileoverview DOM Pool System for Unified Scheduler V2
 * @module ui/components/scheduler/pool/PoolSystem
 * 
 * Creates all DOM elements ONCE at initialization.
 * Manages row acquisition and release.
 */

import type { GridColumn } from '../../../../types';
import type { PooledRow, PooledCell } from '../types';
import type { PoolSystemOptions } from '../types';
import { MAX_POOL_SIZE } from '../constants';
import { ICONS } from '../icons';

/**
 * Pool System - Manages DOM element recycling
 */
export class PoolSystem {
    private pool: PooledRow[] = [];
    private activeRows: Map<number, PooledRow> = new Map();
    private availableRows: PooledRow[] = [];
    private container: HTMLElement;
    private columns: GridColumn[];
    private rowHeight: number;
    private maxActionButtons: number;

    constructor(options: PoolSystemOptions) {
        this.container = options.container;
        this.columns = options.columns;
        this.rowHeight = options.rowHeight;
        this.maxActionButtons = options.maxActionButtons;

        // Calculate pool size
        const viewportHeight = options.container.clientHeight || 800;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);
        const poolSize = Math.min(
            options.poolSize || visibleRows + 10,
            MAX_POOL_SIZE
        );

        // Pre-create all rows at init
        for (let i = 0; i < poolSize; i++) {
            const row = this._createRow();
            row.element.classList.add('vsg-hidden');
            this.pool.push(row);
            this.availableRows.push(row);
            this.container.appendChild(row.element);
        }

        console.log(`[PoolSystem] Created pool: ${poolSize} rows`);
    }

    /**
     * Acquire a row for a specific data index
     */
    acquireRow(dataIndex: number): PooledRow {
        // Already have row?
        const existing = this.activeRows.get(dataIndex);
        if (existing) return existing;

        // Get from pool
        let row: PooledRow;
        if (this.availableRows.length > 0) {
            row = this.availableRows.pop()!;
        } else {
            // Pool exhausted - create temporary row (not ideal but prevents crash)
            console.warn(`[PoolSystem] Pool exhausted at index ${dataIndex}, creating temporary row`);
            row = this._createRow();
            this.pool.push(row);
        }

        row.dataIndex = dataIndex;
        this.activeRows.set(dataIndex, row);
        row.element.classList.remove('vsg-hidden');

        return row;
    }

    /**
     * Release a row back to the pool
     */
    releaseRow(dataIndex: number): void {
        const row = this.activeRows.get(dataIndex);
        if (!row) return;

        // No Flatpickr cleanup needed - using shared popup
        this.activeRows.delete(dataIndex);
        row.dataIndex = -1;
        row.element.classList.add('vsg-hidden');
        this.availableRows.push(row);
    }

    /**
     * Release all rows outside the visible range
     */
    releaseRowsOutsideRange(start: number, end: number): void {
        const toRelease: number[] = [];

        for (const dataIndex of this.activeRows.keys()) {
            if (dataIndex < start || dataIndex > end) {
                toRelease.push(dataIndex);
            }
        }

        for (const dataIndex of toRelease) {
            this.releaseRow(dataIndex);
        }
    }

    /**
     * Get active row count
     */
    getActiveRowCount(): number {
        return this.activeRows.size;
    }

    /**
     * Get available row count
     */
    getAvailableRowCount(): number {
        return this.availableRows.length;
    }

    /**
     * Create a new row element with all cells
     */
    private _createRow(): PooledRow {
        const row = document.createElement('div');
        row.className = 'vsg-row';
        row.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            height: ${this.rowHeight}px;
            display: flex;
            align-items: center;
            border-bottom: 1px solid #f1f5f9;
            background: white;
            min-width: fit-content;
            will-change: top;
        `;

        const cells = new Map<string, PooledCell>();

        // Create cells for each column
        this.columns.forEach(col => {
            const cell = this._createCell(col);
            cells.set(col.field, cell);
            row.appendChild(cell.container);
            
        });

        return {
            element: row,
            cells,
            dataIndex: -1,
        };
    }

    /**
     * Create a cell element for a column
     */
    private _createCell(col: GridColumn): PooledCell {
        const container = document.createElement('div');
        container.className = 'vsg-cell';
        container.setAttribute('data-field', col.field);
        container.setAttribute('role', 'gridcell');

        const isPinned = col.cellClass?.includes('pinned');
        container.style.cssText = `
            width: var(--w-${col.field}, ${col.width || 100}px);
            flex-shrink: 0;
            height: 100%;
            display: flex;
            align-items: center;
            border-right: 1px solid #e2e8f0;
            ${col.align === 'center' ? 'justify-content: center;' : ''}
            ${col.align === 'right' ? 'justify-content: flex-end;' : ''}
            position: ${isPinned ? 'sticky' : 'relative'};
            ${isPinned ? 'background: white; z-index: 100;' : ''}
            overflow: hidden;
        `;

        // Create inner content based on column type
        let input: HTMLInputElement | HTMLSelectElement | null = null;
        let text: HTMLSpanElement | null = null;
        let checkbox: HTMLInputElement | null = null;
        const icons = new Map<string, HTMLSpanElement>();
        const actionButtons: HTMLButtonElement[] = [];
        let collapseBtn: HTMLButtonElement | null = null;
        let indent: HTMLSpanElement | null = null;

        switch (col.type) {
            case 'checkbox':
                checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'vsg-checkbox';
                checkbox.setAttribute('data-field', col.field);
                container.appendChild(checkbox);
                break;

            case 'text':
            case 'number':
            case 'name':  // Name column uses text input with special features
                input = document.createElement('input');
                input.type = col.type === 'name' ? 'text' : col.type;
                input.className = 'vsg-input';
                input.setAttribute('data-field', col.field);
                input.setAttribute('autocomplete', 'off');
                container.appendChild(input);
                break;

            case 'date':
                input = document.createElement('input');
                input.type = 'text';  // Text input with smart formatting (displays MM/DD/YYYY, stores YYYY-MM-DD)
                input.className = 'vsg-input vsg-date-input';
                input.setAttribute('data-field', col.field);
                input.setAttribute('placeholder', 'mm/dd/yyyy');
                input.setAttribute('autocomplete', 'off');
                container.appendChild(input);
                break;

            case 'select':
                // Special handling for schedulingMode to include icon
                if (col.field === 'schedulingMode') {
                    // Create wrapper for icon + select
                    const wrapper = document.createElement('div');
                    wrapper.className = 'vsg-mode-wrapper';
                    wrapper.style.cssText = 'display: flex; align-items: center; width: 100%; gap: 4px; padding: 0 4px;';
                    
                    // Icon container
                    const modeIcon = document.createElement('span');
                    modeIcon.className = 'vsg-mode-icon';
                    modeIcon.setAttribute('data-field', 'schedulingMode-icon');
                    modeIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
                    wrapper.appendChild(modeIcon);

                    input = document.createElement('select');
                    input.className = 'vsg-select';
                    input.setAttribute('data-field', col.field);
                    input.style.flex = '1';
                    input.style.minWidth = '0'; // Allow shrinking
                    
                    // Add options (type is string[])
                    if (col.options) {
                        col.options.forEach(opt => {
                            const option = document.createElement('option');
                                option.value = opt;
                                option.textContent = opt;
                            input!.appendChild(option);
                        });
                    }
                    wrapper.appendChild(input);
                    container.appendChild(wrapper);
                } else {
                    // Standard select
                    input = document.createElement('select');
                    input.className = 'vsg-select';
                    input.setAttribute('data-field', col.field);
                    // Add options (type is string[])
                    if (col.options) {
                        col.options.forEach(opt => {
                            const option = document.createElement('option');
                                option.value = opt;
                                option.textContent = opt;
                            input!.appendChild(option);
                        });
                    }
                    container.appendChild(input);
                }
                break;

            case 'readonly':
            case 'variance':
                text = document.createElement('span');
                text.className = 'vsg-readonly';
                text.setAttribute('data-field', col.field);
                container.appendChild(text);
                break;

            case 'actions':
                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'vsg-actions';
                actionsContainer.setAttribute('data-field', col.field);
                // Style like other column content - full width/height, centered
                actionsContainer.style.cssText = 'display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;';
                // Pre-create action buttons (will be shown/hidden as needed)
                for (let i = 0; i < this.maxActionButtons; i++) {
                    const btn = document.createElement('button');
                    btn.className = 'vsg-action-btn';
                    btn.style.display = 'none';
                    actionButtons.push(btn);
                    actionsContainer.appendChild(btn);
                }
                container.appendChild(actionsContainer);
                break;

            case 'drag':
                const dragHandle = document.createElement('div');
                dragHandle.className = 'vsg-drag-handle';
                dragHandle.setAttribute('data-field', col.field);
                dragHandle.setAttribute('draggable', 'true');
                dragHandle.innerHTML = ICONS.grip;
                container.appendChild(dragHandle);
                break;

            default:
                text = document.createElement('span');
                text.className = 'vsg-text';
                text.setAttribute('data-field', col.field);
                container.appendChild(text);
                break;
        }

        // Special handling for name column (indent + collapse)
        if (col.field === 'name') {
            const prefix = document.createElement('div');
            prefix.className = 'vsg-name-prefix';
            prefix.style.cssText = `
                display: flex;
                align-items: center;
                flex-shrink: 0;
            `;
            container.insertBefore(prefix, container.firstChild);

            // Create collapse button (will be shown/hidden as needed)
            collapseBtn = document.createElement('button');
            collapseBtn.className = 'vsg-collapse-btn';
            collapseBtn.setAttribute('data-action', 'collapse');
            collapseBtn.style.display = 'none';
            
            // Create SVG for collapse button
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M6 9l6 6 6-6'); // Default: chevron-down
            svg.appendChild(path);
            collapseBtn.appendChild(svg);
            prefix.appendChild(collapseBtn);

            // Create indent spacer
            indent = document.createElement('span');
            indent.style.width = '20px';
            prefix.appendChild(indent);
        }

        return {
            container,
            input,
            text,
            checkbox,
            icons,
            actionButtons,
            collapseBtn,
            indent,
        };
    }

    /**
     * Rebuild the entire pool with new column definitions
     * Used when columns structurally change (e.g., baseline columns added/removed)
     * @param columns - New column definitions
     */
    rebuildPool(columns: GridColumn[]): void {
        console.log('[PoolSystem] Rebuilding pool with new columns:', columns.length);
        
        // Store current pool size
        const poolSize = this.pool.length;
        
        // Clear tracking
        this.activeRows.clear();
        this.availableRows = [];
        
        // Remove all existing row elements from DOM
        for (const row of this.pool) {
            row.element.remove();
        }
        this.pool = [];
        
        // Update columns reference
        this.columns = columns;
        
        // Recreate pool with new column structure
        for (let i = 0; i < poolSize; i++) {
            const row = this._createRow();
            row.element.classList.add('vsg-hidden');
            this.pool.push(row);
            this.availableRows.push(row);
            this.container.appendChild(row.element);
        }
        
        console.log(`[PoolSystem] ✅ Pool rebuilt: ${poolSize} rows with ${columns.length} columns`);
    }

    /**
     * Smartly update row structure without destroying existing cells.
     * Preserves focus, event listeners, and DOM state for unchanged columns.
     * Uses document.createDocumentFragment for batch DOM updates (anti-stutter).
     * 
     * @param newColumns - New column definitions
     */
    updateStructure(newColumns: GridColumn[]): void {
        console.log(`[PoolSystem] Updating structure: ${this.columns.length} -> ${newColumns.length} columns`);
        this.columns = newColumns;
        
        // Update all rows in the pool (both active and available)
        for (const row of this.pool) {
            const currentCells = row.cells;
            
            // Create a fragment to minimize reflows during reordering
            const fragment = document.createDocumentFragment();
            const newCellMap = new Map<string, PooledCell>();

            for (const col of newColumns) {
                let cell = currentCells.get(col.field);

                if (!cell) {
                    // Create new cell if it doesn't exist
                    cell = this._createCell(col);
                } else {
                    // Update width/styles for existing cell (preserves input state)
                    const isPinned = col.cellClass?.includes('pinned');
                    cell.container.style.width = `var(--w-${col.field}, ${col.width || 100}px)`;
                    cell.container.style.position = isPinned ? 'sticky' : 'relative';
                    if (isPinned) {
                        cell.container.style.background = 'white';
                        cell.container.style.zIndex = '100';
                    } else {
                        cell.container.style.zIndex = '';
                        cell.container.style.background = '';
                    }
                }

                newCellMap.set(col.field, cell);
                // Appending to fragment automatically detaches from current parent
                fragment.appendChild(cell.container);
            }

            // Update the row's cell map
            row.cells = newCellMap;
            
            // Clear row content and append the reordered fragment
            // The while loop cleans up any orphaned cells not in new columns
            while (row.element.firstChild) {
                row.element.removeChild(row.element.firstChild);
            }
            row.element.appendChild(fragment);
        }
        
        console.log(`[PoolSystem] ✅ Structure updated: ${this.pool.length} rows, ${newColumns.length} columns`);
    }

    /**
     * Destroy the pool system
     */
    destroy(): void {
        // Remove all DOM elements - no Flatpickr instances to clean up (using shared popup)
        for (const row of this.pool) {
            if (row.element.parentNode) {
                row.element.parentNode.removeChild(row.element);
            }
        }

        this.pool = [];
        this.activeRows.clear();
        this.availableRows = [];
    }
}

