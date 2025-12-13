// @ts-check
/**
 * @fileoverview Toast notification service
 * @module ui/services/ToastService
 */

/**
 * Toast notification service
 * Manages toast messages displayed to the user
 * @class
 */
export class ToastService {
    /**
     * @param {Object} options - Configuration
     * @param {HTMLElement} options.container - Container element for toast
     */
    constructor(options = {}) {
        this.container = options.container || document.body;
        this.toastElement = null;
        this._init();
    }

    /**
     * Initialize toast element
     * @private
     */
    _init() {
        // Try to find existing toast element
        this.toastElement = document.getElementById('toast');
        
        // Create if doesn't exist
        if (!this.toastElement) {
            this.toastElement = document.createElement('div');
            this.toastElement.id = 'toast';
            this.toastElement.className = 'toast';
            this.container.appendChild(this.toastElement);
        }
    }

    /**
     * Show a toast message
     * @param {string} message - Message to display
     * @param {string} type - Toast type: 'info' | 'success' | 'error' | 'warning'
     * @param {number} duration - Duration in milliseconds (default: 3000)
     */
    show(message, type = 'info', duration = 3000) {
        if (!this.toastElement) return;

        this.toastElement.textContent = message;
        this.toastElement.className = `toast ${type}`;
        this.toastElement.classList.add('show');

        // Auto-hide after duration
        setTimeout(() => {
            this.toastElement.classList.remove('show');
        }, duration);
    }

    /**
     * Show info toast
     * @param {string} message - Message to display
     */
    info(message) {
        this.show(message, 'info');
    }

    /**
     * Show success toast
     * @param {string} message - Message to display
     */
    success(message) {
        this.show(message, 'success');
    }

    /**
     * Show error toast
     * @param {string} message - Message to display
     */
    error(message) {
        this.show(message, 'error');
    }

    /**
     * Show warning toast
     * @param {string} message - Message to display
     */
    warning(message) {
        this.show(message, 'warning');
    }
}

