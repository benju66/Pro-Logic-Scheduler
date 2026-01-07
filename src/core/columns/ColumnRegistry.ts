/**
 * @fileoverview Column Registry - Central Manager for Column System
 * @module core/columns/ColumnRegistry
 * 
 * Singleton registry for column definitions and renderers.
 * Provides a single source of truth for all column-related configuration.
 */

import type { 
    ColumnType, 
    ColumnDefinition, 
    IColumnRenderer,
    ColumnPreferences 
} from './types';

/**
 * Column Registry - Central Manager
 * 
 * Manages:
 * - Column definitions (metadata)
 * - Column renderers (behavior)
 * - Column preferences (user settings)
 * 
 * @example
 * ```typescript
 * const registry = ColumnRegistry.getInstance();
 * 
 * // Register a renderer
 * registry.registerRenderer(new TextRenderer());
 * 
 * // Register column definitions
 * registry.registerColumn({ id: 'name', type: 'text', ... });
 * 
 * // Get renderer for a column
 * const renderer = registry.getRenderer('text');
 * renderer.render(cell, ctx, column);
 * ```
 */
/**
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - getInstance() retained for backward compatibility
 * - Use setInstance() in Composition Root or inject directly
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class ColumnRegistry {
    private static instance: ColumnRegistry | null = null;
    
    /** Registered renderers by type */
    private renderers: Map<ColumnType, IColumnRenderer> = new Map();
    
    /** Registered column definitions by ID */
    private definitions: Map<string, ColumnDefinition> = new Map();
    
    /** Default column order (for new projects) */
    private defaultOrder: string[] = [];
    
    /** Runtime visibility state (for dynamic column visibility like baseline columns) */
    private runtimeVisibility: Map<string, boolean> = new Map();
    
    /**
     * Constructor is public for Pure DI compatibility.
     */
    public constructor() {}
    
    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static getInstance(): ColumnRegistry {
        if (!ColumnRegistry.instance) {
            ColumnRegistry.instance = new ColumnRegistry();
        }
        return ColumnRegistry.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static setInstance(instance: ColumnRegistry): void {
        ColumnRegistry.instance = instance;
    }
    
    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static resetInstance(): void {
        ColumnRegistry.instance = null;
    }
    
    // =========================================================================
    // RENDERER MANAGEMENT
    // =========================================================================
    
    /**
     * Register a renderer for a column type
     * 
     * @param renderer - The renderer instance to register
     * @throws Error if a renderer for this type is already registered
     */
    registerRenderer(renderer: IColumnRenderer): void {
        if (this.renderers.has(renderer.type)) {
            console.warn(`[ColumnRegistry] Renderer for type '${renderer.type}' already registered, replacing`);
        }
        this.renderers.set(renderer.type, renderer);
        console.log(`[ColumnRegistry] Registered renderer: ${renderer.type}`);
    }
    
    /**
     * Get renderer for a column type
     * 
     * @param type - The column type
     * @returns The renderer, or undefined if not found
     */
    getRenderer(type: ColumnType): IColumnRenderer | undefined {
        return this.renderers.get(type);
    }
    
    /**
     * Check if a renderer is registered for a type
     */
    hasRenderer(type: ColumnType): boolean {
        return this.renderers.has(type);
    }
    
    /**
     * Get all registered renderer types
     */
    getRegisteredTypes(): ColumnType[] {
        return Array.from(this.renderers.keys());
    }
    
    // =========================================================================
    // COLUMN DEFINITION MANAGEMENT
    // =========================================================================
    
    /**
     * Register a column definition
     * 
     * @param definition - The column definition to register
     */
    registerColumn(definition: ColumnDefinition): void {
        this.definitions.set(definition.id, definition);
        
        // Add to default order if not already present
        if (!this.defaultOrder.includes(definition.id)) {
            this.defaultOrder.push(definition.id);
        }
    }
    
    /**
     * Register multiple column definitions
     * 
     * @param definitions - Array of column definitions
     */
    registerColumns(definitions: ColumnDefinition[]): void {
        definitions.forEach(def => this.registerColumn(def));
    }
    
    /**
     * Get column definition by ID
     * 
     * @param id - Column ID
     * @returns The column definition, or undefined if not found
     */
    getColumn(id: string): ColumnDefinition | undefined {
        return this.definitions.get(id);
    }
    
    /**
     * Get all registered column definitions (in default order)
     * 
     * @returns Array of column definitions
     */
    getColumns(): ColumnDefinition[] {
        return this.defaultOrder
            .map(id => this.definitions.get(id))
            .filter((def): def is ColumnDefinition => def !== undefined);
    }
    
    /**
     * Get column definitions filtered and ordered by preferences
     * 
     * @param preferences - User column preferences
     * @returns Filtered and ordered column definitions
     */
    getColumnsWithPreferences(preferences: ColumnPreferences): ColumnDefinition[] {
        // Get base columns
        const allColumns = this.getColumns();
        
        // Filter by visibility
        const visible = allColumns.filter(col => {
            const prefVisible = preferences.visible[col.id] !== false;
            // Also respect column's own visibility setting
            if (col.visible !== undefined) {
                return prefVisible && col.visible;
            }
            return prefVisible;
        });
        
        // Sort by order preference
        const ordered = visible.sort((a, b) => {
            const aIndex = preferences.order.indexOf(a.id);
            const bIndex = preferences.order.indexOf(b.id);
            
            // If not in preferences, maintain original order (new columns)
            if (aIndex === -1 && bIndex === -1) return 0;
            if (aIndex === -1) return 1; // New columns go to end
            if (bIndex === -1) return -1;
            
            return aIndex - bIndex;
        });
        
        return ordered;
    }
    
    /**
     * Get default column preferences
     * 
     * @returns Default preferences with all columns visible in default order
     */
    getDefaultPreferences(): ColumnPreferences {
        const columns = this.getColumns();
        return {
            visible: Object.fromEntries(columns.map(col => [col.id, col.visible !== false])),
            order: columns.map(col => col.id),
            pinned: []
        };
    }
    
    // =========================================================================
    // RUNTIME VISIBILITY (for dynamic columns like baseline)
    // =========================================================================
    
    /**
     * Set runtime visibility for a column
     * Used for dynamic visibility changes (e.g., baseline columns)
     * 
     * @param id - Column ID
     * @param visible - Whether the column should be visible
     */
    setColumnVisibility(id: string, visible: boolean): void {
        this.runtimeVisibility.set(id, visible);
    }
    
    /**
     * Get runtime visibility for a column
     * 
     * @param id - Column ID
     * @returns Visibility state, or undefined if not set
     */
    getColumnVisibility(id: string): boolean | undefined {
        return this.runtimeVisibility.get(id);
    }
    
    /**
     * Clear runtime visibility for a column (revert to default)
     * 
     * @param id - Column ID
     */
    clearColumnVisibility(id: string): void {
        this.runtimeVisibility.delete(id);
    }
    
    /**
     * Set visibility for multiple columns at once
     * 
     * @param columnIds - Array of column IDs
     * @param visible - Whether columns should be visible
     */
    setColumnsVisibility(columnIds: string[], visible: boolean): void {
        columnIds.forEach(id => this.runtimeVisibility.set(id, visible));
    }
    
    // =========================================================================
    // GRIDCOLUMN CONVERSION (backward compatibility)
    // =========================================================================
    
    /**
     * Get columns converted to GridColumn format
     * For backward compatibility with existing code that expects GridColumn[]
     * 
     * @param preferences - Optional column preferences to apply
     * @returns Array of GridColumn objects
     */
    getGridColumns(preferences?: ColumnPreferences): import('../../types').GridColumn[] {
        const columns = preferences 
            ? this.getColumnsWithPreferences(preferences)
            : this.getColumns();
        
        return columns.map((def, index) => this._toGridColumn(def, index, columns, preferences));
    }
    
    /**
     * Convert a ColumnDefinition to GridColumn format
     * 
     * @param def - Column definition
     * @param index - Column index (for pinned calculation)
     * @param allColumns - All columns (for pinned offset calculation)
     * @param preferences - Optional preferences (for pinned state)
     * @returns GridColumn object
     */
    private _toGridColumn(
        def: ColumnDefinition, 
        index: number, 
        allColumns: ColumnDefinition[],
        preferences?: ColumnPreferences
    ): import('../../types').GridColumn {
        // Determine effective visibility:
        // 1. Runtime visibility overrides everything
        // 2. Then preferences
        // 3. Then column default
        const runtimeVisible = this.runtimeVisibility.get(def.id);
        const prefVisible = preferences?.visible[def.id];
        const effectiveVisible = runtimeVisible ?? prefVisible ?? def.visible ?? true;
        
        // Build GridColumn
        const gridCol: import('../../types').GridColumn = {
            id: def.id,
            field: def.field as import('../../types').GridColumn['field'],
            label: def.label,
            type: def.type as import('../../types').GridColumn['type'],
            width: def.width,
            editable: def.editable ?? false,
            minWidth: def.minWidth,
            align: def.align,
            readonlyForParent: def.readonlyForParent,
            resizable: def.resizable,
            visible: effectiveVisible,
            headerClass: def.headerClass,
            cellClass: def.cellClass,
            options: def.options,
            showConstraintIcon: def.showConstraintIcon,
            actions: def.actions,
        };
        
        // Apply pinned state if preferences provided
        if (preferences?.pinned?.includes(def.id)) {
            gridCol.headerClass = (gridCol.headerClass || '') + (gridCol.headerClass ? ' ' : '') + 'pinned';
            gridCol.cellClass = (gridCol.cellClass || '') + (gridCol.cellClass ? ' ' : '') + 'pinned';
            
            // Calculate sticky left offset
            const pinnedIndex = allColumns
                .slice(0, index)
                .filter(c => preferences.pinned.includes(c.id))
                .length;
            
            if (pinnedIndex > 0) {
                const precedingPinned = allColumns
                    .slice(0, index)
                    .filter(c => preferences.pinned.includes(c.id));
                const widths = precedingPinned.map(col => `var(--w-${col.field}, ${col.width || 100}px)`);
                (gridCol as any).stickyLeft = `calc(${widths.join(' + ')})`;
            } else {
                (gridCol as any).stickyLeft = '0px';
            }
        }
        
        return gridCol;
    }
    
    // =========================================================================
    // UTILITY
    // =========================================================================
    
    /**
     * Check if the registry is fully configured
     * (all column types have renderers)
     */
    isFullyConfigured(): boolean {
        for (const column of this.definitions.values()) {
            if (!this.renderers.has(column.type)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Get list of column types without renderers (for debugging)
     */
    getMissingRenderers(): ColumnType[] {
        const missing: ColumnType[] = [];
        const seen = new Set<ColumnType>();
        
        for (const column of this.definitions.values()) {
            if (!seen.has(column.type) && !this.renderers.has(column.type)) {
                missing.push(column.type);
                seen.add(column.type);
            }
        }
        
        return missing;
    }
    
    /**
     * Clear all registrations (for testing)
     */
    clear(): void {
        this.renderers.clear();
        this.definitions.clear();
        this.defaultOrder = [];
        this.runtimeVisibility.clear();
    }
    
    /**
     * Get stats for debugging
     */
    getStats(): { renderers: number; columns: number } {
        return {
            renderers: this.renderers.size,
            columns: this.definitions.size
        };
    }
}
