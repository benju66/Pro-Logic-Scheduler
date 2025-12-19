
# Pro Logic Scheduler: Master System Specification

**Version:** 3.0.0 (Production-Ready)
**Status:** Approved for Implementation & SQLite Migration
**Scope:** Core Logic, Data Architecture, and Rendering Engine
**Supersedes:** `Unified_Scheduler_V2_2_0_Specification.md`

---

## 1. Executive Summary

Pro Logic Scheduler is a high-performance, desktop-class construction scheduling application. It distinguishes itself through a "Ferrari Engine" architecture: vanilla TypeScript/DOM manipulation for rendering (60FPS at 10k+ tasks) backed by a robust Critical Path Method (CPM) calculation engine.

### Key Architectural Pillars
1.  **Unified Viewport:** A "Puppeteer" pattern where a master controller drives separate Grid (DOM) and Gantt (Canvas) renderers via a single RAF loop.
2.  **Fractional Indexing:** Deterministic, conflict-free ordering using string-based sort keys (LexoRank style), enabling infinite reordering without database rewrites.
3.  **Scheduling Triangle:** Intelligent handling of Start/Duration/End edits that mimics MS Project behavior (applying constraints automatically).
4.  **Stateless CPM Engine:** A pure functional core that calculates dates, float, and critical paths without side effects.

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

### 2.3. State Management (Event Sourcing)

* **TaskStore:** Central repository. Manages CRUD and hierarchy queries (`getChildren`, `getVisibleTasks`). Emits `onChange` events.
* **CalendarStore:** Manages working days, holidays, and weekends.
* **HistoryManager (Command Pattern):**
    * **No Snapshots:** To support high performance and SQLite auditability, the system does NOT store full JSON snapshots of the state.
    * **Command Pattern:** Every user intent (e.g., "Indent Task", "Update Duration") is reified as a Command object.
    * **Undo/Redo:** Handled by pushing the *inverse* command to an undo stack (e.g., Undo "Indent" = Execute "Outdent").
    * **Persistence:** All commands are logged to the SQLite `events` table.

---

## 3. Business Logic (The Core)

### 3.1. Critical Path Method (CPM.ts)

The engine runs a 7-step pure calculation cycle:

1. **Successor Map:** Invert dependencies to map Predecessors  Successors.
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

### 3.2. Health Analysis Logic

Tasks are assigned a health status based on the following priority:

1. **Blocked (🟣):** Missing predecessors or circular dependencies.
2. **Critical Failure (🔴):** `FNLT` constraint violated by >3 days, or negative float (schedule impossible).
3. **At Risk (🟡):** `FNLT` violated by <3 days, or Critical Path with low float (<2 days).
4. **Healthy (🟢):** On track with adequate float.

### 3.3. The "Scheduling Triangle" (Service Logic)

The `SchedulerService` interprets user edits to maintain logical consistency:

* **Edit Duration:** Update `duration`. Keep `start`. CPM recalculates `end`.
* **Edit Start:** Apply **SNET** (Start No Earlier Than) constraint.
* **Edit End:** Apply **FNLT** (Finish No Later Than) constraint (Deadline).
* **Edit Actuals:** Update `actualStart`/`actualFinish`. Does **not** affect CPM dates (variance tracking only).

### 3.4. Performance Strategy (Rust Migration)

To achieve 60 FPS with >10,000 tasks, the calculation engine will be migrated in **Phase 2**:
* **Migration:** `src/core/CPM.ts` logic will be ported to **Rust/WASM**.
* **Threading:** Calculations will run on a background thread to prevent UI blocking during heavy forward/backward passes.
* **Monte Carlo:** The Rust engine will also power the future "Schedule Confidence" simulations.

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
* **Fast Binding:** Uses `textContent`, `className`, and `style.transform`. avoids `innerHTML` during scroll.

---

## 5. Interaction Model

### 5.1. Selection & Focus

* **Ownership:** `SchedulerService` holds the `selectedIds` Set.
* **Granularity:** Supports single row, multi-row (Ctrl/Shift), and cell-level focus.
* **Focus Management:** When adding a task, the service explicitly instructs the grid to `focusCell('name')` to allow immediate typing.

### 5.2. Keyboard Shortcuts

The `KeyboardService` maps keys to Service actions:

* `Enter`: Add sibling task (below).
* `Ctrl+Enter`: Add child task.
* `Ins`: Insert task.
* `Tab / Shift+Tab`: Indent / Outdent.
* `F2`: Edit active cell.
* `Arrow Keys`: Navigate focus.

---

## 6. Implementation Plan (SQLite & Event Sourcing)

To migrate to SQLite (Phase 1), the data layer must transition to an **Event Sourcing** model using `tauri-plugin-sql`.

### 6.1. The Events Table
All application state changes must be logged to an append-only table to ensure auditability and crash recovery.

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

---

## 7. API Reference (Core Interfaces)

### SchedulerService (Public API)

* `addTask(data?)`: Promise<Task>
* `deleteTask(id)`: void
* `updateTask(id, updates)`: void
* `indent(id)` / `outdent(id)`: void
* `recalculateAll()`: void
* `loadData()` / `saveData()`: Persistence handling

### SchedulerViewport (Internal API)

* `setScrollTop(y)`: Updates vertical position.
* `setData(tasks)`: Updates model.
* `refresh()`: Forces a layout recalculation and render cycle.

```

---

## 8. Quality Assurance & AI Verification Strategy

To ensure "Bulletproof" reliability without a human QA team, the system relies on an **Automated Verification Gate**.

### 8.1. The "Verify" Protocol
Every development phase must include a corresponding verification script (e.g., `verify-phase1.ts`).
* **Requirement:** The AI Developer must run this script after every significant code change.
* **Success Criteria:** A change is only considered "Complete" when the verification script prints `VERIFICATION PASSED`.

### 8.2. Testing Layers
1.  **Unit Tests (Vitest):**
    * **Scope:** `CPM.ts`, `DateUtils.ts`, `OrderingService.ts`.
    * **Mandate:** 100% logical branch coverage for core math/dates.
    * **Performance:** Must run in <100ms.
2.  **Integration Tests (The "Verify" Scripts):**
    * **Scope:** `SchedulerService` + `TaskStore` + `HistoryManager`.
    * **Mandate:** Simulate real user flows (Add Task -> Indent -> Undo -> Redo) and assert state integrity.
3.  **Performance "Canaries":**
    * **Mandate:** Rendering loop must never exceed 16.6ms (60 FPS) for 1,000 visible rows.
    * **Regression:** Any commit that drops FPS below 55 must be reverted.

### 8.3. Self-Correction Loop
If a verification step fails:
1.  The AI must analyze the `verify` output error.
2.  The AI must propose a fix.
3.  The AI must re-run `verify` to confirm the fix.
4.  Only then can the code be committed.

```