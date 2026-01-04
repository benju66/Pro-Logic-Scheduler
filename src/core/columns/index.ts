/**
 * @fileoverview Column Registry Module Exports
 * @module core/columns
 * 
 * Central export point for the column registry system.
 */

// Types
export type {
    ColumnType,
    ColumnDefinition,
    ColumnContext,
    ColumnConfig,
    ActionDefinition,
    IColumnRenderer,
    RendererServices,
    ColumnPreferences,
} from './types';

// Core classes
export { ColumnRegistry } from './ColumnRegistry';
export { ServiceContainer } from './ServiceContainer';

// Base renderers
export { BaseRenderer, InputRenderer, TextDisplayRenderer } from './renderers/BaseRenderer';

// All renderers
export * from './renderers';

// Column definitions
export { DEFAULT_COLUMNS, BASE_COLUMNS, TRACKING_COLUMNS } from './definitions/defaultColumns';

// Registration functions
export { 
    registerDefaultRenderers, 
    registerDefaultColumns, 
    configureServices,
    initializeColumnSystem 
} from './registerColumns';
