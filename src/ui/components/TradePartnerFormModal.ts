/**
 * @fileoverview Trade Partner Form Modal
 * @module ui/components/TradePartnerFormModal
 * 
 * Modal dialog for creating/editing trade partners.
 */

import type { TradePartner } from '../../types';

export interface TradePartnerFormModalOptions {
  container?: HTMLElement;
  onSave?: (partner: Omit<TradePartner, 'id'>) => void;
  onUpdate?: (id: string, partner: Partial<TradePartner>) => void;
}

interface TradePartnerFormModalDOM {
  element: HTMLDialogElement;
  nameInput: HTMLInputElement;
  contactInput: HTMLInputElement;
  phoneInput: HTMLInputElement;
  emailInput: HTMLInputElement;
  colorInput: HTMLInputElement;
  notesTextarea: HTMLTextAreaElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
}

export class TradePartnerFormModal {
  private options: TradePartnerFormModalOptions;
  private container: HTMLElement;
  private dom!: TradePartnerFormModalDOM;
  private editingId: string | null = null;

  constructor(options: TradePartnerFormModalOptions = {}) {
    this.options = options;
    this.container = options.container || document.body;
    this._buildDOM();
    this._bindEvents();
  }

  private _buildDOM(): void {
    const element = document.createElement('dialog');
    element.className = 'modal-dialog trade-partner-modal';
    element.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-header-left">
            <div class="modal-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div>
              <h3 class="modal-title">Trade Partner</h3>
              <p class="modal-subtitle">Add or edit trade partner information</p>
            </div>
          </div>
          <button class="modal-close" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="tp-name">Company Name <span class="required">*</span></label>
            <input type="text" id="tp-name" class="form-input" placeholder="Enter company name" required autocomplete="off">
          </div>
          
          <div class="form-group">
            <label class="form-label" for="tp-contact">Contact Person</label>
            <input type="text" id="tp-contact" class="form-input" placeholder="Primary contact name" autocomplete="off">
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="tp-phone">Phone</label>
              <input type="tel" id="tp-phone" class="form-input" placeholder="Phone number" autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label" for="tp-email">Email</label>
              <input type="email" id="tp-email" class="form-input" placeholder="Email address" autocomplete="off">
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="tp-color">Color</label>
            <div class="color-picker-row">
              <input type="color" id="tp-color" class="form-input color-input" value="#3B82F6" autocomplete="off">
              <span class="color-preview" id="tp-color-preview" style="background-color: #3B82F6;"></span>
              <span class="color-preview-label">Display color for this trade partner</span>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="tp-notes">Notes</label>
            <textarea id="tp-notes" class="form-input form-textarea" rows="4" placeholder="Additional notes..." autocomplete="off"></textarea>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" id="tp-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="tp-save-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            Save
          </button>
        </div>
      </div>
    `;
    
    this.container.appendChild(element);
    
    this.dom = {
      element,
      nameInput: element.querySelector('#tp-name') as HTMLInputElement,
      contactInput: element.querySelector('#tp-contact') as HTMLInputElement,
      phoneInput: element.querySelector('#tp-phone') as HTMLInputElement,
      emailInput: element.querySelector('#tp-email') as HTMLInputElement,
      colorInput: element.querySelector('#tp-color') as HTMLInputElement,
      notesTextarea: element.querySelector('#tp-notes') as HTMLTextAreaElement,
      saveBtn: element.querySelector('#tp-save-btn') as HTMLButtonElement,
      cancelBtn: element.querySelector('#tp-cancel-btn') as HTMLButtonElement,
    };
  }

  private _bindEvents(): void {
    // Color preview update
    this.dom.colorInput.addEventListener('input', () => {
      const preview = this.dom.element.querySelector('#tp-color-preview') as HTMLElement;
      if (preview) {
        preview.style.backgroundColor = this.dom.colorInput.value;
      }
    });

    // Save button
    this.dom.saveBtn.addEventListener('click', () => this._handleSave());

    // Cancel button and close button
    const closeHandler = () => this.close();
    this.dom.cancelBtn.addEventListener('click', closeHandler);
    this.dom.element.querySelector('.modal-close')?.addEventListener('click', closeHandler);

    // Close on backdrop click
    this.dom.element.addEventListener('click', (e) => {
      if (e.target === this.dom.element) {
        this.close();
      }
    });

    // Keyboard shortcuts - stop propagation to prevent global handlers from interfering
    this.dom.element.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      
      // If focus is in an input or textarea, allow normal input behavior
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // Only handle Ctrl+Enter to save from within inputs
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation(); // Prevent global handlers
          this._handleSave();
          return;
        }
        // For all other keys (Tab, Backspace, Delete, etc.), stop propagation
        // to prevent global KeyboardService from interfering
        e.stopPropagation();
        return;
      }
      
      // For non-input elements (buttons, dialog backdrop, etc.), handle shortcuts
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        this._handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Prevent global Escape handlers
        this.close();
      } else {
        // For other keys (Tab, etc.), stop propagation to prevent global handlers
        // but don't prevent default so normal behavior works
        e.stopPropagation();
      }
    }, true); // Use capture phase to intercept before global handlers
  }

  private _handleSave(): void {
    const name = this.dom.nameInput.value.trim();
    if (!name) {
      alert('Company name is required');
      this.dom.nameInput.focus();
      return;
    }

    const partnerData: Omit<TradePartner, 'id'> = {
      name,
      contact: this.dom.contactInput.value.trim() || undefined,
      phone: this.dom.phoneInput.value.trim() || undefined,
      email: this.dom.emailInput.value.trim() || undefined,
      color: this.dom.colorInput.value,
      notes: this.dom.notesTextarea.value.trim() || undefined,
    };

    if (this.editingId) {
      this.options.onUpdate?.(this.editingId, partnerData);
    } else {
      this.options.onSave?.(partnerData);
    }

    this.close();
  }

  /**
   * Open modal for creating a new trade partner
   */
  openForCreate(): void {
    this.editingId = null;
    this.dom.nameInput.value = '';
    this.dom.contactInput.value = '';
    this.dom.phoneInput.value = '';
    this.dom.emailInput.value = '';
    this.dom.colorInput.value = '#3B82F6';
    this.dom.notesTextarea.value = '';
    
    const preview = this.dom.element.querySelector('#tp-color-preview') as HTMLElement;
    if (preview) {
      preview.style.backgroundColor = '#3B82F6';
    }

    this.dom.element.querySelector('.modal-title')!.textContent = 'New Trade Partner';
    this.dom.element.showModal();
    this.dom.nameInput.focus();
  }

  /**
   * Open modal for editing an existing trade partner
   */
  openForEdit(partner: TradePartner): void {
    this.editingId = partner.id;
    this.dom.nameInput.value = partner.name;
    this.dom.contactInput.value = partner.contact || '';
    this.dom.phoneInput.value = partner.phone || '';
    this.dom.emailInput.value = partner.email || '';
    this.dom.colorInput.value = partner.color;
    this.dom.notesTextarea.value = partner.notes || '';
    
    const preview = this.dom.element.querySelector('#tp-color-preview') as HTMLElement;
    if (preview) {
      preview.style.backgroundColor = partner.color;
    }

    this.dom.element.querySelector('.modal-title')!.textContent = 'Edit Trade Partner';
    this.dom.element.showModal();
    this.dom.nameInput.focus();
  }

  /**
   * Close the modal
   */
  close(): void {
    this.dom.element.close();
    this.editingId = null;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.dom.element.remove();
  }
}

