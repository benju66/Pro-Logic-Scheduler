# Pro Logic Scheduler - Architecture Guide

## Overview

Pro Logic Scheduler is a high-performance, desktop-class construction scheduling application. It is architected for speed ("Ferrari Engine"), using direct DOM manipulation for the critical rendering path while keeping business logic pure and portable.

**Version:** 6.0.0 (WASM Worker Architecture)

## Core Principles

### 1. **Performance First (The "Ferrari Engine")**
The rendering layer eschews heavy framework reconciliation (React/Vue) for the critical grid/gantt components. It uses direct DOM pooling and integer-snapped canvas drawing to achieve 60 FPS with 10,000+ tasks.

### 2. **Unified Viewport ("The Puppeteer")**
A single master controller (`SchedulerViewport`) owns the scroll state and "drives" two dumb renderers (`GridRenderer` and `GanttRenderer`) in a single animation frame. This eliminates scroll jitter and synchronization lag.

**Synchronous Data Updates:** To eliminate visual flashing, renderer data is updated synchronously before scheduling renders. `_updateGridDataSync()` and `_updateGanttDataSync()` ensure both renderers have fresh task data immediately, preventing the delay between data change and visual update.

### 3. **Fractional Indexing**
Task ordering is managed via lexicographical string keys (e.g., `"a0"`, `"a0V"`). This allows infinite reordering between any two tasks without updating the database records of siblings, enabling robust offline-first capabilities.

### 4. **Desktop-Only Architecture**
- **WASM CPM Engine**: All scheduling calculations performed in Rust-compiled WASM for maximum performance (O(N) complexity).
- **Web Worker**: WASM runs in a background thread, never blocking the UI.
- **Tauri Native APIs**: File operations, persistence, and system integration use native OS dialogs and SQLite.
- **No Browser Fallbacks**: Desktop-only means no browser compatibility layer - fails fast with clear errors if Tauri unavailable.

### 5. **Separation of Concerns**
- **Core**: Pure business logic (Date Math, Column definitions). Zero dependencies.
- **WASM Worker**: CPM calculations running in background thread.
- **Data**: Persistence layer (SQLite event sourcing, snapshots).
- **Services**: Application orchestration, state management (RxJS), and user intent handling.
- **UI**: Visual presentation and DOM event delegation.

### 6. **Pure Dependency Injection**
The application uses **Pure DI (Constructor Injection)** for all service dependencies:

- **Composition Root**: All services are created and wired in `src/main.ts`
- **Constructor Injection**: Dependencies are passed via constructor parameters
- **Explicit Dependencies**: Every class declares what it needs
- **Testability**: Easy to inject mocks without global state manipulation

```typescript
// Example: Constructor Injection Pattern
class SchedulerService {
    constructor(options: {
        projectController: ProjectController;
        selectionModel: SelectionModel;
        commandService: CommandService;
        rendererFactory: RendererFactory;
    }) {
        this.projectController = options.projectController;
        // ...
    }
}
```

> **Note:** Legacy `getInstance()` methods exist but are deprecated. See [ADR-001](../adr/001-dependency-injection.md) for details.

### 7. **Command Pattern**
User actions are encapsulated as commands via `CommandService`:

- **Centralized Registration**: All commands registered in one place
- **Keyboard Shortcuts**: Commands bound to keyboard shortcuts
- **Undo/Redo Ready**: Command pattern enables future undo/redo per-command
- **Context-Aware**: Commands receive context (selection, controller) at execution

## Directory Structure

```text
src/
├── main.ts                  # COMPOSITION ROOT - All service wiring happens here
│
├── commands/                # Command Pattern Implementation
│   ├── CommandService.ts   # Command registry and execution
│   ├── CommandUIBinding.ts # UI ↔ Command binding
│   ├── clipboard/          # Copy, Cut, Paste commands
│   ├── dependency/         # Link, Unlink commands
│   ├── edit/               # Undo, Redo commands
│   ├── hierarchy/          # Indent, Outdent, Move commands
│   ├── selection/          # Selection commands
│   ├── task/               # Task CRUD commands
│   └── view/               # Zoom, View commands
│
├── core/                    # Pure business logic (No UI dependencies)
│   ├── columns/            # Column system
│   │   ├── ColumnRegistry.ts    # Column definitions registry
│   │   ├── ServiceContainer.ts  # Service lookup for renderers
│   │   ├── registerColumns.ts   # Column registration
│   │   └── renderers/           # Cell renderers (Text, Date, Number, etc.)
│   ├── engines/            # Engine interface (implementations removed)
│   │   └── index.ts        # ISchedulingEngine type export only
│   ├── calculations/       # Pure calculation functions
│   │   └── VarianceCalculator.ts
│   ├── ISchedulingEngine.ts # Engine interface definition
│   ├── OperationQueue.ts   # Async operation queue
│   ├── FeatureFlags.ts     # Feature flag management
│   ├── DateUtils.ts        # Date calculations (Work days, Holidays)
│   └── Constants.ts        # Shared constants
│
├── data/                    # Persistence Layer
│   ├── DatabaseTypes.ts    # Shared database type definitions
│   ├── DataLoader.ts       # SQLite data loading
│   ├── HistoryManager.ts   # Undo/Redo event recording
│   ├── PersistenceService.ts # SQLite event queue (event sourcing)
│   ├── SnapshotService.ts  # Checkpoint snapshots
│   └── TradePartnerStore.ts # Trade partner management
│
├── services/                # Application Orchestration
│   ├── AppInitializer.ts   # Application bootstrap orchestrator
│   ├── SchedulerService.ts # Main Controller (The "Brain")
│   ├── ProjectController.ts # Worker interface + RxJS state (tasks$, calendar$)
│   ├── SelectionModel.ts   # Selection state management
│   ├── EditingStateManager.ts # Cell editing state
│   ├── ClipboardManager.ts # Clipboard operations
│   ├── ZoomController.ts   # Zoom state and controls
│   ├── OrderingService.ts  # Fractional Indexing logic
│   ├── StatsService.ts     # Statistics calculations
│   ├── UIEventManager.ts   # Global event coordination
│   ├── IOManager.ts        # Import/Export operations
│   └── migration/          # Architecture migration services
│       ├── ViewCoordinator.ts      # Grid/Gantt synchronization
│       └── SchedulingLogicService.ts # Business logic service
│
├── workers/                 # Background Workers
│   ├── scheduler.worker.ts # WASM Worker - hosts SchedulerEngine
│   └── types.ts            # Worker message types (WorkerCommand, WorkerResponse)
│
├── ui/                      # User Interface Layer
│   ├── factories/          # Factory Pattern for UI components
│   │   └── index.ts        # RendererFactory (captures DI deps)
│   ├── components/
│   │   ├── scheduler/      # Unified Scheduler Engine
│   │   │   ├── SchedulerViewport.ts  # MASTER CONTROLLER
│   │   │   ├── GridRenderer.ts       # DOM Renderer (Pooled)
│   │   │   ├── GanttRenderer.ts      # Canvas Renderer
│   │   │   ├── pool/                 # DOM Pooling System
│   │   │   └── types.ts              # Viewport Interfaces
│   │   ├── ActivityBar.ts            # Left sidebar
│   │   ├── RightSidebarManager.ts    # Right sidebar
│   │   └── SettingsModal.ts          # Settings UI
│   │
│   └── services/           # UI-specific services
│       ├── ToastService.ts
│       ├── FileService.ts  # Native file dialogs (Tauri)
│       └── KeyboardService.ts
│
├── types/                   # TypeScript type definitions
│   ├── index.ts            # Main type exports
│   └── globals.d.ts        # Global type declarations
│
└── utils/                   # Utility functions
    ├── debounce.ts
    └── testMode.ts

src-wasm/                    # WASM CPM Engine (Rust → WebAssembly)
├── Cargo.toml              # Rust dependencies
└── src/
    ├── lib.rs              # WASM entry point, SchedulerEngine class
    ├── cpm.rs              # CPM forward/backward pass, float calculation
    ├── types.rs            # Task, Calendar, Dependency types (match TypeScript)
    ├── date_utils.rs       # Working day calculations
    └── utils.rs            # Panic hook for debugging

src-tauri/                   # Tauri Desktop Shell (Minimal Layer)
├── Cargo.toml              # Rust dependencies
├── tauri.conf.json         # Tauri configuration
└── src/
    └── main.rs             # Tauri plugins: SQLite, file dialogs, shell
```

## WASM Worker Architecture

### How Calculations Work

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Main Thread (UI)                                  │
│  ┌──────────────────┐     ┌──────────────────────────────────────┐  │
│  │ SchedulerService │     │       ProjectController              │  │
│  │ (orchestration)  │────►│ • tasks$ (BehaviorSubject)           │  │
│  │                  │     │ • calendar$ (BehaviorSubject)        │  │
│  │                  │     │ • stats$ (BehaviorSubject)           │  │
│  └──────────────────┘     │ • Optimistic UI updates              │  │
│                           └────────────────┬─────────────────────┘  │
└────────────────────────────────────────────┼────────────────────────┘
                                             │ postMessage
                                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Web Worker (Background Thread)                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                scheduler.worker.ts                             │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │           SchedulerEngine (WASM - 135KB)                │  │  │
│  │  │                                                          │  │  │
│  │  │  • initialize(tasks, calendar)                          │  │  │
│  │  │  • add_task(task)                                       │  │  │
│  │  │  • update_task(id, updates)                             │  │  │
│  │  │  • delete_task(id)                                      │  │  │
│  │  │  • calculate() → CPMResult { tasks, stats }             │  │  │
│  │  │                                                          │  │  │
│  │  │  Internals (cpm.rs):                                    │  │  │
│  │  │  • forward_pass() - Early Start/Finish                  │  │  │
│  │  │  • backward_pass() - Late Start/Finish                  │  │  │
│  │  │  • calculate_float() - Total/Free float                 │  │  │
│  │  │  • mark_critical_path()                                 │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Worker Message Protocol

**Commands (Main → Worker):**

| Command | Payload | Description |
|---------|---------|-------------|
| `INITIALIZE` | `{ tasks, calendar }` | Initialize engine with data |
| `ADD_TASK` | `Task` | Add single task + recalculate |
| `UPDATE_TASK` | `{ id, updates }` | Update task fields + recalculate |
| `DELETE_TASK` | `{ id }` | Remove task + recalculate |
| `SYNC_TASKS` | `{ tasks }` | Bulk replace all tasks |
| `UPDATE_CALENDAR` | `Calendar` | Update calendar + recalculate |
| `CALCULATE` | - | Force recalculation |
| `DISPOSE` | - | Clean up resources |

**Responses (Worker → Main):**

| Response | Payload | Description |
|----------|---------|-------------|
| `READY` | - | WASM loaded, engine ready |
| `INITIALIZED` | `{ success }` | Engine initialized |
| `CALCULATION_RESULT` | `{ tasks, stats }` | CPM calculation complete |
| `TASKS_SYNCED` | `{ success }` | Tasks bulk synced |
| `ERROR` | `{ message }` | Error occurred |

### Optimistic Updates

The UI uses optimistic updates for instant responsiveness:

```typescript
// ProjectController.addTask()
public addTask(task: Task): void {
    // 1. OPTIMISTIC UPDATE: Update local state immediately
    const currentTasks = [...this.tasks$.value, task];
    this.tasks$.next(currentTasks);  // UI updates instantly
    
    // 2. Send to worker for CPM calculation
    this.isCalculating$.next(true);
    this.send({ type: 'ADD_TASK', payload: task });
    
    // 3. Worker response will update tasks$ with calculated dates
}
```

## Dependency Injection Architecture

### Composition Root (`src/main.ts`)

All services are created and wired in `main.ts`:

```typescript
// Level 0: Leaf services (no dependencies)
const featureFlags = new FeatureFlags();
const selectionModel = new SelectionModel();
const editingStateManager = new EditingStateManager();

// Level 1: Core services (worker initialization in constructor)
const projectController = new ProjectController();
const commandService = new CommandService();

// Level 2: Factories (capture dependencies in closure)
const rendererFactory = createRendererFactory({
    projectController,
    selectionModel,
    editingStateManager
});

// Level 3: Persistence services
const persistenceService = new PersistenceService();
const snapshotService = new SnapshotService();
const dataLoader = new DataLoader();
const historyManager = new HistoryManager({ maxHistory: 50 });

// Level 4: Orchestrator
const appInitializer = new AppInitializer({
    isTauri,
    rendererFactory,
    persistenceService,
    snapshotService,
    dataLoader,
    historyManager
});
```

### Factory Pattern for UI Components

To avoid prop-drilling, UI components receive dependencies via factories:

```typescript
// Factory captures dependencies in closure
const rendererFactory = createRendererFactory({
    projectController,
    selectionModel,
    editingStateManager
});

// SchedulerService uses factory without knowing internal deps
const gridRenderer = rendererFactory.createGrid(options);
const ganttRenderer = rendererFactory.createGantt(options);
```

### Testing with DI

```typescript
// Create mock
const mockController = {
    tasks$: new BehaviorSubject([]),
    getTask: vi.fn()
} as unknown as ProjectController;

// Inject via constructor
const service = new MyService(mockController);
```

## Architecture Highlights

### WASM CPM Engine
- **Performance**: O(N) complexity with pre-computed HashSet for parent lookups
- **Background Thread**: Never blocks UI - calculations run in Web Worker
- **Compact Size**: 135KB WASM module
- **Data Integrity**: All TypeScript Task fields preserved through Rust serialization

### Tauri Integration
The Tauri backend is a **minimal layer** that provides OS integration:

```rust
// src-tauri/src/main.rs - Only 72 lines!
tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())  // SQLite
    .plugin(tauri_plugin_fs::init())      // File system
    .plugin(tauri_plugin_shell::init())   // Shell commands
    .plugin(tauri_plugin_dialog::init())  // Native dialogs
    // ...
```

**Tauri provides:**
- SQLite database via `tauri-plugin-sql`
- Native file dialogs via `tauri-plugin-dialog`
- File system access via `tauri-plugin-fs`
- Window management

**WASM Worker handles:**
- All CPM scheduling calculations
- Task state management
- Calendar-aware date math

### Desktop-Only Design
- **Native Dialogs**: All file operations use OS-native dialogs (no browser file inputs)
- **SQLite Persistence**: True offline-first with SQLite database (event sourcing)
- **Error Handling**: Fails fast with clear errors if Tauri unavailable (no silent fallbacks)

### Reactive State Management

State flows through RxJS observables for reactive UI updates:

```typescript
// ProjectController exposes observable state
public readonly tasks$ = new BehaviorSubject<Task[]>([]);
public readonly calendar$ = new BehaviorSubject<Calendar>({...});
public readonly stats$ = new BehaviorSubject<CPMStats | null>(null);
public readonly isCalculating$ = new BehaviorSubject<boolean>(false);

// UI components subscribe to state changes
this.controller.tasks$.subscribe(tasks => {
    this.render(tasks);
});
```

### Command System
- **CommandService**: Central registry for all user actions
- **Keyboard Shortcuts**: Mapped via `KeyboardService`
- **Categories**: clipboard, dependency, edit, hierarchy, selection, task, view

## Related Documentation

- [ADR-001: Dependency Injection](../adr/001-dependency-injection.md) - DI architecture decision
- [Coding Guidelines](../CODING_GUIDELINES.md) - Developer guidelines
- [TRUE_PURE_DI_IMPLEMENTATION_PLAN.md](../TRUE_PURE_DI_IMPLEMENTATION_PLAN.md) - Migration details

---

**Last Updated:** January 7, 2026
