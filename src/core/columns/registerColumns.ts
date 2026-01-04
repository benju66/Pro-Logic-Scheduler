/**
 * @fileoverview Column Registration
 * @module core/columns/registerColumns
 * 
 * Registers all default renderers and column definitions.
 */

import { ColumnRegistry } from './ColumnRegistry';
import { ServiceContainer } from './ServiceContainer';

// Import all renderers
import { TextRenderer } from './renderers/TextRenderer';
import { NumberRenderer } from './renderers/NumberRenderer';
import { ReadonlyRenderer } from './renderers/ReadonlyRenderer';
import { CheckboxRenderer } from './renderers/CheckboxRenderer';
import { DragRenderer } from './renderers/DragRenderer';
import { SelectRenderer } from './renderers/SelectRenderer';
import { ActionsRenderer } from './renderers/ActionsRenderer';
import { RowNumberRenderer } from './renderers/RowNumberRenderer';
import { DateRenderer } from './renderers/DateRenderer';
import { NameRenderer } from './renderers/NameRenderer';
import { SchedulingModeRenderer } from './renderers/SchedulingModeRenderer';
import { HealthRenderer } from './renderers/HealthRenderer';
import { TradePartnersRenderer } from './renderers/TradePartnersRenderer';
import { VarianceRenderer } from './renderers/VarianceRenderer';

// Import column definitions
import { DEFAULT_COLUMNS } from './definitions/defaultColumns';

/**
 * Register all default renderers
 * Call this once during app initialization
 */
export function registerDefaultRenderers(): void {
    const registry = ColumnRegistry.getInstance();
    
    console.log('[ColumnRegistry] Registering default renderers...');
    
    // Simple renderers
    registry.registerRenderer(new TextRenderer());
    registry.registerRenderer(new NumberRenderer());
    registry.registerRenderer(new ReadonlyRenderer());
    registry.registerRenderer(new CheckboxRenderer());
    registry.registerRenderer(new DragRenderer());
    
    // Medium renderers
    registry.registerRenderer(new SelectRenderer());
    registry.registerRenderer(new ActionsRenderer());
    registry.registerRenderer(new RowNumberRenderer());
    
    // Complex renderers
    registry.registerRenderer(new DateRenderer());
    registry.registerRenderer(new NameRenderer());
    registry.registerRenderer(new SchedulingModeRenderer());
    
    // DI-based renderers
    registry.registerRenderer(new HealthRenderer());
    registry.registerRenderer(new TradePartnersRenderer());
    registry.registerRenderer(new VarianceRenderer());
    
    console.log(`[ColumnRegistry] Registered ${registry.getRegisteredTypes().length} renderers`);
}

/**
 * Register all default column definitions
 * Call this once during app initialization
 */
export function registerDefaultColumns(): void {
    const registry = ColumnRegistry.getInstance();
    
    console.log('[ColumnRegistry] Registering default columns...');
    
    registry.registerColumns(DEFAULT_COLUMNS);
    
    console.log(`[ColumnRegistry] Registered ${registry.getStats().columns} columns`);
}

/**
 * Configure service container with app services
 * Call this after services are available
 */
export function configureServices(options: {
    getTradePartner: (id: string) => { id: string; name: string; color: string } | undefined;
    calculateVariance: (task: import('../../types').Task) => { start: number | null; finish: number | null };
    isEditingCell: (taskId: string, field: string) => boolean;
    openDatePicker: (taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void;
    onDateChange: (taskId: string, field: string, value: string) => void;
    getCalendar: () => import('../../types').Calendar | null;
    getVisualRowNumber?: (task: import('../../types').Task) => number | null;
}): void {
    const services = ServiceContainer.getInstance();
    
    console.log('[ServiceContainer] Configuring services...');
    
    services.registerTradePartnerService(options.getTradePartner);
    services.registerVarianceService(options.calculateVariance);
    services.registerEditingService(options.isEditingCell);
    services.registerDatePickerService(options.openDatePicker, options.onDateChange);
    services.registerCalendarService(options.getCalendar);
    
    if (options.getVisualRowNumber) {
        services.registerRowNumberService(options.getVisualRowNumber);
    }
    
    const missing = services.getMissingServices();
    if (missing.length > 0) {
        console.warn('[ServiceContainer] Missing services:', missing);
    } else {
        console.log('[ServiceContainer] All services configured');
    }
}

/**
 * Initialize the entire column system
 * Convenience function that registers everything
 */
export function initializeColumnSystem(): void {
    registerDefaultRenderers();
    registerDefaultColumns();
    
    const registry = ColumnRegistry.getInstance();
    const stats = registry.getStats();
    
    console.log(`[ColumnSystem] Initialized: ${stats.renderers} renderers, ${stats.columns} columns`);
    
    // Check for missing renderers
    const missing = registry.getMissingRenderers();
    if (missing.length > 0) {
        console.warn('[ColumnSystem] Missing renderers for types:', missing);
    }
}
