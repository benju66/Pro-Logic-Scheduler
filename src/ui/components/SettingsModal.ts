/**
 * @fileoverview Settings Modal Component
 * @module ui/components/SettingsModal
 * 
 * Application settings modal with tabbed navigation.
 * Content sections will be implemented in future updates.
 */

import { ColumnSettingsModal } from './ColumnSettingsModal';

export interface SettingsModalOptions {
    overlay: HTMLElement;
    modal: HTMLElement;
    onClose?: () => void;
    onSettingChange?: (setting: string, value: boolean) => void;
    getScheduler?: () => any; // SchedulerService instance
}

export class SettingsModal {
    private overlay: HTMLElement;
    private modal: HTMLElement;
    private options: SettingsModalOptions;
    private activeSection: string = 'general';
    private isOpen: boolean = false;
    private columnSettingsModal: ColumnSettingsModal | null = null;

    constructor(options: SettingsModalOptions) {
        this.overlay = options.overlay;
        this.modal = options.modal;
        this.options = options;
        this._bindEvents();
    }

    /**
     * Bind event listeners
     */
    private _bindEvents(): void {
        // Close button
        this.modal.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            
            // Close button
            if (target.closest('[data-action="close-settings"]')) {
                this.close();
                return;
            }

            // Section navigation
            const navBtn = target.closest('.settings-nav-btn') as HTMLButtonElement | null;
            if (navBtn) {
                const section = navBtn.dataset.settingsSection;
                if (section) {
                    this._setActiveSection(section);
                }
            }
        });

        // Click overlay to close
        this.overlay.addEventListener('click', (e: MouseEvent) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });

        // Escape key to close
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        // Settings toggles
        const highlightDepsToggle = this.modal.querySelector('#setting-highlight-deps') as HTMLInputElement;
        if (highlightDepsToggle) {
            highlightDepsToggle.addEventListener('change', () => {
                this.options.onSettingChange?.('highlightDependenciesOnHover', highlightDepsToggle.checked);
            });
        }
    }

    /**
     * Set active settings section
     */
    private _setActiveSection(section: string): void {
        if (section === this.activeSection) return;

        // Update nav buttons
        const navButtons = this.modal.querySelectorAll('.settings-nav-btn');
        navButtons.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-settings-section') === section);
        });

        // Update content sections
        const sections = this.modal.querySelectorAll('.settings-section');
        sections.forEach(sec => {
            sec.classList.toggle('active', sec.id === `settings-${section}`);
        });

        this.activeSection = section;

        // v3.0: Initialize Columns tab when activated
        if (section === 'columns') {
            this._initColumnsTab();
        }
    }

    /**
     * Initialize Columns tab content
     * v3.0: Uses ColumnSettingsModal to render column management UI
     * @private
     */
    private _initColumnsTab(): void {
        const container = this.modal.querySelector('#settings-columns-content') as HTMLElement;
        if (!container || !this.options.getScheduler) return;

        const scheduler = this.options.getScheduler();
        if (!scheduler) return;

        // Create or reuse ColumnSettingsModal instance
        if (!this.columnSettingsModal) {
            this.columnSettingsModal = new ColumnSettingsModal({
                container: document.body, // Not used when rendering into container
                onSave: (preferences) => {
                    scheduler.saveColumnPreferencesFromSettings(preferences);
                },
                getColumns: () => scheduler.getColumnDefinitionsForSettings(),
                getPreferences: () => scheduler.getColumnPreferencesForSettings(),
            });
        }

        // Render column settings into the container
        this.columnSettingsModal.renderIntoContainer(container);
    }

    /**
     * Open the settings modal
     */
    open(): void {
        this.overlay.style.display = 'flex';
        this.isOpen = true;
        
        // Focus trap (optional enhancement)
        this.modal.focus();
    }

    /**
     * Close the settings modal
     */
    close(): void {
        this.overlay.style.display = 'none';
        this.isOpen = false;
        this.options.onClose?.();
    }

    /**
     * Toggle the settings modal
     */
    toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Check if modal is open
     */
    getIsOpen(): boolean {
        return this.isOpen;
    }
}

