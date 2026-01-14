# Pro Logic Scheduler - Architecture Guide

## Overview

Pro Logic Scheduler is a high-performance, desktop-class construction scheduling application. It is architected for speed ("Ferrari Engine"), using direct DOM manipulation for the critical rendering path while keeping business logic pure and portable.

**Version:** 7.0.0 (Subordinate Factory Architecture)

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
        subordinateFactory: SchedulerSubordinateFactory;
    }) {
        this.projectController = options.projectController;
        // ...
    }
}
```

> **Note:** Legacy `getInstance()` methods exist but are deprecated. See [ADR-001](../adr/001-dependency-injection.md) for details.

### 7. **Subordinate Factory Pattern**
SchedulerService uses a factory pattern to create its subordinate services:

- **Static Dependencies**: Captured in factory closure at creation time (main.ts)
- **Runtime Context**: Callbacks and accessors provided by SchedulerService
- **Cross-Dependencies**: Handled via forward references within factory
- **Single Point of Creation**: All 12+ subordinate services created atomically

```typescript
// Factory captures static deps, returns services with runtime context
const bundle = subordinateFactory.createAll({
    getGrid: () => this.grid,
    render: () => this.render(),
    // ... runtime callbacks
});
```

### 8. **Command Pattern**
User actions are encapsulated as commands via `CommandService`:

- **Centralized Registration**: All commands registered in one place
- **Keyboard Shortcuts**: Commands bound to keyboard shortcuts
- **Undo/Redo Ready**: Command pattern enables future undo/redo per-command
- **Context-Aware**: Commands receive context (selection, controller) at execution

### 9. **Reactive State Management (ViewCoordinator)**
The `ViewCoordinator` subscribes to RxJS observables and coordinates UI updates:

- **ProjectController.tasks$**: Task state changes
- **SelectionModel.state$**: Selection changes  
- **Batched Updates**: Uses `requestAnimationFrame` to batch DOM updates
- **Non-Blocking**: Eliminates synchronous blocking operations

## Directory Structure

```text
src/
├── main.ts                  # COMPOSITION ROOT - All service wiring (7 levels)
│
├── commands/                # Command Pattern Implementation
│   ├── CommandService.ts   # Command registry and execution
│   ├── CommandUIBinding.ts # UI ↔ Command binding
│   ├── types.ts            # Command type definitions
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
│   │   ├── types.ts             # Column type definitions
│   │   ├── definitions/         # Column definitions
│   │   │   └── defaultColumns.ts
│   │   └── renderers/           # Cell renderers (16 types)
│   │       ├── BaseRenderer.ts
│   │       ├── TextRenderer.ts
│   │       ├── NameRenderer.ts
│   │       ├── NumberRenderer.ts
│   │       ├── DateRenderer.ts
│   │       ├── SelectRenderer.ts
│   │       ├── CheckboxRenderer.ts
│   │       ├── ActionsRenderer.ts
│   │       ├── DragRenderer.ts
│   │       ├── HealthRenderer.ts
│   │       ├── ReadonlyRenderer.ts
│   │       ├── RowNumberRenderer.ts
│   │       ├── SchedulingModeRenderer.ts
│   │       ├── TradePartnersRenderer.ts
│   │       └── VarianceRenderer.ts
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
│   └── TradePartnerStore.ts # Trade partner data store
│
├── services/                # Application Orchestration
│   ├── AppInitializer.ts   # Application bootstrap orchestrator
│   ├── SchedulerService.ts # Main Orchestrator (delegates to subordinates)
│   ├── ProjectController.ts # Worker interface + RxJS state (tasks$, calendar$)
│   ├── SelectionModel.ts   # Selection state management
│   ├── EditingStateManager.ts # Cell editing state
│   ├── ClipboardManager.ts # Clipboard operations
│   ├── ZoomController.ts   # Zoom state and controls
│   ├── OrderingService.ts  # Fractional Indexing logic
│   ├── StatsService.ts     # Statistics calculations
│   ├── UIEventManager.ts   # Global event coordination
│   ├── IOManager.ts        # Import/Export operations
│   │
│   ├── interfaces/         # Interface definitions for DI
│   │   ├── IProjectController.ts
│   │   ├── IPersistenceService.ts
│   │   ├── ISnapshotService.ts
│   │   ├── IDataLoader.ts
│   │   ├── IHistoryManager.ts
│   │   └── IClipboardManager.ts
│   │
│   ├── migration/          # Architecture migration services
│   │   ├── ViewCoordinator.ts      # Reactive Grid/Gantt coordination
│   │   └── SchedulingLogicService.ts # Business logic service
│   │
│   └── scheduler/          # SchedulerService Subordinates (Factory Pattern)
│       ├── SchedulerSubordinateFactory.ts # Factory interface & types
│       ├── createSubordinateFactory.ts    # Factory implementation
│       ├── TaskOperationsService.ts       # Task CRUD, hierarchy, movement
│       ├── ViewStateService.ts            # View state, navigation, edit mode
│       ├── ColumnPreferencesService.ts    # Column prefs and header management
│       ├── GridNavigationController.ts    # Excel-style cell navigation
│       ├── ContextMenuService.ts          # Right-click context menus
│       ├── ModalCoordinator.ts            # Modal dialogs and panels
│       ├── FileOperationsService.ts       # File open, save, import, export
│       ├── BaselineService.ts             # Baseline set, clear, variance
│       ├── TradePartnerService.ts         # Trade partner CRUD & assignment
│       ├── DependencyValidationService.ts # Dependency validation
│       ├── ViewportFactoryService.ts      # Viewport facade creation
│       ├── KeyboardBindingService.ts      # Keyboard binding configuration
│       └── types.ts                       # Shared subordinate types
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
│   │   │   ├── viewportRegistry.ts   # Viewport instance registry
│   │   │   ├── constants.ts          # Scheduler constants
│   │   │   ├── icons.ts              # SVG icon definitions
│   │   │   ├── types.ts              # Viewport Interfaces
│   │   │   ├── pool/                 # DOM Pooling System
│   │   │   │   ├── PoolSystem.ts
│   │   │   │   └── BindingSystem.ts
│   │   │   ├── datepicker/           # Date picker configuration
│   │   │   │   └── DatePickerConfig.ts
│   │   │   └── styles/
│   │   │       └── scheduler.css
│   │   ├── ActivityBar.ts            # Left sidebar navigation
│   │   ├── RightSidebarManager.ts    # Right sidebar panel manager
│   │   ├── SettingsModal.ts          # Settings UI
│   │   ├── CalendarModal.ts          # Calendar configuration modal
│   │   ├── ColumnSettingsModal.ts    # Column customization modal
│   │   ├── DependenciesModal.ts      # Dependency management modal
│   │   ├── ContextMenu.ts            # Right-click context menus
│   │   ├── SideDrawer.ts             # Slide-out drawer component
│   │   ├── CanvasGantt.ts            # Canvas-based Gantt renderer
│   │   └── TradePartnerFormModal.ts  # Trade partner editing
│   │
│   ├── panels/             # Right sidebar panels
│   │   ├── TaskTradePartnersPanel.ts    # Task trade partner assignment
│   │   └── TradePartnerDetailsPanel.ts  # Trade partner details
│   │
│   ├── views/              # Full-page views
│   │   └── TradePartnerDirectoryView.ts # Trade partner directory
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
├── utils/                   # Utility functions
│   ├── debounce.ts
│   ├── testMode.ts
│   └── TestDataGenerator.ts
│
├── sql/                     # SQL schemas
│   └── schema.sql          # SQLite database schema
│
├── styles/                  # Global styles
│   └── trade-partners.css  # Trade partner specific styles
│
└── debug/                   # Debug utilities
    └── UIBlockingDiagnostic.ts

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

All services are created and wired in `main.ts` across 7 levels:

```typescript
// Level 0: Leaf services (no dependencies)
const featureFlags = new FeatureFlags();
const clipboardManager = new ClipboardManager();
const selectionModel = new SelectionModel();
const editingStateManager = new EditingStateManager();

// Level 1: Column system + Core data
const columnRegistry = new ColumnRegistry();
const serviceContainer = new ServiceContainer();
const projectController = new ProjectController();

// Level 2: Command system + Support services
const commandService = new CommandService();
const zoomController = new ZoomController();
const schedulingLogicService = new SchedulingLogicService();
const tradePartnerStore = new TradePartnerStore();
const viewCoordinator = new ViewCoordinator({ projectController, selectionModel });

// Level 3: Renderer Factory (captures deps in closure)
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

// Level 5: UI Services (lifted from SchedulerService)
const toastService = new ToastService({ container: document.body });
const fileService = new FileService({ isTauri, onToast: ... });

// Level 6: Subordinate Factory (captures all static deps)
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

### Subordinate Factory Pattern

SchedulerService delegates specialized concerns to subordinate services created by a factory:

```typescript
// SchedulerSubordinateFactory.ts - Factory Interface
interface SchedulerSubordinateFactory {
    createAll(context: SubordinateFactoryContext): SubordinateServicesBundle;
}

// SubordinateServicesBundle - All 12 subordinate services
interface SubordinateServicesBundle {
    columnPreferencesService: ColumnPreferencesService;
    gridNavigationController: GridNavigationController;
    viewportFactoryService: ViewportFactoryService;
    taskOperationsService: TaskOperationsService;
    viewStateService: ViewStateService;
    contextMenuService: ContextMenuService;
    modalCoordinator: ModalCoordinator;
    fileOperationsService: FileOperationsService;
    baselineService: BaselineService;
    tradePartnerService: TradePartnerService;
    dependencyValidationService: DependencyValidationService;
    keyboardBindingService: KeyboardBindingService;
}
```

**Service Responsibilities:**

| Service | Responsibility |
|---------|----------------|
| `TaskOperationsService` | Task CRUD, hierarchy, movement |
| `ViewStateService` | View state, navigation, edit mode |
| `ColumnPreferencesService` | Column preferences and header management |
| `GridNavigationController` | Excel-style grid cell navigation |
| `ContextMenuService` | Right-click context menus |
| `ModalCoordinator` | Modal dialogs and panels |
| `FileOperationsService` | File open, save, import, export |
| `BaselineService` | Baseline set, clear, variance calculation |
| `TradePartnerService` | Trade partner CRUD and task assignment |
| `DependencyValidationService` | Dependency validation and cycle detection |
| `ViewportFactoryService` | Viewport facade creation |
| `KeyboardBindingService` | Keyboard binding configuration |

### ViewCoordinator (Reactive UI Updates)

ViewCoordinator eliminates UI blocking by subscribing to RxJS streams:

```typescript
// ViewCoordinator subscribes to state streams
controller.tasks$.subscribe(tasks => {
    this._scheduleGridDataUpdate(tasks);
    this._scheduleGanttDataUpdate(tasks);
    this._scheduleRender();
});

selection.state$.subscribe(state => {
    if (this.grid) this.grid.setSelection(state.selectedIds, state.focusedId);
    if (this.gantt) this.gantt.setSelection(state.selectedIds);
});
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

// ViewCoordinator subscribes and batches updates
controller.tasks$.pipe(distinctUntilChanged()).subscribe(tasks => {
    this._scheduleGridDataUpdate(tasks);
    this._scheduleRender();
});
```

### Command System
- **CommandService**: Central registry for all user actions
- **Keyboard Shortcuts**: Mapped via `KeyboardService`
- **Categories**: clipboard, dependency, edit, hierarchy, selection, task, view

### Trade Partner Feature

Complete vertical slice for trade partner management:

```
TradePartnerStore (data)
  → TradePartnersRenderer (grid column)
  → TradePartnerFormModal (editing)
  → TradePartnerDetailsPanel (sidebar)
  → TradePartnerDirectoryView (full view)
  → TradePartnerService (operations)
```

## Related Documentation

- [ADR-001: Dependency Injection](../adr/001-dependency-injection.md) - DI architecture decision
- [Column Registry Design](./COLUMN_REGISTRY_DESIGN.md) - Column system design

---

**Last Updated:** January 14, 2026
