/**
 * @fileoverview Keyboard Binding Service
 * @module services/scheduler/KeyboardBindingService
 * 
 * Service for setting up keyboard bindings and shortcuts.
 * Extracted from SchedulerService as part of the decomposition plan.
 * 
 * RESPONSIBILITIES:
 * - Configure KeyboardService with all keyboard bindings
 * - Map keyboard shortcuts to action handlers
 * - Provide clean initialization interface
 * 
 * ARCHITECTURE:
 * - Pure configuration - no business logic
 * - Uses callback injection pattern
 * - Delegates all actions to provided callbacks
 * 
 * @see docs/PHASE4_DECOMPOSITION_AUDIT.md - Phase 4.2
 */

import type { KeyboardService } from '../../ui/services/KeyboardService';

/**
 * Keyboard action callbacks
 */
export interface KeyboardActions {
    /** Check if app is ready */
    isAppReady: () => boolean;
    /** Undo last action */
    onUndo: () => void;
    /** Redo last undone action */
    onRedo: () => void;
    /** Delete selected tasks */
    onDelete: () => void;
    /** Copy selected tasks */
    onCopy: () => void;
    /** Cut selected tasks */
    onCut: () => void;
    /** Paste tasks */
    onPaste: () => void;
    /** Insert task below */
    onInsert: () => void;
    /** Insert task above */
    onShiftInsert: () => void;
    /** Add child task */
    onCtrlEnter: () => void;
    /** Arrow key navigation */
    onArrowUp: (shiftKey: boolean, ctrlKey: boolean) => void;
    onArrowDown: (shiftKey: boolean, ctrlKey: boolean) => void;
    onArrowLeft: (shiftKey: boolean, ctrlKey: boolean) => void;
    onArrowRight: (shiftKey: boolean, ctrlKey: boolean) => void;
    /** Collapse/expand with Ctrl+Arrow */
    onCtrlArrowLeft: () => void;
    onCtrlArrowRight: () => void;
    /** Tab indent/outdent */
    onTab: () => void;
    onShiftTab: () => void;
    /** Move tasks */
    onCtrlArrowUp: () => void;
    onCtrlArrowDown: () => void;
    /** Enter edit mode */
    onF2: () => void;
    /** Escape handler */
    onEscape: () => void;
    /** Link selected tasks */
    onLinkSelected: () => void;
    /** Toggle driving path mode */
    onDrivingPath: () => void;
}

/**
 * Dependencies required by KeyboardBindingService
 */
export interface KeyboardBindingServiceDeps {
    /** Keyboard action callbacks */
    actions: KeyboardActions;
    /** KeyboardService constructor (for creating instance) */
    KeyboardServiceClass: new (options: any) => KeyboardService;
}

/**
 * Keyboard Binding Service
 * 
 * Configures keyboard bindings for the scheduler application.
 * All actions are delegated to provided callbacks.
 */
export class KeyboardBindingService {
    private deps: KeyboardBindingServiceDeps;

    constructor(deps: KeyboardBindingServiceDeps) {
        this.deps = deps;
    }

    /**
     * Initialize keyboard bindings
     * 
     * Creates and configures KeyboardService with all keyboard shortcuts.
     * 
     * @returns Configured KeyboardService instance
     */
    initialize(): KeyboardService {
        return new this.deps.KeyboardServiceClass({
            isAppReady: this.deps.actions.isAppReady,
            onUndo: this.deps.actions.onUndo,
            onRedo: this.deps.actions.onRedo,
            onDelete: this.deps.actions.onDelete,
            onCopy: this.deps.actions.onCopy,
            onCut: this.deps.actions.onCut,
            onPaste: this.deps.actions.onPaste,
            onInsert: this.deps.actions.onInsert,
            onShiftInsert: this.deps.actions.onShiftInsert,
            onCtrlEnter: this.deps.actions.onCtrlEnter,
            onArrowUp: this.deps.actions.onArrowUp,
            onArrowDown: this.deps.actions.onArrowDown,
            onArrowLeft: this.deps.actions.onArrowLeft,
            onArrowRight: this.deps.actions.onArrowRight,
            onCtrlArrowLeft: this.deps.actions.onCtrlArrowLeft,
            onCtrlArrowRight: this.deps.actions.onCtrlArrowRight,
            onTab: this.deps.actions.onTab,
            onShiftTab: this.deps.actions.onShiftTab,
            onCtrlArrowUp: this.deps.actions.onCtrlArrowUp,
            onCtrlArrowDown: this.deps.actions.onCtrlArrowDown,
            onF2: this.deps.actions.onF2,
            onEscape: this.deps.actions.onEscape,
            onLinkSelected: this.deps.actions.onLinkSelected,
            onDrivingPath: this.deps.actions.onDrivingPath,
        });
    }
}
