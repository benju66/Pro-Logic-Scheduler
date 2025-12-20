/**
 * @fileoverview Activity Bar Component
 * @module ui/components/ActivityBar
 * 
 * VS Code-style activity bar for view switching and settings access.
 */

export interface ActivityBarOptions {
    container: HTMLElement;
    onViewChange?: (view: string) => void;
    onSettingsClick?: () => void;
}

export class ActivityBar {
    private container: HTMLElement;
    private options: ActivityBarOptions;
    private activeView: string = 'schedule';

    constructor(options: ActivityBarOptions) {
        this.container = options.container;
        this.options = options;
        this._bindEvents();
    }

    /**
     * Bind event listeners using event delegation
     */
    private _bindEvents(): void {
        this.container.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('.activity-btn') as HTMLButtonElement | null;
            
            if (!btn || btn.disabled) return;

            const view = btn.dataset.view;
            const action = btn.dataset.action;

            if (view) {
                this._setActiveView(view);
            } else if (action === 'open-settings') {
                this.options.onSettingsClick?.();
            }
        });
    }

    /**
     * Set the active view
     */
    private _setActiveView(view: string): void {
        if (view === this.activeView) return;

        // Update button states
        const buttons = this.container.querySelectorAll('.activity-btn[data-view]');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === view);
        });

        this.activeView = view;
        this.options.onViewChange?.(view);
    }

    /**
     * Get current active view
     */
    getActiveView(): string {
        return this.activeView;
    }
}

