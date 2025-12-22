/**
 * @fileoverview Keyboard shortcut service - handles keyboard navigation and shortcuts
 * @module ui/services/KeyboardService
 */

/**
 * Keyboard service options
 */
export interface KeyboardServiceOptions {
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onInsert?: () => void;
  onShiftInsert?: () => void;
  onCtrlEnter?: () => void;
  onArrowUp?: (shiftKey: boolean, ctrlKey: boolean) => void;
  onArrowDown?: (shiftKey: boolean, ctrlKey: boolean) => void;
  onArrowLeft?: (shiftKey: boolean, ctrlKey: boolean) => void;
  onArrowRight?: (shiftKey: boolean, ctrlKey: boolean) => void;
  onTab?: () => void;
  onShiftTab?: () => void;
  onCtrlArrowUp?: () => void;
  onCtrlArrowDown?: () => void;
  onCtrlArrowLeft?: () => void;
  onCtrlArrowRight?: () => void;
  onF2?: () => void;
  onEscape?: () => void;
  onLinkSelected?: () => void;
  onDrivingPath?: () => void;
  isAppReady?: () => boolean;
}

/**
 * Keyboard service for handling keyboard shortcuts and navigation
 */
export class KeyboardService {
  private options: KeyboardServiceOptions;
  private isEnabled: boolean;
  private _boundHandler: (e: KeyboardEvent) => void;

  /**
   * @param options - Configuration
   */
  constructor(options: KeyboardServiceOptions = {}) {
    this.options = options;
    this.isEnabled = true;
    this._boundHandler = this._handleKeyDown.bind(this);
    this._attach();
  }

  /**
   * Attach keyboard event listener
   * @private
   */
  private _attach(): void {
    document.addEventListener('keydown', this._boundHandler);
  }

  /**
   * Detach keyboard event listener
   */
  detach(): void {
    document.removeEventListener('keydown', this._boundHandler);
  }

  /**
   * Enable keyboard shortcuts
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disable keyboard shortcuts
   */
  disable(): void {
    this.isEnabled = false;
  }

  /**
   * Handle keydown events
   * @private
   * @param e - Keyboard event
   */
  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this.isEnabled) return;
    
    // Guard: Don't process keyboard shortcuts if app isn't ready
    if (this.options.isAppReady && !this.options.isAppReady()) {
      return;
    }

    const isEditing = this._isEditing(e.target as HTMLElement);
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

    // Ctrl+Enter: Add child task (works even when editing - saves and adds child)
    if (isCtrl && e.key === 'Enter') {
      e.preventDefault();
      
      // If editing, blur the input first to save the current edit
      if (isEditing) {
        (e.target as HTMLElement).blur();
      }
      
      if (this.options.onCtrlEnter) {
        // Small delay to ensure blur/save completes
        setTimeout(() => {
          this.options.onCtrlEnter!();
        }, 50);
      }
      return;
    }

    // Insert key - add task below (default), Shift+Insert - add task above
    // Ctrl+I also triggers insert (works even when editing - saves and inserts)
    if (e.key === 'Insert' || (isCtrl && e.key === 'i')) {
      e.preventDefault();
      
      // If editing, blur the input first to save the current edit
      if (isEditing) {
        (e.target as HTMLElement).blur();
      }
      
      if (e.shiftKey) {
        if (this.options.onShiftInsert) {
          setTimeout(() => {
            this.options.onShiftInsert!();
          }, 50);
        }
      } else {
        if (this.options.onInsert) {
          setTimeout(() => {
            this.options.onInsert!();
          }, 50);
        }
      }
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
    // Only trigger when tasks are selected AND focus is not inside an input field
    if (e.key === 'Tab' && this.options.onTab && !isEditing) {
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

    // Ctrl+Arrow Left/Right - collapse/expand
    if (isCtrl && e.key === 'ArrowLeft' && this.options.onCtrlArrowLeft) {
      e.preventDefault();
      this.options.onCtrlArrowLeft();
      return;
    }

    if (isCtrl && e.key === 'ArrowRight' && this.options.onCtrlArrowRight) {
      e.preventDefault();
      this.options.onCtrlArrowRight();
      return;
    }

    // Arrow key navigation (up/down/left/right) - cell navigation
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

    // Arrow Left/Right - cell navigation
    if (e.key === 'ArrowLeft' && this.options.onArrowLeft) {
      e.preventDefault();
      this.options.onArrowLeft(e.shiftKey, isCtrl);
      return;
    }

    if (e.key === 'ArrowRight' && this.options.onArrowRight) {
      e.preventDefault();
      this.options.onArrowRight(e.shiftKey, isCtrl);
      return;
    }

    // F2 - enter edit mode
    if (e.key === 'F2' && this.options.onF2) {
      e.preventDefault();
      this.options.onF2();
      return;
    }

    // Link selected tasks (Ctrl+L)
    if (isCtrl && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      if (this.options.onLinkSelected) this.options.onLinkSelected();
      return;
    }

    // Driving path mode (Ctrl+D)
    if (isCtrl && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (this.options.onDrivingPath) this.options.onDrivingPath();
      return;
    }
  }

  /**
   * Check if user is currently editing (typing in input)
   * @private
   * @param target - Event target element
   * @returns True if editing
   */
  private _isEditing(target: HTMLElement): boolean {
    // Exclude checkboxes - they're selection controls, not editable cells for Tab navigation
    // This allows Tab/Shift+Tab to indent/outdent when checkbox is focused (if tasks are selected)
    if (target.classList.contains('vsg-checkbox') || 
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox')) {
      return false; // Checkboxes are NOT considered editing
    }
    
    return target.classList.contains('vsg-input') ||
           target.classList.contains('form-input') ||
           target.tagName === 'INPUT' ||
           target.tagName === 'TEXTAREA' ||
           target.tagName === 'SELECT';
  }
}
