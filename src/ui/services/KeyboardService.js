/**
 * @fileoverview Keyboard shortcut service - handles keyboard navigation and shortcuts
 * @module ui/services/KeyboardService
 */

/**
 * Keyboard service for handling keyboard shortcuts and navigation
 * @class
 */
export class KeyboardService {
    /**
     * @param {Object} options - Configuration
     * @param {Function} options.onUndo - Undo callback
     * @param {Function} options.onRedo - Redo callback
     * @param {Function} options.onDelete - Delete selected callback
     * @param {Function} options.onCopy - Copy callback
     * @param {Function} options.onCut - Cut callback
     * @param {Function} options.onPaste - Paste callback
     * @param {Function} options.onInsert - Insert task above callback
     * @param {Function} options.onArrowUp - Arrow up navigation callback
     * @param {Function} options.onArrowDown - Arrow down navigation callback
     * @param {Function} options.onArrowLeft - Arrow left callback (collapse)
     * @param {Function} options.onArrowRight - Arrow right callback (expand)
     * @param {Function} options.onTab - Tab callback (indent)
     * @param {Function} options.onShiftTab - Shift+Tab callback (outdent)
     * @param {Function} options.onCtrlArrowUp - Ctrl+Arrow Up callback (move up)
     * @param {Function} options.onCtrlArrowDown - Ctrl+Arrow Down callback (move down)
     * @param {Function} options.onF2 - F2 callback (edit mode)
     * @param {Function} options.onEscape - Escape callback
     */
    constructor(options = {}) {
        this.options = options;
        this.isEnabled = true;
        this._boundHandler = this._handleKeyDown.bind(this);
        this._attach();
    }

    /**
     * Attach keyboard event listener
     * @private
     */
    _attach() {
        document.addEventListener('keydown', this._boundHandler);
    }

    /**
     * Detach keyboard event listener
     */
    detach() {
        document.removeEventListener('keydown', this._boundHandler);
    }

    /**
     * Enable keyboard shortcuts
     */
    enable() {
        this.isEnabled = true;
    }

    /**
     * Disable keyboard shortcuts
     */
    disable() {
        this.isEnabled = false;
    }

    /**
     * Handle keydown events
     * @private
     * @param {KeyboardEvent} e - Keyboard event
     */
    _handleKeyDown(e) {
        if (!this.isEnabled) return;

        const isEditing = this._isEditing(e.target);
        const isCtrl = e.ctrlKey || e.metaKey;

        // Undo/Redo (always active)
        if (isCtrl && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (this.options.onUndo) this.options.onUndo();
            return;
        }

        if ((isCtrl && e.key === 'y') || (isCtrl && e.shiftKey && e.key === 'z')) {
            e.preventDefault();
            if (this.options.onRedo) this.options.onRedo();
            return;
        }

        // Skip other shortcuts when editing (except undo/redo)
        if (isEditing) return;

        // Escape
        if (e.key === 'Escape') {
            if (this.options.onEscape) {
                this.options.onEscape();
            }
            return;
        }

        // Delete selected
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.options.onDelete) {
            e.preventDefault();
            this.options.onDelete();
            return;
        }

        // Tab = indent, Shift+Tab = outdent
        if (e.key === 'Tab' && this.options.onTab) {
            e.preventDefault();
            if (e.shiftKey) {
                if (this.options.onShiftTab) this.options.onShiftTab();
            } else {
                this.options.onTab();
            }
            return;
        }

        // Copy (Ctrl+C)
        if (isCtrl && e.key === 'c' && this.options.onCopy) {
            e.preventDefault();
            this.options.onCopy();
            return;
        }

        // Cut (Ctrl+X)
        if (isCtrl && e.key === 'x' && this.options.onCut) {
            e.preventDefault();
            this.options.onCut();
            return;
        }

        // Paste (Ctrl+V)
        if (isCtrl && e.key === 'v' && this.options.onPaste) {
            e.preventDefault();
            this.options.onPaste();
            return;
        }

        // Insert key - add task above
        if (e.key === 'Insert' && this.options.onInsert) {
            e.preventDefault();
            this.options.onInsert();
            return;
        }

        // Ctrl+Arrow Up/Down - move task
        if (isCtrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            if (e.key === 'ArrowUp' && this.options.onCtrlArrowUp) {
                e.preventDefault();
                this.options.onCtrlArrowUp();
                return;
            }
            if (e.key === 'ArrowDown' && this.options.onCtrlArrowDown) {
                e.preventDefault();
                this.options.onCtrlArrowDown();
                return;
            }
        }

        // Arrow key navigation (up/down)
        if (e.key === 'ArrowUp' && this.options.onArrowUp) {
            e.preventDefault();
            this.options.onArrowUp(e.shiftKey, isCtrl);
            return;
        }

        if (e.key === 'ArrowDown' && this.options.onArrowDown) {
            e.preventDefault();
            this.options.onArrowDown(e.shiftKey, isCtrl);
            return;
        }

        // Arrow Left/Right - collapse/expand
        if (e.key === 'ArrowLeft' && this.options.onArrowLeft) {
            e.preventDefault();
            this.options.onArrowLeft();
            return;
        }

        if (e.key === 'ArrowRight' && this.options.onArrowRight) {
            e.preventDefault();
            this.options.onArrowRight();
            return;
        }

        // F2 - enter edit mode
        if (e.key === 'F2' && this.options.onF2) {
            e.preventDefault();
            this.options.onF2();
            return;
        }
    }

    /**
     * Check if user is currently editing (typing in input)
     * @private
     * @param {HTMLElement} target - Event target element
     * @returns {boolean} True if editing
     */
    _isEditing(target) {
        return target.classList.contains('vsg-input') ||
               target.classList.contains('form-input') ||
               target.tagName === 'INPUT' ||
               target.tagName === 'TEXTAREA' ||
               target.tagName === 'SELECT';
    }
}

