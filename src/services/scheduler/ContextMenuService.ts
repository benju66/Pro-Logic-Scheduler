/**
 * @fileoverview ContextMenuService - Manages right-click context menus
 * @module services/scheduler/ContextMenuService
 * 
 * Phase 4 of SchedulerService decomposition.
 * Extracts context menu creation and handling from SchedulerService
 * into a focused, single-responsibility service.
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md
 */

import { ContextMenu, type ContextMenuItem } from '../../ui/components/ContextMenu';

// =========================================================================
// TYPES
// =========================================================================

/**
 * Dependencies required by ContextMenuService
 */
export interface ContextMenuServiceDeps {
    /** Insert blank row above a task */
    insertBlankRowAbove: (taskId: string) => void;
    /** Insert blank row below a task */
    insertBlankRowBelow: (taskId: string) => void;
    /** Convert blank row to a task */
    convertBlankToTask: (taskId: string) => void;
    /** Delete a task */
    deleteTask: (taskId: string) => void;
    /** Open properties drawer/panel for a task */
    openProperties: (taskId: string) => void;
}

// =========================================================================
// CONTEXT MENU SERVICE
// =========================================================================

/**
 * ContextMenuService - Manages right-click context menus
 * 
 * This service handles:
 * - Creating and caching the context menu instance
 * - Building menu items based on task state (blank vs regular)
 * - Dispatching menu actions to appropriate handlers
 * 
 * @example
 * ```typescript
 * const contextMenuService = new ContextMenuService({
 *     insertBlankRowAbove: (id) => taskOps.insertBlankRowAbove(id),
 *     insertBlankRowBelow: (id) => taskOps.insertBlankRowBelow(id),
 *     convertBlankToTask: (id) => taskOps.convertBlankToTask(id),
 *     deleteTask: (id) => taskOps.deleteTask(id),
 *     openProperties: (id) => modalCoord.openProperties(id)
 * });
 * 
 * // Show context menu on right-click
 * contextMenuService.showRowContextMenu(taskId, isBlank, anchorEl, event);
 * ```
 */
export class ContextMenuService {
    private deps: ContextMenuServiceDeps;
    
    /** Singleton context menu instance */
    private contextMenu: ContextMenu | null = null;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(deps: ContextMenuServiceDeps) {
        this.deps = deps;
    }

    // =========================================================================
    // CONTEXT MENU MANAGEMENT
    // =========================================================================

    /**
     * Get or create context menu instance
     * @private
     */
    private getContextMenu(): ContextMenu {
        if (!this.contextMenu) {
            this.contextMenu = new ContextMenu();
        }
        return this.contextMenu;
    }

    /**
     * Show context menu for a row
     * 
     * @param taskId - ID of the task that was right-clicked
     * @param isBlank - Whether this is a blank row
     * @param anchorEl - HTML element to anchor the menu to
     * @param _event - Mouse event (currently unused but available for future use)
     */
    showRowContextMenu(taskId: string, isBlank: boolean, anchorEl: HTMLElement, _event: MouseEvent): void {
        const menu = this.getContextMenu();
        
        const items: ContextMenuItem[] = [
            {
                id: 'insert-above',
                label: 'Insert Blank Row Above',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>`,
            },
            {
                id: 'insert-below',
                label: 'Insert Blank Row Below',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>`,
            },
            { id: 'divider-1', type: 'divider' },
        ];
        
        // Convert to Task option only for blank rows
        if (isBlank) {
            items.push({
                id: 'convert-to-task',
                label: 'Convert to Task',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>`,
            });
            items.push({ id: 'divider-2', type: 'divider' });
        }
        
        items.push({
            id: 'delete',
            label: 'Delete Row',
            icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>`,
            danger: true,
        });
        
        items.push({ id: 'divider-3', type: 'divider' });
        
        items.push({
            id: 'properties',
            label: 'Properties...',
            icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>`,
        });
        
        menu.show(anchorEl, items, (itemId) => {
            this.handleMenuAction(taskId, itemId);
        });
    }

    /**
     * Handle context menu action
     * @private
     */
    private handleMenuAction(taskId: string, itemId: string): void {
        switch (itemId) {
            case 'insert-above':
                this.deps.insertBlankRowAbove(taskId);
                break;
            case 'insert-below':
                this.deps.insertBlankRowBelow(taskId);
                break;
            case 'convert-to-task':
                this.deps.convertBlankToTask(taskId);
                break;
            case 'delete':
                this.deps.deleteTask(taskId);
                break;
            case 'properties':
                this.deps.openProperties(taskId);
                break;
        }
    }

    /**
     * Hide the context menu if visible
     */
    hideContextMenu(): void {
        if (this.contextMenu) {
            this.contextMenu.hide();
        }
    }

    /**
     * Dispose of the context menu service
     */
    dispose(): void {
        if (this.contextMenu) {
            this.contextMenu.hide();
            this.contextMenu = null;
        }
    }
}
