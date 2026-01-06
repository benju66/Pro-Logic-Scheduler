/**
 * @fileoverview Command Registry - Public API
 * @module commands
 * 
 * Central export for the Command Registry system.
 * 
 * Usage:
 * ```typescript
 * import { CommandService, registerAllCommands } from './commands';
 * 
 * // During app init:
 * const service = CommandService.getInstance();
 * service.setContext({ ... });
 * registerAllCommands();
 * 
 * // Execute commands:
 * await service.execute('task.delete');
 * await service.executeShortcut('Ctrl+Z');
 * ```
 */

// Types
export type {
    Command,
    CommandContext,
    CommandCategory,
    CommandResult,
    ExecuteOptions,
    ICommandService
} from './types';

// Service
export { CommandService } from './CommandService';
export { CommandUIBinding } from './CommandUIBinding';

// Command categories
export { DeleteSelectedCommand, InsertBelowCommand, InsertAboveCommand, AddChildCommand } from './task';
export { IndentCommand, OutdentCommand, MoveUpCommand, MoveDownCommand } from './hierarchy';
export { UndoCommand, RedoCommand } from './edit';
export { CopyCommand, CutCommand, PasteCommand } from './clipboard';
export { SelectAllCommand, EscapeCommand } from './selection';
export { CollapseCommand, ExpandCommand, ToggleCollapseCommand, ZoomInCommand, ZoomOutCommand, FitToViewCommand, ResetZoomCommand } from './view';
export { LinkSelectedCommand, UnlinkCommand } from './dependency';

// Debug command for testing
import type { Command } from './types';
import { CommandService } from './CommandService';

// Import commands for registration
import { DeleteSelectedCommand, InsertBelowCommand, InsertAboveCommand, AddChildCommand } from './task';
import { IndentCommand, OutdentCommand, MoveUpCommand, MoveDownCommand } from './hierarchy';
import { UndoCommand, RedoCommand } from './edit';
import { CopyCommand, CutCommand, PasteCommand } from './clipboard';
import { SelectAllCommand, EscapeCommand } from './selection';
import { CollapseCommand, ExpandCommand, ToggleCollapseCommand, ZoomInCommand, ZoomOutCommand, FitToViewCommand, ResetZoomCommand } from './view';
import { LinkSelectedCommand, UnlinkCommand } from './dependency';

/**
 * Debug command for verifying the command system works.
 * Registered by default, can be removed in production.
 */
export const DebugHelloCommand: Command = {
    id: 'debug.hello',
    label: 'Hello World (Debug)',
    category: 'debug',
    icon: '👋',
    description: 'Test command to verify the command system is working',

    canExecute(): boolean {
        return true; // Always executable
    },

    execute(ctx) {
        const message = 'Hello from Command Registry!';
        console.log('[debug.hello]', message, {
            hasController: !!ctx.controller,
            hasSelection: !!ctx.selection,
            hasHistoryManager: !!ctx.historyManager,
            hasToastService: !!ctx.toastService,
            selectedCount: ctx.selection?.getSelectionCount() ?? 0
        });

        ctx.toastService?.success(message);

        return { success: true, message };
    }
};

/**
 * Register all commands with the CommandService.
 * Call this once during app initialization after setting context.
 */
export function registerAllCommands(): void {
    const service = CommandService.getInstance();

    // Task commands
    service.register(DeleteSelectedCommand);
    service.register(InsertBelowCommand);
    service.register(InsertAboveCommand);
    service.register(AddChildCommand);

    // Hierarchy commands
    service.register(IndentCommand);
    service.register(OutdentCommand);
    service.register(MoveUpCommand);
    service.register(MoveDownCommand);

    // Edit commands
    service.register(UndoCommand);
    service.register(RedoCommand);

    // Clipboard commands
    service.register(CopyCommand);
    service.register(CutCommand);
    service.register(PasteCommand);

    // Selection commands
    service.register(SelectAllCommand);
    service.register(EscapeCommand);

    // View commands
    service.register(CollapseCommand);
    service.register(ExpandCommand);
    service.register(ToggleCollapseCommand);
    service.register(ZoomInCommand);
    service.register(ZoomOutCommand);
    service.register(FitToViewCommand);
    service.register(ResetZoomCommand);

    // Dependency commands
    service.register(LinkSelectedCommand);
    service.register(UnlinkCommand);

    // Debug commands (can be removed in production)
    service.register(DebugHelloCommand);

    // Log registration complete
    const stats = service.getStats();
    console.log(
        `[CommandService] ✅ Registered ${stats.commandCount} commands with ${stats.shortcutCount} shortcuts`,
        stats.categories
    );
}

/**
 * Utility to build shortcut string from KeyboardEvent.
 * Use this in KeyboardService to convert events to shortcut strings.
 * 
 * @param e - Keyboard event
 * @returns Normalized shortcut string (e.g., 'Ctrl+Shift+Z')
 */
export function buildShortcutFromEvent(e: KeyboardEvent): string {
    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Normalize key
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();

    // Capitalize special keys
    if (key.startsWith('Arrow')) {
        // Already correct (ArrowUp, ArrowDown, etc.)
    } else if (key.length > 1) {
        // Capitalize first letter (delete -> Delete)
        key = key.charAt(0).toUpperCase() + key.slice(1);
    }

    parts.push(key);
    return parts.join('+');
}
