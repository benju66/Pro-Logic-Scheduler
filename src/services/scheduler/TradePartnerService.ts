/**
 * @fileoverview TradePartnerService - Trade partner CRUD and task assignment
 * @module services/scheduler/TradePartnerService
 * 
 * Phase 8 of SchedulerService decomposition.
 * Extracts trade partner operations from SchedulerService into a focused,
 * single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import type { TradePartner } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { TradePartnerStore } from '../../data/TradePartnerStore';
import type { PersistenceService } from '../../data/PersistenceService';
import type { ToastService } from '../../ui/services/ToastService';
import type { ViewCoordinator } from '../migration/ViewCoordinator';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by TradePartnerService
 */
export interface TradePartnerServiceDeps {
    /** ProjectController for task data access */
    projectController: ProjectController;
    /** TradePartnerStore for trade partner data */
    tradePartnerStore: TradePartnerStore;
    /** PersistenceService for database operations (optional) */
    persistenceService: PersistenceService | null;
    /** ToastService for user notifications */
    toastService: ToastService;
    /** ViewCoordinator for reactive rendering */
    viewCoordinator: ViewCoordinator | null;
    /** Notify data change listeners */
    notifyDataChange: () => void;
}

// =========================================================================
// TRADE PARTNER SERVICE
// =========================================================================

/**
 * TradePartnerService - Handles trade partner CRUD and task assignment
 * 
 * This service handles:
 * - Getting all trade partners
 * - Getting a specific trade partner
 * - Creating new trade partners
 * - Updating trade partner fields
 * - Deleting trade partners
 * - Assigning trade partners to tasks
 * - Unassigning trade partners from tasks
 * - Getting trade partners for a task
 * - Handling trade partner click events
 * 
 * @example
 * ```typescript
 * const tradePartnerService = new TradePartnerService({
 *     projectController,
 *     tradePartnerStore,
 *     persistenceService,
 *     toastService,
 *     viewCoordinator,
 *     notifyDataChange: () => scheduler._notifyDataChange()
 * });
 * 
 * // Create a trade partner
 * const partner = tradePartnerService.create({ name: 'Acme Inc' });
 * 
 * // Assign to a task
 * tradePartnerService.assignToTask(taskId, partner.id);
 * ```
 */
export class TradePartnerService {
    private deps: TradePartnerServiceDeps;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: TradePartnerServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // READ OPERATIONS
    // =========================================================================

    /**
     * Get all trade partners
     * @returns Array of all trade partners
     */
    getAll(): TradePartner[] {
        return this.deps.tradePartnerStore.getAll();
    }

    /**
     * Get a trade partner by ID
     * @param id - Trade partner ID
     * @returns Trade partner or undefined
     */
    get(id: string): TradePartner | undefined {
        return this.deps.tradePartnerStore.get(id);
    }

    /**
     * Get trade partners for a task
     * @param taskId - Task ID
     * @returns Array of trade partners assigned to the task
     */
    getForTask(taskId: string): TradePartner[] {
        const task = this.deps.projectController.getTaskById(taskId);
        if (!task?.tradePartnerIds) return [];
        return this.deps.tradePartnerStore.getMany(task.tradePartnerIds);
    }

    // =========================================================================
    // CRUD OPERATIONS
    // =========================================================================

    /**
     * Create a new trade partner
     * @param data - Trade partner data (without id)
     * @returns Created trade partner
     */
    create(data: Omit<TradePartner, 'id'>): TradePartner {
        const partner = this.deps.tradePartnerStore.add(data);
        
        // Queue persistence event
        if (this.deps.persistenceService) {
            this.deps.persistenceService.queueEvent('TRADE_PARTNER_CREATED', partner.id, {
                id: partner.id,
                name: partner.name,
                contact: partner.contact,
                phone: partner.phone,
                email: partner.email,
                color: partner.color,
                notes: partner.notes,
            });
        }
        
        this.deps.toastService.success(`Created trade partner: ${partner.name}`);
        
        // Notify data change listeners (for unified panel sync)
        this.deps.notifyDataChange();
        
        return partner;
    }

    /**
     * Update a trade partner field
     * @param id - Trade partner ID
     * @param field - Field to update
     * @param value - New value
     */
    update(id: string, field: keyof TradePartner, value: unknown): void {
        const existing = this.deps.tradePartnerStore.get(id);
        if (!existing) return;
        
        const oldValue = existing[field];
        this.deps.tradePartnerStore.update(id, { [field]: value });
        
        // Queue persistence event
        if (this.deps.persistenceService) {
            this.deps.persistenceService.queueEvent('TRADE_PARTNER_UPDATED', id, {
                field,
                old_value: oldValue,
                new_value: value,
            });
        }
        
        // Re-render if color changed (affects task display)
        if (field === 'color' || field === 'name') {
            this.deps.viewCoordinator?.forceUpdate();
        }
        
        // Notify data change listeners (for unified panel sync)
        this.deps.notifyDataChange();
    }

    /**
     * Delete a trade partner
     * @param id - Trade partner ID
     */
    delete(id: string): void {
        const partner = this.deps.tradePartnerStore.get(id);
        if (!partner) return;
        
        // Remove from all tasks first
        const affectedTasks = this.deps.projectController.getTasks().filter(
            t => t.tradePartnerIds?.includes(id)
        );
        
        for (const task of affectedTasks) {
            this.unassignFromTask(task.id, id, false); // Don't show toast for each
        }
        
        // Delete the partner
        this.deps.tradePartnerStore.delete(id);
        
        // Queue persistence event
        if (this.deps.persistenceService) {
            this.deps.persistenceService.queueEvent('TRADE_PARTNER_DELETED', id, {
                name: partner.name,
            });
        }
        
        this.deps.toastService.info(`Deleted trade partner: ${partner.name}`);
        this.deps.viewCoordinator?.forceUpdate();
    }

    // =========================================================================
    // TASK ASSIGNMENT OPERATIONS
    // =========================================================================

    /**
     * Assign a trade partner to a task
     * @param taskId - Task ID
     * @param tradePartnerId - Trade partner ID
     */
    assignToTask(taskId: string, tradePartnerId: string): void {
        const task = this.deps.projectController.getTaskById(taskId);
        const partner = this.deps.tradePartnerStore.get(tradePartnerId);
        if (!task || !partner) return;
        
        // Check if already assigned
        if (task.tradePartnerIds?.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = [...(task.tradePartnerIds || []), tradePartnerId];
        this.deps.projectController.updateTask(taskId, { tradePartnerIds: newIds });
        
        // Queue persistence event
        if (this.deps.persistenceService) {
            this.deps.persistenceService.queueEvent('TASK_TRADE_PARTNER_ASSIGNED', taskId, {
                trade_partner_id: tradePartnerId,
                trade_partner_name: partner.name,
            });
        }
        
        this.deps.viewCoordinator?.forceUpdate();
    }

    /**
     * Unassign a trade partner from a task
     * @param taskId - Task ID
     * @param tradePartnerId - Trade partner ID
     * @param showToast - Whether to show a toast notification (default true)
     */
    unassignFromTask(taskId: string, tradePartnerId: string, showToast = true): void {
        const task = this.deps.projectController.getTaskById(taskId);
        if (!task || !task.tradePartnerIds) return;
        
        // Check if assigned
        if (!task.tradePartnerIds.includes(tradePartnerId)) return;
        
        // Update task
        const newIds = task.tradePartnerIds.filter(id => id !== tradePartnerId);
        this.deps.projectController.updateTask(taskId, { tradePartnerIds: newIds });
        
        // Queue persistence event
        if (this.deps.persistenceService) {
            this.deps.persistenceService.queueEvent('TASK_TRADE_PARTNER_UNASSIGNED', taskId, {
                trade_partner_id: tradePartnerId,
            });
        }
        
        if (showToast) {
            this.deps.viewCoordinator?.forceUpdate();
        }
    }

    // =========================================================================
    // EVENT HANDLING
    // =========================================================================

    /**
     * Handle trade partner click event
     * @param taskId - Task ID (unused for now)
     * @param tradePartnerId - Trade partner ID
     * @param e - Click event
     */
    handleClick(_taskId: string, tradePartnerId: string, e: MouseEvent): void {
        e.stopPropagation(); // Prevent row click from firing
        
        // For now, just show a toast - Phase 12 will add details panel
        const partner = this.deps.tradePartnerStore.get(tradePartnerId);
        if (partner) {
            this.deps.toastService.info(`Trade Partner: ${partner.name}`);
        }
        
        // TODO: Phase 12 - Open trade partner details panel
    }
}
