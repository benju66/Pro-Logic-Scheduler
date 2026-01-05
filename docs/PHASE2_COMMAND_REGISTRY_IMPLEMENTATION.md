# Phase 2: Command Registry Implementation Plan

**Goal:** Decouple "User Intent" from "UI Implementation" by moving user actions into discrete Command Objects.

**Estimated Duration:** 2-3 Days  
**Confidence Level:** 95% (Validated)  
**Document Created:** January 5, 2026  
**Last Updated:** January 5, 2026 (Post-Validation)

---

## Pre-Implementation Validation Results ✅

Validation performed on target codebase. **No blockers found.**

| Area | Confidence | Status |
|------|------------|--------|
| Generic typing integration | 95% | ✅ Standard TypeScript pattern |
| KeyboardService wiring | 98% | ✅ Callback pattern is ideal for migration |
| Method extraction complexity | 92% | ✅ `getVisibleTasks()` solves `_getFlatList()` |
| Initialization order | 95% | ✅ Lazy getter solves ToastService timing |
| HistoryManager integration | 98% | ✅ Already using correct composite pattern |

### Key Findings:
1. **KeyboardService** uses callback-based options - perfect for command delegation
2. **`_deleteSelected()`** is only ~30 lines, already uses `beginComposite()`/`endComposite()`
3. **`undo()`/`redo()`** are ~25 lines each, simple extraction
4. **`indentSelected()`/`outdentSelected()`** use private `_getFlatList()` - solved by using `ProjectController.getVisibleTasks()`
5. **`saveCheckpoint()`** is now a no-op - events auto-record via ProjectController
6. **ToastService** created inside SchedulerService - solved with lazy getter

---

## Executive Summary

The `SchedulerService` currently contains 120+ methods mixing orchestration logic with user actions (delete, indent, outdent, copy, paste, etc.). This creates:

- **Tight coupling** between UI components and business logic
- **Difficult testing** - can't test commands in isolation
- **Limited extensibility** - adding keyboard shortcuts or command palette requires touching SchedulerService

The **Command Registry** pattern (used by VS Code, Sublime Text, etc.) solves this by:

1. Defining each user action as a discrete `Command` object
2. Registering commands in a central `CommandService`
3. Executing commands by ID from anywhere (keyboard, menu, palette)
4. Enabling future features (command palette, custom keybindings) with zero additional work

---

## Part 1: Architecture Design

### 1.1 Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CommandService                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │   registry    │  │   shortcuts   │  │      context          │   │
│  │ Map<id,Cmd>   │  │ Map<key,id>   │  │ {controller,selection │   │
│  │               │  │               │  │  history,toast,...}   │   │
│  └───────────────┘  └───────────────┘  └───────────────────────┘   │
│                                                                      │
│  register(cmd)  │  execute(id)  │  executeShortcut(key)             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Commands                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ task.delete  │  │ task.indent  │  │ edit.undo    │   ...        │
│  │              │  │              │  │              │              │
│  │ canExecute() │  │ canExecute() │  │ canExecute() │              │
│  │ execute()    │  │ execute()    │  │ execute()    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CommandContext                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ProjectController│  │ SelectionModel │  │ HistoryManager │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │  ToastService  │  │OrderingService │  │ TradePartner   │        │
│  │                │  │                │  │    Store       │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
User Action (keyboard/click/menu)
         │
         ▼
┌─────────────────────┐
│   KeyboardService   │──► commandService.executeShortcut('Delete')
│   ContextMenu       │──► commandService.execute('task.delete')
│   CommandPalette    │──► commandService.execute('task.indent')
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   CommandService    │
│   .execute(id)      │
│                     │
│   1. Get command    │
│   2. Check context  │
│   3. canExecute()?  │
│   4. execute()      │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Command.execute() │
│                     │
│   Uses context:     │
│   - controller      │
│   - selection       │
│   - historyManager  │
│   - toastService    │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  ProjectController  │──► WASM Worker ──► tasks$ update ──► UI render
└─────────────────────┘
```

---

## Part 2: Type Definitions

### 2.1 CommandContext Interface

```typescript
// src/commands/types.ts

import type { Task } from '../types';
import type { ProjectController } from '../services/ProjectController';
import type { SelectionModel } from '../services/SelectionModel';
import type { HistoryManager } from '../data/HistoryManager';
import type { ToastService } from '../ui/services/ToastService';
import type { OrderingService } from '../services/OrderingService';
import type { TradePartnerStore } from '../data/TradePartnerStore';

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
  controller: ProjectController;
  
  /** Selection state (synchronous, UI-focused) */
  selection: SelectionModel;
  
  /** Undo/redo functionality */
  historyManager: HistoryManager | null;
  
  /** 
   * User notifications.
   * NOTE: Uses lazy getter pattern because ToastService is created
   * inside SchedulerService which initializes after CommandService.
   */
  readonly toastService: ToastService | null;
  
  /** Fractional indexing for task ordering (static methods) */
  orderingService: typeof OrderingService;
  
  /** Trade partner data access */
  tradePartnerStore: TradePartnerStore;
  
  /**
   * Get visible tasks respecting collapse state.
   * Replaces private _getFlatList() from SchedulerService.
   * Uses ProjectController.getVisibleTasks() internally.
   */
  getVisibleTasks(): Task[];
}
```

### 2.2 Command Interface

```typescript
// src/commands/types.ts (continued)

/**
 * Command category for organization and filtering
 */
export type CommandCategory = 
  | 'task'        // Task CRUD operations
  | 'hierarchy'   // Indent, outdent, move
  | 'selection'   // Select all, clear selection
  | 'clipboard'   // Cut, copy, paste
  | 'dependency'  // Link, unlink
  | 'edit'        // Undo, redo, cell editing
  | 'navigation'  // Arrow keys, tab, page up/down
  | 'view'        // Zoom, view mode, collapse/expand
  | 'io'          // Import, export, save
  | 'debug';      // Developer tools

/**
 * Command execution result
 */
export interface CommandResult {
  /** Whether the command completed successfully */
  success: boolean;
  
  /** Optional message for user feedback */
  message?: string;
  
  /** Optional data returned by the command */
  data?: unknown;
}

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
```

### 2.3 CommandService Interface

```typescript
// src/commands/types.ts (continued)

/**
 * Command execution options with typed args
 */
export interface ExecuteOptions<TArgs = unknown> {
  /** Typed arguments to pass to the command */
  args?: TArgs;
  
  /** If true, skip canExecute() check */
  force?: boolean;
  
  /** If true, don't show toast on error */
  silent?: boolean;
}

/**
 * CommandService public interface
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
}
```

---

## Part 3: File Structure

```
src/
├── commands/
│   ├── index.ts                    # Public exports + registerAllCommands()
│   ├── types.ts                    # All type definitions
│   ├── CommandService.ts           # Registry and execution logic
│   │
│   ├── task/                       # Task CRUD commands
│   │   ├── index.ts               # Export all task commands
│   │   ├── DeleteSelectedCommand.ts
│   │   ├── AddTaskBelowCommand.ts
│   │   ├── AddTaskAboveCommand.ts
│   │   └── AddBlankRowCommand.ts
│   │
│   ├── hierarchy/                  # Hierarchy manipulation
│   │   ├── index.ts
│   │   ├── IndentCommand.ts
│   │   ├── OutdentCommand.ts
│   │   ├── MoveUpCommand.ts
│   │   └── MoveDownCommand.ts
│   │
│   ├── clipboard/                  # Clipboard operations
│   │   ├── index.ts
│   │   ├── CopyCommand.ts
│   │   ├── CutCommand.ts
│   │   └── PasteCommand.ts
│   │
│   ├── edit/                       # Edit operations
│   │   ├── index.ts
│   │   ├── UndoCommand.ts
│   │   ├── RedoCommand.ts
│   │   └── SelectAllCommand.ts
│   │
│   ├── dependency/                 # Dependency/link operations
│   │   ├── index.ts
│   │   ├── LinkSelectedCommand.ts
│   │   └── UnlinkCommand.ts
│   │
│   └── view/                       # View operations
│       ├── index.ts
│       ├── CollapseCommand.ts
│       ├── ExpandCommand.ts
│       └── ToggleCollapseCommand.ts
```

---

## Part 4: Implementation Phases

### Phase 2.0: Foundation (Day 1 Morning) - ~2 hours

**Goal:** Create the command infrastructure without migrating any existing code.

#### Step 2.0.1: Create Type Definitions

Create `src/commands/types.ts` with:
- `CommandContext` interface
- `CommandCategory` type
- `CommandResult` interface
- `Command` interface
- `ExecuteOptions` interface
- `ICommandService` interface

#### Step 2.0.2: Create CommandService

Create `src/commands/CommandService.ts`:

```typescript
/**
 * CommandService - Central registry and executor for all commands
 * 
 * This is the "switchboard" for user actions. It maintains a registry
 * of all commands and provides methods to execute them by ID or shortcut.
 */
export class CommandService implements ICommandService {
  private static instance: CommandService;
  
  /** Command registry: id -> Command */
  private registry = new Map<string, Command>();
  
  /** Shortcut mapping: normalized shortcut -> command id */
  private shortcuts = new Map<string, string>();
  
  /** Injected dependencies for commands */
  private context: CommandContext | null = null;

  private constructor() {}

  static getInstance(): CommandService {
    if (!CommandService.instance) {
      CommandService.instance = new CommandService();
    }
    return CommandService.instance;
  }

  // ... implementation details in full code
}
```

Key methods to implement:
- `setContext(ctx: CommandContext): void`
- `register(command: Command): void`
- `execute(id: string, options?: ExecuteOptions): Promise<CommandResult>`
- `executeShortcut(shortcut: string): Promise<CommandResult | null>`
- `canExecute(id: string): boolean`
- `getCommand(id: string): Command | undefined`
- `getAllCommands(): Command[]`
- `getCommandsByCategory(category: CommandCategory): Command[]`
- `getEnabledCommands(): Command[]`
- `private normalizeShortcut(shortcut: string): string`

#### Step 2.0.3: Create Index File

Create `src/commands/index.ts`:

```typescript
// Export types
export type { 
  Command, 
  CommandContext, 
  CommandResult, 
  CommandCategory,
  ExecuteOptions,
  ICommandService 
} from './types';

// Export service
export { CommandService } from './CommandService';

// Command registration (to be populated)
export function registerAllCommands(): void {
  const service = CommandService.getInstance();
  
  // Phase 2.1 commands will be registered here
  
  console.log('[Commands] All commands registered');
}
```

#### Step 2.0.4: Wire into AppInitializer

Add to `AppInitializer.ts`:

```typescript
import { CommandService, registerAllCommands } from '../commands';
import type { CommandContext } from '../commands';
import { OrderingService } from './OrderingService';
import { getTradePartnerStore } from '../data/TradePartnerStore';

// Add new method
private _initializeCommandService(): void {
  console.log('[AppInitializer] 🎮 Initializing Command Service...');
  
  const service = CommandService.getInstance();
  const self = this;  // Capture for closures
  
  // Build command context with all dependencies
  // NOTE: Uses lazy getter for toastService (created inside SchedulerService)
  const context: CommandContext = {
    controller: ProjectController.getInstance(),
    selection: SelectionModel.getInstance(),
    historyManager: this.historyManager,
    
    // LAZY GETTER: ToastService is created inside SchedulerService
    // which may not be fully initialized when CommandService is set up
    get toastService() {
      return self.scheduler?.toastService ?? null;
    },
    
    // Static class with utility methods
    orderingService: OrderingService,
    
    tradePartnerStore: getTradePartnerStore(),
    
    // Helper method replacing private _getFlatList()
    getVisibleTasks(): Task[] {
      const controller = ProjectController.getInstance();
      return controller.getVisibleTasks((id) => {
        const task = controller.getTaskById(id);
        return task?._collapsed ?? false;
      });
    }
  };
  
  service.setContext(context);
  registerAllCommands();
  
  console.log('[AppInitializer] ✅ Command Service initialized');
}

// Call in initialize() AFTER _initializeScheduler()
// This ensures scheduler exists for the lazy toastService getter
```

#### Step 2.0.5: Verification Test

Create a test command to verify the system works:

```typescript
// Temporary test in registerAllCommands()
service.register({
  id: 'debug.hello',
  label: 'Hello World',
  category: 'debug',
  shortcut: 'Ctrl+Shift+H',
  canExecute: () => true,
  execute: (ctx) => {
    ctx.toastService.show('Command system working!', 'success');
    return { success: true };
  }
});
```

**Verification:**
- [ ] App initializes without errors
- [ ] Console shows command registration logs
- [ ] `Ctrl+Shift+H` shows toast (if keyboard wired)

---

### Phase 2.1: First Commands (Day 1 Afternoon) - ~3 hours

**Goal:** Migrate 5 core commands from SchedulerService.

#### Step 2.1.1: Create task/DeleteSelectedCommand.ts

Extract logic from `SchedulerService.deleteSelected()`:

```typescript
export const DeleteSelectedCommand: Command = {
  id: 'task.delete',
  label: 'Delete Selected Tasks',
  category: 'task',
  shortcut: 'Delete',
  icon: '🗑️',
  
  canExecute(ctx: CommandContext): boolean {
    return ctx.selection.getSelectionCount() > 0;
  },
  
  execute(ctx: CommandContext): CommandResult {
    const selectedIds = ctx.selection.getSelectedIds();
    
    if (selectedIds.length === 0) {
      return { success: false, message: 'No tasks selected' };
    }
    
    // Begin composite for single undo
    ctx.historyManager?.beginComposite(`Delete ${selectedIds.length} Task(s)`);
    
    try {
      // Delete in correct order (children before parents)
      const tasks = ctx.controller.getTasks();
      const toDelete = selectedIds
        .map(id => tasks.find(t => t.id === id))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .sort((a, b) => (b.level || 0) - (a.level || 0));
      
      for (const task of toDelete) {
        ctx.controller.deleteTask(task.id);
      }
      
      ctx.historyManager?.endComposite();
      ctx.selection.clear();
      ctx.toastService?.show(`Deleted ${toDelete.length} task(s)`, 'success');
      
      return { success: true, data: { deletedCount: toDelete.length } };
    } catch (error) {
      ctx.historyManager?.cancelComposite();
      throw error;
    }
  }
};
```

#### Step 2.1.2: Create hierarchy/IndentCommand.ts

Extract logic from `SchedulerService.indentSelected()`.

**Key change:** Uses `ctx.getVisibleTasks()` instead of private `_getFlatList()`.

```typescript
export const IndentCommand: Command = {
  id: 'hierarchy.indent',
  label: 'Indent Selected Tasks',
  category: 'hierarchy',
  shortcut: 'Tab',
  icon: '→',
  
  canExecute(ctx: CommandContext): boolean {
    if (ctx.selection.isEmpty()) return false;
    
    // Use getVisibleTasks() from context (replaces _getFlatList())
    const list = ctx.getVisibleTasks();
    const selectedIds = new Set(ctx.selection.getSelectedIds());
    
    // Find first selected task in visual order
    const firstSelected = list.find(t => selectedIds.has(t.id));
    if (!firstSelected) return false;
    
    const idx = list.findIndex(t => t.id === firstSelected.id);
    if (idx <= 0) return false; // Can't indent first task
    
    // Check if previous task can be parent
    const prev = list[idx - 1];
    const taskDepth = ctx.controller.getDepth(firstSelected.id);
    const prevDepth = ctx.controller.getDepth(prev.id);
    
    // Can only indent if prev is at same or higher depth
    return prevDepth >= taskDepth;
  },
  
  execute(ctx: CommandContext): CommandResult {
    const list = ctx.getVisibleTasks();
    const selectedIds = new Set(ctx.selection.getSelectedIds());
    
    // Get top-level selected tasks (parent not in selection)
    const topLevelSelected = list.filter(task =>
      selectedIds.has(task.id) &&
      (!task.parentId || !selectedIds.has(task.parentId))
    );
    
    let indentedCount = 0;
    
    for (const task of topLevelSelected) {
      const idx = list.findIndex(t => t.id === task.id);
      if (idx <= 0) continue;
      
      const prev = list[idx - 1];
      const taskDepth = ctx.controller.getDepth(task.id);
      const prevDepth = ctx.controller.getDepth(prev.id);
      
      if (prevDepth < taskDepth) continue;
      
      let newParentId: string | null = null;
      if (prevDepth === taskDepth) {
        newParentId = prev.id;
      } else {
        // Walk up to find appropriate parent
        let curr = prev;
        while (curr && ctx.controller.getDepth(curr.id) > taskDepth) {
          curr = curr.parentId ? ctx.controller.getTaskById(curr.parentId)! : null!;
        }
        if (curr) newParentId = curr.id;
      }
      
      if (newParentId !== null) {
        const newSortKey = ctx.orderingService.generateAppendKey(
          ctx.controller.getLastSortKey(newParentId)
        );
        ctx.controller.moveTask(task.id, newParentId, newSortKey);
        indentedCount++;
      }
    }
    
    if (indentedCount > 0) {
      ctx.toastService?.show(`Indented ${indentedCount} task(s)`, 'success');
    }
    
    return { success: true, data: { indentedCount } };
  }
};
```

#### Step 2.1.3: Create hierarchy/OutdentCommand.ts

Extract logic from `SchedulerService.outdentSelected()`.

**Key change:** Uses `ctx.getVisibleTasks()` instead of private `_getFlatList()`.

```typescript
export const OutdentCommand: Command = {
  id: 'hierarchy.outdent',
  label: 'Outdent Selected Tasks',
  category: 'hierarchy',
  shortcut: 'Shift+Tab',
  icon: '←',
  
  canExecute(ctx: CommandContext): boolean {
    if (ctx.selection.isEmpty()) return false;
    
    // Can't outdent root-level tasks
    const list = ctx.getVisibleTasks();
    const selectedIds = new Set(ctx.selection.getSelectedIds());
    const firstSelected = list.find(t => selectedIds.has(t.id));
    
    return !!firstSelected?.parentId;
  },
  
  execute(ctx: CommandContext): CommandResult {
    const list = ctx.getVisibleTasks();
    const selectedIds = new Set(ctx.selection.getSelectedIds());
    const allTasks = ctx.controller.getTasks();
    
    // Get top-level selected tasks (parent not in selection)
    const topLevelSelected = list.filter(task =>
      selectedIds.has(task.id) &&
      (!task.parentId || !selectedIds.has(task.parentId))
    );
    
    let outdentedCount = 0;
    
    for (const task of topLevelSelected) {
      if (!task.parentId) continue; // Already at root
      
      const currentParent = allTasks.find(t => t.id === task.parentId);
      const grandparentId = currentParent?.parentId ?? null;
      
      // Position after former parent among its siblings
      const auntsUncles = ctx.controller.getChildren(grandparentId);
      const formerParentIndex = auntsUncles.findIndex(t => t.id === currentParent?.id);
      
      const beforeKey = currentParent?.sortKey ?? null;
      const afterKey = formerParentIndex < auntsUncles.length - 1
        ? auntsUncles[formerParentIndex + 1].sortKey
        : null;
      
      const newSortKey = ctx.orderingService.generateInsertKey(beforeKey, afterKey);
      
      ctx.controller.updateTask(task.id, {
        parentId: grandparentId,
        sortKey: newSortKey
      });
      outdentedCount++;
    }
    
    if (outdentedCount > 0) {
      ctx.toastService?.show(`Outdented ${outdentedCount} task(s)`, 'success');
    }
    
    return { success: true, data: { outdentedCount } };
  }
};
```

#### Step 2.1.4: Create edit/UndoCommand.ts

**Note:** Uses null-safe `ctx.toastService?.` pattern.

```typescript
export const UndoCommand: Command = {
  id: 'edit.undo',
  label: 'Undo',
  category: 'edit',
  shortcut: 'Ctrl+Z',
  icon: '↩️',
  
  canExecute(ctx: CommandContext): boolean {
    return ctx.historyManager?.canUndo() ?? false;
  },
  
  execute(ctx: CommandContext): CommandResult {
    if (!ctx.historyManager) {
      return { success: false, message: 'History manager not available' };
    }
    
    const events = ctx.historyManager.undo();
    if (!events || events.length === 0) {
      ctx.toastService?.show('Nothing to undo', 'info');
      return { success: false, message: 'Nothing to undo' };
    }
    
    // Apply backward events through ProjectController
    // ProjectController handles optimistic updates and worker sync
    ctx.controller.applyEvents(events);
    
    const label = ctx.historyManager.getRedoLabel();
    ctx.toastService?.show(label ? `Undone: ${label}` : 'Undone', 'info');
    
    return { success: true };
  }
};
```

#### Step 2.1.5: Create edit/RedoCommand.ts

**Note:** Uses null-safe `ctx.toastService?.` pattern.

```typescript
export const RedoCommand: Command = {
  id: 'edit.redo',
  label: 'Redo',
  category: 'edit',
  shortcut: 'Ctrl+Y',
  alternateShortcuts: ['Ctrl+Shift+Z'],
  icon: '↪️',
  
  canExecute(ctx: CommandContext): boolean {
    return ctx.historyManager?.canRedo() ?? false;
  },
  
  execute(ctx: CommandContext): CommandResult {
    if (!ctx.historyManager) {
      return { success: false, message: 'History manager not available' };
    }
    
    const events = ctx.historyManager.redo();
    if (!events || events.length === 0) {
      ctx.toastService?.show('Nothing to redo', 'info');
      return { success: false, message: 'Nothing to redo' };
    }
    
    // Apply forward events through ProjectController
    // ProjectController handles optimistic updates and worker sync
    ctx.controller.applyEvents(events);
    
    const label = ctx.historyManager.getUndoLabel();
    ctx.toastService?.show(label ? `Redone: ${label}` : 'Redone', 'info');
    
    return { success: true };
  }
};
```

#### Step 2.1.6: Update registerAllCommands()

```typescript
import { DeleteSelectedCommand } from './task/DeleteSelectedCommand';
import { IndentCommand, OutdentCommand } from './hierarchy';
import { UndoCommand, RedoCommand } from './edit';

export function registerAllCommands(): void {
  const service = CommandService.getInstance();
  
  // Task commands
  service.register(DeleteSelectedCommand);
  
  // Hierarchy commands
  service.register(IndentCommand);
  service.register(OutdentCommand);
  
  // Edit commands
  service.register(UndoCommand);
  service.register(RedoCommand);
  
  console.log('[Commands] Registered 5 commands');
}
```

---

### Phase 2.2: Keyboard Integration (Day 2 Morning) - ~2 hours

**Goal:** Wire CommandService into keyboard handling.

**Validation Note:** The current `KeyboardService` uses a callback-based pattern:
```typescript
// Current pattern (to be replaced):
if (isCtrl && e.key === 'z' && !e.shiftKey) { 
  if (this.options.onUndo) this.options.onUndo(); 
  return; 
}
```

This is ideal for migration - we replace callbacks with `commandService.executeShortcut()`.

#### Step 2.2.1: Update KeyboardService

Replace callback-based handling with command execution:

```typescript
// In KeyboardService.ts

import { CommandService } from '../commands';

export class KeyboardService {
  private commandService = CommandService.getInstance();
  
  // Updated _handleKeyDown replaces the large if/else block
  private _handleKeyDown(e: KeyboardEvent): void {
    // Skip if not enabled or in editing mode that should block shortcuts
    if (!this.isEnabled || !this.isAppReady) return;
    if (this.isEditing && !this._isShortcutActiveWhileEditing(e)) return;
    
    // Build shortcut string
    const shortcut = this.buildShortcutString(e);
    
    // Try command service first (registry-driven)
    const handled = this.commandService.executeShortcut(shortcut);
    if (handled) {
      e.preventDefault();
      return;
    }
    
    // Fall back to legacy callbacks (during migration)
    this._handleLegacyShortcut(e);
  }
  
  private buildShortcutString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    
    // Normalize key names
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    
    parts.push(key);
    return parts.join('+');
  }
  
  // Shortcuts that work even while editing a cell
  private _isShortcutActiveWhileEditing(e: KeyboardEvent): boolean {
    const shortcut = this.buildShortcutString(e);
    // Undo/Redo always active, Escape to cancel edit
    return shortcut === 'Ctrl+Z' || shortcut === 'Ctrl+Y' || 
           shortcut === 'Ctrl+Shift+Z' || shortcut === 'Escape';
  }
  
  // Move legacy if/else blocks here during migration
  private _handleLegacyShortcut(e: KeyboardEvent): void {
    // ... remaining callbacks that haven't been migrated yet ...
  }
}
```

#### Step 2.2.2: Handle Special Cases

Tab key needs special handling (indent vs. cell navigation):

```typescript
// In KeyboardService or command canExecute
if (shortcut === 'Tab' && this.isGridFocused()) {
  // Check if we're in a cell - if so, navigate don't indent
  const editingManager = getEditingStateManager();
  if (editingManager.isEditing()) {
    // Let grid handle Tab for cell navigation
    return false;
  }
}
```

---

### Phase 2.3: SchedulerService Delegation (Day 2 Afternoon) - ~2 hours

**Goal:** Make SchedulerService methods delegate to commands (strangler fig).

#### Step 2.3.1: Add CommandService Reference

```typescript
// In SchedulerService.ts

import { CommandService } from './commands';

export class SchedulerService {
  private commandService = CommandService.getInstance();
  
  // ... existing code
}
```

#### Step 2.3.2: Delegate delete

```typescript
// Before:
deleteSelected(): void {
  const selectedIds = this._sel_toArray();
  // ... 50 lines of delete logic
}

// After:
deleteSelected(): void {
  this.commandService.execute('task.delete');
}
```

#### Step 2.3.3: Delegate indent/outdent

```typescript
// Before:
indentSelected(): void {
  // ... 80 lines of indent logic
}

// After:
indentSelected(): void {
  this.commandService.execute('hierarchy.indent');
}

outdentSelected(): void {
  this.commandService.execute('hierarchy.outdent');
}
```

#### Step 2.3.4: Delegate undo/redo

```typescript
// Before:
undo(): void {
  const events = this.historyManager.undo();
  // ... apply events
}

// After:
undo(): void {
  this.commandService.execute('edit.undo');
}

redo(): void {
  this.commandService.execute('edit.redo');
}
```

---

### Phase 2.4: Additional Commands (Day 3) - ~4 hours

**Goal:** Migrate remaining high-value commands.

#### Commands to Add:

| ID | Source Method | Priority |
|----|---------------|----------|
| `task.addBelow` | `addTask()` | High |
| `task.addAbove` | `addTaskAbove()` | High |
| `task.addBlankRow` | `addBlankRow()` | Medium |
| `clipboard.copy` | `copyToClipboard()` | High |
| `clipboard.cut` | `cutToClipboard()` | High |
| `clipboard.paste` | `pasteFromClipboard()` | High |
| `dependency.link` | `linkSelectedTasks()` | Medium |
| `selection.all` | `selectAll()` | Medium |
| `view.collapse` | `collapseSelected()` | Low |
| `view.expand` | `expandSelected()` | Low |

---

## Part 5: Testing Strategy

### 5.1 Unit Tests for Commands

Create `src/commands/__tests__/DeleteSelectedCommand.test.ts`:

```typescript
import { DeleteSelectedCommand } from '../task/DeleteSelectedCommand';
import type { CommandContext } from '../types';

describe('DeleteSelectedCommand', () => {
  let mockContext: CommandContext;
  
  beforeEach(() => {
    mockContext = {
      controller: {
        getTasks: jest.fn().mockReturnValue([
          { id: '1', name: 'Task 1', level: 0 },
          { id: '2', name: 'Task 2', level: 0 },
        ]),
        deleteTask: jest.fn(),
      },
      selection: {
        getSelectedIds: jest.fn().mockReturnValue(['1']),
        getSelectionCount: jest.fn().mockReturnValue(1),
        isEmpty: jest.fn().mockReturnValue(false),
        clear: jest.fn(),
      },
      historyManager: {
        beginComposite: jest.fn(),
        endComposite: jest.fn(),
        cancelComposite: jest.fn(),
      },
      toastService: {
        show: jest.fn(),
      },
    } as unknown as CommandContext;
  });
  
  describe('canExecute', () => {
    it('returns true when tasks are selected', () => {
      expect(DeleteSelectedCommand.canExecute(mockContext)).toBe(true);
    });
    
    it('returns false when no tasks selected', () => {
      (mockContext.selection.getSelectionCount as jest.Mock).mockReturnValue(0);
      expect(DeleteSelectedCommand.canExecute(mockContext)).toBe(false);
    });
  });
  
  describe('execute', () => {
    it('deletes selected tasks', () => {
      const result = DeleteSelectedCommand.execute(mockContext);
      
      expect(mockContext.controller.deleteTask).toHaveBeenCalledWith('1');
      expect(mockContext.selection.clear).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { deletedCount: 1 } });
    });
    
    it('groups deletions in composite for undo', () => {
      DeleteSelectedCommand.execute(mockContext);
      
      expect(mockContext.historyManager?.beginComposite).toHaveBeenCalledWith('Delete 1 Task(s)');
      expect(mockContext.historyManager?.endComposite).toHaveBeenCalled();
    });
  });
});
```

### 5.2 Integration Tests

Create `tests/integration/commands.test.ts`:

```typescript
describe('Command Integration', () => {
  it('keyboard shortcut executes command', async () => {
    // Simulate Delete key press
    const event = new KeyboardEvent('keydown', { key: 'Delete' });
    document.dispatchEvent(event);
    
    // Verify task was deleted
    await waitFor(() => {
      expect(scheduler.tasks.length).toBe(initialCount - 1);
    });
  });
  
  it('undo reverses delete', async () => {
    // Delete a task
    await commandService.execute('task.delete');
    const afterDelete = scheduler.tasks.length;
    
    // Undo
    await commandService.execute('edit.undo');
    
    expect(scheduler.tasks.length).toBe(afterDelete + 1);
  });
});
```

---

## Part 6: Migration Checklist

### Phase 2.0: Foundation
- [ ] Create `src/commands/types.ts`
- [ ] Create `src/commands/CommandService.ts`
- [ ] Create `src/commands/index.ts`
- [ ] Add `_initializeCommandService()` to AppInitializer
- [ ] Call `_initializeCommandService()` in initialize()
- [ ] Verify with debug.hello command

### Phase 2.1: First Commands
- [ ] Create `src/commands/task/DeleteSelectedCommand.ts`
- [ ] Create `src/commands/hierarchy/IndentCommand.ts`
- [ ] Create `src/commands/hierarchy/OutdentCommand.ts`
- [ ] Create `src/commands/edit/UndoCommand.ts`
- [ ] Create `src/commands/edit/RedoCommand.ts`
- [ ] Create index files for each category
- [ ] Update `registerAllCommands()`
- [ ] Verify each command works in console: `CommandService.getInstance().execute('task.delete')`

### Phase 2.2: Keyboard Integration
- [ ] Add shortcut handling to KeyboardService
- [ ] Handle Tab special case (indent vs. cell nav)
- [ ] Verify Delete key deletes tasks
- [ ] Verify Tab indents (when not editing)
- [ ] Verify Ctrl+Z undoes

### Phase 2.3: SchedulerService Delegation
- [ ] Add commandService property to SchedulerService
- [ ] Delegate `deleteSelected()` → `task.delete`
- [ ] Delegate `indentSelected()` → `hierarchy.indent`
- [ ] Delegate `outdentSelected()` → `hierarchy.outdent`
- [ ] Delegate `undo()` → `edit.undo`
- [ ] Delegate `redo()` → `edit.redo`
- [ ] Remove old implementation code (or keep behind flag)

### Phase 2.4: Additional Commands
- [ ] Implement clipboard commands
- [ ] Implement task.addBelow
- [ ] Implement task.addAbove
- [ ] Implement dependency.link
- [ ] Implement selection.all

---

## Part 7: Rollback Strategy

### Instant Rollback via Feature Flag

Add to `SchedulerService.ts`:

```typescript
const USE_COMMAND_SERVICE = true;  // Flip to false to revert

deleteSelected(): void {
  if (USE_COMMAND_SERVICE) {
    this.commandService.execute('task.delete');
  } else {
    // Original implementation
    const selectedIds = this._sel_toArray();
    // ...
  }
}
```

### Git Strategy

```bash
# Each phase = separate commit
git commit -m "Phase 2.0: Create CommandService foundation"
git commit -m "Phase 2.1: Add first 5 commands"
git commit -m "Phase 2.2: Wire keyboard shortcuts"
git commit -m "Phase 2.3: Delegate SchedulerService methods"

# Rollback any phase:
git revert <commit-hash>
```

---

## Part 8: Success Metrics

| Metric | Before | After | How to Verify |
|--------|--------|-------|---------------|
| Commands in CommandService | 0 | 5+ | `CommandService.getInstance().getAllCommands().length` |
| SchedulerService methods reduced | 120+ | 115+ | Grep for `public\|private.*\(` |
| Keyboard handled by commands | 0% | 20%+ | Count shortcuts in command registry |
| Command unit test coverage | N/A | >80% | `npm test -- --coverage` |

---

## Part 9: Future Enhancements (Out of Scope for Phase 2)

These become trivial once Command Registry exists:

### Command Palette (Ctrl+Shift+P)
```typescript
// Get all enabled commands
const commands = commandService.getEnabledCommands();
// Show in fuzzy-search modal
// On select: commandService.execute(command.id)
```

### Custom Keybindings
```typescript
// Store user preferences
const customBindings = localStorage.getItem('keybindings');
// Override default shortcuts
commandService.rebindShortcut('task.delete', 'Ctrl+D');
```

### Context Menu from Commands
```typescript
// Right-click on task
const menuItems = commandService.getCommandsByCategory('task')
  .filter(cmd => cmd.canExecute(context))
  .map(cmd => ({ label: cmd.label, action: () => cmd.execute(context) }));
```

### Macro Recording
```typescript
// Record command sequence
commandService.on('executed', (id, args) => macro.push({ id, args }));
// Replay
macro.forEach(({ id, args }) => commandService.execute(id, { args }));
```

---

## Appendix A: Command ID Naming Convention

```
{category}.{action}[.{modifier}]

Examples:
  task.delete
  task.add.below
  task.add.above
  hierarchy.indent
  hierarchy.outdent
  hierarchy.move.up
  hierarchy.move.down
  clipboard.copy
  clipboard.cut
  clipboard.paste
  edit.undo
  edit.redo
  edit.selectAll
  dependency.link
  dependency.unlink
  view.collapse
  view.expand
  view.toggleCollapse
  io.save
  io.export.json
  io.export.xml
  io.import.json
```

---

## Appendix B: Shortcut Normalization Rules

```typescript
// Normalize for consistent matching
function normalizeShortcut(shortcut: string): string {
  return shortcut
    .toLowerCase()
    .replace(/\s+/g, '')           // Remove spaces
    .replace(/cmd/g, 'ctrl')       // Mac Cmd → Ctrl
    .replace(/meta/g, 'ctrl')      // Meta → Ctrl
    .split('+')
    .sort((a, b) => {
      // Modifiers first, in consistent order
      const order = ['ctrl', 'alt', 'shift'];
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    })
    .join('+');
}

// Examples:
// 'Ctrl+Shift+P' → 'ctrl+shift+p'
// 'Shift+Ctrl+P' → 'ctrl+shift+p' (same result)
// 'Cmd+Z'        → 'ctrl+z'
// 'Delete'       → 'delete'
```

---

## Appendix C: Full File List

Files to create:
```
src/commands/
├── index.ts
├── types.ts
├── CommandService.ts
├── task/
│   ├── index.ts
│   └── DeleteSelectedCommand.ts
├── hierarchy/
│   ├── index.ts
│   ├── IndentCommand.ts
│   └── OutdentCommand.ts
└── edit/
    ├── index.ts
    ├── UndoCommand.ts
    └── RedoCommand.ts
```

Files to modify:
```
src/services/AppInitializer.ts    # Add _initializeCommandService()
src/services/SchedulerService.ts  # Delegate to commands
src/ui/services/KeyboardService.ts # Route shortcuts to commands
```

---

**Document Version:** 1.1  
**Last Updated:** January 5, 2026 (Post-Validation Update)  
**Author:** AI Assistant  
**Status:** Ready for Implementation (Validated)

---

## Change Log

### Version 1.1 (Post-Validation)
- Added validation results section with confidence levels
- Updated `Command` interface to use generics (`Command<TArgs>`)
- Added `getVisibleTasks()` helper to `CommandContext` (replaces `_getFlatList()`)
- Changed `toastService` to lazy getter pattern (null-safe)
- Updated all command examples with null-safe `ctx.toastService?.` access
- Updated `IndentCommand` and `OutdentCommand` with full implementations
- Changed `orderingService` to static class reference (`typeof OrderingService`)

### Version 1.0 (Initial)
- Initial implementation plan
