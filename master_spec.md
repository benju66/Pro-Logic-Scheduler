
# Pro Logic Scheduler: Master System Specification

**Version:** 6.0.0 (WASM Worker Architecture)
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
    
    // Core Data
    name: string;
    notes: string;
    
    // Scheduling (Persisted Input)
    duration: number;             // Work days
    constraintType: 'asap' | 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mfo';
    constraintDate: string | null; // YYYY-MM-DD
    dependencies: Dependency[];    // Predecessors
    schedulingMode?: 'Auto' | 'Manual'; // Scheduling mode (default: 'Auto')
    
    // Scheduling (Calculated Runtime)
    start: string;                // Early Start
    end: string;                  // Early Finish
    lateStart: string | null;
    lateFinish: string | null;
    totalFloat: number;
    freeFloat: number;
    
    // Status & Metadata
    progress: number;             // 0-100
    _isCritical: boolean;         // Calculated by CPM
    _health?: HealthIndicator;    // Calculated status (Critical/Blocked/Healthy)
    _collapsed: boolean;          // UI State
}

```

### 2.2. Ordering Strategy (Fractional Indexing)

* **Concept:** Instead of integer indexes (`1, 2, 3`), tasks use lexicographical string keys (`"a0"`, `"a1"`).
* **Insertion:** Inserting between `"a0"` and `"a1"` generates `"a0V"`.
* **Implementation:** Handled by `OrderingService.ts` using the `fractional-indexing` library.
* **Benefit:** Allows reordering operations (drag-and-drop) to update **only one record**, making it compatible with offline-first and SQL databases.

### 2.3. State Management

The application uses **Pure Dependency Injection** with constructor injection for all services:

* **ProjectController:** Central data controller. Manages tasks and calendar via RxJS BehaviorSubjects (`tasks$`, `calendar$`). Coordinates with WASM worker for CPM calculations.
* **SelectionModel:** Manages task selection state. Supports single, multi-select (Ctrl), and range select (Shift).
* **EditingStateManager:** Single source of truth for cell editing state. Coordinates between GridRenderer, KeyboardService, and SchedulerService using observer pattern.
* **ClipboardManager:** Manages cut/copy/paste operations for tasks.
* **HistoryManager:** Undo/Redo via command pattern (no JSON snapshots for performance).

> **Dependency Injection:** All services are created in `src/main.ts` (Composition Root) and injected via constructors. Legacy `getInstance()` methods are deprecated. See [ADR-001](docs/adr/001-dependency-injection.md).

### 2.4. Command System

User actions are encapsulated as commands via `CommandService`:

* **CommandService:** Central registry for all user actions with keyboard shortcut bindings.
* **Command Categories:** clipboard, edit, hierarchy, selection, task, view
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

### 3.3. The "Scheduling Triangle" (Service Logic)

The `SchedulingLogicService` interprets user edits to maintain logical consistency:

* **Edit Duration:** Update `duration`. Keep `start`. CPM recalculates `end`.
* **Edit Start:** Apply **SNET** (Start No Earlier Than) constraint.
* **Edit End:** Apply **FNLT** (Finish No Later Than) constraint (Deadline).
* **Edit Actuals:** Update `actualStart`/`actualFinish`. Does **not** affect CPM dates (variance tracking only).

**Scheduling Modes:**
* **Auto Mode (default):** CPM engine calculates dates based on dependencies and constraints. User edits to `start`/`end` apply constraints (SNET/FNLT) that influence the calculation.
* **Manual Mode:** User-fixed dates that CPM will **not** change during recalculation. Manual tasks still participate in backward pass (have Late Start/Finish), have float calculated, and act as anchors for their successors. When CPM results are applied, only calculated fields (`_isCritical`, `totalFloat`, `freeFloat`, etc.) are updated; `start`, `end`, and `duration` are preserved.

**Async Engine Synchronization:**
Date changes are processed asynchronously via the Web Worker to ensure constraint updates complete before recalculation runs. This prevents race conditions where recalculation might execute before constraints are synced, causing date values to revert.

### 3.4. Performance Architecture

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

* **Subscription-Based:** Subscribes to `ProjectController.tasks$` and `SelectionModel` changes.
* **Batched Updates:** Coalesces rapid changes into single render cycles.
* **Component References:** Holds references to Grid and Gantt for coordinated updates.

---

## 5. Interaction Model

### 5.1. Selection & Focus

* **Ownership:** `SelectionModel` manages all selection state via RxJS observables.
* **Granularity:** Supports single row, multi-row (Ctrl/Shift), and cell-level focus.
* **Focus Management:** When adding a task, the service explicitly instructs the grid to `focusCell('name')` to allow immediate typing.
* **Reactive Updates:** Components subscribe to `SelectionModel.selectedIds$` for reactive UI updates.

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
    
    // Task Operations
    addTask(parentId?: string): Promise<Task>;
    updateTask(id: string, updates: Partial<Task>): void;
    deleteTask(id: string): void;
    getTask(id: string): Task | undefined;
    
    // Hierarchy
    indent(taskId: string): void;
    outdent(taskId: string): void;
    
    // Initialization
    initialize(tasks: Task[], calendar: Calendar): Promise<void>;
}
```

### CommandService (Command Pattern)

```typescript
class CommandService {
    // Registration
    register(command: CommandDefinition): void;
    
    // Execution
    execute(commandId: string, args?: unknown): CommandResult;
    
    // Context
    setContext(context: CommandContext): void;
    
    // Query
    getCommand(id: string): CommandDefinition | undefined;
    getShortcut(id: string): string | undefined;
}
```

### SelectionModel (Selection State)

```typescript
class SelectionModel {
    // Observables
    selectedIds$: BehaviorSubject<Set<string>>;
    focusedCell$: BehaviorSubject<CellPosition | null>;
    
    // Operations
    select(taskId: string, options?: SelectOptions): void;
    selectRange(startId: string, endId: string): void;
    clearSelection(): void;
    
    // Queries
    isSelected(taskId: string): boolean;
    getSelectedIds(): string[];
}
```

### SchedulerService (Orchestrator)

```typescript
class SchedulerService {
    // Initialization
    init(container: HTMLElement): Promise<void>;
    initKeyboard(): void;
    
    // View Management
    scrollToTask(taskId: string): void;
    refresh(): void;
    
    // Accessors
    getProjectController(): ProjectController;
    getSelectionModel(): SelectionModel;
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
* [TRUE_PURE_DI_IMPLEMENTATION_PLAN.md](docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md) - DI migration details

---

**Last Updated:** January 7, 2026
