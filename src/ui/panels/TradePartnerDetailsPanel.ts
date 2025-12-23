/**
 * @fileoverview Trade Partner Details Panel
 * @module ui/panels/TradePartnerDetailsPanel
 * 
 * Right sidebar panel for viewing/editing trade partner details.
 */

import type { TradePartner } from '../../types';

export interface TradePartnerDetailsPanelOptions {
  container: HTMLElement;
  onUpdate?: (id: string, field: keyof TradePartner, value: unknown) => void;
  onClose?: () => void;
  getPartner: (id: string) => TradePartner | undefined;
}

export class TradePartnerDetailsPanel {
  private container: HTMLElement;
  private options: TradePartnerDetailsPanelOptions;
  private currentPartnerId: string | null = null;

  constructor(options: TradePartnerDetailsPanelOptions) {
    this.options = options;
    this.container = options.container;
  }

  /**
   * Show details for a specific trade partner
   */
  show(partnerId: string): void {
    this.currentPartnerId = partnerId;
    this.render();
    this.container.classList.add('visible');
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.container.classList.remove('visible');
    this.currentPartnerId = null;
  }

  private render(): void {
    if (!this.currentPartnerId) {
      this.container.innerHTML = '';
      return;
    }

    const partner = this.options.getPartner(this.currentPartnerId);
    if (!partner) {
      this.hide();
      return;
    }

    this.container.innerHTML = `
      <div class="trade-details-panel">
        <div class="trade-details-header">
          <h3>Trade Partner Details</h3>
          <button class="btn-close-panel" title="Close">
            <span class="material-icons">close</span>
          </button>
        </div>
        
        <div class="trade-details-content">
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="trade-input" data-field="name" 
                   value="${this.escapeAttr(partner.name)}">
          </div>
          
          <div class="form-group">
            <label>Contact Person</label>
            <input type="text" class="trade-input" data-field="contact" 
                   value="${this.escapeAttr(partner.contact || '')}">
          </div>
          
          <div class="form-group">
            <label>Phone</label>
            <input type="tel" class="trade-input" data-field="phone" 
                   value="${this.escapeAttr(partner.phone || '')}">
          </div>
          
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="trade-input" data-field="email" 
                   value="${this.escapeAttr(partner.email || '')}">
          </div>
          
          <div class="form-group">
            <label>Color</label>
            <div class="color-picker-row">
              <input type="color" class="trade-color-input" data-field="color" 
                     value="${partner.color}">
              <span class="color-preview" style="background-color: ${partner.color}"></span>
            </div>
          </div>
          
          <div class="form-group">
            <label>Notes</label>
            <textarea class="trade-textarea" data-field="notes" rows="4"
            >${this.escapeAttr(partner.notes || '')}</textarea>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Close button
    const closeBtn = this.container.querySelector('.btn-close-panel');
    closeBtn?.addEventListener('click', () => {
      this.hide();
      this.options.onClose?.();
    });

    // Input changes
    const inputs = this.container.querySelectorAll('.trade-input, .trade-textarea, .trade-color-input');
    inputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement;
        const field = target.dataset.field as keyof TradePartner;
        if (field && this.currentPartnerId) {
          this.options.onUpdate?.(this.currentPartnerId, field, target.value);
          
          // Update color preview if color changed
          if (field === 'color') {
            const preview = this.container.querySelector('.color-preview') as HTMLElement;
            if (preview) {
              preview.style.backgroundColor = target.value;
            }
          }
        }
      });
    });
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
    if (this.currentPartnerId) {
      this.render();
    }
  }

  /**
   * Check if panel is showing a specific partner
   */
  isShowing(partnerId: string): boolean {
    return this.currentPartnerId === partnerId;
  }
}

