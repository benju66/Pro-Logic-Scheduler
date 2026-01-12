/**
 * @fileoverview Command Service - Central registry and executor
 * @module commands/CommandService
 * 
 * The CommandService is the "switchboard" for user actions.
 * It maintains a registry of all commands and provides methods
 * to execute them by ID or keyboard shortcut.
 * 
 * Pattern: VS Code / JetBrains style command registry
 * 
 * Usage:
 * 1. Register commands on app startup
 * 2. Set context with dependencies
 * 3. Execute commands from UI, keyboard shortcuts, or command palette
 * 
 * @author Pro Logic Scheduler
 * @version 1.0.0
 */

import type {
    Command,
    CommandContext,
    CommandCategory,
    CommandResult,
    ExecuteOptions,
    ICommandService
} from './types';
import { BehaviorSubject, Observable, map, distinctUntilChanged } from 'rxjs';

/**
 * CommandService - Central registry and executor for all commands
 * 
 * Singleton that manages command registration, shortcut mapping,
 * and execution with proper context injection.
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - getInstance() retained for backward compatibility
 * - Use setInstance() in Composition Root or inject directly
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class CommandService implements ICommandService {
    private static instance: CommandService | null = null;

    /** Command registry: id -> Command */
    private registry = new Map<string, Command<unknown>>();

    /** Shortcut mapping: normalized shortcut -> command id */
    private shortcuts = new Map<string, string>();

    /** Injected dependencies for commands */
    private context: CommandContext | null = null;

    /** Debug mode for logging */
    private debugMode = false;

    /**
     * Constructor is public for Pure DI compatibility.
     */
    public constructor() {
        // Check for debug mode (handle server-side/Node environments)
        if (typeof window !== 'undefined') {
            this.debugMode = (window as unknown as Record<string, unknown>).__COMMAND_DEBUG__ === true;
        }
    }

    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static getInstance(): CommandService {
        if (!CommandService.instance) {
            CommandService.instance = new CommandService();
        }
        return CommandService.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static setInstance(instance: CommandService): void {
        CommandService.instance = instance;
    }

    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    static resetInstance(): void {
        CommandService.instance = null;
    }

    // =========================================================================
    // Context Management
    // =========================================================================

    /**
     * Set the command context with all dependencies.
     * Call once during app initialization.
     * 
     * @param ctx - CommandContext with all required services
     */
    setContext(ctx: CommandContext): void {
        this.context = ctx;
        this.log('Context set', {
            hasController: !!ctx.controller,
            hasSelection: !!ctx.selection,
            hasHistoryManager: !!ctx.historyManager,
            hasToastService: !!ctx.toastService
        });
    }

    /**
     * Get the current context (for testing/debugging)
     */
    getContext(): CommandContext | null {
        return this.context;
    }

    // =========================================================================
    // Registration
    // =========================================================================

    /**
     * Register a command.
     * Automatically registers keyboard shortcuts if defined.
     * 
     * @param command - Command to register
     * @throws Error if command ID is already registered
     */
    register<TArgs>(command: Command<TArgs>): void {
        if (this.registry.has(command.id)) {
            console.warn(`[CommandService] Command '${command.id}' already registered, overwriting`);
        }

        // Store command (cast to unknown for registry storage)
        this.registry.set(command.id, command as Command<unknown>);

        // Register shortcuts
        if (command.shortcut) {
            this.registerShortcut(command.shortcut, command.id);
        }

        if (command.alternateShortcuts) {
            for (const shortcut of command.alternateShortcuts) {
                this.registerShortcut(shortcut, command.id);
            }
        }

        this.log(`Registered command: ${command.id}`, {
            category: command.category,
            shortcut: command.shortcut
        });
    }

    /**
     * Register a keyboard shortcut for a command
     * @private
     */
    private registerShortcut(shortcut: string, commandId: string): void {
        const normalized = this.normalizeShortcut(shortcut);

        if (this.shortcuts.has(normalized)) {
            const existingId = this.shortcuts.get(normalized);
            console.warn(
                `[CommandService] Shortcut '${shortcut}' already bound to '${existingId}', rebinding to '${commandId}'`
            );
        }

        this.shortcuts.set(normalized, commandId);
        this.log(`Registered shortcut: ${normalized} -> ${commandId}`);
    }

    /**
     * Normalize a shortcut string for consistent comparison.
     * Converts to uppercase, orders modifiers consistently.
     * 
     * @param shortcut - Raw shortcut string (e.g., 'ctrl+shift+z')
     * @returns Normalized string (e.g., 'Ctrl+Shift+Z')
     */
    private normalizeShortcut(shortcut: string): string {
        const parts = shortcut.split('+').map(p => p.trim());
        const modifiers: string[] = [];
        let key = '';

        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') {
                modifiers.push('Ctrl');
            } else if (lower === 'shift') {
                modifiers.push('Shift');
            } else if (lower === 'alt' || lower === 'option') {
                modifiers.push('Alt');
            } else {
                // This is the key
                key = part.length === 1 ? part.toUpperCase() : this.normalizeKeyName(part);
            }
        }

        // Sort modifiers for consistent ordering: Ctrl, Shift, Alt
        modifiers.sort((a, b) => {
            const order = ['Ctrl', 'Shift', 'Alt'];
            return order.indexOf(a) - order.indexOf(b);
        });

        return [...modifiers, key].join('+');
    }

    /**
     * Normalize key names (e.g., 'delete' -> 'Delete')
     */
    private normalizeKeyName(key: string): string {
        const keyMap: Record<string, string> = {
            'delete': 'Delete',
            'backspace': 'Backspace',
            'enter': 'Enter',
            'return': 'Enter',
            'escape': 'Escape',
            'esc': 'Escape',
            'tab': 'Tab',
            'space': 'Space',
            'arrowup': 'ArrowUp',
            'arrowdown': 'ArrowDown',
            'arrowleft': 'ArrowLeft',
            'arrowright': 'ArrowRight',
            'pageup': 'PageUp',
            'pagedown': 'PageDown',
            'home': 'Home',
            'end': 'End',
            'insert': 'Insert'
        };

        return keyMap[key.toLowerCase()] ?? key;
    }

    // =========================================================================
    // Execution
    // =========================================================================

    /**
     * Execute a command by ID.
     * 
     * @param id - Command ID (e.g., 'task.delete')
     * @param options - Execution options
     * @returns Promise resolving to CommandResult
     */
    async execute<TArgs = unknown>(
        id: string,
        options: ExecuteOptions<TArgs> = {}
    ): Promise<CommandResult> {
        const command = this.registry.get(id);

        if (!command) {
            const msg = `Command '${id}' not found`;
            this.log(msg, undefined, 'warn');
            return { success: false, message: msg };
        }

        if (!this.context) {
            const msg = 'CommandService context not set';
            this.log(msg, undefined, 'error');
            return { success: false, message: msg };
        }

        // Check canExecute (unless force is true)
        if (!options.force) {
            const canExec = command.canExecute(this.context, options.args);
            if (!canExec) {
                this.log(`Command '${id}' cannot execute in current state`);
                return { success: false, message: 'Command cannot execute in current state' };
            }
        }

        try {
            this.log(`Executing command: ${id}`, options.args ? { args: options.args } : undefined);

            const result = await command.execute(this.context, options.args);

            // Normalize result
            const commandResult: CommandResult = result ?? { success: true };

            if (commandResult.success) {
                this.log(`Command '${id}' succeeded`, commandResult.data ? { data: commandResult.data } : undefined);
            } else {
                this.log(`Command '${id}' failed: ${commandResult.message}`, undefined, 'warn');
            }

            return commandResult;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[CommandService] Command '${id}' threw error:`, error);

            // Show toast unless silent
            if (!options.silent && this.context?.toastService) {
                this.context.toastService.error(`Error: ${message}`);
            }

            return { success: false, message };
        }
    }

    /**
     * Execute command for a keyboard shortcut.
     * 
     * @param shortcut - Shortcut string (e.g., 'Ctrl+Z')
     * @returns Promise resolving to CommandResult, or null if no command bound
     */
    async executeShortcut(shortcut: string): Promise<CommandResult | null> {
        const normalized = this.normalizeShortcut(shortcut);
        const commandId = this.shortcuts.get(normalized);

        if (!commandId) {
            this.log(`No command bound to shortcut: ${normalized}`);
            return null;
        }

        return this.execute(commandId);
    }

    /**
     * Check if a command can execute.
     * 
     * @param id - Command ID
     * @param args - Optional arguments
     * @returns true if command can execute
     */
    canExecute<TArgs = unknown>(id: string, args?: TArgs): boolean {
        const command = this.registry.get(id);

        if (!command || !this.context) {
            return false;
        }

        return command.canExecute(this.context, args);
    }

    // =========================================================================
    // Query Methods
    // =========================================================================

    /**
     * Get a command by ID
     */
    getCommand(id: string): Command<unknown> | undefined {
        return this.registry.get(id);
    }

    /**
     * Get all registered commands
     */
    getAllCommands(): Command<unknown>[] {
        return Array.from(this.registry.values());
    }

    /**
     * Get commands by category
     */
    getCommandsByCategory(category: CommandCategory): Command<unknown>[] {
        return this.getAllCommands().filter(cmd => cmd.category === category);
    }

    /**
     * Get currently enabled commands (for menus/palette)
     */
    getEnabledCommands(): Command<unknown>[] {
        if (!this.context) return [];

        return this.getAllCommands().filter(cmd =>
            cmd.canExecute(this.context!)
        );
    }

    /**
     * Check if a shortcut is registered
     */
    hasShortcut(shortcut: string): boolean {
        const normalized = this.normalizeShortcut(shortcut);
        return this.shortcuts.has(normalized);
    }

    /**
     * Get command ID for a shortcut
     */
    getCommandIdForShortcut(shortcut: string): string | undefined {
        const normalized = this.normalizeShortcut(shortcut);
        return this.shortcuts.get(normalized);
    }

    /**
     * Get all registered shortcuts
     */
    getAllShortcuts(): Map<string, string> {
        return new Map(this.shortcuts);
    }

    // =========================================================================
    // Debug Helpers
    // =========================================================================

    /**
     * Enable debug mode
     */
    enableDebug(): void {
        this.debugMode = true;
        if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__COMMAND_DEBUG__ = true;
        }
    }

    /**
     * Disable debug mode
     */
    disableDebug(): void {
        this.debugMode = false;
        if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__COMMAND_DEBUG__ = false;
        }
    }

    /**
     * Log a debug message
     * @private
     */
    private log(
        message: string,
        data?: Record<string, unknown>,
        level: 'log' | 'warn' | 'error' = 'log'
    ): void {
        if (!this.debugMode && level === 'log') return;

        const prefix = '[CommandService]';
        if (data) {
            console[level](prefix, message, data);
        } else {
            console[level](prefix, message);
        }
    }

    /**
     * Get registry stats (for debugging)
     */
    getStats(): { commandCount: number; shortcutCount: number; categories: Record<string, number> } {
        const categories: Record<string, number> = {};

        for (const cmd of this.registry.values()) {
            categories[cmd.category] = (categories[cmd.category] || 0) + 1;
        }

        return {
            commandCount: this.registry.size,
            shortcutCount: this.shortcuts.size,
            categories
        };
    }

    // =========================================================================
    // PHASE 2.3: Reactive canExecute$ for UI binding
    // =========================================================================

    /** Observable that emits when any command state might have changed */
    private stateChange$ = new BehaviorSubject<number>(0);

    /**
     * Notify that command states may have changed.
     * Call this when selection changes, history changes, etc.
     */
    notifyStateChange(): void {
        this.stateChange$.next(this.stateChange$.value + 1);
    }

    /**
     * Get an observable that emits the canExecute state for a command.
     * Emits immediately with current state, then whenever state changes.
     * 
     * @param commandId - The command ID to observe
     * @returns Observable<boolean> that emits canExecute state
     */
    canExecute$(commandId: string): Observable<boolean> {
        return this.stateChange$.pipe(
            map(() => this.canExecute(commandId)),
            distinctUntilChanged()
        );
    }

    /**
     * Get an observable for multiple commands at once.
     * Useful for updating multiple buttons together.
     * 
     * @param commandIds - Array of command IDs to observe
     * @returns Observable<Record<string, boolean>> mapping command IDs to canExecute state
     */
    canExecuteMany$(commandIds: string[]): Observable<Record<string, boolean>> {
        return this.stateChange$.pipe(
            map(() => {
                const result: Record<string, boolean> = {};
                for (const id of commandIds) {
                    result[id] = this.canExecute(id);
                }
                return result;
            }),
            distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
        );
    }
}
