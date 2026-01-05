/**
 * @fileoverview Keyboard shortcut service - handles keyboard navigation and shortcuts
 * @module ui/services/KeyboardService
 * 
 * PHASE 2: Now integrates with CommandService for command-based shortcuts.
 * Shortcuts registered with CommandService are tried first, then legacy callbacks.
 */

import { getEditingStateManager, type EditingStateChangeEvent } from '../../services/EditingStateManager';
import { CommandService, buildShortcutFromEvent } from '../../commands';

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
  private _unsubscribeEditing: (() => void) | null = null;

  /**
   * @param options - Configuration
   */
  constructor(options: KeyboardServiceOptions = {}) {
    this.options = options;
    this.isEnabled = true;
    this._boundHandler = this._handleKeyDown.bind(this);
    this._attach();
    
    // Subscribe to editing state changes
    const editingManager = getEditingStateManager();
    this._unsubscribeEditing = editingManager.subscribe((event) => {
      this._onEditingStateChange(event);
    });
  }

  /**
   * Handle editing state changes
   * Could be used for visual feedback or state tracking
   */
  private _onEditingStateChange(_event: EditingStateChangeEvent): void {
    // Optional: Add any KeyboardService-specific reactions
    // For now, state is checked directly in _handleKeyDown
  }

  /**
   * Attach keyboard event listener
   * @private
   */
  private _attach(): void {
    document.addEventListener('keydown', this._boundHandler);
  }

  /**
   * Detach keyboard event listener and cleanup
   */
  detach(): void {
    document.removeEventListener('keydown', this._boundHandler);
    if (this._unsubscribeEditing) {
      this._unsubscribeEditing();
      this._unsubscribeEditing = null;
    }
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
   * PHASE 2: Try CommandService first, then fall back to legacy callbacks.
   * @private
   * @param e - Keyboard event
   */
  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this.isEnabled) return;
    
    // Guard: Don't process keyboard shortcuts if app isn't ready
    if (this.options.isAppReady && !this.options.isAppReady()) {
      return;
    }

    // CRITICAL: Use EditingStateManager as source of truth
    const editingManager = getEditingStateManager();
    const isEditing = editingManager.isEditing();
    const isCtrl = e.ctrlKey || e.metaKey;

    // Build shortcut string for CommandService
    const shortcut = buildShortcutFromEvent(e);

    // =========================================================================
    // PHASE 2: Try CommandService for registered shortcuts
    // These shortcuts work via the Command Registry even during editing
    // =========================================================================
    
    // Shortcuts that work during editing: Undo, Redo
    if (this._isShortcutActiveWhileEditing(shortcut)) {
      if (this._tryCommandService(shortcut, e)) {
        return;
      }
    }

    // =========================================================================
    // PHASE 2: Task creation shortcuts (work even during editing)
    // These are handled by CommandService, but we need to exit edit mode first
    // =========================================================================

    // Ctrl+Enter: Add child task (works even when editing)
    // Shift+Enter: Insert task above (works even when editing)
    if (e.key === 'Enter' && (isCtrl || e.shiftKey)) {
      if (isEditing) {
        // Exit edit mode first, then execute command
        editingManager.exitEditMode('programmatic');
      }
      // Let CommandService handle via _tryCommandService below
      if (this._tryCommandService(shortcut, e)) {
        return;
      }
      // Fallback to legacy handler for Ctrl+Enter only
      if (isCtrl && this.options.onCtrlEnter) {
        e.preventDefault();
        setTimeout(() => this.options.onCtrlEnter!(), 50);
        return;
      }
    }

    // Insert key - add task
    if (e.key === 'Insert' || (isCtrl && e.key === 'i')) {
      e.preventDefault();
      if (isEditing) {
        editingManager.exitEditMode('programmatic');
      }
      if (e.shiftKey) {
        if (this.options.onShiftInsert) {
          setTimeout(() => this.options.onShiftInsert!(), 50);
        }
      } else {
        if (this.options.onInsert) {
          setTimeout(() => this.options.onInsert!(), 50);
        }
      }
      return;
    }

    // Skip other shortcuts when editing
    if (isEditing) return;

    // =========================================================================
    // PHASE 2: Try CommandService for non-editing shortcuts
    // =========================================================================
    
    if (this._tryCommandService(shortcut, e)) {
      return;
    }

    // =========================================================================
    // LEGACY: Callbacks for shortcuts not yet migrated to commands
    // =========================================================================

    // Escape
    if (e.key === 'Escape') {
      if (this.options.onEscape) {
        this.options.onEscape();
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

    // Arrow key navigation (only when NOT editing)
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
   * Try to execute a shortcut via CommandService.
   * Returns true if command was found and executed.
   * @private
   */
  private _tryCommandService(shortcut: string, e: KeyboardEvent): boolean {
    const commandService = CommandService.getInstance();
    
    // Check if this shortcut is registered
    if (!commandService.hasShortcut(shortcut)) {
      return false;
    }

    // Prevent default and execute
    e.preventDefault();
    
    // Execute asynchronously (commands may be async)
    commandService.executeShortcut(shortcut).catch(err => {
      console.error('[KeyboardService] Command execution failed:', err);
    });

    return true;
  }

  /**
   * Check if a shortcut should work even while editing.
   * These are critical shortcuts like Undo/Redo.
   * @private
   */
  private _isShortcutActiveWhileEditing(shortcut: string): boolean {
    const activeWhileEditing = [
      'Ctrl+Z',        // Undo
      'Ctrl+Y',        // Redo
      'Ctrl+Shift+Z',  // Redo (alternate)
    ];
    return activeWhileEditing.includes(shortcut);
  }

  // REMOVE the old _isEditing method - no longer needed
}
