/**
 * @fileoverview Task Trade Partners Panel
 * @module ui/panels/TaskTradePartnersPanel
 * 
 * Right sidebar panel for viewing/managing trade partners assigned to a task.
 */

import type { TradePartner, Task } from '../../types';

export interface TaskTradePartnersPanelOptions {
  container: HTMLElement;
  onAssign?: (taskId: string, tradePartnerId: string) => void;
  onUnassign?: (taskId: string, tradePartnerId: string) => void;
  getTask: (taskId: string) => Task | undefined;
  getTradePartners: () => TradePartner[];
  getTaskTradePartners: (taskId: string) => TradePartner[];
}

export class TaskTradePartnersPanel {
  private container: HTMLElement;
  private options: TaskTradePartnersPanelOptions;
  private currentTaskId: string | null = null;
  private searchFilter: string = '';

  constructor(options: TaskTradePartnersPanelOptions) {
    this.options = options;
    this.container = options.container;
  }

  /**
   * Get the panel element for attachment to DOM
   */
  public getElement(): HTMLElement {
    return this.container;
  }

  /**
   * Show trade partners for a specific task
   */
  show(taskId: string): void {
    this.currentTaskId = taskId;
    this.searchFilter = '';
    this.render();
  }

  /**
   * Hide the panel and show empty state
   */
  hide(): void {
    this.currentTaskId = null;
    this.searchFilter = '';
    this.showEmptyState();
  }

  /**
   * Show empty state when no task is selected
   */
  public showEmptyState(): void {
    this.currentTaskId = null;
    this.container.innerHTML = `
      <div class="task-trade-partners-panel">
        <div class="panel-header">
          <h3>Trade Partners</h3>
          <p class="panel-subtitle">Select a task to view trade partners</p>
        </div>
        <div class="panel-content">
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <p>Select a task to view and manage trade partners</p>
          </div>
        </div>
      </div>
    `;
  }

  private render(): void {
    if (!this.currentTaskId) {
      this.container.innerHTML = '';
      return;
    }

    const task = this.options.getTask(this.currentTaskId);
    if (!task) {
      this.hide();
      return;
    }

    const assignedPartners = this.options.getTaskTradePartners(this.currentTaskId);
    const allPartners = this.options.getTradePartners();
    const assignedIds = new Set(assignedPartners.map(p => p.id));
    
    // Filter partners based on search
    const filterLower = this.searchFilter.toLowerCase();
    const filteredPartners = allPartners.filter(p => {
      if (!filterLower) return true;
      return p.name.toLowerCase().includes(filterLower) ||
             p.contact?.toLowerCase().includes(filterLower);
    });

    this.container.innerHTML = `
      <div class="task-trade-partners-panel">
        <div class="panel-header">
          <h3>Trade Partners</h3>
          <p class="panel-subtitle">${this.escapeHtml(task.name)}</p>
        </div>
        
        <div class="panel-content">
          <!-- Partner Selection Tree -->
          <div class="panel-section">
            <h4 class="section-title">
              Select Partners
              <span class="badge">${assignedPartners.length}</span>
            </h4>
            
            ${allPartners.length === 0 ? `
              <div class="empty-state">
                <p>No trade partners available. Create one in the Trade Partners directory.</p>
              </div>
            ` : `
              <div class="tp-tree-selector">
                <div class="tp-tree-header">
                  <input type="text" 
                         class="tp-search-input" 
                         id="tp-partner-search" 
                         placeholder="Search trade partners..." 
                         value="${this.escapeAttr(this.searchFilter)}">
                </div>
                <div class="tp-tree-container" id="tp-partner-tree">
                  ${this._renderPartnerTree(filteredPartners, assignedIds)}
                </div>
              </div>
            `}
          </div>

          <!-- Assigned Partners Table -->
          <div class="panel-section">
            <h4 class="section-title">
              Assigned Partners
              <span class="badge">${assignedPartners.length}</span>
            </h4>
            
            ${assignedPartners.length === 0 ? `
              <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <p>No trade partners assigned. Select partners above.</p>
              </div>
            ` : `
              <div class="tp-table-wrapper">
                <table class="tp-table">
                  <thead>
                    <tr>
                      <th>Partner</th>
                      <th style="width: 40px;"></th>
                    </tr>
                  </thead>
                  <tbody id="tp-assigned-body">
                    ${assignedPartners.map((partner, idx) => `
                      <tr data-index="${idx}" data-partner-id="${partner.id}">
                        <td>
                          <div class="tp-partner-cell">
                            <span class="tp-color-badge" style="background-color: ${partner.color};"></span>
                            <div class="tp-partner-info">
                              <span class="tp-partner-name">${this.escapeHtml(partner.name)}</span>
                              ${partner.contact ? `<span class="tp-partner-contact">${this.escapeHtml(partner.contact)}</span>` : ''}
                            </div>
                          </div>
                        </td>
                        <td>
                          <button class="btn-icon btn-danger-icon tp-remove-btn" data-index="${idx}" data-partner-id="${partner.id}" title="Remove">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  /**
   * Render partner selection tree
   * @private
   */
  private _renderPartnerTree(partners: TradePartner[], assignedIds: Set<string>): string {
    if (partners.length === 0) {
      return '<div class="tp-tree-empty">No partners match your search</div>';
    }

    let html = '<div class="tp-tree-list">';
    
    partners.forEach(partner => {
      const isAssigned = assignedIds.has(partner.id);
      html += `
        <div class="tp-tree-item" data-partner-id="${partner.id}">
          <label class="tp-tree-label">
            <input type="checkbox" 
                   class="tp-tree-checkbox" 
                   ${isAssigned ? 'checked' : ''}
                   data-partner-id="${partner.id}">
            <span class="tp-color-badge" style="background-color: ${partner.color};"></span>
            <span class="tp-tree-name">${this.escapeHtml(partner.name)}</span>
            ${partner.contact ? `<span class="tp-tree-contact">${this.escapeHtml(partner.contact)}</span>` : ''}
          </label>
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }

  private setupEventListeners(): void {
    if (!this.currentTaskId) return;

    // Search input
    const searchInput = this.container.querySelector('#tp-partner-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchFilter = (e.target as HTMLInputElement).value;
        this.render();
      });
    }

    // Tree checkboxes - handle assign/unassign
    this.container.querySelectorAll('.tp-tree-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const partnerId = target.dataset.partnerId;
        if (!partnerId || !this.currentTaskId) return;

        if (target.checked) {
          // Assign partner
          this.options.onAssign?.(this.currentTaskId, partnerId);
        } else {
          // Unassign partner
          this.options.onUnassign?.(this.currentTaskId, partnerId);
        }
        
        // Re-render after a short delay to allow state to update
        setTimeout(() => this.render(), 50);
      });
    });

    // Remove buttons in assigned table
    this.container.querySelectorAll('.tp-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partnerId = (e.currentTarget as HTMLElement).dataset.partnerId;
        if (partnerId && this.currentTaskId) {
          this.options.onUnassign?.(this.currentTaskId, partnerId);
          // Re-render after a short delay to allow state to update
          setTimeout(() => this.render(), 50);
        }
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Refresh current display
   */
  refresh(): void {
    if (this.currentTaskId) {
      this.render();
    }
  }

  /**
   * Check if panel is showing a specific task
   */
  isShowing(taskId: string): boolean {
    return this.currentTaskId === taskId;
  }
}

