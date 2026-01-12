/**
 * ============================================================================
 * ColumnSettingsModal.ts
 * ============================================================================
 * 
 * Modal dialog for managing column visibility, order, and pinning.
 * Allows users to:
 * - Toggle column visibility with checkboxes
 * - Reorder columns via drag-and-drop
 * - Pin/unpin columns for sticky behavior
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import type { ColumnPreferences, GridColumn } from '../../types';

/**
 * Column settings modal options
 */
export interface ColumnSettingsModalOptions {
  container?: HTMLElement;
  onSave?: (preferences: ColumnPreferences) => void;
  getColumns?: () => GridColumn[];
  getPreferences?: () => ColumnPreferences;
}

/**
 * Column settings modal DOM references
 */
interface ColumnSettingsModalDOM {
  columnList: HTMLElement;
  closeBtn: HTMLElement;
  cancelBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
}

export class ColumnSettingsModal {
    
    private options: ColumnSettingsModalOptions;
    private container: HTMLElement;
    private element!: HTMLDialogElement; // Initialized in _buildDOM()
    private dom!: ColumnSettingsModalDOM; // Initialized in _buildDOM()
    private tempPreferences: ColumnPreferences;
    private draggingElement: HTMLElement | null = null;

    /**
     * Create a new ColumnSettingsModal instance
     * 
     * @param options - Configuration options
     */
    constructor(options: ColumnSettingsModalOptions = {}) {
        this.options = options;
        this.container = options.container || document.body;
        
        // Initialize temp preferences from current state
        const currentPrefs = options.getPreferences ? options.getPreferences() : this._getDefaultPreferences();
        this.tempPreferences = JSON.parse(JSON.stringify(currentPrefs)) as ColumnPreferences;
        
        this._buildDOM();
        this._bindEvents();
        this._render();
    }

    /**
     * Build the modal DOM structure
     * @private
     */
    private _buildDOM(): void {
        this.element = document.createElement('dialog');
        this.element.className = 'modal-dialog column-settings-modal';
        this.element.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-header-left">
                        <div class="modal-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                                <line x1="15" y1="3" x2="15" y2="21"/>
                                <line x1="3" y1="9" x2="21" y2="9"/>
                                <line x1="3" y1="15" x2="21" y2="15"/>
                            </svg>
                        </div>
                        <div>
                            <h3 class="modal-title">Column Settings</h3>
                            <p class="modal-subtitle">Customize column visibility, order, and pinning</p>
                        </div>
                    </div>
                    <button class="modal-close" title="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="modal-body">
                    <div class="form-section">
                        <div class="form-label">Drag to reorder, check to show/hide, pin to freeze</div>
                        <ul class="column-list" id="column-list">
                            <!-- Columns will be rendered here -->
                        </ul>
                    </div>
                    
                    <div class="form-hint" style="margin-top: 16px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                        </svg>
                        <span>Pinned columns stay visible when scrolling horizontally. At least one column must be visible.</span>
                    </div>
                </div>
                
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="reset-btn">Reset to Defaults</button>
                    <div style="flex: 1;"></div>
                    <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
                    <button class="btn btn-primary" id="save-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Save Changes
                    </button>
                </div>
            </div>
        `;
        
        this.container.appendChild(this.element);
        
        // Cache DOM references
        const getElement = <T extends HTMLElement>(id: string): T => {
            const el = this.element.querySelector(`#${id}`) as T;
            if (!el) throw new Error(`Element #${id} not found`);
            return el;
        };

        this.dom = {
            columnList: getElement<HTMLElement>('column-list'),
            closeBtn: this.element.querySelector('.modal-close') as HTMLElement,
            cancelBtn: getElement<HTMLButtonElement>('cancel-btn'),
            saveBtn: getElement<HTMLButtonElement>('save-btn'),
            resetBtn: getElement<HTMLButtonElement>('reset-btn'),
        };
    }

    /**
     * Bind event listeners
     * @private
     */
    private _bindEvents(): void {
        // Close buttons
        this.dom.closeBtn.addEventListener('click', () => this.close());
        this.dom.cancelBtn.addEventListener('click', () => this.close());
        
        // Save button
        this.dom.saveBtn.addEventListener('click', () => this._save());
        
        // Reset button
        this.dom.resetBtn.addEventListener('click', () => this._reset());
        
        // Close on backdrop click
        this.element.addEventListener('click', (e: MouseEvent) => {
            if (e.target === this.element) {
                this.close();
            }
        });
        
        // Close on Escape
        this.element.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    /**
     * Render column settings into a container (for use in Settings Modal)
     * v3.0: Allows rendering ColumnSettingsModal content inside Settings Modal
     */
    renderIntoContainer(container: HTMLElement): void {
        const columns = this.options.getColumns ? this.options.getColumns() : [];
        
        // Create column list element
        const list = document.createElement('ul');
        list.className = 'column-list';
        container.innerHTML = '';
        container.appendChild(list);
        
        // Get columns in current order
        const orderedColumns = this.tempPreferences.order
            .map(id => columns.find(col => col.id === id))
            .filter((col): col is GridColumn => col !== undefined)
            .concat(columns.filter(col => !this.tempPreferences.order.includes(col.id)));
        
        orderedColumns.forEach(col => {
            const li = document.createElement('li');
            li.className = 'column-list-item';
            li.setAttribute('data-column-id', col.id);
            li.draggable = true;
            
            const isVisible = this.tempPreferences.visible[col.id] !== false;
            const isPinned = this.tempPreferences.pinned.includes(col.id);
            
            li.innerHTML = `
                <div class="column-item-content">
                    <div class="column-item-handle">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                            <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                            <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                        </svg>
                    </div>
                    <label class="column-item-checkbox">
                        <input type="checkbox" ${isVisible ? 'checked' : ''} data-column-id="${col.id}">
                        <span class="column-item-label">${this._escapeHtml(col.label || col.id)}</span>
                    </label>
                    <button class="btn-icon-only column-item-pin ${isPinned ? 'pinned' : ''}" data-column-id="${col.id}" title="${isPinned ? 'Unpin column' : 'Pin column'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isPinned 
                                ? '<path d="M12 17v5M9 10.76V6a3 3 0 013-3h0a3 3 0 013 3v4.76M9 10.76l-5 5v2.48a2 2 0 002 2h10a2 2 0 002-2v-2.48l-5-5z"/>'
                                : '<path d="M12 17v5M9 10.76V6a3 3 0 013-3h0a3 3 0 013 3v4.76M9 10.76l-5 5v2.48a2 2 0 002 2h10a2 2 0 002-2v-2.48l-5-5z" opacity="0.4"/>'
                            }
                        </svg>
                    </button>
                </div>
            `;
            
            list.appendChild(li);
        });
        
        // Bind events to new elements
        this._bindColumnEventsInContainer(list);
        this._initDragAndDropInContainer(list);
        
        // Add save button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = 'Save Changes';
        saveBtn.style.cssText = 'margin-top: 16px;';
        saveBtn.addEventListener('click', () => {
            this._save();
        });
        container.appendChild(saveBtn);
    }

    /**
     * Bind column events in a container (for Settings Modal integration)
     * @private
     */
    private _bindColumnEventsInContainer(container: HTMLElement): void {
        // Checkbox changes
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e: Event) => {
                const target = e.target as HTMLInputElement;
                const columnId = target.dataset.columnId || '';
                this.tempPreferences.visible[columnId] = target.checked;
            });
        });
        
        // Pin/unpin buttons
        container.querySelectorAll('.column-item-pin').forEach(btn => {
            btn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                
                const columnId = (btn as HTMLElement).getAttribute('data-column-id') || '';
                if (!columnId) return;
                
                if (!this.tempPreferences.visible[columnId]) {
                    return;
                }
                
                const index = this.tempPreferences.pinned.indexOf(columnId);
                if (index > -1) {
                    this.tempPreferences.pinned.splice(index, 1);
                } else {
                    const orderIndex = this.tempPreferences.order.indexOf(columnId);
                    if (orderIndex === -1) {
                        this.tempPreferences.pinned.push(columnId);
                    } else {
                        let insertIndex = this.tempPreferences.pinned.length;
                        for (let i = 0; i < this.tempPreferences.pinned.length; i++) {
                            const pinnedColId = this.tempPreferences.pinned[i];
                            const pinnedOrderIndex = this.tempPreferences.order.indexOf(pinnedColId);
                            if (pinnedOrderIndex > orderIndex) {
                                insertIndex = i;
                                break;
                            }
                        }
                        this.tempPreferences.pinned.splice(insertIndex, 0, columnId);
                    }
                }
                
                // Re-render to update pin icons
                const parentContainer = container.parentElement;
                if (parentContainer) {
                    this.renderIntoContainer(parentContainer);
                }
            });
        });
    }

    /**
     * Initialize drag-and-drop in a container (for Settings Modal integration)
     * @private
     */
    private _initDragAndDropInContainer(container: HTMLElement): void {
        const listEl = (container.querySelector('.column-list') || container) as HTMLElement;
        
        listEl.querySelectorAll('.column-list-item').forEach(item => {
            const itemEl = item as HTMLElement;
            
            itemEl.addEventListener('dragstart', (e: DragEvent) => {
                if (!e.dataTransfer) return;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', itemEl.dataset.columnId || '');
                this.draggingElement = itemEl;
                itemEl.classList.add('dragging');
            });
            
            itemEl.addEventListener('dragend', () => {
                itemEl.classList.remove('dragging');
                this.draggingElement = null;
                listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            });
        });
        
        listEl.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            if (!this.draggingElement) return;
            
            const afterElement = this._getDragAfterElement(listEl, e.clientY);
            listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            
            if (afterElement && afterElement !== this.draggingElement) {
                afterElement.classList.add('drag-over');
                listEl.insertBefore(this.draggingElement, afterElement);
            } else if (!afterElement) {
                listEl.appendChild(this.draggingElement);
            }
        });
        
        listEl.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            this._updateOrderFromDOMInContainer(listEl);
            listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    }

    /**
     * Update order from DOM in a container
     * @private
     */
    private _updateOrderFromDOMInContainer(container: HTMLElement): void {
        const items = container.querySelectorAll('.column-list-item');
        const newOrder = Array.from(items).map(item => item.getAttribute('data-column-id') || '');
        this.tempPreferences.order = newOrder;
    }

    /**
     * Render the column list
     * @private
     */
    private _render(): void {
        const columns = this.options.getColumns ? this.options.getColumns() : [];
        const list = this.dom.columnList;
        
        list.innerHTML = '';
        
        // Get columns in current order
        const orderedColumns = this.tempPreferences.order
            .map(id => columns.find(col => col.id === id))
            .filter((col): col is GridColumn => col !== undefined)
            .concat(columns.filter(col => !this.tempPreferences.order.includes(col.id)));
        
        orderedColumns.forEach(col => {
            const li = document.createElement('li');
            li.className = 'column-list-item';
            li.setAttribute('data-column-id', col.id);
            li.draggable = true;
            
            const isVisible = this.tempPreferences.visible[col.id] !== false;
            const isPinned = this.tempPreferences.pinned.includes(col.id);
            
            li.innerHTML = `
                <div class="column-item-content">
                    <div class="column-item-handle">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
                            <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                            <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                        </svg>
                    </div>
                    <label class="column-item-checkbox">
                        <input type="checkbox" ${isVisible ? 'checked' : ''} data-column-id="${col.id}">
                        <span class="column-item-label">${this._escapeHtml(col.label || col.id)}</span>
                    </label>
                    <button class="btn-icon-only column-item-pin ${isPinned ? 'pinned' : ''}" data-column-id="${col.id}" title="${isPinned ? 'Unpin column' : 'Pin column'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isPinned 
                                ? '<path d="M12 17v5M9 10.76V6a3 3 0 013-3h0a3 3 0 013 3v4.76M9 10.76l-5 5v2.48a2 2 0 002 2h10a2 2 0 002-2v-2.48l-5-5z"/>'
                                : '<path d="M12 17v5M9 10.76V6a3 3 0 013-3h0a3 3 0 013 3v4.76M9 10.76l-5 5v2.48a2 2 0 002 2h10a2 2 0 002-2v-2.48l-5-5z" opacity="0.4"/>'
                            }
                        </svg>
                    </button>
                </div>
            `;
            
            list.appendChild(li);
        });
        
        // Bind events to new elements
        this._bindColumnEvents();
        this._initDragAndDrop();
    }

    /**
     * Bind events to column items
     * @private
     */
    private _bindColumnEvents(): void {
        // Checkbox changes
        this.dom.columnList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e: Event) => {
                const target = e.target as HTMLInputElement;
                const columnId = target.dataset.columnId || '';
                this.tempPreferences.visible[columnId] = target.checked;
            });
        });
        
        // Pin/unpin buttons
        this.dom.columnList.querySelectorAll('.column-item-pin').forEach(btn => {
            btn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                
                // Get column ID from the button itself (more reliable than traversing DOM)
                const columnId = (btn as HTMLElement).getAttribute('data-column-id') || '';
                if (!columnId) return;
                
                // Prevent pinning hidden columns
                if (!this.tempPreferences.visible[columnId]) {
                    // Optionally show a message or just ignore
                    return;
                }
                
                const index = this.tempPreferences.pinned.indexOf(columnId);
                if (index > -1) {
                    // Unpin: remove from array
                    this.tempPreferences.pinned.splice(index, 1);
                } else {
                    // Pin: add in the correct position based on column order
                    // Find where this column appears in the order
                    const orderIndex = this.tempPreferences.order.indexOf(columnId);
                    if (orderIndex === -1) {
                        // Column not in order (shouldn't happen), just push
                        this.tempPreferences.pinned.push(columnId);
                    } else {
                        // Find the correct insertion point: after the last pinned column
                        // that appears before this column in the order
                        let insertIndex = this.tempPreferences.pinned.length;
                        for (let i = 0; i < this.tempPreferences.pinned.length; i++) {
                            const pinnedColId = this.tempPreferences.pinned[i];
                            const pinnedOrderIndex = this.tempPreferences.order.indexOf(pinnedColId);
                            if (pinnedOrderIndex > orderIndex) {
                                insertIndex = i;
                                break;
                            }
                        }
                        this.tempPreferences.pinned.splice(insertIndex, 0, columnId);
                    }
                }
                
                this._render(); // Re-render to update pin icons
            });
        });
    }

    /**
     * Initialize drag-and-drop for column reordering
     * @private
     */
    private _initDragAndDrop(): void {
        const list = this.dom.columnList;
        
        list.querySelectorAll('.column-list-item').forEach(item => {
            const itemEl = item as HTMLElement;
            
            itemEl.addEventListener('dragstart', (e: DragEvent) => {
                // Guard: dataTransfer may be null in edge cases
                if (!e.dataTransfer) return;
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', itemEl.dataset.columnId || '');
                this.draggingElement = itemEl;
                itemEl.classList.add('dragging');
            });
            
            itemEl.addEventListener('dragend', () => {
                itemEl.classList.remove('dragging');
                this.draggingElement = null;
                // Clean up all drag-over indicators
                list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            });
        });
        
        list.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            
            // Guard: dataTransfer may be null in edge cases
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            
            if (!this.draggingElement) return;
            
            const afterElement = this._getDragAfterElement(list, e.clientY);
            
            // Remove all drag-over classes
            list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            
            // Add drag-over to target
            if (afterElement && afterElement !== this.draggingElement) {
                afterElement.classList.add('drag-over');
            }
            
            if (afterElement == null) {
                list.appendChild(this.draggingElement);
            } else if (afterElement !== this.draggingElement) {
                list.insertBefore(this.draggingElement, afterElement);
            }
        });
        
        list.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            this._updateOrderFromDOM();
            // Clean up all drag-over indicators
            list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        
        list.addEventListener('dragleave', () => {
            // Clean up when leaving the list entirely
            list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    }

    /**
     * Get the element after which to insert the dragged element
     * @private
     */
    private _getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
        const draggableElements = [...container.querySelectorAll('.column-list-item:not(.dragging)')] as HTMLElement[];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null }).element;
    }

    /**
     * Update order from DOM
     * @private
     */
    private _updateOrderFromDOM(): void {
        const items = this.dom.columnList.querySelectorAll('.column-list-item');
        const newOrder = Array.from(items).map(item => item.getAttribute('data-column-id') || '');
        this.tempPreferences.order = newOrder;
    }

    /**
     * Reset to default preferences
     * @private
     */
    private _reset(): void {
        this.tempPreferences = this._getDefaultPreferences();
        this._render();
    }

    /**
     * Get default preferences
     * @private
     */
    private _getDefaultPreferences(): ColumnPreferences {
        const columns = this.options.getColumns ? this.options.getColumns() : [];
        return {
            visible: Object.fromEntries(columns.map(col => [col.id, true])),
            order: columns.map(col => col.id),
            pinned: []
        };
    }

    /**
     * Save preferences and close
     * @private
     */
    private _save(): void {
        // Validate: at least one column must be visible
        const visibleCount = Object.values(this.tempPreferences.visible).filter(v => v).length;
        if (visibleCount === 0) {
            alert('At least one column must be visible');
            return;
        }
        
        // Update order from DOM (in case user dragged but didn't drop)
        this._updateOrderFromDOM();
        
        if (this.options.onSave) {
            this.options.onSave(this.tempPreferences);
        }
        this.close();
    }

    /**
     * Escape HTML special characters
     * @private
     */
    private _escapeHtml(str: string): string {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
    }

    /**
     * Open the modal
     */
    open(): void {
        // Refresh preferences from current state
        const currentPrefs = this.options.getPreferences ? this.options.getPreferences() : this._getDefaultPreferences();
        this.tempPreferences = JSON.parse(JSON.stringify(currentPrefs)) as ColumnPreferences;
        this._render();
        
        // Show modal
        this.element.showModal();
    }

    /**
     * Close the modal
     */
    close(): void {
        this.element.close();
    }

    /**
     * Destroy the modal
     */
    destroy(): void {
        this.element.remove();
    }
}

