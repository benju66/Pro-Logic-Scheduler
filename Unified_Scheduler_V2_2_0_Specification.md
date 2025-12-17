# Pro Logic Scheduler V2: Unified Viewport Architecture
## Complete Implementation Specification

**Version:** 2.2.0 (Production-Ready)  
**Status:** Ready for Implementation  
**Target:** 60 FPS with 10,000+ tasks  
**Last Updated:** Based on Architectural Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [DOM Structure](#3-dom-structure)
4. [File Structure](#4-file-structure)
5. [Module 1: SchedulerViewport (The Master)](#5-module-1-schedulerviewport-the-master)
6. [Module 2: GridRenderer](#6-module-2-gridrenderer)
7. [Module 3: GanttRenderer](#7-module-3-ganttrenderer)
8. [Module 4: Shared Types](#8-module-4-shared-types)
9. [Module 5: Pre-rendered Icons](#9-module-5-pre-rendered-icons)
10. [Module 6: Pool System](#10-module-6-pool-system)
11. [Module 7: Binding System](#11-module-7-binding-system)
12. [CSS Requirements](#12-css-requirements)
13. [Event Flow & Coordination](#13-event-flow--coordination)
14. [Selection State Management](#14-selection-state-management)
15. [Performance Budgets](#15-performance-budgets)
16. [Error Handling & Recovery](#16-error-handling--recovery)
17. [Accessibility Requirements](#17-accessibility-requirements)
18. [SchedulerService Integration](#18-schedulerservice-integration)
19. [Initialization Sequence](#19-initialization-sequence)
20. [Testing Strategy](#20-testing-strategy)
21. [Implementation Order](#21-implementation-order)
22. [Verification Checklist](#22-verification-checklist)

---

## 1. Executive Summary

### Problem Statement

The current architecture has two independent scroll systems (Grid and Gantt) synchronized via a mediator service with `_isSyncing` flags. This causes:

- **Scroll jitter** from competing scroll handlers
- **DOM thrashing** from `innerHTML` and `createElement` during scroll
- **Garbage collection pressure** from destroyed elements
- **Layout thrashing** from interleaved reads/writes
- **Sync lag** from flag-based coordination

### The Solution: Unified Viewport (The "Puppeteer" Model)

A **Master Controller** (`SchedulerViewport`) owns the Vertical Scroll state and drives two "dumb" renderers (`GridRenderer` and `GanttRenderer`) via a single `requestAnimationFrame` loop.

**Key Principles:**
- **Vertical Scroll (Y-axis):** Managed globally by `SchedulerViewport`. Both panels move in perfect lockstep.
- **Horizontal Scroll (X-axis):** Managed locally by each renderer.
  - Grid scrolls X for Columns (independent)
  - Gantt scrolls X for Timeline (independent)
- **Single RAF Loop:** One animation frame drives both renderers
- **DOM Pooling:** All row elements created once, recycled forever
- **Integer Snapping:** All Y-coordinates use `Math.floor()` to prevent sub-pixel drift

---

## 2. Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SchedulerViewport (MASTER)                            │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              Single Scroll Container (overflow-y: auto)          │   │
│   │                                                                  │   │
│   │   ┌──────────────────────────────────────────────────────────┐   │   │
│   │   │              Single RAF Loop                              │   │   │
│   │   │   requestAnimationFrame → calculate state → render both   │   │   │
│   │   └──────────────────────────────────────────────────────────┘   │   │
│   │                          │                                        │   │
│   │            ┌─────────────┴─────────────┐                        │   │
│   │            │      ViewportState        │                        │   │
│   │            │  {scrollTop, height,      │                        │   │
│   │            │   visibleRange}           │                        │   │
│   │            └─────────────┬─────────────┘                        │   │
│   │                          │                                        │   │
│   │         ┌────────────────┼────────────────┐                     │   │
│   │         ▼                                 ▼                       │   │
│   │   ┌───────────────┐                ┌───────────────┐             │   │
│   │   │ GridRenderer   │                │ GanttRenderer │             │   │
│   │   │    (DOM)       │                │   (Canvas)    │             │   │
│   │   │                │                │               │             │   │
│   │   │ - PoolSystem   │                │ - 2D Context │             │   │
│   │   │ - BindSystem   │                │ - Bar drawing │             │   │
│   │   │ - Events       │                │ - Deps lines │             │   │
│   │   │                │                │               │             │   │
│   │   │ overflow-x:auto│                │ overflow-x:auto│            │   │
│   │   │ (independent)  │                │ (independent) │             │   │
│   │   └───────────────┘                └───────────────┘             │   │
│   │                                                                   │   │
│   │   Constraint: Neither renderer has vertical scroll listeners     │   │
│   │   Constraint: Neither renderer calls requestAnimationFrame        │   │
│   └───────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Scroll Event (passive, vertical only)
       │
       ▼
SchedulerViewport._onScroll()
       │
       ├─► Update this.scrollTop (single source of truth)
       │
       ▼
RAF Loop (if not already scheduled)
       │
       ▼
Calculate ViewportState
       │
       ├─► visibleRange = { start, end }
       │
       ▼
Call renderers in same frame:
       │
       ├─► gridRenderer.render(state)
       │       │
       │       ├─► Release rows outside range
       │       ├─► Acquire/bind rows in range
       │       └─► Apply CSS transform (translateY)
       │
       └─► ganttRenderer.render(state)
               │
               ├─► Clear canvas
               ├─► Draw background grid
               └─► Draw visible bars (integer-snapped)
```

### Component Responsibilities

| Component | Owns | Does NOT Own |
|-----------|------|--------------|
| `SchedulerViewport` | Vertical scroll position, RAF loop, visible range calculation, resize handling, selection state | DOM content, Canvas drawing, horizontal scroll |
| `GridRenderer` | DOM element pools, data binding, event delegation, horizontal scroll (columns) | Vertical scroll position, RAF scheduling |
| `GanttRenderer` | Canvas contexts, bar rendering, dependency lines, horizontal scroll (timeline) | Vertical scroll position, RAF scheduling |

---

## 3. DOM Structure

### Container Hierarchy

```
<div class="scheduler-viewport">          ← SchedulerViewport creates
    position: relative
    overflow-y: auto                      ← Vertical scroll container
    overflow-x: hidden
    
    <div class="scheduler-scroll-content">  ← Scroll content wrapper
        height: totalHeight (dataLength * rowHeight)
        
        <div class="scheduler-grid-pane">    ← GridRenderer container
            position: absolute
            left: 0
            width: gridWidth
            overflow-x: auto                ← Horizontal scroll (independent)
            overflow-y: hidden              ← No vertical scroll
            
            <div class="vsg-row-container">  ← Row container (transform-based)
                position: absolute
                will-change: transform
                
                <div class="vsg-row">...</div>  ← Pooled rows
                <div class="vsg-row">...</div>
                ...
            </div>
        </div>
        
        <div class="scheduler-gantt-pane">  ← GanttRenderer container
            position: absolute
            left: gridWidth
            right: 0
            overflow-x: auto                ← Horizontal scroll (independent)
            overflow-y: hidden              ← No vertical scroll
            
            <canvas class="cg-header-canvas"></canvas>  ← Fixed header
            <canvas class="cg-main-canvas"></canvas>    ← Scrollable content
        </div>
    </div>
</div>
```

### Key Points

1. **Single Vertical Scroll Container:** Only `scheduler-viewport` has `overflow-y: auto`
2. **Independent Horizontal Scroll:** Grid and Gantt panes each have `overflow-x: auto`
3. **Transform-Based Positioning:** Row container uses `transform: translateY()` for performance
4. **No Phantom Spacers:** Scroll height maintained by `scheduler-scroll-content` height

---

## 4. File Structure

```
src/ui/components/
├── scheduler/
│   ├── SchedulerViewport.ts       # Master controller (NO singleton)
│   ├── GridRenderer.ts           # DOM renderer
│   ├── GanttRenderer.ts          # Canvas renderer
│   ├── types.ts                  # Shared interfaces
│   ├── icons.ts                  # Pre-rendered SVG strings
│   ├── constants.ts              # Shared constants (ROW_HEIGHT, etc.)
│   ├── pool/
│   │   ├── PoolSystem.ts         # Row/cell DOM pooling
│   │   └── BindingSystem.ts     # Data-to-DOM binding
│   └── styles/
│       └── scheduler.css         # BEM-scoped styles
│
├── VirtualScrollGrid.ts          # FACADE - Wraps GridRenderer
├── CanvasGantt.ts                # FACADE - Wraps GanttRenderer
└── ... (other components unchanged)
```

### Why Facades?

To maintain backward compatibility with `SchedulerService`, we keep existing class names as thin wrappers. This means **SchedulerService requires MINIMAL changes**.

---

## 5. Module 1: SchedulerViewport (The Master)

### File: `src/ui/components/scheduler/SchedulerViewport.ts`

### Responsibility

The single source of truth for vertical scroll position. Owns the RAF loop. Drives both renderers. Manages selection state.

### Interface

```typescript
import type { Task, GridColumn } from '../../../types';
import type { ViewportState, GridRendererOptions, GanttRendererOptions } from './types';
import { GridRenderer } from './GridRenderer';
import { GanttRenderer } from './GanttRenderer';

export interface SchedulerViewportOptions {
    rowHeight?: number;
    headerHeight?: number;
    bufferRows?: number;
    
    // Event callbacks (forwarded to SchedulerService)
    onRowClick?: (taskId: string, event: MouseEvent) => void;
    onRowDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onCellChange?: (taskId: string, field: string, value: unknown) => void;
    onAction?: (taskId: string, action: string, event: MouseEvent) => void;
    onToggleCollapse?: (taskId: string) => void;
    onSelectionChange?: (selectedIds: string[]) => void;
    onRowMove?: (taskIds: string[], targetId: string, position: 'before' | 'after') => void;
    onBarClick?: (taskId: string, event: MouseEvent) => void;
    onBarDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onBarDrag?: (task: Task, start: string, end: string) => void;
    onDependencyClick?: (taskId: string, depId: string, event: MouseEvent) => void;
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
    getDepth?: (taskId: string) => number;
}

export class SchedulerViewport {
    // Configuration
    private rowHeight: number;
    private headerHeight: number;
    private bufferRows: number;
    
    // Scroll state (THE source of truth for vertical scroll)
    private scrollTop: number = 0;
    private viewportHeight: number = 0;
    private viewportWidth: number = 0;
    
    // Data
    private tasks: Task[] = [];
    private dataLength: number = 0;
    
    // Renderers
    private gridRenderer: GridRenderer | null = null;
    private ganttRenderer: GanttRenderer | null = null;
    
    // DOM
    private container: HTMLElement;
    private scrollElement: HTMLElement | null = null;
    private scrollContent: HTMLElement | null = null;
    private gridPane: HTMLElement | null = null;
    private ganttPane: HTMLElement | null = null;
    
    // RAF state
    private rafId: number | null = null;
    private dirty: boolean = false;
    private isRendering: boolean = false;
    
    // Selection state (owned by Viewport)
    private selectedIds: Set<string> = new Set();
    
    // Options
    private options: SchedulerViewportOptions;
    
    // Error handling
    private errorCount: number = 0;
    private readonly MAX_ERRORS = 5;
    
    // Resize observer
    private resizeObserver: ResizeObserver | null = null;
    
    // ─────────────────────────────────────────────────────────────────
    // CONSTRUCTOR (NO SINGLETON)
    // ─────────────────────────────────────────────────────────────────
    
    constructor(container: HTMLElement, options: SchedulerViewportOptions = {}) {
        this.container = container;
        this.options = options;
        
        this.rowHeight = options.rowHeight ?? 38;
        this.headerHeight = options.headerHeight ?? 60;
        this.bufferRows = options.bufferRows ?? 5;
        
        this._buildDOM();
    }
    
    // ─────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────
    
    /**
     * Initialize Grid renderer
     * Must be called before start()
     */
    initGrid(options: GridRendererOptions): void;
    
    /**
     * Initialize Gantt renderer
     * Must be called before start()
     */
    initGantt(options: GanttRendererOptions): void;
    
    /**
     * Start the render loop
     * Call after both initGrid() and initGantt()
     */
    start(): void;
    
    // ─────────────────────────────────────────────────────────────────
    // DATA
    // ─────────────────────────────────────────────────────────────────
    
    setData(tasks: Task[]): void;
    setVisibleData(tasks: Task[]): void;
    
    // ─────────────────────────────────────────────────────────────────
    // SCROLL CONTROL
    // ─────────────────────────────────────────────────────────────────
    
    setScrollTop(scrollTop: number): void;
    scrollToTask(taskId: string): void;
    getScrollTop(): number;
    
    // ─────────────────────────────────────────────────────────────────
    // SELECTION (owned by Viewport)
    // ─────────────────────────────────────────────────────────────────
    
    setSelection(taskIds: string[]): void;
    getSelection(): string[];
    clearSelection(): void;
    
    // ─────────────────────────────────────────────────────────────────
    // REFRESH
    // ─────────────────────────────────────────────────────────────────
    
    refresh(): void;
    updateRow(taskId: string): void;
    updateGridColumns(columns: GridColumn[]): void;
    
    // ─────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────
    
    destroy(): void;
}
```

### Implementation Highlights

#### DOM Construction

```typescript
private _buildDOM(): void {
    this.container.innerHTML = '';
    this.container.className = 'scheduler-viewport';
    
    // Main scroll container (vertical scroll only)
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'scheduler-scroll-container';
    scrollContainer.style.cssText = `
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        height: 100%;
        width: 100%;
    `;
    
    // Scroll content wrapper (defines scroll height)
    this.scrollContent = document.createElement('div');
    this.scrollContent.className = 'scheduler-scroll-content';
    this.scrollContent.style.cssText = `
        position: relative;
        width: 100%;
    `;
    
    // Grid pane (horizontal scroll independent)
    this.gridPane = document.createElement('div');
    this.gridPane.className = 'scheduler-grid-pane';
    this.gridPane.style.cssText = `
        position: absolute;
        left: 0;
        width: var(--grid-width, 400px);
        overflow-x: auto;
        overflow-y: hidden;
        height: 100%;
    `;
    
    // Gantt pane (horizontal scroll independent)
    this.ganttPane = document.createElement('div');
    this.ganttPane.className = 'scheduler-gantt-pane';
    this.ganttPane.style.cssText = `
        position: absolute;
        left: var(--grid-width, 400px);
        right: 0;
        overflow-x: auto;
        overflow-y: hidden;
        height: 100%;
    `;
    
    this.scrollContent.appendChild(this.gridPane);
    this.scrollContent.appendChild(this.ganttPane);
    scrollContainer.appendChild(this.scrollContent);
    this.container.appendChild(scrollContainer);
    
    this.scrollElement = scrollContainer;
    
    // Bind scroll listener (passive)
    scrollContainer.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
}
```

#### Scroll Handler

```typescript
private _onScroll(): void {
    if (!this.scrollElement) return;
    
    const newScrollTop = this.scrollElement.scrollTop;
    if (newScrollTop === this.scrollTop) return;
    
    this.scrollTop = newScrollTop;
    this._scheduleRender();
}

private _scheduleRender(): void {
    if (this.dirty) return;
    
    this.dirty = true;
    
    if (this.rafId === null) {
        this.rafId = requestAnimationFrame(this._renderLoop.bind(this));
    }
}
```

#### Render Loop

```typescript
private _renderLoop(): void {
    this.rafId = null;
    
    if (!this.dirty) return;
    this.dirty = false;
    
    // Calculate state ONCE
    const state = this._calculateViewportState();
    
    // Render both in same frame
    try {
        if (this.gridRenderer) {
            this.gridRenderer.render(state);
        }
    } catch (e) {
        console.error('[SchedulerViewport] Grid render error:', e);
        this._handleError('grid', e);
    }
    
    try {
        if (this.ganttRenderer) {
            this.ganttRenderer.render(state);
        }
    } catch (e) {
        console.error('[SchedulerViewport] Gantt render error:', e);
        this._handleError('gantt', e);
    }
}

private _calculateViewportState(): ViewportState {
    const rawStart = Math.floor(this.scrollTop / this.rowHeight);
    const visibleCount = Math.ceil(this.viewportHeight / this.rowHeight);
    
    const start = Math.max(0, rawStart - this.bufferRows);
    const end = Math.min(this.dataLength - 1, rawStart + visibleCount + this.bufferRows);
    
    return {
        scrollTop: this.scrollTop,
        viewportHeight: this.viewportHeight,
        visibleRange: { start, end },
        rowHeight: this.rowHeight,
        totalHeight: this.dataLength * this.rowHeight,
    };
}
```

#### Error Handling

```typescript
private _handleError(source: 'grid' | 'gantt', error: unknown): void {
    this.errorCount++;
    
    if (this.errorCount >= this.MAX_ERRORS) {
        console.error(`[SchedulerViewport] Too many errors (${this.errorCount}), disabling render loop`);
        this._stopRenderLoop();
        
        // Notify error handler if provided
        if (this.options.onError) {
            this.options.onError(source, error);
        }
    }
}

private _stopRenderLoop(): void {
    if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
    this.dirty = false;
}
```

---

## 6. Module 2: GridRenderer

### File: `src/ui/components/scheduler/GridRenderer.ts`

### Responsibility

Render DOM rows using pooled elements. Handle user interactions via event delegation. **NO vertical scroll handling**. Owns horizontal scroll for columns.

### Key Implementation Points

#### Horizontal Scroll

```typescript
constructor(options: GridRendererOptions) {
    // ...
    
    // Grid pane handles its own horizontal scroll
    this.container.style.overflowX = 'auto';
    this.container.style.overflowY = 'hidden'; // No vertical scroll
    
    // Listen to horizontal scroll for header sync (if needed)
    this.container.addEventListener('scroll', (e) => {
        const scrollLeft = this.container.scrollLeft;
        // Notify header if needed (internal to GridRenderer)
        this._syncHeaderScroll(scrollLeft);
    }, { passive: true });
}
```

#### Render Method

```typescript
render(state: ViewportState): void {
    const { scrollTop, visibleRange } = state;
    const { start, end } = visibleRange;
    
    // 1. Apply transform (compositor-only, no layout)
    const offset = Math.floor(start * this.rowHeight);
    this.rowContainer.style.transform = `translateY(${offset}px)`;
    
    // 2. Release rows outside range
    this.pool.releaseRowsOutsideRange(start, end);
    
    // 3. Bind rows in range
    for (let i = start; i <= end && i < this.data.length; i++) {
        const task = this.data[i];
        if (!task) continue;
        
        const row = this.pool.acquireRow(i);
        const context: BindingContext = {
            task,
            index: i,
            isSelected: this.selectedIds.has(task.id),
            isParent: this.options.isParent(task.id),
            isCollapsed: task._collapsed ?? false,
            isCritical: task._isCritical ?? false,
            depth: this.options.getDepth(task.id),
        };
        
        this.binder.bindRow(row, context);
    }
}
```

#### Event Delegation

```typescript
private _bindEventListeners(): void {
    // Event delegation on row container
    this.rowContainer.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest('.vsg-row');
        if (!row) return;
        
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        
        // Handle different click types
        if (this._handleCollapseClick(e, taskId)) return;
        if (this._handleActionClick(e, taskId)) return;
        if (this._handleCheckboxClick(e, taskId)) return;
        
        // Bubble row click to Viewport
        if (this.options.onRowClick) {
            this.options.onRowClick(taskId, e);
        }
    });
    
    // Similar for dblclick, change, keydown, etc.
}
```

---

## 7. Module 3: GanttRenderer

### File: `src/ui/components/scheduler/GanttRenderer.ts`

### Responsibility

Render Canvas-based Gantt chart. **NO vertical scroll handling**. Owns horizontal scroll for timeline. Header scroll syncs with main canvas.

### Key Implementation Points

#### Horizontal Scroll with Header Sync

```typescript
constructor(options: GanttRendererOptions) {
    // ...
    
    // Gantt pane handles its own horizontal scroll
    this.container.style.overflowX = 'auto';
    this.container.style.overflowY = 'hidden'; // No vertical scroll
    
    // Listen to horizontal scroll
    this.container.addEventListener('scroll', (e) => {
        this.scrollX = this.container.scrollLeft;
        // Re-render header with new scroll position
        this._renderHeader();
        // Mark main canvas dirty
        this._dirty = true;
    }, { passive: true });
}

private _renderHeader(): void {
    const ctx = this.headerCtx;
    if (!ctx) return;
    
    // Clear header
    ctx.clearRect(0, 0, this.viewportWidth, this.headerHeight);
    
    // Draw header based on scrollX
    // ... header rendering logic
}
```

#### Render Method (Integer-Snapped)

```typescript
render(state: ViewportState): void {
    const { scrollTop, visibleRange, viewportHeight } = state;
    const { start, end } = visibleRange;
    
    const ctx = this.mainCtx;
    if (!ctx) return;
    
    // Clear canvas
    const width = this.mainCanvas.width / (window.devicePixelRatio || 1);
    const height = this.mainCanvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);
    
    // Draw grid background
    this._drawGrid(state);
    
    // Draw visible bars (integer-snapped coordinates)
    for (let i = start; i <= end && i < this.data.length; i++) {
        const task = this.data[i];
        if (!task) continue;
        
        // Integer-snap Y coordinate
        const rowY = Math.floor((i * this.rowHeight) - scrollTop);
        
        // Skip if outside viewport
        if (rowY + this.rowHeight < 0 || rowY > height) continue;
        
        this._drawTaskBar(task, i, rowY, this.scrollX);
    }
    
    // Draw dependencies
    this._drawDependencies(state);
}
```

---

## 8. Module 4: Shared Types

### File: `src/ui/components/scheduler/types.ts`

```typescript
import type { Task, GridColumn } from '../../../types';

/**
 * Viewport state passed to renderers
 */
export interface ViewportState {
    scrollTop: number;              // Vertical scroll position (controlled by Viewport)
    viewportHeight: number;         // Viewport height
    visibleRange: VisibleRange;     // Visible row indices
    rowHeight: number;              // Row height (shared constant)
    totalHeight: number;            // Total scroll height
}

export interface VisibleRange {
    start: number;                  // Index of first visible row
    end: number;                    // Index of last visible row
}

/**
 * Binding context for row data
 */
export interface BindingContext {
    task: Task;
    index: number;
    isSelected: boolean;
    isParent: boolean;
    isCollapsed: boolean;
    isCritical: boolean;
    depth: number;
}

/**
 * Pooled row element
 */
export interface PooledRow {
    element: HTMLElement;
    cells: Map<string, PooledCell>;
    dataIndex: number;
}

export interface PooledCell {
    container: HTMLElement;
    input: HTMLInputElement | HTMLSelectElement | null;
    text: HTMLSpanElement | null;
    checkbox: HTMLInputElement | null;
    icons: Map<string, HTMLSpanElement>;
    actionButtons: HTMLButtonElement[];
    collapseBtn: HTMLButtonElement | null;
    indent: HTMLSpanElement | null;
}

/**
 * Renderer interface
 */
export interface IRenderer {
    render(state: ViewportState): void;
    setData(tasks: Task[]): void;
    setSelection(selectedIds: Set<string>): void;
    destroy(): void;
}

/**
 * Grid renderer options
 */
export interface GridRendererOptions {
    container: HTMLElement;
    rowHeight: number;
    bufferRows: number;
    columns: GridColumn[];
    
    // Callbacks
    onCellChange?: (taskId: string, field: string, value: unknown) => void;
    onRowClick?: (taskId: string, event: MouseEvent) => void;
    onRowDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onAction?: (taskId: string, action: string, event: MouseEvent) => void;
    onToggleCollapse?: (taskId: string) => void;
    onSelectionChange?: (selectedIds: string[]) => void;
    onRowMove?: (taskIds: string[], targetId: string, position: 'before' | 'after') => void;
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
    getDepth?: (taskId: string) => number;
}

/**
 * Gantt renderer options
 */
export interface GanttRendererOptions {
    container: HTMLElement;
    rowHeight: number;
    headerHeight: number;
    
    // Callbacks
    onBarClick?: (taskId: string, event: MouseEvent) => void;
    onBarDoubleClick?: (taskId: string, event: MouseEvent) => void;
    onBarDrag?: (task: Task, start: string, end: string) => void;
    onDependencyClick?: (taskId: string, depId: string, event: MouseEvent) => void;
    
    // Metadata providers
    isParent?: (taskId: string) => boolean;
}
```

---

## 9. Module 5: Pre-rendered Icons

### File: `src/ui/components/scheduler/icons.ts`

```typescript
/**
 * Pre-rendered SVG icon strings
 * Use these instead of creating SVG DOM nodes dynamically
 */
export const ICONS = {
    chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"></path></svg>`,
    
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"></path></svg>`,
    
    grip: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`,
    
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"></rect><line x1="16" x2="16" y1="2" y2="6"></line><line x1="8" x2="8" y1="2" y2="6"></line><line x1="3" x2="21" y1="10" y2="10"></line></svg>`,
    
    // ... more icons
} as const;

export type IconName = keyof typeof ICONS;
```

---

## 10. Module 6: Pool System

### File: `src/ui/components/scheduler/pool/PoolSystem.ts`

### Responsibility

Create all DOM elements ONCE at initialization. Manage row acquisition and release.

### Key Implementation

```typescript
export class PoolSystem {
    private pool: PooledRow[] = [];
    private activeRows: Map<number, PooledRow> = new Map();
    private availableRows: PooledRow[] = [];
    private container: HTMLElement;
    private columns: GridColumn[];
    private rowHeight: number;
    
    constructor(options: PoolSystemOptions) {
        this.container = options.container;
        this.columns = options.columns;
        this.rowHeight = options.rowHeight;
        
        // Calculate pool size
        const viewportHeight = options.container.clientHeight || 800;
        const visibleRows = Math.ceil(viewportHeight / this.rowHeight);
        const poolSize = visibleRows + (options.bufferRows * 2) + 5;
        
        // Pre-create all rows at init
        for (let i = 0; i < poolSize; i++) {
            const row = this._createRow();
            row.element.classList.add('vsg-hidden');
            this.pool.push(row);
            this.availableRows.push(row);
            this.container.appendChild(row.element);
        }
        
        console.log(`[PoolSystem] Created pool: ${poolSize} rows`);
    }
    
    acquireRow(dataIndex: number): PooledRow {
        // Already have row?
        const existing = this.activeRows.get(dataIndex);
        if (existing) return existing;
        
        // Get from pool
        let row: PooledRow;
        if (this.availableRows.length > 0) {
            row = this.availableRows.pop()!;
        } else {
            // Pool exhausted - create temporary row (not ideal but prevents crash)
            console.warn(`[PoolSystem] Pool exhausted at index ${dataIndex}, creating temporary row`);
            row = this._createRow();
            this.pool.push(row);
        }
        
        row.dataIndex = dataIndex;
        this.activeRows.set(dataIndex, row);
        row.element.classList.remove('vsg-hidden');
        
        return row;
    }
    
    releaseRow(dataIndex: number): void {
        const row = this.activeRows.get(dataIndex);
        if (!row) return;
        
        this.activeRows.delete(dataIndex);
        row.dataIndex = -1;
        row.element.classList.add('vsg-hidden');
        this.availableRows.push(row);
    }
    
    releaseRowsOutsideRange(start: number, end: number): void {
        const toRelease: number[] = [];
        
        for (const dataIndex of this.activeRows.keys()) {
            if (dataIndex < start || dataIndex > end) {
                toRelease.push(dataIndex);
            }
        }
        
        for (const dataIndex of toRelease) {
            this.releaseRow(dataIndex);
        }
    }
    
    private _createRow(): PooledRow {
        // Create row element with all cells
        // ... implementation
    }
}
```

---

## 11. Module 7: Binding System

### File: `src/ui/components/scheduler/pool/BindingSystem.ts`

### Responsibility

Update DOM content on pooled elements using ONLY fast DOM operations. Update accessibility attributes.

### Fast DOM Operations

| Operation | Performance | Use For |
|-----------|-------------|---------|
| `textContent = x` | ⚡ Fastest | Text updates |
| `className = x` | ⚡ Fast | Class replacement |
| `dataset.x = y` | ⚡ Fast | Data attributes |
| `style.transform = x` | ⚡ Fast | Positioning |
| `value = x` | ⚡ Fast | Input values |
| `setAttribute()` | ⚡ Fast | ARIA attributes |
| `classList.add/remove` | ⚠️ Slower | Avoid in loops |
| `innerHTML` | ❌ Avoid | Never during scroll |

### Key Implementation

```typescript
export class BindingSystem {
    private columnMap: Map<string, GridColumn>;
    
    bindRow(row: PooledRow, ctx: BindingContext): void {
        const { task, index, isSelected, isParent, isCollapsed, isCritical, depth } = ctx;
        
        // Build className string (faster than classList)
        let rowClass = 'vsg-row';
        if (isSelected) rowClass += ' row-selected';
        if (isParent) rowClass += ' is-parent';
        if (isCollapsed) rowClass += ' is-collapsed';
        if (isCritical) rowClass += ' is-critical';
        if (task._health?.status === 'blocked') rowClass += ' is-blocked';
        
        // Single assignment
        row.element.className = rowClass;
        row.element.dataset.taskId = task.id;
        row.element.dataset.index = String(index);
        
        // Accessibility attributes
        row.element.setAttribute('role', 'row');
        row.element.setAttribute('aria-rowindex', String(index + 1));
        row.element.setAttribute('aria-selected', String(isSelected));
        
        // Bind cells
        for (const [field, cell] of row.cells) {
            const column = this.columnMap.get(field);
            if (column) {
                this._bindCell(cell, column, task, ctx);
            }
        }
    }
    
    private _bindCell(cell: PooledCell, column: GridColumn, task: Task, ctx: BindingContext): void {
        // Update cell content using fast operations
        // ... implementation
    }
}
```

---

## 12. CSS Requirements

### File: `src/ui/components/scheduler/styles/scheduler.css`

```css
/* BEM Naming Convention */

/* Main Viewport */
.scheduler-viewport {
    position: relative;
    height: 100%;
    width: 100%;
    overflow: hidden;
}

/* Scroll Container (Vertical Scroll Only) */
.scheduler-scroll-container {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    width: 100%;
    will-change: scroll-position;
    contain: strict; /* Critical for performance */
}

/* Scroll Content Wrapper */
.scheduler-scroll-content {
    position: relative;
    width: 100%;
}

/* Grid Pane (Horizontal Scroll Independent) */
.scheduler-grid-pane {
    position: absolute;
    left: 0;
    width: var(--grid-width, 400px);
    overflow-x: auto;
    overflow-y: hidden;
    height: 100%;
}

/* Gantt Pane (Horizontal Scroll Independent) */
.scheduler-gantt-pane {
    position: absolute;
    left: var(--grid-width, 400px);
    right: 0;
    overflow-x: auto;
    overflow-y: hidden;
    height: 100%;
}

/* Row Container (Transform-Based Positioning) */
.vsg-row-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
}

/* Row */
.vsg-row {
    display: flex;
    align-items: center;
    height: 38px; /* Must match ROW_HEIGHT constant */
    border-bottom: 1px solid var(--border-color, #e2e8f0);
    background: var(--row-bg, #ffffff);
    position: relative; /* For absolute positioning of children */
}

.vsg-row:hover {
    background: var(--row-hover-bg, #f8fafc);
}

.vsg-row.row-selected {
    background: var(--row-selected-bg, #eff6ff);
}

.vsg-row.is-critical {
    background: var(--row-critical-bg, #fef2f2);
}

.vsg-row.is-blocked {
    opacity: 0.6;
}

/* Hidden Rows */
.vsg-hidden {
    display: none !important;
}

/* Cell */
.vsg-cell {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 8px;
    overflow: hidden;
    flex-shrink: 0;
}

/* Input */
.vsg-input,
.vsg-select {
    width: 100%;
    height: 24px;
    padding: 0 4px;
    border: 1px solid transparent;
    background: transparent;
}

.vsg-input:focus,
.vsg-select:focus {
    outline: none;
    border-color: var(--focus-ring, #3b82f6);
    background: var(--input-bg, #ffffff);
}

/* Text */
.vsg-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Collapse Button */
.vsg-collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
}

/* Action Buttons */
.vsg-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
}

.vsg-action-btn:hover {
    background: var(--hover-bg, #f1f5f9);
}
```

---

## 13. Event Flow & Coordination

### Event Bubbling Strategy

```
User Interaction
       │
       ▼
GridRenderer (Event Delegation)
       │
       ├─► Handle internally (collapse, action buttons)
       │
       └─► Bubble to SchedulerViewport
              │
              └─► Forward to SchedulerService
                     │
                     └─► Update state (selection, data)
                            │
                            └─► Call viewport.setSelection()
                                   │
                                   └─► Update both Grid and Gantt
```

### Event Types

| Event | Handled By | Bubbles To |
|-------|------------|------------|
| Row Click | GridRenderer | SchedulerViewport → SchedulerService |
| Row Double Click | GridRenderer | SchedulerViewport → SchedulerService |
| Cell Change | GridRenderer | SchedulerViewport → SchedulerService |
| Action Click | GridRenderer | SchedulerViewport → SchedulerService |
| Collapse Toggle | GridRenderer | SchedulerViewport → SchedulerService |
| Bar Click | GanttRenderer | SchedulerViewport → SchedulerService |
| Bar Drag | GanttRenderer | SchedulerViewport → SchedulerService |
| Dependency Click | GanttRenderer | SchedulerViewport → SchedulerService |

### Event Prevention During Scroll

```typescript
// In GridRenderer
private _isScrolling: boolean = false;

private _onScroll(): void {
    this._isScrolling = true;
    // ... scroll handling
    
    requestAnimationFrame(() => {
        this._isScrolling = false;
    });
}

private _onClick(e: MouseEvent): void {
    // Ignore clicks during scroll
    if (this._isScrolling) {
        e.preventDefault();
        return;
    }
    // ... handle click
}
```

---

## 14. Selection State Management

### Ownership: SchedulerViewport

Selection state is owned by `SchedulerViewport` and synchronized to both renderers.

### Selection Flow

```
User Clicks Row
       │
       ▼
GridRenderer.onRowClick()
       │
       ▼
SchedulerViewport (bubbles up)
       │
       ▼
SchedulerService._handleRowClick()
       │
       ├─► Update selection logic (Shift/Ctrl)
       │
       └─► Call viewport.setSelection(selectedIds)
              │
              ├─► Update viewport.selectedIds
              │
              ├─► gridRenderer.setSelection(selectedIds)
              │
              └─► ganttRenderer.setSelection(selectedIds)
```

### Implementation

```typescript
// In SchedulerViewport
setSelection(taskIds: string[]): void {
    this.selectedIds = new Set(taskIds);
    
    // Update both renderers
    if (this.gridRenderer) {
        this.gridRenderer.setSelection(this.selectedIds);
    }
    if (this.ganttRenderer) {
        this.ganttRenderer.setSelection(this.selectedIds);
    }
    
    // Notify SchedulerService
    if (this.options.onSelectionChange) {
        this.options.onSelectionChange(taskIds);
    }
    
    // Trigger re-render
    this._scheduleRender();
}
```

---

## 15. Performance Budgets

### Target Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Frame Rate | 60 FPS | `performance.now()` in render loop |
| Render Time | < 16ms | Total time for both renderers |
| Bind Row Time | < 0.1ms | Time to bind single row |
| Draw Bar Time | < 0.05ms | Time to draw single bar |
| Calculate Range Time | < 0.1ms | Time to calculate visible range |
| Memory Growth | Stable | Heap snapshot over 1000 scrolls |
| DOM Allocations | 0 | During scroll (only at init) |

### Performance Monitoring

```typescript
// In SchedulerViewport
private _performanceMetrics = {
    renderCount: 0,
    totalRenderTime: 0,
    maxRenderTime: 0,
    slowFrames: 0,
};

private _renderLoop(): void {
    const startTime = performance.now();
    
    // ... render logic
    
    const renderTime = performance.now() - startTime;
    
    // Update metrics
    this._performanceMetrics.renderCount++;
    this._performanceMetrics.totalRenderTime += renderTime;
    this._performanceMetrics.maxRenderTime = Math.max(
        this._performanceMetrics.maxRenderTime,
        renderTime
    );
    
    if (renderTime > 16) {
        this._performanceMetrics.slowFrames++;
        console.warn(`[SchedulerViewport] Slow frame: ${renderTime.toFixed(2)}ms`);
    }
}

getPerformanceMetrics(): PerformanceMetrics {
    return {
        ...this._performanceMetrics,
        avgRenderTime: this._performanceMetrics.totalRenderTime / this._performanceMetrics.renderCount,
    };
}
```

---

## 16. Error Handling & Recovery

### Error Recovery Strategy

```typescript
// In SchedulerViewport
private errorCount: number = 0;
private readonly MAX_ERRORS = 5;
private readonly ERROR_RESET_INTERVAL = 60000; // 1 minute

private _handleError(source: 'grid' | 'gantt', error: unknown): void {
    this.errorCount++;
    
    console.error(`[SchedulerViewport] Error in ${source}:`, error);
    
    if (this.errorCount >= this.MAX_ERRORS) {
        console.error(`[SchedulerViewport] Too many errors (${this.errorCount}), disabling render loop`);
        this._stopRenderLoop();
        
        // Notify error handler
        if (this.options.onError) {
            this.options.onError(source, error);
        }
        
        // Reset error count after interval
        setTimeout(() => {
            this.errorCount = 0;
            console.log('[SchedulerViewport] Error count reset, re-enabling render loop');
            this._scheduleRender();
        }, this.ERROR_RESET_INTERVAL);
    }
}

private _stopRenderLoop(): void {
    if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
    this.dirty = false;
}
```

### Graceful Degradation

If render loop fails repeatedly:
1. Stop RAF loop
2. Fall back to scroll-based rendering (less performant but functional)
3. Show error notification to user
4. Auto-recover after timeout

---

## 17. Accessibility Requirements

### ARIA Attributes

All rows must have proper ARIA attributes:

```typescript
// In BindingSystem
row.element.setAttribute('role', 'row');
row.element.setAttribute('aria-rowindex', String(index + 1));
row.element.setAttribute('aria-selected', String(isSelected));
row.element.setAttribute('aria-label', `${task.name}, row ${index + 1}`);

// Cells
cell.setAttribute('role', 'gridcell');
cell.setAttribute('aria-label', `${column.label || column.field}: ${value}`);
```

### Keyboard Navigation

```typescript
// In GridRenderer
private _onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            this._navigateRow(-1);
            break;
        case 'ArrowDown':
            e.preventDefault();
            this._navigateRow(1);
            break;
        case 'Enter':
            e.preventDefault();
            this._activateRow();
            break;
        case 'Escape':
            e.preventDefault();
            this._cancelEdit();
            break;
    }
}
```

### Focus Management

- Focused row must always be visible
- Focus moves with selection
- Focus preserved during scroll (if row still visible)

---

## 18. SchedulerService Integration

### Changes Required

```typescript
// In SchedulerService.ts

// OLD:
this.grid = new VirtualScrollGrid(gridContainer, options);
this.gantt = new CanvasGantt(ganttContainer, options);

// NEW:
this.viewport = new SchedulerViewport(container, {
    rowHeight: 38,
    headerHeight: 60,
    bufferRows: 5,
    onRowClick: (taskId, e) => this._handleRowClick(taskId, e),
    onRowDoubleClick: (taskId, e) => this._handleRowDoubleClick(taskId, e),
    // ... other callbacks
});

this.viewport.initGrid({
    container: gridPane,
    columns: this.columns,
    // ... grid options
});

this.viewport.initGantt({
    container: ganttPane,
    // ... gantt options
});

this.viewport.start();

// Map legacy methods
scrollToTask(taskId: string): void {
    this.viewport.scrollToTask(taskId);
}

setSelection(selectedIds: Set<string>): void {
    this.viewport.setSelection([...selectedIds]);
}
```

### Facade Pattern

`VirtualScrollGrid` and `CanvasGantt` become thin facades:

```typescript
// VirtualScrollGrid.ts (Facade)
export class VirtualScrollGrid {
    private viewport: SchedulerViewport;
    
    constructor(container: HTMLElement, options: VirtualScrollGridOptions) {
        // Get or create viewport instance
        this.viewport = SchedulerViewport.getInstance(container);
        this.viewport.initGrid(options);
    }
    
    setData(tasks: Task[]): void {
        this.viewport.setData(tasks);
    }
    
    // ... delegate all methods to viewport
}
```

---

## 19. Initialization Sequence

### Required Order

1. **Constructor:** Create DOM structure
2. **initGrid():** Initialize Grid renderer
3. **initGantt():** Initialize Gantt renderer
4. **start():** Begin RAF loop (only if both ready)
5. **setData():** Can be called anytime

### Implementation

```typescript
// In SchedulerViewport
private gridReady: boolean = false;
private ganttReady: boolean = false;

initGrid(options: GridRendererOptions): void {
    if (!this.gridPane) {
        throw new Error('Grid pane not initialized. Call constructor first.');
    }
    
    this.gridRenderer = new GridRenderer({
        container: this.gridPane,
        ...options,
    });
    
    this.gridReady = true;
    this._tryStart();
}

initGantt(options: GanttRendererOptions): void {
    if (!this.ganttPane) {
        throw new Error('Gantt pane not initialized. Call constructor first.');
    }
    
    this.ganttRenderer = new GanttRenderer({
        container: this.ganttPane,
        ...options,
    });
    
    this.ganttReady = true;
    this._tryStart();
}

private _tryStart(): void {
    if (this.gridReady && this.ganttReady && !this.rafId) {
        this.start();
    }
}

start(): void {
    if (!this.gridReady || !this.ganttReady) {
        throw new Error('Both Grid and Gantt must be initialized before start()');
    }
    
    this._setupResizeObserver();
    this._measure();
    this._scheduleRender();
}
```

---

## 20. Testing Strategy

### Unit Tests

```typescript
describe('SchedulerViewport', () => {
    test('calculates visible range correctly', () => {
        const viewport = new SchedulerViewport(container);
        viewport.setData(tasks);
        viewport.setScrollTop(1000);
        
        const state = viewport._calculateViewportState();
        expect(state.visibleRange.start).toBeGreaterThanOrEqual(0);
        expect(state.visibleRange.end).toBeLessThan(tasks.length);
    });
    
    test('releases rows outside visible range', () => {
        // ... test pool management
    });
});
```

### Integration Tests

```typescript
describe('Scroll Synchronization', () => {
    test('Grid and Gantt scroll together vertically', () => {
        const viewport = new SchedulerViewport(container);
        viewport.initGrid(gridOptions);
        viewport.initGantt(ganttOptions);
        viewport.start();
        
        viewport.setScrollTop(500);
        
        // Verify both renderers received same scrollTop
        expect(gridRenderer.lastScrollTop).toBe(500);
        expect(ganttRenderer.lastScrollTop).toBe(500);
    });
    
    test('Grid and Gantt scroll independently horizontally', () => {
        // ... test horizontal independence
    });
});
```

### Performance Tests

```typescript
describe('Performance', () => {
    test('render time under 16ms', () => {
        const viewport = new SchedulerViewport(container);
        // ... setup
        
        const start = performance.now();
        viewport.setScrollTop(1000);
        // Wait for render
        const time = performance.now() - start;
        
        expect(time).toBeLessThan(16);
    });
    
    test('no DOM allocations during scroll', () => {
        // Use PerformanceObserver to track allocations
    });
});
```

---

## 21. Implementation Order

### Phase 1: Foundation
1. `types.ts` - All interfaces
2. `constants.ts` - Shared constants (ROW_HEIGHT, etc.)
3. `icons.ts` - Pre-rendered SVGs
4. `scheduler.css` - All styles

### Phase 2: Pool System
5. `pool/PoolSystem.ts` - DOM pooling
6. `pool/BindingSystem.ts` - Data binding

### Phase 3: Renderers
7. `GridRenderer.ts` - DOM renderer
8. `GanttRenderer.ts` - Canvas renderer

### Phase 4: Master Controller
9. `SchedulerViewport.ts` - The master

### Phase 5: Integration
10. Update `VirtualScrollGrid.ts` (facade)
11. Update `CanvasGantt.ts` (facade)
12. Update `SchedulerService.ts`

### Phase 6: Testing
13. Unit tests
14. Integration tests
15. Performance tests

---

## 22. Verification Checklist

### Performance Targets

- [ ] Frame rate: 60 FPS maintained during rapid scrolling
- [ ] Render time: < 16ms per frame
- [ ] DOM ops during scroll: 0 allocations
- [ ] Memory: Stable heap over 1000 scrolls
- [ ] Bind row time: < 0.1ms per row
- [ ] Draw bar time: < 0.05ms per bar

### Functionality Tests

- [ ] Vertical scroll moves both panels perfectly in sync
- [ ] Grid horizontal scroll works independently (columns)
- [ ] Gantt horizontal scroll works independently (time)
- [ ] Gantt header scrolls with main canvas horizontally
- [ ] Row rendering correct for all visible rows
- [ ] Row selection (single, multi, range) works
- [ ] Cell editing works
- [ ] Expand/collapse works
- [ ] Drag and drop works
- [ ] Keyboard navigation works
- [ ] Bar rendering correct
- [ ] Dependencies render correctly
- [ ] All callbacks fire correctly

### Accessibility Tests

- [ ] `aria-rowindex` correct on visible rows
- [ ] `aria-selected` updates on selection
- [ ] `role="row"` and `role="gridcell"` present
- [ ] Keyboard navigation works
- [ ] Screen reader compatible

### Error Handling Tests

- [ ] Render errors don't crash application
- [ ] Error recovery works after timeout
- [ ] Graceful degradation on repeated errors

---

## AI Implementation Prompts

### Prompt 1: Foundation
```
Create foundation files for Unified Scheduler V2:
1. src/ui/components/scheduler/types.ts
2. src/ui/components/scheduler/constants.ts
3. src/ui/components/scheduler/icons.ts
4. src/ui/components/scheduler/styles/scheduler.css

Reference sections 8, 9, 12 of this spec.
```

### Prompt 2: Pool System
```
Create DOM pooling system:
1. src/ui/components/scheduler/pool/PoolSystem.ts
2. src/ui/components/scheduler/pool/BindingSystem.ts

Requirements:
- Create all DOM at init, never during scroll
- Use only fast DOM operations
- Add 'aria-rowindex' and other ARIA attributes
- Handle pool exhaustion gracefully

Reference sections 10, 11, 17 of this spec.
```

### Prompt 3: Renderers
```
Create renderer components:
1. src/ui/components/scheduler/GridRenderer.ts
2. src/ui/components/scheduler/GanttRenderer.ts

Requirements:
- NO vertical scroll listeners (handled by Viewport)
- Renderers handle their own HORIZONTAL scroll (overflow-x: auto)
- Both implement render(state: ViewportState)
- Integer-snap all Y-coordinates
- Event delegation with bubbling to Viewport

Reference sections 6, 7, 13 of this spec.
```

### Prompt 4: Master Controller
```
Create master controller:
src/ui/components/scheduler/SchedulerViewport.ts

Requirements:
- NO singleton pattern (constructor-based)
- Owns vertical scroll state and RAF loop
- Calls both renderers in same frame
- Manages selection state
- Listens for bubbled events and forwards to callbacks
- Error handling and recovery
- Performance monitoring

Reference sections 5, 14, 15, 16, 19 of this spec.
```

### Prompt 5: Facades
```
Convert to facades:
1. src/ui/components/VirtualScrollGrid.ts
2. src/ui/components/CanvasGantt.ts

Requirements:
- Maintain exact public API
- Delegate to SchedulerViewport
- SchedulerService needs MINIMAL changes

Reference section 18 of this spec.
```

### Prompt 6: Integration
```
Update SchedulerService to use new system:
1. Modify src/services/SchedulerService.ts
2. Replace init() to use SchedulerViewport
3. Map legacy methods to new Viewport
4. Remove SyncService dependency

Reference section 18 of this spec.
```

---

## Appendix A: Constants

```typescript
// src/ui/components/scheduler/constants.ts

export const ROW_HEIGHT = 38; // Must match CSS
export const HEADER_HEIGHT = 60;
export const DEFAULT_BUFFER_ROWS = 5;
export const MAX_POOL_SIZE = 100; // Safety limit
export const PERFORMANCE_BUDGETS = {
    renderFrame: 16,      // ms (60 FPS)
    bindRow: 0.1,         // ms per row
    drawBar: 0.05,        // ms per bar
    calculateRange: 0.1,  // ms
} as const;
```

---

## Appendix B: Migration Guide

### Step 1: Create New Files
- Create all new files in `src/ui/components/scheduler/`
- Keep old files intact

### Step 2: Test New System
- Create test page with new system
- Verify performance and functionality

### Step 3: Update Facades
- Update `VirtualScrollGrid.ts` to delegate to `SchedulerViewport`
- Update `CanvasGantt.ts` to delegate to `SchedulerViewport`

### Step 4: Update SchedulerService
- Replace initialization code
- Map legacy methods
- Remove `SyncService` dependency

### Step 5: Remove Old Code
- Delete old implementation files
- Clean up unused code

---

*End of Specification*

**Version:** 2.2.0  
**Status:** Production-Ready  
**Last Updated:** Based on Architectural Review

