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

  constructor(options: TaskTradePartnersPanelOptions) {
    this.options = options;
    this.container = options.container;
  }

  /**
   * Show trade partners for a specific task
   */
  show(taskId: string): void {
    this.currentTaskId = taskId;
    this.render();
    this.container.classList.add('visible');
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.container.classList.remove('visible');
    this.currentTaskId = null;
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
    const unassignedPartners = allPartners.filter(
      p => !assignedPartners.some(ap => ap.id === p.id)
    );

    this.container.innerHTML = `
      <div class="task-trade-partners-panel">
        <div class="panel-header">
          <h3>Trade Partners</h3>
          <p class="panel-subtitle">${this.escapeHtml(task.name)}</p>
        </div>
        
        <div class="panel-content">
          <!-- Assigned Partners -->
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
                <p>No trade partners assigned</p>
              </div>
            ` : `
              <div class="assigned-partners-list">
                ${assignedPartners.map(partner => `
                  <div class="assigned-partner-item" data-partner-id="${partner.id}">
                    <div class="partner-chip" style="background-color: ${partner.color}20; border-color: ${partner.color};">
                      <span class="partner-color-dot" style="background-color: ${partner.color};"></span>
                      <span class="partner-name">${this.escapeHtml(partner.name)}</span>
                      ${partner.contact ? `<span class="partner-contact">${this.escapeHtml(partner.contact)}</span>` : ''}
                    </div>
                    <button class="btn-unassign" title="Unassign" data-partner-id="${partner.id}">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Assign New Partner -->
          ${unassignedPartners.length > 0 ? `
            <div class="panel-section">
              <h4 class="section-title">Assign Partner</h4>
              <div class="unassigned-partners-list">
                ${unassignedPartners.map(partner => `
                  <button class="partner-assign-btn" data-partner-id="${partner.id}">
                    <span class="partner-color-dot" style="background-color: ${partner.color};"></span>
                    <span class="partner-name">${this.escapeHtml(partner.name)}</span>
                    ${partner.contact ? `<span class="partner-contact">${this.escapeHtml(partner.contact)}</span>` : ''}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : allPartners.length === 0 ? `
            <div class="panel-section">
              <div class="empty-state">
                <p>No trade partners available. Create one in the Trade Partners directory.</p>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.currentTaskId) return;

    // Unassign buttons
    this.container.querySelectorAll('.btn-unassign').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partnerId = (e.currentTarget as HTMLElement).dataset.partnerId;
        if (partnerId && this.currentTaskId) {
          this.options.onUnassign?.(this.currentTaskId, partnerId);
          // Re-render after a short delay to allow state to update
          setTimeout(() => this.render(), 50);
        }
      });
    });

    // Assign buttons
    this.container.querySelectorAll('.partner-assign-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partnerId = (e.currentTarget as HTMLElement).dataset.partnerId;
        if (partnerId && this.currentTaskId) {
          this.options.onAssign?.(this.currentTaskId, partnerId);
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

