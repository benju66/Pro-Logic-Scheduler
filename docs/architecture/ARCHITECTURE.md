# Pro Logic Scheduler - Architecture Guide

## Overview

Pro Logic Scheduler is a high-performance, desktop-class construction scheduling application. It is architected for speed ("Ferrari Engine"), using direct DOM manipulation for the critical rendering path while keeping business logic pure and portable.

**Version:** 4.0.0 (Desktop-Only Architecture)

## Core Principles

### 1. **Performance First (The "Ferrari Engine")**
The rendering layer eschews heavy framework reconciliation (React/Vue) for the critical grid/gantt components. It uses direct DOM pooling and integer-snapped canvas drawing to achieve 60 FPS with 10,000+ tasks.

### 2. **Unified Viewport ("The Puppeteer")**
A single master controller (`SchedulerViewport`) owns the scroll state and "drives" two dumb renderers (`GridRenderer` and `GanttRenderer`) in a single animation frame. This eliminates scroll jitter and synchronization lag.

### 3. **Fractional Indexing**
Task ordering is managed via lexicographical string keys (e.g., `"a0"`, `"a0V"`). This allows infinite reordering between any two tasks without updating the database records of siblings, enabling robust offline-first capabilities.

### 4. **Desktop-Only Architecture**
- **Rust CPM Engine**: All scheduling calculations performed in Rust for maximum performance (O(N) complexity).
- **Tauri Native APIs**: File operations, persistence, and system integration use native OS dialogs and SQLite.
- **No Browser Fallbacks**: Desktop-only means no browser compatibility layer - fails fast with clear errors if Tauri unavailable.

### 5. **Separation of Concerns**
- **Core**: Pure business logic (Date Math, Engine interfaces). Zero dependencies.
- **Rust Backend**: CPM calculations, state management, SQLite persistence.
- **Data**: State management and CRUD operations.
- **Services**: Application orchestration and user intent handling.
- **UI**: Visual presentation and DOM event delegation.

### 6. **Centralized State Management**
The application uses singleton patterns for cross-component state coordination:
- **EditingStateManager**: Single source of truth for cell editing state. Eliminates synchronization bugs between GridRenderer, KeyboardService, and SchedulerService. Uses observer pattern for reactive updates.

## Directory Structure

```text
src/
├── core/                    # Pure business logic (No UI dependencies)
│   ├── engines/            # Scheduling engines
│   │   └── RustEngine.ts   # Tauri Desktop CPM Engine (sole engine)
│   ├── DateUtils.ts        # Date calculations (Work days, Holidays)
│   └── Constants.ts        # Shared constants
│
├── data/                    # Data management layer
│   ├── TaskStore.ts        # Task CRUD & Hierarchy queries
│   ├── CalendarStore.ts    # Calendar state
│   ├── HistoryManager.ts   # Undo/Redo snapshots
│   ├── PersistenceService.ts # SQLite event queue
│   ├── SnapshotService.ts  # Checkpoint snapshots
│   └── DataLoader.ts      # SQLite data loading
│
├── services/                # Application Orchestration
│   ├── SchedulerService.ts # Main Controller (The "Brain")
│   ├── OrderingService.ts  # Fractional Indexing logic
│   ├── EditingStateManager.ts # Centralized editing state (Singleton)
│   └── UIEventManager.ts   # Global event coordination
│
├── ui/                      # User Interface Layer
│   ├── components/
│   │   ├── scheduler/      # Unified Scheduler Engine
│   │   │   ├── SchedulerViewport.ts  # MASTER CONTROLLER
│   │   │   ├── GridRenderer.ts       # DOM Renderer (Pooled)
│   │   │   ├── GanttRenderer.ts      # Canvas Renderer
│   │   │   ├── pool/                 # DOM Pooling System
│   │   │   └── types.ts              # Viewport Interfaces
│   │   │
│   │   └── CanvasGantt.ts            # Facade (Legacy Adapter)
│   │
│   └── services/           # UI-specific services
│       ├── ToastService.ts
│       ├── FileService.ts  # Native file dialogs (Tauri)
│       └── KeyboardService.ts
│
src-tauri/                   # Rust Backend
├── src/
│   ├── cpm.rs              # Rust CPM Engine (O(N) performance, HashSet optimization)
│   ├── types.rs            # Rust type definitions (matches TypeScript)
│   ├── engine_state.rs     # Stateful engine state management
│   └── commands.rs         # Tauri command handlers
```

## Architecture Highlights

### Rust CPM Engine
- **Performance**: O(N) complexity (pre-computed HashSet for parent lookups)
- **Data Integrity**: All TypeScript Task fields preserved through Rust round-trips
- **Stateful**: Maintains project state in Rust backend for efficient delta updates

### Desktop-Only Design
- **Native Dialogs**: All file operations use OS-native dialogs (no browser file inputs)
- **SQLite Persistence**: True offline-first with SQLite database
- **Error Handling**: Fails fast with clear errors if Tauri unavailable (no silent fallbacks)

### Engine Architecture
- **Single Engine**: RustEngine is the sole scheduling engine (no JavaScript fallback)
- **State Management**: Engine state maintained in Rust backend via Tauri commands
- **Delta Updates**: Efficient task updates via `updateTask()`, `addTask()`, `deleteTask()` commands