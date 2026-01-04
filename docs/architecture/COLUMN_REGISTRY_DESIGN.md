# Column Registry Architecture Design

## Overview

This document outlines a modern, extensible column architecture for Pro-Logic Scheduler.
The design follows SOLID principles and draws inspiration from AG Grid and TanStack Table.

## Goals

1. **Extensibility**: Add new column types without modifying existing code
2. **Robustness**: Strong typing with clear interfaces and contracts
3. **Reliability**: Single source of truth for column behavior
4. **Maintainability**: Each column type is self-contained in one file
5. **Testability**: Column behaviors can be unit tested in isolation

## Current vs Proposed Architecture

### Current (Problematic)

```
SchedulerService._getBaseColumnDefinitions()
    ↓ creates inline renderer functions with `this` capture
GridColumn[] with embedded anonymous renderers
    ↓ passed to
BindingSystem._bindCell()
    ↓ switch-like logic per column type
DOM rendering
```

**Problems:**
- Renderers capture `this.tradePartnerStore`, `this._calculateVariance()`, etc.
- Can't extract columns to separate files
- Adding a column requires changes to SchedulerService + BindingSystem
- No way to test renderer logic in isolation

### Proposed (Column Registry Pattern)

```
ColumnRegistry (singleton)
    ↓ registers
ColumnDefinition[] (static metadata + renderer class reference)
    ↓ instantiates
ColumnRenderer instances (injected with services)
    ↓ called by
BindingSystem.bindCell(task, column, renderer)
    ↓
DOM rendering
```

## Core Interfaces

### 1. ColumnDefinition (Metadata Only)

```typescript
// src/core/columns/types.ts

export interface ColumnDefinition {
  // Identity
  id: string;                    // Unique identifier (e.g., 'name', 'start', 'health')
  field: keyof Task | string;    // Task field or virtual field
  
  // Display
  label: string;
  width: number;
  minWidth?: number;
  align?: 'left' | 'center' | 'right';
  
  // Behavior
  type: ColumnType;              // Reference to registered column type
  editable?: boolean | ((task: Task, ctx: ColumnContext) => boolean);
  visible?: boolean | (() => boolean);
  resizable?: boolean;
  
  // Styling
  headerClass?: string;
  cellClass?: string;
  
  // Type-specific config
  config?: Record<string, unknown>;
}

export type ColumnType = 
  | 'text' 
  | 'number' 
  | 'date' 
  | 'select' 
  | 'checkbox' 
  | 'readonly'
  | 'actions'
  | 'drag'
  | 'health'
  | 'variance'
  | 'tradePartners'
  | 'schedulingMode';
```

### 2. ColumnRenderer (Behavior)

```typescript
// src/core/columns/ColumnRenderer.ts

export interface ColumnContext {
  task: Task;
  index: number;
  isParent: boolean;
  isCollapsed: boolean;
  isCritical: boolean;
  depth: number;
  isSelected: boolean;
}

export interface ColumnRenderer {
  // Unique type identifier
  readonly type: ColumnType;
  
  // Render cell content (returns HTML string or DOM manipulation)
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
  
  // Get raw display value (for accessibility, copy/paste)
  getValue(task: Task, column: ColumnDefinition): string;
  
  // Handle cell edit (optional)
  onEdit?(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
  
  // Validate input (optional)
  validate?(value: string, task: Task, column: ColumnDefinition): boolean;
  
  // Parse input to task value (optional)
  parse?(value: string, column: ColumnDefinition): unknown;
}
```

### 3. ColumnRegistry (Central Manager)

```typescript
// src/core/columns/ColumnRegistry.ts

export class ColumnRegistry {
  private static instance: ColumnRegistry;
  
  private renderers: Map<ColumnType, ColumnRenderer> = new Map();
  private definitions: Map<string, ColumnDefinition> = new Map();
  
  private constructor() {}
  
  static getInstance(): ColumnRegistry {
    if (!ColumnRegistry.instance) {
      ColumnRegistry.instance = new ColumnRegistry();
    }
    return ColumnRegistry.instance;
  }
  
  // Register a renderer for a column type
  registerRenderer(renderer: ColumnRenderer): void {
    this.renderers.set(renderer.type, renderer);
  }
  
  // Register a column definition
  registerColumn(definition: ColumnDefinition): void {
    this.definitions.set(definition.id, definition);
  }
  
  // Get renderer for column type
  getRenderer(type: ColumnType): ColumnRenderer | undefined {
    return this.renderers.get(type);
  }
  
  // Get all registered column definitions (ordered)
  getColumns(): ColumnDefinition[] {
    return Array.from(this.definitions.values());
  }
  
  // Get column by ID
  getColumn(id: string): ColumnDefinition | undefined {
    return this.definitions.get(id);
  }
}
```

## Implementation: Column Renderers

### Base Classes

```typescript
// src/core/columns/renderers/BaseRenderer.ts

export abstract class BaseRenderer implements ColumnRenderer {
  abstract readonly type: ColumnType;
  
  abstract render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void;
  
  getValue(task: Task, column: ColumnDefinition): string {
    const value = getTaskFieldValue(task, column.field);
    return value ? String(value) : '';
  }
}

// src/core/columns/renderers/InputRenderer.ts
export abstract class InputRenderer extends BaseRenderer {
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
    if (!cell.input) return;
    
    const value = this.getValue(ctx.task, column);
    const editingManager = getEditingStateManager();
    
    if (!editingManager.isEditingCell(ctx.task.id, column.field)) {
      cell.input.value = this.formatForDisplay(value, column);
    }
    
    const isReadonly = this.isReadonly(ctx, column);
    cell.input.disabled = isReadonly;
    cell.input.classList.toggle('cell-readonly', isReadonly);
  }
  
  protected formatForDisplay(value: string, column: ColumnDefinition): string {
    return value;
  }
  
  protected isReadonly(ctx: ColumnContext, column: ColumnDefinition): boolean {
    if (column.editable === false) return true;
    if (typeof column.editable === 'function') {
      return !column.editable(ctx.task, ctx);
    }
    return false;
  }
}
```

### Concrete Renderers

```typescript
// src/core/columns/renderers/TextRenderer.ts
export class TextRenderer extends InputRenderer {
  readonly type: ColumnType = 'text';
}

// src/core/columns/renderers/DateRenderer.ts
export class DateRenderer extends InputRenderer {
  readonly type: ColumnType = 'date';
  
  protected formatForDisplay(value: string, column: ColumnDefinition): string {
    if (!value) return '';
    return formatDateForDisplay(value);
  }
  
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
    super.render(cell, ctx, column);
    
    // Add calendar icon, constraint icon, etc.
    if (column.config?.showConstraintIcon) {
      this.renderConstraintIcon(cell, ctx.task, column);
    }
  }
  
  private renderConstraintIcon(cell: PooledCell, task: Task, column: ColumnDefinition): void {
    // Icon rendering logic (moved from BindingSystem)
  }
}

// src/core/columns/renderers/HealthRenderer.ts
export class HealthRenderer extends BaseRenderer {
  readonly type: ColumnType = 'health';
  
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
    if (!cell.text) return;
    
    const health = ctx.task._health;
    if (!health) {
      cell.text.innerHTML = '<span style="color: #94a3b8;">-</span>';
      return;
    }
    
    const statusClass = `health-${health.status}`;
    cell.text.innerHTML = `<span class="health-indicator-inline ${statusClass}" title="${health.summary}">${health.icon}</span>`;
  }
  
  getValue(task: Task): string {
    return task._health?.summary || '-';
  }
}

// src/core/columns/renderers/TradePartnersRenderer.ts
export class TradePartnersRenderer extends BaseRenderer {
  readonly type: ColumnType = 'tradePartners';
  
  // Dependency injection - no `this` capture!
  constructor(private tradePartnerStore: TradePartnerStore) {
    super();
  }
  
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
    if (!cell.text) return;
    
    const partnerIds = ctx.task.tradePartnerIds || [];
    if (partnerIds.length === 0) {
      cell.text.textContent = '';
      return;
    }
    
    const chips = partnerIds.map(id => {
      const partner = this.tradePartnerStore.get(id);
      if (!partner) return '';
      
      const shortName = partner.name.length > 12 
        ? partner.name.substring(0, 10) + '...' 
        : partner.name;
      
      return `<span class="trade-chip" data-partner-id="${id}" 
              style="background-color:${partner.color}; color: white; 
              padding: 2px 8px; border-radius: 12px; font-size: 11px;
              margin-right: 4px; cursor: pointer; display: inline-block;
              white-space: nowrap; max-width: 100px; overflow: hidden;
              text-overflow: ellipsis;" title="${partner.name}">${shortName}</span>`;
    }).join('');
    
    cell.text.innerHTML = chips;
  }
  
  getValue(task: Task): string {
    return (task.tradePartnerIds || []).join(', ');
  }
}

// src/core/columns/renderers/VarianceRenderer.ts
export class VarianceRenderer extends BaseRenderer {
  readonly type: ColumnType = 'variance';
  
  constructor(private calculateVariance: (task: Task) => { start: number | null; finish: number | null }) {
    super();
  }
  
  render(cell: PooledCell, ctx: ColumnContext, column: ColumnDefinition): void {
    if (!cell.text) return;
    
    const variance = this.calculateVariance(ctx.task);
    const field = column.config?.varianceField as 'start' | 'finish';
    const value = field === 'finish' ? variance.finish : variance.start;
    
    if (value === null) {
      cell.text.innerHTML = '<span style="color: #94a3b8;">-</span>';
      return;
    }
    
    const absValue = Math.abs(value);
    const isPositive = value > 0;
    const isNegative = value < 0;
    
    let className = 'variance-on-time';
    let prefix = '';
    
    if (isPositive) {
      className = 'variance-ahead';
      prefix = '+';
    } else if (isNegative) {
      className = 'variance-behind';
    }
    
    const tooltip = `${isPositive ? 'Ahead' : isNegative ? 'Behind' : 'On time'} by ${absValue} day${absValue !== 1 ? 's' : ''}`;
    cell.text.innerHTML = `<span class="${className}" title="${tooltip}">${prefix}${value}</span>`;
  }
}
```

## Registration & Initialization

```typescript
// src/core/columns/registerDefaultColumns.ts

export function registerDefaultColumns(registry: ColumnRegistry, services: ServiceContainer): void {
  // Register renderers (one per type)
  registry.registerRenderer(new TextRenderer());
  registry.registerRenderer(new NumberRenderer());
  registry.registerRenderer(new DateRenderer());
  registry.registerRenderer(new SelectRenderer());
  registry.registerRenderer(new CheckboxRenderer());
  registry.registerRenderer(new ReadonlyRenderer());
  registry.registerRenderer(new DragRenderer());
  registry.registerRenderer(new ActionsRenderer());
  registry.registerRenderer(new HealthRenderer());
  registry.registerRenderer(new TradePartnersRenderer(services.tradePartnerStore));
  registry.registerRenderer(new VarianceRenderer(services.calculateVariance));
  registry.registerRenderer(new SchedulingModeRenderer());
  
  // Register column definitions (static metadata)
  DEFAULT_COLUMNS.forEach(col => registry.registerColumn(col));
}

// Default column definitions (pure data, no functions)
const DEFAULT_COLUMNS: ColumnDefinition[] = [
  {
    id: 'drag',
    field: 'drag',
    label: '',
    type: 'drag',
    width: 28,
    align: 'center',
    editable: false,
    resizable: false,
    minWidth: 20,
  },
  {
    id: 'checkbox',
    field: 'checkbox',
    label: '',
    type: 'checkbox',
    width: 30,
    align: 'center',
    editable: false,
    resizable: false,
    minWidth: 25,
  },
  {
    id: 'name',
    field: 'name',
    label: 'Task Name',
    type: 'text',
    width: 220,
    editable: true,
    minWidth: 100,
  },
  // ... more columns ...
  {
    id: 'health',
    field: '_health',
    label: 'Health',
    type: 'health',
    width: 80,
    align: 'center',
    editable: false,
    minWidth: 60,
  },
  {
    id: 'tradePartners',
    field: 'tradePartnerIds',
    label: 'Trade Partners',
    type: 'tradePartners',
    width: 180,
    editable: false,
    align: 'left',
    minWidth: 120,
  },
];
```

## Migration Path

### Phase 1: Create Infrastructure (Low Risk)
1. Create `src/core/columns/` directory structure
2. Define interfaces (`ColumnDefinition`, `ColumnRenderer`, etc.)
3. Implement `ColumnRegistry` singleton
4. Create base renderer classes

### Phase 2: Migrate Simple Columns (Medium Risk)
1. Implement `TextRenderer`, `NumberRenderer`, `ReadonlyRenderer`
2. Migrate column definitions to `DEFAULT_COLUMNS` array
3. Update `BindingSystem` to use registry for simple types

### Phase 3: Migrate Complex Columns (Higher Risk)
1. Implement `DateRenderer` with constraint icons
2. Implement `TradePartnersRenderer` with dependency injection
3. Implement `VarianceRenderer` with callback injection
4. Update `BindingSystem` to delegate all rendering to registry

### Phase 4: Remove Legacy Code
1. Remove `_getBaseColumnDefinitions()` from SchedulerService
2. Remove column-specific logic from BindingSystem
3. Update ColumnSettingsModal to use registry

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| Add new column type | Edit 3+ files | Create 1 renderer file + register |
| Test column rendering | Requires full app setup | Unit test renderer in isolation |
| Column logic location | Split across files | Single file per type |
| Dependencies | `this` capture | Explicit injection |
| Type safety | Partial | Full TypeScript coverage |

## File Structure (Final)

```
src/core/columns/
├── types.ts                 # Interfaces
├── ColumnRegistry.ts        # Singleton manager
├── registerDefaultColumns.ts
├── renderers/
│   ├── BaseRenderer.ts
│   ├── InputRenderer.ts     # Base for editable columns
│   ├── TextRenderer.ts
│   ├── NumberRenderer.ts
│   ├── DateRenderer.ts
│   ├── SelectRenderer.ts
│   ├── CheckboxRenderer.ts
│   ├── ReadonlyRenderer.ts
│   ├── DragRenderer.ts
│   ├── ActionsRenderer.ts
│   ├── HealthRenderer.ts
│   ├── TradePartnersRenderer.ts
│   ├── VarianceRenderer.ts
│   └── SchedulingModeRenderer.ts
└── definitions/
    ├── baseColumns.ts       # Core columns (drag, checkbox, name, etc.)
    └── trackingColumns.ts   # Baseline/actual/variance columns
```

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Infrastructure | 2-3 hours | Low |
| Phase 2: Simple columns | 3-4 hours | Low-Medium |
| Phase 3: Complex columns | 4-6 hours | Medium |
| Phase 4: Cleanup | 2-3 hours | Low |
| **Total** | **11-16 hours** | - |

## Testing Strategy

1. **Unit Tests per Renderer**
   ```typescript
   describe('DateRenderer', () => {
     it('formats ISO date to MM/DD/YYYY', () => {
       const renderer = new DateRenderer();
       const mockCell = createMockCell();
       const ctx = createMockContext({ task: { start: '2024-01-15' } });
       renderer.render(mockCell, ctx, dateColumn);
       expect(mockCell.input.value).toBe('01/15/2024');
     });
   });
   ```

2. **Integration Tests**
   - Verify registry initialization
   - Verify column ordering with preferences
   - Verify cell rendering in grid

3. **Snapshot Tests**
   - Capture rendered HTML for each column type
   - Regression testing during migration
