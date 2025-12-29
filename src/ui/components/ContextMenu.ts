/**
 * @fileoverview Lightweight context menu component
 * @module ui/components/ContextMenu
 */

export interface ContextMenuItem {
    id: string;
    label?: string;
    icon?: string;
    type?: 'item' | 'divider';
    danger?: boolean;
    disabled?: boolean;
}

/**
 * Lightweight context menu for row actions
 * Appended to document.body to avoid overflow clipping
 */
export class ContextMenu {
    private container: HTMLElement | null = null;
    private backdrop: HTMLElement | null = null;
    private onSelect: ((id: string) => void) | null = null;
    private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
    private focusedIndex: number = -1;
    private items: ContextMenuItem[] = [];
    
    /**
     * Show context menu
     */
    show(
        anchorEl: HTMLElement,
        items: ContextMenuItem[],
        onSelect: (id: string) => void
    ): void {
        this.hide(); // Close any existing menu
        
        this.items = items;
        this.onSelect = onSelect;
        this.focusedIndex = -1;
        
        // Create backdrop for click-outside detection
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'context-menu-backdrop';
        this.backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9998;
        `;
        this.backdrop.addEventListener('click', () => this.hide());
        document.body.appendChild(this.backdrop);
        
        // Create menu container
        this.container = document.createElement('div');
        this.container.className = 'context-menu';
        this.container.setAttribute('role', 'menu');
        this.container.setAttribute('tabindex', '-1');
        
        // Render items
        items.forEach((item, index) => {
            if (item.type === 'divider') {
                const divider = document.createElement('div');
                divider.className = 'context-menu-divider';
                this.container!.appendChild(divider);
            } else {
                const itemEl = document.createElement('button');
                itemEl.className = 'context-menu-item';
                if (item.danger) itemEl.classList.add('danger');
                if (item.disabled) itemEl.classList.add('disabled');
                itemEl.setAttribute('role', 'menuitem');
                itemEl.setAttribute('data-index', String(index));
                itemEl.setAttribute('data-id', item.id);
                
                if (item.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'context-menu-icon';
                    iconSpan.innerHTML = item.icon;
                    itemEl.appendChild(iconSpan);
                }
                
                const labelSpan = document.createElement('span');
                labelSpan.className = 'context-menu-label';
                labelSpan.textContent = item.label || item.id;
                itemEl.appendChild(labelSpan);
                
                if (!item.disabled) {
                    itemEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectItem(item.id);
                    });
                }
                
                this.container!.appendChild(itemEl);
            }
        });
        
        document.body.appendChild(this.container);
        
        // Position menu
        this.positionMenu(anchorEl);
        
        // Add keyboard handler
        this.boundKeyHandler = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.boundKeyHandler);
        
        // Focus first item
        this.focusItem(0);
    }
    
    /**
     * Hide context menu
     */
    hide(): void {
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }
        
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        
        if (this.boundKeyHandler) {
            document.removeEventListener('keydown', this.boundKeyHandler);
            this.boundKeyHandler = null;
        }
        
        this.onSelect = null;
        this.focusedIndex = -1;
        this.items = [];
    }
    
    /**
     * Select an item and close menu
     */
    private selectItem(id: string): void {
        const callback = this.onSelect;
        this.hide();
        if (callback) {
            callback(id);
        }
    }
    
    /**
     * Position menu relative to anchor
     */
    private positionMenu(anchorEl: HTMLElement): void {
        if (!this.container) return;
        
        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = this.container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        const padding = 8;
        
        // Default: below and to the right of anchor
        let top = anchorRect.bottom + 4;
        let left = anchorRect.left;
        
        // Flip vertical if would overflow bottom
        if (top + menuRect.height + padding > viewportHeight) {
            top = anchorRect.top - menuRect.height - 4;
        }
        
        // Flip horizontal if would overflow right
        if (left + menuRect.width + padding > viewportWidth) {
            left = anchorRect.right - menuRect.width;
        }
        
        // Ensure not off-screen left
        if (left < padding) {
            left = padding;
        }
        
        // Ensure not off-screen top
        if (top < padding) {
            top = padding;
        }
        
        this.container.style.cssText = `
            position: fixed;
            top: ${top}px;
            left: ${left}px;
            z-index: 9999;
        `;
    }
    
    /**
     * Handle keyboard navigation
     */
    private handleKeyDown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.hide();
                break;
                
            case 'ArrowDown':
                e.preventDefault();
                this.focusNextItem(1);
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                this.focusNextItem(-1);
                break;
                
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (this.focusedIndex >= 0) {
                    const item = this.items[this.focusedIndex];
                    if (item && !item.disabled && item.type !== 'divider') {
                        this.selectItem(item.id);
                    }
                }
                break;
                
            case 'Tab':
                e.preventDefault();
                this.hide();
                break;
        }
    }
    
    /**
     * Focus an item by index
     */
    private focusItem(index: number): void {
        if (!this.container) return;
        
        const items = this.container.querySelectorAll('.context-menu-item:not(.disabled)');
        if (items.length === 0) return;
        
        // Clamp index
        const targetIndex = Math.max(0, Math.min(index, items.length - 1));
        
        // Remove focus from all
        items.forEach(item => item.classList.remove('focused'));
        
        // Focus target
        const targetItem = items[targetIndex] as HTMLElement;
        targetItem.classList.add('focused');
        targetItem.focus();
        
        this.focusedIndex = parseInt(targetItem.getAttribute('data-index') || '0');
    }
    
    /**
     * Focus next/previous item
     */
    private focusNextItem(direction: 1 | -1): void {
        if (!this.container) return;
        
        const items = this.container.querySelectorAll('.context-menu-item:not(.disabled)');
        if (items.length === 0) return;
        
        // Find current focused position in filtered list
        let currentPos = -1;
        items.forEach((item, i) => {
            if (item.classList.contains('focused')) {
                currentPos = i;
            }
        });
        
        // Calculate next position
        let nextPos = currentPos + direction;
        if (nextPos < 0) nextPos = items.length - 1;
        if (nextPos >= items.length) nextPos = 0;
        
        // Focus it
        items.forEach(item => item.classList.remove('focused'));
        const nextItem = items[nextPos] as HTMLElement;
        nextItem.classList.add('focused');
        nextItem.focus();
        
        this.focusedIndex = parseInt(nextItem.getAttribute('data-index') || '0');
    }
}

export default ContextMenu;

