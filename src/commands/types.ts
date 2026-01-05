/**
 * @fileoverview Command Registry Types
 * @module commands/types
 * 
 * Type definitions for the Command Registry pattern.
 * 
 * This pattern (used by VS Code, Sublime Text, JetBrains, etc.) decouples
 * user intent from implementation by representing each action as a Command.
 * 
 * Key concepts:
 * - Command<TArgs>: A discrete, testable user action with typed arguments
 * - CommandContext: Injected services available to all commands
 * - CommandService: Central registry and executor
 * 
 * @author Pro Logic Scheduler
 * @version 1.0.0
 */

import type { Task, ToastType } from '../types';
import type { ProjectController } from '../services/ProjectController';
import type { SelectionModel } from '../services/SelectionModel';
import type { HistoryManager } from '../data/HistoryManager';
import type { ToastService } from '../ui/services/ToastService';
import type { OrderingService } from '../services/OrderingService';
import type { TradePartnerStore } from '../data/TradePartnerStore';
import type { ClipboardManager } from '../services/ClipboardManager';

// =============================================================================
// COMMAND CONTEXT
// =============================================================================

/**
 * Injected dependencies available to all commands.
 * 
 * This is set once during app initialization and passed to every
 * command's canExecute() and execute() methods.
 * 
 * NOTE: Services are injected, NOT optional args like taskId/taskIds.
 * Command-specific arguments use the generic TArgs parameter on Command<TArgs>.
 */
export interface CommandContext {
    /** Task data and WASM worker interface */
    readonly controller: ProjectController;

    /** Selection state (synchronous, UI-focused) */
    readonly selection: SelectionModel;

    /** Undo/redo functionality */
    readonly historyManager: HistoryManager | null;

    /**
     * User notifications.
     * NOTE: Uses lazy getter pattern because ToastService is created
     * inside SchedulerService which initializes after CommandService.
     */
    readonly toastService: ToastService | null;

    /** Fractional indexing for task ordering (static methods) */
    readonly orderingService: typeof OrderingService;

    /** Trade partner data access */
    readonly tradePartnerStore: TradePartnerStore;

    /** Clipboard for copy/cut/paste operations */
    readonly clipboardManager: ClipboardManager;

    /**
     * Get visible tasks respecting collapse state.
     * Replaces private _getFlatList() from SchedulerService.
     * Uses ProjectController.getVisibleTasks() internally.
     */
    getVisibleTasks(): Task[];
}

// =============================================================================
// COMMAND CATEGORIES
// =============================================================================

/**
 * Command category for organization and filtering.
 * Commands are grouped by category in the command palette and menus.
 */
export type CommandCategory =
    | 'task'        // Task CRUD operations (add, delete)
    | 'hierarchy'   // Indent, outdent, move up/down
    | 'selection'   // Select all, clear selection
    | 'clipboard'   // Cut, copy, paste
    | 'dependency'  // Link, unlink
    | 'edit'        // Undo, redo, cell editing
    | 'navigation'  // Arrow keys, tab, page up/down
    | 'view'        // Zoom, view mode, collapse/expand
    | 'io'          // Import, export, save
    | 'debug';      // Developer tools

// =============================================================================
// COMMAND RESULT
// =============================================================================

/**
 * Result returned by command execution.
 * Commands can return success/failure status and optional data.
 */
export interface CommandResult {
    /** Whether the command completed successfully */
    success: boolean;

    /** Optional message for user feedback */
    message?: string;

    /** Optional data returned by the command */
    data?: unknown;
}

// =============================================================================
// COMMAND INTERFACE
// =============================================================================

/**
 * Command definition with typed arguments.
 * 
 * Uses generics for type-safe command arguments. Commands without args
 * use the default `void` type. Commands with args specify their type.
 * 
 * This is the professional pattern used by VS Code, JetBrains, etc.
 * It keeps CommandContext clean (services only) while allowing
 * command-specific arguments to be fully typed.
 * 
 * @example
 * ```typescript
 * // Command without args (uses selection)
 * const DeleteCommand: Command = {
 *   id: 'task.delete',
 *   label: 'Delete Selected Tasks',
 *   category: 'task',
 *   shortcut: 'Delete',
 *   canExecute: (ctx) => ctx.selection.getSelectionCount() > 0,
 *   execute: (ctx) => {
 *     const ids = ctx.selection.getSelectedIds();
 *     ids.forEach(id => ctx.controller.deleteTask(id));
 *   }
 * };
 * 
 * // Command with typed args (for context menu)
 * interface DeleteArgs {
 *   taskIds?: string[];  // Override selection if provided
 * }
 * 
 * const DeleteWithArgsCommand: Command<DeleteArgs> = {
 *   id: 'task.delete',
 *   label: 'Delete Tasks',
 *   category: 'task',
 *   canExecute: (ctx, args) => {
 *     const ids = args?.taskIds ?? ctx.selection.getSelectedIds();
 *     return ids.length > 0;
 *   },
 *   execute: (ctx, args) => {
 *     const ids = args?.taskIds ?? ctx.selection.getSelectedIds();
 *     ids.forEach(id => ctx.controller.deleteTask(id));
 *   }
 * };
 * ```
 * 
 * @typeParam TArgs - Type of command-specific arguments (defaults to void)
 */
export interface Command<TArgs = void> {
    /**
     * Unique identifier using dot notation.
     * Convention: {category}.{action}
     * Examples: 'task.delete', 'hierarchy.indent', 'edit.undo'
     */
    id: string;

    /**
     * Human-readable label for display in menus and command palette.
     */
    label: string;

    /**
     * Command category for grouping and filtering.
     */
    category: CommandCategory;

    /**
     * Keyboard shortcut (optional).
     * Examples: 'Delete', 'Ctrl+Z', 'Ctrl+Shift+P', 'Tab'
     */
    shortcut?: string;

    /**
     * Alternative shortcuts (optional).
     * Useful for platform-specific shortcuts (Cmd vs Ctrl).
     */
    alternateShortcuts?: string[];

    /**
     * Icon for menus and command palette (optional).
     * Can be emoji or icon class name.
     */
    icon?: string;

    /**
     * Description for command palette and tooltips (optional).
     */
    description?: string;

    /**
     * Check if the command can execute in the current state.
     * This is called before execute() and also used to enable/disable
     * menu items and show keyboard shortcuts.
     * 
     * @param ctx - Command context with all dependencies
     * @param args - Optional typed command arguments
     * @returns true if the command can execute
     */
    canExecute(ctx: CommandContext, args?: TArgs): boolean;

    /**
     * Execute the command.
     * 
     * @param ctx - Command context with all dependencies
     * @param args - Optional typed command arguments
     * @returns Optional result, or void
     */
    execute(ctx: CommandContext, args?: TArgs): CommandResult | Promise<CommandResult> | void;
}

// =============================================================================
// EXECUTE OPTIONS
// =============================================================================

/**
 * Options for executing a command via CommandService.execute()
 */
export interface ExecuteOptions<TArgs = unknown> {
    /** Typed arguments to pass to the command */
    args?: TArgs;

    /** If true, skip canExecute() check */
    force?: boolean;

    /** If true, don't show toast on error */
    silent?: boolean;
}

// =============================================================================
// COMMAND SERVICE INTERFACE
// =============================================================================

/**
 * CommandService public interface.
 * The central registry and executor for all commands.
 */
export interface ICommandService {
    /** Set the command context (call once during init) */
    setContext(ctx: CommandContext): void;

    /** Register a command (accepts any Command type) */
    register<TArgs>(command: Command<TArgs>): void;

    /** Execute a command by ID with typed args */
    execute<TArgs = unknown>(id: string, options?: ExecuteOptions<TArgs>): Promise<CommandResult>;

    /** Execute command for a keyboard shortcut */
    executeShortcut(shortcut: string): Promise<CommandResult | null>;

    /** Check if a command can execute (with optional args) */
    canExecute<TArgs = unknown>(id: string, args?: TArgs): boolean;

    /** Get a command by ID */
    getCommand(id: string): Command<unknown> | undefined;

    /** Get all registered commands */
    getAllCommands(): Command<unknown>[];

    /** Get commands by category */
    getCommandsByCategory(category: CommandCategory): Command<unknown>[];

    /** Get enabled commands (for menus) */
    getEnabledCommands(): Command<unknown>[];

    /** Check if a shortcut is registered */
    hasShortcut(shortcut: string): boolean;

    /** Get command ID for a shortcut */
    getCommandIdForShortcut(shortcut: string): string | undefined;
}
