/**
 * @fileoverview Command Registry - Public API
 * @module commands
 * 
 * Central export for the Command Registry system.
 * 
 * Usage (Pure DI - recommended):
 * ```typescript
 * import { CommandService, registerAllCommands } from './commands';
 * import { ZoomController } from '../services/ZoomController';
 * 
 * // During app init (with explicit dependencies):
 * const commandService = new CommandService();
 * const zoomController = new ZoomController();
 * commandService.setContext({ ... });
 * registerAllCommands({ commandService, zoomController });
 * ```
 * 
 * Usage (Legacy - backward compatible):
 * ```typescript
 * import { CommandService, registerAllCommands } from './commands';
 * 
 * // During app init (uses singletons):
 * const service = CommandService.getInstance();
 * service.setContext({ ... });
 * registerAllCommands();
 * 
 * // Execute commands:
 * await service.execute('task.delete');
 * await service.executeShortcut('Ctrl+Z');
 * ```
 * 
 * @see docs/adr/001-dependency-injection.md
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
export { 
    CollapseCommand, 
    ExpandCommand, 
    ToggleCollapseCommand, 
    ZoomInCommand, 
    ZoomOutCommand, 
    FitToViewCommand, 
    ResetZoomCommand,
    // Factory functions for Pure DI
    createZoomInCommand,
    createZoomOutCommand,
    createFitToViewCommand,
    createResetZoomCommand
} from './view';
export { LinkSelectedCommand, UnlinkCommand } from './dependency';

// Debug command for testing
import type { Command } from './types';
import { CommandService } from './CommandService';
import { ZoomController } from '../services/ZoomController';

// Import commands for registration
import { DeleteSelectedCommand, InsertBelowCommand, InsertAboveCommand, AddChildCommand } from './task';
import { IndentCommand, OutdentCommand, MoveUpCommand, MoveDownCommand } from './hierarchy';
import { UndoCommand, RedoCommand } from './edit';
import { CopyCommand, CutCommand, PasteCommand } from './clipboard';
import { SelectAllCommand, EscapeCommand } from './selection';
import { 
    CollapseCommand, 
    ExpandCommand, 
    ToggleCollapseCommand,
    createZoomInCommand,
    createZoomOutCommand,
    createFitToViewCommand,
    createResetZoomCommand
} from './view';
import { LinkSelectedCommand, UnlinkCommand } from './dependency';

/**
 * Dependencies for command registration (optional for backward compatibility)
 * 
 * @see docs/adr/001-dependency-injection.md
 */
export interface RegisterCommandsDependencies {
    commandService?: CommandService;
    zoomController?: ZoomController;
}

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
 * 
 * MIGRATION NOTE (Pure DI):
 * - Accepts optional dependencies for testing and explicit injection
 * - Falls back to getInstance() for backward compatibility
 * - Zoom commands use factory functions to capture ZoomController
 * 
 * @param deps - Optional dependencies (uses singletons if not provided)
 * @see docs/adr/001-dependency-injection.md
 */
export function registerAllCommands(deps?: RegisterCommandsDependencies): void {
    const service = deps?.commandService || CommandService.getInstance();
    const zoomController = deps?.zoomController || ZoomController.getInstance();

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

    // View commands (non-zoom)
    service.register(CollapseCommand);
    service.register(ExpandCommand);
    service.register(ToggleCollapseCommand);
    
    // View commands (zoom) - use factory functions with injected ZoomController
    service.register(createZoomInCommand(zoomController));
    service.register(createZoomOutCommand(zoomController));
    service.register(createFitToViewCommand(zoomController));
    service.register(createResetZoomCommand(zoomController));

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
