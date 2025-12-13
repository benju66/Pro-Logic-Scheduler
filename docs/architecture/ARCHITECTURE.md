# Pro Logic Scheduler - Architecture Guide

## Overview

This application is designed to be **AI-friendly** - structured for easy understanding, maintenance, and extension by AI assistants. Every architectural decision prioritizes clarity, consistency, and discoverability.

## Core Principles

### 1. **Single Responsibility**
Each module has ONE clear purpose. If a module does multiple things, it should be split.

### 2. **Explicit Dependencies**
No globals. All dependencies are passed explicitly via constructor or function parameters.

### 3. **Type Documentation**
Every function, class, and module has comprehensive JSDoc with types.

### 4. **Consistent Patterns**
Same structure everywhere. Predictable naming conventions.

### 5. **Separation of Concerns**
- **Core**: Pure business logic (no DOM, no side effects)
- **Data**: Data management and persistence
- **UI**: Presentation and user interaction
- **Services**: Application orchestration

## Directory Structure

```
src/
├── core/                    # Pure business logic (no dependencies on DOM/UI)
│   ├── CPM.js              # Critical Path Method calculations
│   └── DateUtils.js        # Date calculations and utilities
│
├── data/                    # Data management layer
│   ├── TaskStore.js        # Task CRUD operations
│   ├── CalendarStore.js    # Calendar management
│   └── HistoryManager.js   # Undo/redo history
│
├── ui/                      # User interface layer
│   ├── components/         # Reusable UI components
│   │   ├── VirtualScrollGrid.js
│   │   ├── CanvasGantt.js
│   │   ├── SideDrawer.js
│   │   ├── DependenciesModal.js
│   │   └── CalendarModal.js
│   └── services/           # UI-specific services
│       ├── ToastService.js
│       ├── FileService.js
│       └── KeyboardService.js
│
├── services/                # Application services (orchestration)
│   ├── SchedulerService.js # Main application orchestrator
│   └── SyncService.js      # Grid/Gantt synchronization
│
└── main.js                  # Entry point (minimal, just initialization)
```

## Module Patterns

### Core Modules (Pure Logic)
```javascript
/**
 * @fileoverview Brief description of what this module does
 * @module core/ModuleName
 */

/**
 * Class description
 * @class
 */
export class ModuleName {
    /**
     * Method description
     * @param {Type} param - Parameter description
     * @returns {ReturnType} Return description
     */
    method(param) {
        // Implementation
    }
}
```

### Data Modules (State Management)
```javascript
/**
 * @fileoverview Manages [data type] state and persistence
 * @module data/DataStore
 */

export class DataStore {
    /**
     * @param {Object} options - Configuration
     * @param {Function} options.onChange - Callback when data changes
     */
    constructor(options) {}
    
    /**
     * Get all items
     * @returns {Array<ItemType>}
     */
    getAll() {}
    
    /**
     * Update an item
     * @param {string} id - Item ID
     * @param {Partial<ItemType>} updates - Updates to apply
     * @returns {ItemType} Updated item
     */
    update(id, updates) {}
}
```

### UI Components
```javascript
/**
 * @fileoverview [Component description]
 * @module ui/components/ComponentName
 */

export class ComponentName {
    /**
     * @param {Object} options - Configuration
     * @param {HTMLElement} options.container - DOM container
     * @param {Function} options.onEvent - Event callback
     */
    constructor(options) {}
    
    /**
     * Render the component
     * @param {Object} data - Data to render
     */
    render(data) {}
    
    /**
     * Clean up resources
     */
    destroy() {}
}
```

### Services (Orchestration)
```javascript
/**
 * @fileoverview Orchestrates [domain] functionality
 * @module services/ServiceName
 */

export class ServiceName {
    /**
     * @param {Object} dependencies - Required services/components
     * @param {DataStore} dependencies.store - Data store
     * @param {Component} dependencies.component - UI component
     */
    constructor(dependencies) {}
}
```

## Naming Conventions

### Files
- **PascalCase** for classes: `TaskStore.js`, `VirtualScrollGrid.js`
- **camelCase** for utilities: `dateUtils.js` (if not a class)

### Classes
- **PascalCase**: `TaskStore`, `VirtualScrollGrid`

### Methods
- **camelCase**: `getTask()`, `updateTask()`, `render()`
- **Private methods** prefixed with `_`: `_calculate()`, `_renderRow()`

### Constants
- **UPPER_SNAKE_CASE**: `MAX_HISTORY`, `STORAGE_KEY`

## Dependency Flow

```
main.js
  └──> services/SchedulerService
         ├──> data/TaskStore
         ├──> data/CalendarStore
         ├──> data/HistoryManager
         ├──> ui/components/VirtualScrollGrid
         ├──> ui/components/CanvasGantt
         ├──> ui/components/SideDrawer
         ├──> ui/services/KeyboardService
         └──> services/SyncService
```

**Key Rule**: Dependencies flow DOWN only. Lower layers never import from higher layers.

- `core/` → No dependencies
- `data/` → Can import from `core/`
- `ui/` → Can import from `core/` and `data/`
- `services/` → Can import from all layers
- `main.js` → Only imports from `services/`

## Data Flow

### Unidirectional Data Flow
```
User Action
  ↓
UI Component (captures event)
  ↓
Service (processes action)
  ↓
Data Store (updates state)
  ↓
Service (notifies subscribers)
  ↓
UI Components (re-render)
```

## Event Handling

### Pattern: Event Delegation + Callbacks
```javascript
// Component emits events via callbacks
constructor(options) {
    this.onCellChange = options.onCellChange; // Callback
}

// Service subscribes
const grid = new VirtualScrollGrid({
    onCellChange: (taskId, field, value) => {
        this.handleCellChange(taskId, field, value);
    }
});
```

## State Management

### Centralized State
- All application state lives in `data/` stores
- UI components are **stateless** (presentation only)
- Services coordinate between stores and UI

### State Updates
1. User action triggers callback
2. Service receives callback
3. Service updates data store
4. Store notifies subscribers
5. UI components re-render

## Testing Strategy

### Unit Tests
- `core/` modules: Pure functions, easy to test
- `data/` modules: Mock storage, test CRUD operations
- `ui/` components: Mock DOM, test rendering logic

### Integration Tests
- `services/` modules: Test orchestration logic

## Performance Considerations

### Virtual Scrolling
- `VirtualScrollGrid` uses DOM recycling
- Only visible rows are rendered
- Editing state preserved during scroll

### Canvas Rendering
- `CanvasGantt` uses requestAnimationFrame
- Only redraws when data changes

### Debouncing
- Input changes debounced (150ms)
- CPM calculations batched
- Scroll events throttled (16ms)

## Extension Points

### Adding a New Feature

1. **Core Logic**: Add to `core/` if pure logic
2. **Data Management**: Add to `data/` if state management
3. **UI Component**: Add to `ui/components/` if visual component
4. **Service**: Add to `services/` if orchestration needed
5. **Wire Up**: Update `SchedulerService` to integrate

### Example: Adding Resource Management

```
core/
  └── ResourceModel.js      # Resource data model

data/
  └── ResourceStore.js     # Resource CRUD

ui/components/
  └── ResourcePanel.js      # Resource UI

services/
  └── ResourceService.js    # Resource orchestration
```

Then integrate into `SchedulerService`.

## Migration Notes

### From Old Structure
- ✅ `SchedulerEngine.js` → Removed (replaced by `SchedulerService`)
- ✅ `SchedulerService` → Uses `TaskStore` + `CalendarStore` + `HistoryManager`
- ⏳ `main.js` helpers → Move to `ui/services/` (in progress)
- ⏳ Global `window` assignments → Refactor to use event delegation (in progress)

## AI-Friendly Features

### 1. Clear Module Boundaries
Every file has a single, clear purpose.

### 2. Comprehensive Documentation
Every function has JSDoc with types.

### 3. Consistent Patterns
Same structure everywhere = predictable.

### 4. Explicit Dependencies
No hidden dependencies = easy to understand.

### 5. Type Information
JSDoc types help AI understand data structures.

### 6. Self-Documenting Code
Clear naming, logical structure.

## Questions?

When modifying code, ask:
1. **What layer does this belong in?** (core/data/ui/services)
2. **What are the dependencies?** (explicit, not global)
3. **Is this the right pattern?** (follow existing structure)
4. **Is it documented?** (JSDoc with types)

