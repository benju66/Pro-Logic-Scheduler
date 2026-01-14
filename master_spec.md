
# Pro Logic Scheduler: Master System Specification

**Version:** 7.0.0 (Subordinate Factory Architecture)
**Status:** Production-Ready with WASM CPM Engine
**Scope:** Core Logic, Data Architecture, and Rendering Engine
**Supersedes:** All previous specification versions

---

## 1. Executive Summary

Pro Logic Scheduler is a high-performance, desktop-class construction scheduling application. It distinguishes itself through a "Ferrari Engine" architecture: vanilla TypeScript/DOM manipulation for rendering (60FPS at 10k+ tasks) backed by a Rust-powered Critical Path Method (CPM) calculation engine.

### Key Architectural Pillars
1.  **Unified Viewport:** A "Puppeteer" pattern where a master controller drives separate Grid (DOM) and Gantt (Canvas) renderers via a single RAF loop.
2.  **Fractional Indexing:** Deterministic, conflict-free ordering using string-based sort keys (LexoRank style), enabling infinite reordering without database rewrites.
3.  **Scheduling Triangle:** Intelligent handling of Start/Duration/End edits that mimics MS Project behavior (applying constraints automatically).
4.  **WASM CPM Engine:** High-performance O(N) scheduling calculations running in a Web Worker (Rust compiled to WebAssembly).
5.  **Pure Dependency Injection:** Constructor injection with a single Composition Root for testability and maintainability.
6.  **Subordinate Factory Pattern:** SchedulerService delegates to specialized subordinate services created via factory pattern.

---

## 2. Data Architecture (The Model)

### 2.1. Task Entity
The Task object is the atomic unit of the system. It blends persistent state with calculated runtime values.

```typescript
interface Task {
    // Identity & Hierarchy
    id: string;
    parentId: string | null;      // Hierarchy pointer
    sortKey: string;              // FRACTIONAL INDEXING key (e.g., "a0", "a0V")
    level: number;                // Depth level (0-based)
    
    // Row Type
    rowType?: RowType;            // 'task' | 'blank' | 'phantom' (default: 'task')
    
    // Core Data
    name: string;
    notes: string;
    wbs?: string;                 // Work Breakdown Structure code (future)
    
    // Scheduling (Persisted Input)
    duration: number;             // Work days
    constraintType: ConstraintType; // 'asap' | 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mfo'
    constraintDate: string | null; // YYYY-MM-DD
    dependencies: Dependency[];    // Predecessors
    schedulingMode?: SchedulingMode; // 'Auto' | 'Manual' (default: 'Auto')
    
    // Scheduling (Calculated Runtime)
    start: string;                // Early Start
    end: string;                  // Early Finish
    lateStart?: string | null;
    lateFinish?: string | null;
    totalFloat?: number;
    freeFloat?: number;
    
    // Status & Metadata
    progress: number;             // 0-100
    _isCritical?: boolean;        // Calculated by CPM
    _health?: HealthIndicator;    // Calculated status (Critical/Blocked/Healthy)
    _collapsed?: boolean;         // UI State
    _visualRowNumber?: number | null; // Visual row number (excludes blank rows)
    
    // Actuals Tracking
    actualStart?: string | null;
    actualFinish?: string | null;
    remainingDuration?: number;
    
    // Baseline Tracking
    baselineStart?: string | null;
    baselineFinish?: string | null;
    baselineDuration?: number;
    
    // Trade Partners
    tradePartnerIds?: string[];   // Assigned trade partner IDs
}

// Row type discriminator
type RowType = 'task' | 'blank' | 'phantom';
```

### 2.2. Trade Partner Entity
Trade partners represent subcontractors/companies assigned to tasks.

```typescript
interface TradePartner {
    id: string;
    name: string;
    contact?: string;
    phone?: string;
    email?: string;
    color: string;      // Hex color for display
    notes?: string;
}
```

### 2.3. Ordering Strategy (Fractional Indexing)

* **Concept:** Instead of integer indexes (`1, 2, 3`), tasks use lexicographical string keys (`"a0"`, `"a1"`).
* **Insertion:** Inserting between `"a0"` and `"a1"` generates `"a0V"`.
* **Implementation:** Handled by `OrderingService.ts` using the `fractional-indexing` library.
* **Benefit:** Allows reordering operations (drag-and-drop) to update **only one record**, making it compatible with offline-first and SQL databases.

### 2.4. State Management

The application uses **Pure Dependency Injection** with constructor injection for all services:

* **ProjectController:** Central data controller. Manages tasks and calendar via RxJS BehaviorSubjects (`tasks$`, `calendar$`). Coordinates with WASM worker for CPM calculations.
* **SelectionModel:** Manages task selection state via `state$` observable. Supports single, multi-select (Ctrl), and range select (Shift).
* **EditingStateManager:** Single source of truth for cell editing state. Coordinates between GridRenderer, KeyboardService, and SchedulerService using observer pattern.
* **ClipboardManager:** Manages cut/copy/paste operations for tasks.
* **HistoryManager:** Undo/Redo via event sourcing command pattern (stores forward/backward event pairs, not JSON snapshots).
* **TradePartnerStore:** Manages CRUD operations for trade partners.
* **ViewCoordinator:** Reactive subscription manager for Grid/Gantt updates. Subscribes to `tasks$` and `SelectionModel.state$`.

> **Dependency Injection:** All services are created in `src/main.ts` (Composition Root) and injected via constructors. Legacy `getInstance()` methods are deprecated. See [ADR-001](docs/adr/001-dependency-injection.md).

### 2.5. Command System

User actions are encapsulated as commands via `CommandService`:

* **CommandService:** Central registry for all user actions with keyboard shortcut bindings.
* **Command Categories:** clipboard, dependency, edit, hierarchy, selection, task, view
* **Context-Aware:** Commands receive context (controller, selection) at execution time.

---

## 3. Business Logic (The Core)

### 3.1. Critical Path Method (WASM Engine)

The CPM engine runs in a Web Worker as Rust compiled to WebAssembly for maximum performance (O(N) complexity). The WASM module (`src-wasm/`) is loaded by `scheduler.worker.ts` and exposes a `SchedulerEngine` class.

**CPM Algorithm Steps:**

1. **Successor Map:** Invert dependencies to map Predecessors → Successors.
2. **Forward Pass:** Calculate Early Start (ES) & Early Finish (EF).
   * `ES = Max(Predecessor EF + Lag)`
   * Apply Constraints (SNET, FNET).
3. **Parent Rollup:** Parents inherit `Min(Child Start)` and `Max(Child End)`.
4. **Backward Pass:** Calculate Late Start (LS) & Late Finish (LF).
   * `LF = Min(Successor LS - Lag)`
   * Apply Constraints (SNLT, FNLT).
5. **Float Calculation:**
   * `Total Float = LS - ES`
   * `Free Float = Min(Successor ES) - EF`
6. **Critical Path:** Mark tasks where `Total Float <= 0`.
7. **Health Analysis:** Analyze constraints and float to determine task health.

**Architecture:**
```
Main Thread                     Worker Thread (Background)
     │                                    │
     │  ───── WorkerCommand ─────>        │
     │       { type, payload }            │
     │                                    ▼
     │                          ┌─────────────────┐
     │                          │  WASM Module    │
     │                          │  (135 KB)       │
     │                          │                 │
     │                          │ SchedulerEngine │
     │                          │  - tasks[]      │
     │                          │  - calculate()  │
     │                          └─────────────────┘
     │                                    │
     │  <───── WorkerResponse ─────       │
     │       { tasks, stats }             │
     ▼                                    ▼
```

### 3.2. Health Analysis Logic

Tasks are assigned a health status based on the following priority:

1. **Blocked (🟣):** Missing predecessors or circular dependencies.
2. **Critical Failure (🔴):** `FNLT` constraint violated by >3 days, or negative float (schedule impossible).
3. **At Risk (🟡):** `FNLT` violated by <3 days, or Critical Path with low float (<2 days).
4. **Healthy (🟢):** On track with adequate float.
5. **Forced (⚪):** Task dates have been manually overridden.

### 3.3. The "Scheduling Triangle" (Service Logic)

The `SchedulingLogicService` interprets user edits to maintain logical consistency:

* **Edit Duration:** Update `duration`. Keep `start`. CPM recalculates `end`.
* **Edit Start:** Apply **SNET** (Start No Earlier Than) constraint.
* **Edit End:** Apply **FNLT** (Finish No Later Than) constraint (Deadline).
* **Edit Actuals:** Update `actualStart`/`actualFinish`. Does **not** affect CPM dates (variance tracking only).

**Scheduling Modes:**
* **Auto Mode (default):** CPM engine calculates dates based on dependencies and constraints. User edits to `start`/`end` apply constraints (SNET/FNLT) that influence the calculation.
* **Manual Mode:** User-fixed dates that CPM will **not** change during recalculation. Manual tasks still participate in backward pass (have Late Start/Finish), have float calculated, and act as anchors for their successors. When CPM results are applied, only calculated fields (`_isCritical`, `totalFloat`, `freeFloat`, etc.) are updated; `start`, `end`, and `duration` are preserved.

**Driver/Completion Modes:**
* **Driver Mode (actualStart):** Setting `actualStart` anchors the task's historical start and automatically applies SNET constraint.
* **Completion Mode (actualFinish):** Setting `actualFinish` marks task 100% complete, auto-populates `actualStart` if not set, and sets `remainingDuration` to 0.

**Async Engine Synchronization:**
Date changes are processed asynchronously via the Web Worker to ensure constraint updates complete before recalculation runs. This prevents race conditions where recalculation might execute before constraints are synced, causing date values to revert.

### 3.4. Baseline Tracking

The `BaselineService` manages baseline snapshots:

* **Set Baseline:** Copies current `start`, `end`, `duration` to `baselineStart`, `baselineFinish`, `baselineDuration`.
* **Clear Baseline:** Removes baseline data from all tasks.
* **Variance Calculation:** Compares current dates against baseline using `VarianceCalculator`.

### 3.5. Performance Architecture

The system achieves 60 FPS with >10,000 tasks through:

* **WASM CPM Engine:** All scheduling calculations run in Rust compiled to WebAssembly (O(N) complexity with HashSet optimization).
* **Web Worker:** Background thread prevents UI blocking during heavy calculations.
* **Optimistic Updates:** UI updates immediately; worker recalculates asynchronously.
* **DOM Pooling:** Fixed pool of row elements recycled during scroll.
* **Canvas Rendering:** Integer-snapped drawing for Gantt chart.
* **Synchronous Data Updates:** Eliminates visual flashing by updating renderer data before RAF.

---

## 4. UI Rendering Engine (Unified Viewport)

### 4.1. Architecture: The "Puppeteer" Model

A master controller (`SchedulerViewport`) orchestrates two "dumb" renderers.

```
┌─────────────────────────────────────────────────────────────┐
│                 SchedulerViewport (Master)                  │
│  Owns: Scroll Top, RAF Loop, Selection, Data, Dimensions    │
└──────────────────────────────┬──────────────────────────────┘
                               │ (State Update)
           ┌───────────────────┴───────────────────┐
           ▼                                       ▼
┌───────────────────────┐           ┌─────────────────────────┐
│     GridRenderer      │           │      GanttRenderer      │
│  (DOM Implementation) │           │ (Canvas Implementation) │
│ - Div Pooling         │           │ - Layered Canvas        │
│ - CSS Transforms      │           │ - Integer Snapping      │
│ - Event Delegation    │           │ - Dependency Lines      │
└───────────────────────┘           └─────────────────────────┘

```

### 4.2. Scroll Synchronization

* **Vertical:** Tightly coupled. The Viewport calculates the `visibleRange` (e.g., rows 50-80) and pushes it to both renderers in the same animation frame.
* **Horizontal:** Decoupled.
  * **Grid:** Scrolls columns independently (`overflow-x: auto`).
  * **Gantt:** Scrolls time-axis independently.
* **Defensive Sync:** The Viewport listens for scroll events on specific DOM nodes to handle edge cases (e.g., momentum scrolling on Mac trackpads).

### 4.3. DOM Optimization (GridRenderer)

* **Pooling:** A fixed pool of row elements (Viewport Height / Row Height + Buffer) is created at initialization.
* **Recycling:** As the user scrolls, rows moving off-screen are "teleported" to the bottom and rebound with new data.
* **Fast Binding:** Uses `textContent`, `className`, and `style.transform`. Avoids `innerHTML` during scroll.

### 4.4. Synchronous Data Updates (Flash Elimination)

To eliminate visual flashing when dates or durations change, renderer data is updated synchronously before scheduling the render:

* **`_updateGridDataSync()`:** Updates `GridRenderer.data` synchronously from `ProjectController` before `render()` is called. Ensures `_bindCell()` has fresh task data during the render cycle.
* **`_updateGanttDataSync()`:** Updates `GanttRenderer.data` synchronously before `render()` to prevent canvas flash. The GanttRenderer fills the canvas with background color instead of clearing, combined with synchronous data updates to eliminate any visual artifacts.

This pattern ensures both renderers have fresh data immediately, eliminating the delay between data change and visual update that causes flashing.

### 4.5. View Coordination

The `ViewCoordinator` service ensures Grid and Gantt renderers stay synchronized:

* **Subscription-Based:** Subscribes to `ProjectController.tasks$` and `SelectionModel.state$` changes.
* **Batched Updates:** Uses `requestAnimationFrame` to coalesce rapid changes into single render cycles.
* **Component References:** Holds references to Grid and Gantt for coordinated updates.
* **Visual Row Numbers:** Assigns sequential row numbers to schedulable tasks (skipping blank/phantom rows).

---

## 5. Interaction Model

### 5.1. Selection & Focus

* **Ownership:** `SelectionModel` manages all selection state via single `state$` observable.
* **Granularity:** Supports single row, multi-row (Ctrl/Shift), and cell-level focus.
* **Focus Management:** When adding a task, the service explicitly instructs the grid to `focusCell('name')` to allow immediate typing.
* **Reactive Updates:** Components subscribe to `SelectionModel.state$` for reactive UI updates.
* **Selection Order:** Tracks order of selection for operations like "link in order".

### 5.2. Keyboard Shortcuts

The `KeyboardService` maps keys to `CommandService` actions:

* `Enter`: Add sibling task (below).
* `Ctrl+Enter`: Add child task.
* `Ins`: Insert task.
* `Tab / Shift+Tab`: Indent / Outdent (when not editing).
* `F2`: Edit active cell.
* `Arrow Keys`: Navigate focus (when not editing).
* `Escape`: Cancel edit (revert to original value).
* `Enter` (while editing): Commit and move to next row.
* `Tab` (while editing): Commit and move to next editable cell.
* `Ctrl+C/X/V`: Copy, Cut, Paste tasks.
* `Ctrl+Z/Y`: Undo/Redo.
* `Ctrl++/-/0`: Zoom In/Out/Reset.
* `Ctrl+L`: Link selected tasks in order.
* `Ctrl+Shift+D`: Toggle driving path mode.

**Editing State Management:**
The `EditingStateManager` serves as the single source of truth for cell editing state. It coordinates between `GridRenderer`, `KeyboardService`, and `SchedulerService` to prevent state synchronization bugs. Uses observer pattern for reactive state updates. Injected via constructor (not accessed as singleton).

---

## 6. Implementation Plan (SQLite & Event Sourcing)

The data layer uses an **Event Sourcing** model with `tauri-plugin-sql`.

### 6.1. The Events Table
All application state changes are logged to an append-only table for auditability and crash recovery.

* **Table Name:** `events`
* **Schema:**
    * `id`: INTEGER PRIMARY KEY AUTOINCREMENT
    * `task_id`: TEXT (UUID) - Target of the action
    * `action_type`: TEXT (e.g., `TASK_UPDATE`, `TASK_CREATE`, `LINK_ADD`, `INDENT`)
    * `payload`: JSON - The data required to replay the action (e.g., `{ "field": "duration", "old": 5, "new": 10 }`)
    * `timestamp`: INTEGER (Unix Epoch)
    * `user_id`: TEXT (Optional, for future collaboration)
* **Replay Requirement:** The application state must be fully reproducible by replaying these events from the database.

### 6.2. Schema Mapping Rules
1. **Ordering:** The SQL table MUST store `sort_key` (VARCHAR). Indexing on `(parent_id, sort_key)` is required for performance.
2. **Dates:** Store as ISO strings (`YYYY-MM-DD`).
3. **Constraints:** Store `constraint_type` and `constraint_date`.
4. **Calculated Fields:** Do NOT persist `start`, `end`, `is_critical` (unless caching is desired). These should be recalculated by the CPM engine on load.
5. **Transactions:** Move operations (Indent/Outdent/Drag) must be atomic transactions that update `parent_id` and `sort_key` simultaneously.

### 6.3. Persistence Services

* **PersistenceService:** Event queue for incremental writes to SQLite.
* **SnapshotService:** Periodic full-state snapshots for fast recovery.
* **DataLoader:** Loads initial state from SQLite on app startup.

---

## 7. API Reference (Core Interfaces)

### ProjectController (Data Layer)

```typescript
class ProjectController {
    // Observables
    tasks$: BehaviorSubject<Task[]>;
    calendar$: BehaviorSubject<Calendar>;
    stats$: BehaviorSubject<CPMStats | null>;
    isInitialized$: BehaviorSubject<boolean>;
    isCalculating$: BehaviorSubject<boolean>;
    errors$: Subject<string>;
    
    // Task Operations (Optimistic Updates)
    addTask(task: Task): void;
    updateTask(id: string, updates: Partial<Task>): void;
    deleteTask(id: string): void;
    syncTasks(tasks: Task[]): void;
    
    // Specialized Operations
    createBlankRow(sortKey: string, parentId?: string | null): Task;
    wakeUpBlankRow(taskId: string, name?: string): Task | undefined;
    moveTask(taskId: string, newParentId: string | null, newSortKey: string): boolean;
    
    // Calendar
    updateCalendar(calendar: Calendar): void;
    
    // Calculation
    forceRecalculate(): void;
    
    // Initialization
    initialize(tasks: Task[], calendar: Calendar): Promise<void>;
    
    // Queries
    getTaskById(id: string): Task | undefined;
    getTasks(): Task[];
    getCalendar(): Calendar;
    isParent(id: string): boolean;
    getDepth(id: string): number;
    getChildren(parentId: string | null): Task[];
    getVisibleTasks(isCollapsed: (id: string) => boolean): Task[];
    getDescendants(id: string): Task[];
    
    // Persistence Integration
    setPersistenceService(service: PersistenceService): void;
    setHistoryManager(manager: HistoryManager): void;
    
    // Event Application (for Undo/Redo)
    applyEvents(events: QueuedEvent[]): void;
}
```

### CommandService (Command Pattern)

```typescript
class CommandService {
    // Registration
    register(command: Command): void;
    
    // Execution
    execute(commandId: string, args?: unknown): CommandResult;
    
    // Context
    setContext(context: CommandContext): void;
    
    // Query
    getCommand(id: string): Command | undefined;
    getShortcut(id: string): string | undefined;
    isEnabled(id: string): boolean;
    
    // State Change Notification
    notifyStateChange(): void;
}
```

### SelectionModel (Selection State)

```typescript
class SelectionModel {
    // Observable (combined state)
    state$: BehaviorSubject<SelectionState>;
    
    // State Interface
    interface SelectionState {
        selectedIds: Set<string>;
        selectionOrder: string[];  // Order tasks were selected
        focusedId: string | null;
        anchorId: string | null;   // For range selection
        focusedField: string | null;
    }
    
    // Operations
    setSelection(ids: Set<string>, focusedId: string | null, order: string[]): void;
    addToSelection(taskIds: string[]): void;
    removeFromSelection(taskIds: string[]): void;
    clearSelection(): void;
    setFocus(taskId: string | null, field?: string | null): void;
    
    // Queries
    isSelected(taskId: string): boolean;
    getSelectedIds(): string[];
    getSelectionInOrder(): string[];
    getFocusedId(): string | null;
    getFocusedField(): string | null;
    getAnchorId(): string | null;
}
```

### SchedulerService (Orchestrator)

```typescript
class SchedulerService {
    // UI Components
    grid: VirtualScrollGridFacade | null;
    gantt: CanvasGanttFacade | null;
    toastService: ToastService;
    
    // Initialization
    init(): Promise<void>;
    initKeyboard(): void;
    
    // View Management
    render(): void;
    getStats(): PerformanceStats;
    
    // Task Operations (delegate to TaskOperationsService)
    addTask(taskData?: Partial<Task>): Promise<Task | undefined>;
    deleteTask(taskId: string): void;
    indent(taskId: string): void;
    outdent(taskId: string): void;
    toggleCollapse(taskId: string): void;
    
    // Selection
    getSelectedTask(): Task | null;
    getSelectionInOrder(): string[];
    
    // Modals (delegate to ModalCoordinator)
    openDependencies(taskId: string): void;
    openCalendar(): void;
    openColumnSettings(): void;
    
    // File Operations (delegate to FileOperationsService)
    saveToFile(): Promise<void>;
    openFromFile(): Promise<void>;
    exportAsDownload(): void;
    
    // Baseline (delegate to BaselineService)
    hasBaseline(): boolean;
    setBaseline(): void;
    clearBaseline(): void;
    
    // Trade Partners (delegate to TradePartnerService)
    getTradePartners(): TradePartner[];
    createTradePartner(data: Omit<TradePartner, 'id'>): TradePartner;
    assignTradePartner(taskId: string, tradePartnerId: string): void;
    
    // Subscriptions
    onTaskSelect(callback: (taskId, task, field) => void): () => void;
    onDataChange(callback: () => void): () => void;
    
    // Lifecycle
    destroy(): void;
    onShutdown(): Promise<void>;
}
```

### SchedulerViewport (Internal API)

* `setScrollTop(y)`: Updates vertical position.
* `setData(tasks)`: Updates model.
* `refresh()`: Forces a layout recalculation and render cycle.

---

## 8. Quality Assurance & AI Verification Strategy

To ensure "Bulletproof" reliability without a human QA team, the system relies on an **Automated Verification Gate**.

### 8.1. The "Verify" Protocol
Every development phase must include a corresponding verification script (e.g., `verify-phase1.ts`).
* **Requirement:** The AI Developer must run this script after every significant code change.
* **Success Criteria:** A change is only considered "Complete" when the verification script prints `VERIFICATION PASSED`.

### 8.2. Testing Layers
1.  **Unit Tests (Vitest):**
    * **Scope:** Core services, utilities, pure functions.
    * **Mandate:** High coverage for core math/dates.
    * **Performance:** Must run in <100ms.
2.  **Integration Tests (The "Verify" Scripts):**
    * **Scope:** `SchedulerService` + `ProjectController` + `HistoryManager`.
    * **Mandate:** Simulate real user flows (Add Task -> Indent -> Undo -> Redo) and assert state integrity.
3.  **DI Mocking Tests:**
    * **Scope:** Verify services can be mocked via `setInstance()` pattern.
    * **Mandate:** Ensure testability of all singleton services.
4.  **Performance "Canaries":**
    * **Mandate:** Rendering loop must never exceed 16.6ms (60 FPS) for 1,000 visible rows.
    * **Regression:** Any commit that drops FPS below 55 must be reverted.

### 8.3. Self-Correction Loop
If a verification step fails:
1.  The AI must analyze the `verify` output error.
2.  The AI must propose a fix.
3.  The AI must re-run `verify` to confirm the fix.
4.  Only then can the code be committed.

---

## 9. Related Documentation

* [Architecture Guide](docs/architecture/ARCHITECTURE.md) - Detailed architecture overview
* [ADR-001: Dependency Injection](docs/adr/001-dependency-injection.md) - DI architecture decision
* [Coding Guidelines](docs/CODING_GUIDELINES.md) - Developer guidelines


---

**Last Updated:** January 14, 2026
