/**
 * @fileoverview Service Container for Column Renderers
 * @module core/columns/ServiceContainer
 * 
 * Provides dependency injection for column renderers.
 * Renderers access services through this container instead of capturing `this`.
 */

import type { Task, Calendar } from '../../types';
import type { RendererServices } from './types';

/**
 * Service Container - Dependency Injection for Renderers
 * 
 * This singleton provides access to services that renderers need,
 * avoiding the problematic `this` capture in inline renderer functions.
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - getInstance() retained for backward compatibility
 * - Use setInstance() in Composition Root or inject directly
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 * 
 * @example
 * ```typescript
 * // In renderer:
 * const services = ServiceContainer.getInstance();
 * const partner = services.getTradePartner(id);
 * ```
 */
export class ServiceContainer implements RendererServices {
    private static instance: ServiceContainer | null = null;
    
    // Service implementations (set during initialization)
    private _getTradePartner: ((id: string) => { id: string; name: string; color: string } | undefined) | null = null;
    private _calculateVariance: ((task: Task) => { start: number | null; finish: number | null }) | null = null;
    private _isEditingCell: ((taskId: string, field: string) => boolean) | null = null;
    private _openDatePicker: ((taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void) | null = null;
    private _onDateChange: ((taskId: string, field: string, value: string) => void) | null = null;
    private _getCalendar: (() => Calendar | null) | null = null;
    private _getVisualRowNumber: ((task: Task) => number | null) | null = null;
    
    /**
     * Constructor is public for Pure DI compatibility.
     */
    public constructor() {}
    
    /**
     * Get singleton instance (lazy initialization)
     */
    static getInstance(): ServiceContainer {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer();
        }
        return ServiceContainer.instance;
    }
    
    /**
     * Set the singleton instance (for testing/DI)
     */
    static setInstance(instance: ServiceContainer): void {
        ServiceContainer.instance = instance;
    }
    
    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        ServiceContainer.instance = null;
    }
    
    // =========================================================================
    // SERVICE REGISTRATION
    // =========================================================================
    
    /**
     * Register the trade partner lookup function
     */
    registerTradePartnerService(fn: (id: string) => { id: string; name: string; color: string } | undefined): void {
        this._getTradePartner = fn;
    }
    
    /**
     * Register the variance calculation function
     */
    registerVarianceService(fn: (task: Task) => { start: number | null; finish: number | null }): void {
        this._calculateVariance = fn;
    }
    
    /**
     * Register the editing state checker
     */
    registerEditingService(fn: (taskId: string, field: string) => boolean): void {
        this._isEditingCell = fn;
    }
    
    /**
     * Register the date picker opener
     */
    registerDatePickerService(
        openFn: (taskId: string, field: string, anchorEl: HTMLElement, currentValue: string) => void,
        changeFn: (taskId: string, field: string, value: string) => void
    ): void {
        this._openDatePicker = openFn;
        this._onDateChange = changeFn;
    }
    
    /**
     * Register the calendar accessor
     */
    registerCalendarService(fn: () => Calendar | null): void {
        this._getCalendar = fn;
    }
    
    /**
     * Register the visual row number accessor
     */
    registerRowNumberService(fn: (task: Task) => number | null): void {
        this._getVisualRowNumber = fn;
    }
    
    // =========================================================================
    // SERVICE ACCESSORS (RendererServices interface)
    // =========================================================================
    
    /**
     * Get trade partner by ID
     */
    getTradePartner(id: string): { id: string; name: string; color: string } | undefined {
        if (!this._getTradePartner) {
            console.warn('[ServiceContainer] TradePartner service not registered');
            return undefined;
        }
        return this._getTradePartner(id);
    }
    
    /**
     * Calculate variance for a task
     */
    calculateVariance(task: Task): { start: number | null; finish: number | null } {
        if (!this._calculateVariance) {
            console.warn('[ServiceContainer] Variance service not registered');
            return { start: null, finish: null };
        }
        return this._calculateVariance(task);
    }
    
    /**
     * Check if a cell is being edited
     */
    isEditingCell(taskId: string, field: string): boolean {
        if (!this._isEditingCell) {
            return false;
        }
        return this._isEditingCell(taskId, field);
    }
    
    /**
     * Open date picker popup
     */
    openDatePicker(taskId: string, field: string, anchorEl: HTMLElement, currentValue: string): void {
        if (!this._openDatePicker) {
            console.warn('[ServiceContainer] DatePicker service not registered');
            return;
        }
        this._openDatePicker(taskId, field, anchorEl, currentValue);
    }
    
    /**
     * Handle date change
     */
    onDateChange(taskId: string, field: string, value: string): void {
        if (!this._onDateChange) {
            console.warn('[ServiceContainer] DateChange service not registered');
            return;
        }
        this._onDateChange(taskId, field, value);
    }
    
    /**
     * Get current calendar
     */
    getCalendar(): Calendar | null {
        if (!this._getCalendar) {
            return null;
        }
        return this._getCalendar();
    }
    
    /**
     * Get visual row number for a task
     */
    getVisualRowNumber(task: Task): number | null {
        if (!this._getVisualRowNumber) {
            return task._visualRowNumber ?? null;
        }
        return this._getVisualRowNumber(task);
    }
    
    // =========================================================================
    // UTILITY
    // =========================================================================
    
    /**
     * Check if all required services are registered
     */
    isFullyConfigured(): boolean {
        return !!(
            this._getTradePartner &&
            this._calculateVariance &&
            this._isEditingCell &&
            this._openDatePicker &&
            this._onDateChange &&
            this._getCalendar
        );
    }
    
    /**
     * Get list of missing services (for debugging)
     */
    getMissingServices(): string[] {
        const missing: string[] = [];
        if (!this._getTradePartner) missing.push('tradePartner');
        if (!this._calculateVariance) missing.push('variance');
        if (!this._isEditingCell) missing.push('editing');
        if (!this._openDatePicker) missing.push('datePicker');
        if (!this._onDateChange) missing.push('dateChange');
        if (!this._getCalendar) missing.push('calendar');
        if (!this._getVisualRowNumber) missing.push('rowNumber');
        return missing;
    }
}
