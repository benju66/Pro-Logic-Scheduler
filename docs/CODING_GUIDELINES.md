# Coding Guidelines

## Dependency Injection

### The Golden Rule

> **All dependencies should be passed via constructor parameters.**

```typescript
// ✅ CORRECT
class MyService {
    constructor(
        private projectController: ProjectController,
        private selectionModel: SelectionModel
    ) {}
}

// ❌ INCORRECT - Do not add new getInstance() calls
class MyService {
    doSomething(): void {
        const controller = ProjectController.getInstance(); // ❌ Deprecated
    }
}
```

### Creating New Services

When creating a new service or class:

1. **Identify dependencies** - What other services does it need?
2. **Add to constructor** - Accept dependencies as constructor parameters
3. **Wire in main.ts** - Create and inject in the Composition Root

```typescript
// 1. Define service with constructor injection
class NewFeatureService {
    constructor(
        private projectController: ProjectController,
        private commandService: CommandService
    ) {}
    
    doFeature(): void {
        // Use injected dependencies
        const tasks = this.projectController.tasks$.value;
        this.commandService.execute('some.command');
    }
}

// 2. Wire in main.ts (Composition Root)
const newFeatureService = new NewFeatureService(
    projectController,
    commandService
);
```

### Deprecated Patterns

The following patterns are **deprecated** and show warnings in your IDE:

| Pattern | Status | Use Instead |
|---------|--------|-------------|
| `X.getInstance()` | ⚠️ Deprecated | Constructor injection |
| `X.setInstance()` | ⚠️ Deprecated | Constructor injection with mock |
| `X.resetInstance()` | ⚠️ Deprecated | Create new instance |
| `getEditingStateManager()` | ⚠️ Deprecated | Constructor injection |
| `getClipboardManager()` | ⚠️ Deprecated | Constructor injection |
| `getTradePartnerStore()` | ⚠️ Deprecated | Constructor injection |

### When You See Deprecated Methods

If you're modifying code that uses `getInstance()`:

1. **New code** - Use constructor injection instead
2. **Existing code** - Consider refactoring if touching that area
3. **Quick fix** - Leaving as-is is acceptable for small changes

---

## Code Organization

### File Structure

```
src/
├── commands/              # Command pattern implementations
│   ├── clipboard/        # Copy, Cut, Paste commands
│   ├── dependency/       # Link, Unlink commands
│   ├── edit/             # Undo, Redo commands
│   ├── hierarchy/        # Indent, Outdent, Move commands
│   ├── selection/        # Selection commands
│   ├── task/             # Task CRUD commands
│   ├── view/             # Zoom, View commands
│   ├── CommandService.ts # Central registry
│   └── types.ts          # Command types
├── core/                  # Core utilities and column system
│   ├── columns/          # Column registry and renderers
│   ├── calculations/     # Pure calculation functions
│   └── *.ts              # DateUtils, Constants, FeatureFlags
├── data/                  # Data layer (persistence, loading)
│   ├── PersistenceService.ts
│   ├── SnapshotService.ts
│   ├── DataLoader.ts
│   ├── HistoryManager.ts
│   └── TradePartnerStore.ts
├── services/              # Application services
│   ├── interfaces/       # Service interfaces for DI/testing
│   ├── migration/        # ViewCoordinator, SchedulingLogicService
│   ├── scheduler/        # SchedulerService subordinates (12 services)
│   └── *.ts              # ProjectController, SelectionModel, etc.
├── ui/                    # UI components and renderers
│   ├── components/       # UI components
│   ├── factories/        # Renderer factory
│   ├── panels/           # Right sidebar panels
│   ├── services/         # ToastService, FileService, KeyboardService
│   └── views/            # Full-page views
├── workers/               # Web Workers
│   └── scheduler.worker.ts # WASM CPM engine host
├── types/                 # TypeScript type definitions
├── utils/                 # Utility functions
├── sql/                   # SQL schema files
├── styles/                # Global CSS files
├── debug/                 # Debug utilities
└── main.ts                # COMPOSITION ROOT - ALL wiring here
```

### Composition Root (main.ts)

The `main.ts` file is the **single location** where services are created and wired. Services are organized into 7 levels:

```typescript
// main.ts - Composition Root

// Level 0: Leaf services (no dependencies)
const featureFlags = new FeatureFlags();
const clipboardManager = new ClipboardManager();
const selectionModel = new SelectionModel();
const editingStateManager = new EditingStateManager();

// Level 1: Column system + Core data
const columnRegistry = new ColumnRegistry();
const projectController = new ProjectController();

// Level 2: Support services
const commandService = new CommandService();
const zoomController = new ZoomController();
const schedulingLogicService = new SchedulingLogicService();
const tradePartnerStore = new TradePartnerStore();
const viewCoordinator = new ViewCoordinator({ projectController, selectionModel });

// Level 3: Renderer Factory
const rendererFactory = createRendererFactory({
    projectController,
    selectionModel,
    editingStateManager
});

// Level 4: Persistence services
const persistenceService = new PersistenceService();
const snapshotService = new SnapshotService();
const dataLoader = new DataLoader();
const historyManager = new HistoryManager({ maxHistory: 50 });

// Level 5: UI Services
const toastService = new ToastService({ container: document.body });
const fileService = new FileService({ isTauri, onToast: ... });

// Level 6: Subordinate Factory
const subordinateFactory = createSubordinateFactory({
    projectController,
    selectionModel,
    editingStateManager,
    commandService,
    columnRegistry,
    viewCoordinator,
    toastService,
    fileService,
    tradePartnerStore,
    persistenceService,
});

// Level 7: Orchestrator
const appInitializer = new AppInitializer({
    isTauri,
    rendererFactory,
    persistenceService,
    snapshotService,
    dataLoader,
    historyManager,
    subordinateFactory,
    // ... all other services
});
```

---

## Adding New Scheduler Subordinate Services

When adding a service to `SchedulerService`, use the **Subordinate Factory Pattern**:

### 1. Create the Service

```typescript
// src/services/scheduler/MyNewService.ts
export interface MyNewServiceOptions {
    projectController: ProjectController;
    toastService: ToastService;
    // Runtime callbacks from SchedulerService
    render: () => void;
    isInitialized: () => boolean;
}

export class MyNewService {
    constructor(private options: MyNewServiceOptions) {}
    
    doSomething(): void {
        const { projectController, toastService, render } = this.options;
        // Implementation
    }
}
```

### 2. Add to Factory Context

```typescript
// src/services/scheduler/SchedulerSubordinateFactory.ts
export interface SubordinateFactoryContext {
    // Add your new callbacks here if needed
    myNewCallback: () => void;
}

export interface SubordinateServicesBundle {
    // Add your new service here
    myNewService: MyNewService;
}
```

### 3. Wire in createSubordinateFactory

```typescript
// src/services/scheduler/createSubordinateFactory.ts
const myNewService = new MyNewService({
    projectController,
    toastService,
    render: ctx.render,
    isInitialized: ctx.isInitialized,
});

return {
    // ... existing services
    myNewService,
};
```

### 4. Use in SchedulerService

```typescript
// SchedulerService.ts
private myNewService!: MyNewService;

async init(): Promise<void> {
    const bundle = this.subordinateFactory.createAll(ctx);
    this.myNewService = bundle.myNewService;
}

// Delegate public methods
public doSomething(): void {
    this.myNewService.doSomething();
}
```

---

## Command Pattern

### Creating a New Command

Commands follow the VS Code pattern. Create commands in the appropriate category folder:

```typescript
// src/commands/task/MyNewCommand.ts
import type { Command, CommandContext, CommandResult } from '../types';

export const MyNewCommand: Command<{ taskId: string }> = {
    id: 'task.myNew',
    label: 'My New Command',
    category: 'task',
    shortcut: 'Ctrl+Shift+N', // Optional
    
    canExecute(ctx: CommandContext, args?: { taskId: string }): boolean {
        // Return false to disable command
        if (!args?.taskId) return false;
        return ctx.selection.getSelectedIds().length > 0;
    },
    
    execute(ctx: CommandContext, args?: { taskId: string }): CommandResult {
        const { controller, toastService } = ctx;
        
        // Implementation
        const task = controller.getTaskById(args!.taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }
        
        // Do something
        toastService?.success('Command executed!');
        return { success: true };
    }
};
```

### Register the Command

```typescript
// src/commands/task/index.ts
import { MyNewCommand } from './MyNewCommand';

export function registerTaskCommands(service: CommandService): void {
    service.register(InsertAboveCommand);
    service.register(InsertBelowCommand);
    service.register(MyNewCommand);  // Add here
    // ...
}
```

### Command Categories

Available categories for organizing commands:

| Category | Description | Examples |
|----------|-------------|----------|
| `task` | Task CRUD operations | add, delete, insert |
| `hierarchy` | Structure operations | indent, outdent, move |
| `selection` | Selection management | select all, clear |
| `clipboard` | Cut/copy/paste | copy, cut, paste |
| `dependency` | Link operations | link, unlink |
| `edit` | Edit operations | undo, redo |
| `navigation` | Movement | arrow keys, tab |
| `view` | View controls | zoom, collapse |
| `io` | File operations | import, export, save |
| `debug` | Developer tools | diagnostics |

---

## Testing

### Preferred: Constructor Injection

```typescript
describe('MyService', () => {
    it('should do something', () => {
        // Create mocks
        const mockController = {
            tasks$: { value: [] }
        } as unknown as ProjectController;
        
        // Inject via constructor
        const service = new MyService(mockController, mockCommandService);
        
        // Test
        service.doSomething();
        expect(/* ... */);
    });
});
```

### Legacy: setInstance() (Still Supported)

```typescript
describe('LegacyCode', () => {
    afterEach(() => {
        ProjectController.resetInstance();
    });
    
    it('should work', () => {
        ProjectController.setInstance(mockController);
        // ... test code that uses getInstance() internally
    });
});
```

### Using Interfaces for Mocking

The `src/services/interfaces/` directory contains interfaces for external I/O services:

```typescript
import type { IProjectController } from '../services/interfaces';

// Create a mock that satisfies the interface
const mockController: Partial<IProjectController> = {
    tasks$: new BehaviorSubject([]),
    getTaskById: vi.fn().mockReturnValue({ id: '1', name: 'Test' }),
    updateTask: vi.fn(),
};

// Use in tests
const service = new MyService(mockController as IProjectController);
```

**Available interfaces:**
- `IProjectController` - Task data and WASM worker interface
- `IPersistenceService` - SQLite event queue
- `IHistoryManager` - Undo/redo management
- `IClipboardManager` - Cut/copy/paste operations
- `IDataLoader` - SQLite data loading
- `ISnapshotService` - Checkpoint snapshots

---

## TypeScript Conventions

### Strict Mode

We use TypeScript strict mode. All types must be explicit:

```typescript
// ✅ CORRECT
function processTask(task: Task): ProcessedTask {
    return { ...task, processed: true };
}

// ❌ INCORRECT - Implicit any
function processTask(task) {
    return { ...task, processed: true };
}
```

### Type Imports

Use `type` imports for types that won't be used at runtime:

```typescript
// ✅ CORRECT - Type-only import
import type { Task, Calendar } from '../types';
import type { ProjectController } from '../services/ProjectController';

// Use regular import for classes you'll instantiate
import { SelectionModel } from '../services/SelectionModel';
```

### RxJS Patterns

When working with observables:

```typescript
// ✅ CORRECT - Subscribe with cleanup
class MyComponent {
    private subscriptions: Subscription[] = [];
    
    init(): void {
        const sub = this.projectController.tasks$.subscribe(tasks => {
            this.render(tasks);
        });
        this.subscriptions.push(sub);
    }
    
    destroy(): void {
        this.subscriptions.forEach(s => s.unsubscribe());
    }
}

// ✅ CORRECT - Get current value synchronously
const currentTasks = this.projectController.tasks$.value;
```

---

## Related Documentation

- [Master Specification](../master_spec.md) - System specification
- [Architecture Guide](architecture/ARCHITECTURE.md) - System architecture
- [ADR-001: Dependency Injection](adr/001-dependency-injection.md) - Architecture decision
