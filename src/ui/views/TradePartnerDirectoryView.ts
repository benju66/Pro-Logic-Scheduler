/**
 * @fileoverview Trade Partner Directory View
 * @module ui/views/TradePartnerDirectoryView
 * 
 * Main view for managing trade partners (CRUD operations).
 * Accessible from the left activity bar.
 */

import type { TradePartner } from '../../types';
import { TradePartnerFormModal } from '../components/TradePartnerFormModal';

export interface TradePartnerDirectoryOptions {
  container: HTMLElement;
  onSelect?: (partnerId: string) => void;
  onCreate?: (data: Omit<TradePartner, 'id'>) => TradePartner;
  onUpdate?: (id: string, field: keyof TradePartner, value: unknown) => void;
  onDelete?: (id: string) => void;
  getPartners: () => TradePartner[];
}

export class TradePartnerDirectoryView {
  private container: HTMLElement;
  private options: TradePartnerDirectoryOptions;
  private listContainer: HTMLElement | null = null;
  private selectedId: string | null = null;
  private formModal: TradePartnerFormModal;

  constructor(options: TradePartnerDirectoryOptions) {
    this.options = options;
    this.container = options.container;
    
    // Initialize form modal
    this.formModal = new TradePartnerFormModal({
      container: document.body,
      onSave: (data) => {
        const partner = this.options.onCreate?.(data);
        if (partner) {
          this.renderList();
          this.handleSelect(partner.id);
          // Details will be rendered by handleSelect
        }
      },
      onUpdate: (id, data) => {
        // Update each field individually
        Object.entries(data).forEach(([field, value]) => {
          this.options.onUpdate?.(id, field as keyof TradePartner, value);
        });
        this.renderList();
        // Refresh details if this is the selected partner
        if (this.selectedId === id) {
          this.renderDetails(id);
        }
      },
    });
    
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="trade-directory">
        <div class="trade-directory-sidebar">
          <div class="trade-directory-header">
            <h2>Trade Partners</h2>
            <button class="btn-add-trade" title="Add Trade Partner">
              <span class="material-icons">add</span>
            </button>
          </div>
          <div class="trade-directory-search">
            <input type="text" placeholder="Search trade partners..." class="trade-search-input">
          </div>
          <div class="trade-directory-list"></div>
        </div>
        <div class="trade-directory-main">
          <div class="trade-directory-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <h3>Select a trade partner</h3>
            <p>Choose a trade partner from the list to view and edit details</p>
          </div>
        </div>
      </div>
    `;

    this.listContainer = this.container.querySelector('.trade-directory-list');
    this.setupEventListeners();
    this.renderList();
  }

  private setupEventListeners(): void {
    // Add button
    const addBtn = this.container.querySelector('.btn-add-trade');
    addBtn?.addEventListener('click', () => this.handleAdd());

    // Search input
    const searchInput = this.container.querySelector('.trade-search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.renderList((e.target as HTMLInputElement).value);
    });

    // List delegation
    this.listContainer?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest('.trade-item') as HTMLElement;
      
      if (!item) return;
      
      const partnerId = item.dataset.partnerId;
      if (!partnerId) return;

      // Delete button
      if (target.closest('.btn-delete-trade')) {
        e.stopPropagation();
        this.handleDelete(partnerId);
        return;
      }

      // Edit button (double-click or right-click could also trigger edit)
      if (target.closest('.btn-edit-trade')) {
        e.stopPropagation();
        const partner = this.options.getPartners().find(p => p.id === partnerId);
        if (partner) {
          this.formModal.openForEdit(partner);
        }
        return;
      }

      // Select item
      this.handleSelect(partnerId);
    });
  }

  private renderList(filter = ''): void {
    if (!this.listContainer) return;

    const partners = this.options.getPartners();
    const filtered = filter
      ? partners.filter(p => 
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          p.contact?.toLowerCase().includes(filter.toLowerCase())
        )
      : partners;

    if (filtered.length === 0) {
      this.listContainer.innerHTML = `
        <div class="trade-empty">
          ${filter ? 'No matches found' : 'No trade partners yet. Click + to add one.'}
        </div>
      `;
      return;
    }

    this.listContainer.innerHTML = filtered.map(partner => `
      <div class="trade-item ${this.selectedId === partner.id ? 'selected' : ''}" 
           data-partner-id="${partner.id}">
        <div class="trade-item-color" style="background-color: ${partner.color}"></div>
        <div class="trade-item-info">
          <div class="trade-item-name">${this.escapeHtml(partner.name)}</div>
          ${partner.contact ? `<div class="trade-item-contact">${this.escapeHtml(partner.contact)}</div>` : ''}
        </div>
        <div class="trade-item-actions">
          <button class="btn-edit-trade" title="Edit" data-partner-id="${partner.id}">
            <span class="material-icons">edit</span>
          </button>
          <button class="btn-delete-trade" title="Delete" data-partner-id="${partner.id}">
            <span class="material-icons">delete</span>
          </button>
        </div>
      </div>
    `).join('');
  }

  private handleAdd(): void {
    this.formModal.openForCreate();
  }

  private handleSelect(partnerId: string): void {
    this.selectedId = partnerId;
    this.renderList();
    this.renderDetails(partnerId);
    this.options.onSelect?.(partnerId);
  }

  private renderDetails(partnerId: string): void {
    const mainArea = this.container.querySelector('.trade-directory-main');
    if (!mainArea) return;

    const partner = this.options.getPartners().find(p => p.id === partnerId);
    if (!partner) {
      mainArea.innerHTML = `
        <div class="trade-directory-empty">
          <p>Trade partner not found</p>
        </div>
      `;
      return;
    }

    mainArea.innerHTML = `
      <div class="trade-partner-details-view">
        <div class="details-header">
          <div class="details-header-left">
            <div class="partner-color-badge" style="background-color: ${partner.color};"></div>
            <div>
              <h2>${this.escapeHtml(partner.name)}</h2>
              ${partner.contact ? `<p class="partner-subtitle">${this.escapeHtml(partner.contact)}</p>` : ''}
            </div>
          </div>
          <button class="btn-edit-partner" data-partner-id="${partner.id}" title="Edit">
            <span class="material-icons">edit</span>
          </button>
        </div>
        
        <div class="details-content">
          <div class="details-section">
            <h3>Contact Information</h3>
            <div class="details-grid">
              ${partner.phone ? `
                <div class="detail-item">
                  <label>Phone</label>
                  <div class="detail-value">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    <a href="tel:${this.escapeAttr(partner.phone)}">${this.escapeHtml(partner.phone)}</a>
                  </div>
                </div>
              ` : ''}
              ${partner.email ? `
                <div class="detail-item">
                  <label>Email</label>
                  <div class="detail-value">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <a href="mailto:${this.escapeAttr(partner.email)}">${this.escapeHtml(partner.email)}</a>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          ${partner.notes ? `
            <div class="details-section">
              <h3>Notes</h3>
              <div class="notes-content">${this.escapeHtml(partner.notes).replace(/\n/g, '<br>')}</div>
            </div>
          ` : ''}

          <div class="details-section">
            <h3>Assigned Tasks</h3>
            <div class="assigned-tasks-info">
              <p class="info-text">Task assignments are managed from the schedule view.</p>
              <p class="info-text">Select a task and use the Trade Partners panel to assign this partner.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Setup edit button
    const editBtn = mainArea.querySelector('.btn-edit-partner');
    editBtn?.addEventListener('click', () => {
      this.formModal.openForEdit(partner);
    });
  }

  private handleDelete(partnerId: string): void {
    const partner = this.options.getPartners().find(p => p.id === partnerId);
    if (!partner) return;

    if (confirm(`Delete "${partner.name}"? This will remove it from all assigned tasks.`)) {
      const wasSelected = this.selectedId === partnerId;
      
      this.options.onDelete?.(partnerId);
      
      if (wasSelected) {
        this.selectedId = null;
        // Clear the details view
        const mainArea = this.container.querySelector('.trade-directory-main');
        if (mainArea) {
          mainArea.innerHTML = `
            <div class="trade-directory-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <h3>Select a trade partner</h3>
              <p>Choose a trade partner from the list to view and edit details</p>
            </div>
          `;
        }
      }
      
      this.renderList();
    }
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
   * Refresh the list (call after external changes)
   */
  refresh(): void {
    this.renderList();
    if (this.selectedId) {
      this.renderDetails(this.selectedId);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.container.innerHTML = '';
    this.formModal.destroy();
  }
}

