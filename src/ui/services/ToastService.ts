/**
 * @fileoverview Toast notification service
 * @module ui/services/ToastService
 */

import type { ToastType } from '../../types';

/**
 * Toast service options
 */
export interface ToastOptions {
  container?: HTMLElement;
  duration?: number;
}

/**
 * Toast notification service
 * Manages toast messages displayed to the user
 */
export class ToastService {
  private container: HTMLElement;
  private toastElement: HTMLElement | null = null;
  private defaultDuration: number;

  /**
   * @param options - Configuration
   */
  constructor(options: ToastOptions = {}) {
    this.container = options.container || document.body;
    this.defaultDuration = options.duration ?? 3000;
    this._init();
  }

  /**
   * Initialize toast element
   * @private
   */
  private _init(): void {
    // Try to find existing toast element
    this.toastElement = document.getElementById('toast') as HTMLElement | null;
    
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
   * @param message - Message to display
   * @param type - Toast type
   * @param duration - Duration in milliseconds
   */
  show(message: string, type: ToastType = 'info', duration?: number): void {
    if (!this.toastElement) return;

    this.toastElement.textContent = message;
    this.toastElement.className = `toast ${type}`;
    this.toastElement.classList.add('show');

    const hideDuration = duration ?? this.defaultDuration;

    // Auto-hide after duration
    setTimeout(() => {
      this.toastElement?.classList.remove('show');
    }, hideDuration);
  }

  /**
   * Show info toast
   * @param message - Message to display
   * @param duration - Optional duration override
   */
  info(message: string, duration?: number): void {
    this.show(message, 'info', duration);
  }

  /**
   * Show success toast
   * @param message - Message to display
   * @param duration - Optional duration override
   */
  success(message: string, duration?: number): void {
    this.show(message, 'success', duration);
  }

  /**
   * Show error toast
   * @param message - Message to display
   * @param duration - Optional duration override
   */
  error(message: string, duration?: number): void {
    this.show(message, 'error', duration);
  }

  /**
   * Show warning toast
   * @param message - Message to display
   * @param duration - Optional duration override
   */
  warning(message: string, duration?: number): void {
    this.show(message, 'warning', duration);
  }
}
