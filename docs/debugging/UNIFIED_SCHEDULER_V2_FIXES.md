# Unified Scheduler V2 - Fix Plan

## Issues Identified

### 1. DOM Structure Conflict
**Problem**: 
- SchedulerViewport replaces `.main` content, destroying existing structure
- GridRenderer clears `#grid-container` and creates its own structure
- GanttRenderer clears `#gantt-container` and creates its own structure
- This removes: grid-header, gantt-toolbar, resizer divider

**Current HTML Structure**:
```
.main
  ├── .grid-pane
  │   ├── .grid-header (DYNAMIC - built by SchedulerService)
  │   └── .grid-container (target for GridRenderer)
  ├── .resizer (divider between grid and gantt)
  └── .gantt-pane
      ├── .gantt-toolbar
      └── .gantt-container (target for GanttRenderer)
```

**What SchedulerViewport is doing**:
```
.main (cleared!)
  └── .scheduler-viewport
      └── .scheduler-scroll-container
          └── .scheduler-scroll-content
              ├── .scheduler-grid-pane (NEW - conflicts with existing)
              └── .scheduler-gantt-pane (NEW - conflicts with existing)
```

### 2. Container Mismatch
**Problem**:
- GridRenderer receives `#grid-container` but clears it and creates `.scheduler-grid-pane`
- GanttRenderer receives `#gantt-container` but clears it and creates its own structure
- SchedulerViewport creates panes that aren't used

### 3. Missing Elements
- Grid header (`.grid-header`) - lost when viewport clears `.main`
- Gantt toolbar (`.gantt-toolbar`) - lost when viewport clears `.main`
- Resizer divider (`.resizer`) - lost when viewport clears `.main`
- Column header synchronization - broken

### 4. CSS Variable Issues
- `--grid-width` CSS variable needs to be set correctly
- Grid pane width calculation needs to account for resizer

## Fix Plan

### Phase 1: Fix DOM Integration (CRITICAL)

#### 1.1 Update SchedulerViewport to Work with Existing Structure
**File**: `src/ui/components/scheduler/SchedulerViewport.ts`

**Changes**:
- DO NOT clear `.main` container
- Instead, find and use existing `.grid-container` and `.gantt-container`
- Create scroll container INSIDE `.main` that wraps both panes
- Preserve grid-header, gantt-toolbar, and resizer

**New Structure**:
```
.main (preserved)
  ├── .grid-pane (preserved)
  │   ├── .grid-header (preserved)
  │   └── .grid-container (used by GridRenderer)
  ├── .resizer (preserved)
  └── .gantt-pane (preserved)
      ├── .gantt-toolbar (preserved)
      └── .gantt-container (used by GanttRenderer)
```

**Implementation**:
- Remove `_buildDOM()` that clears container
- Create scroll wrapper that spans both panes
- Use existing containers instead of creating new ones

#### 1.2 Update GridRenderer to Use Existing Container
**File**: `src/ui/components/scheduler/GridRenderer.ts`

**Changes**:
- DO NOT clear container or create new pane
- Use the existing `#grid-container` as-is
- Create row container INSIDE the existing container
- Preserve existing container structure

**Implementation**:
- Remove `_buildDOM()` that clears container
- Append row container to existing container
- Ensure proper CSS classes are applied

#### 1.3 Update GanttRenderer to Use Existing Container
**File**: `src/ui/components/scheduler/GanttRenderer.ts`

**Changes**:
- DO NOT clear container or create new pane structure
- Use the existing `#gantt-container` as-is
- Create canvas elements INSIDE the existing container
- Preserve gantt-toolbar structure

**Implementation**:
- Remove `_buildDOM()` that clears container
- Append canvas wrapper to existing container
- Ensure proper CSS classes are applied

### Phase 2: Fix Scroll Synchronization

#### 2.1 Create Unified Scroll Container
**File**: `src/ui/components/scheduler/SchedulerViewport.ts`

**Changes**:
- Create a scroll container that wraps both `.grid-pane` and `.gantt-pane`
- This container handles vertical scroll
- Both panes remain independent for horizontal scroll

**Implementation**:
- Insert scroll wrapper between `.main` and panes
- Move panes inside scroll wrapper
- Ensure scroll wrapper has correct height

#### 2.2 Update GridRenderer Scroll Handling
**File**: `src/ui/components/scheduler/GridRenderer.ts`

**Changes**:
- Remove any internal vertical scroll handling
- Rely entirely on SchedulerViewport for vertical scroll
- Keep horizontal scroll independent

#### 2.3 Update GanttRenderer Scroll Handling
**File**: `src/ui/components/scheduler/GanttRenderer.ts`

**Changes**:
- Remove any internal vertical scroll handling
- Rely entirely on SchedulerViewport for vertical scroll
- Keep horizontal scroll independent

### Phase 3: Fix Column Header Synchronization

#### 3.1 Preserve Grid Header
**File**: `src/services/SchedulerService.ts`

**Changes**:
- Ensure `_buildGridHeader()` still works
- Grid header should sync with grid horizontal scroll
- Header should remain visible during vertical scroll

**Implementation**:
- Keep header outside scroll container
- Sync header scrollLeft with grid pane scrollLeft

#### 3.2 Update Header Scroll Sync
**File**: `src/services/SchedulerService.ts`

**Changes**:
- Update `_syncHeaderScroll()` to work with new structure
- Ensure header scrolls with grid pane horizontal scroll

### Phase 4: Fix CSS and Styling

#### 4.1 Update CSS Variables
**File**: `src/services/SchedulerService.ts`

**Changes**:
- Ensure `--grid-width` is set correctly
- Account for resizer width (6px) in calculations
- Update when resizer is dragged

#### 4.2 Update Scheduler CSS
**File**: `src/ui/components/scheduler/styles/scheduler.css`

**Changes**:
- Ensure styles work with existing HTML structure
- Fix any conflicts with existing styles
- Ensure proper z-index for header/toolbar

### Phase 5: Fix Renderer Initialization

#### 5.1 Update SchedulerService Integration
**File**: `src/services/SchedulerService.ts`

**Changes**:
- Pass correct containers to renderers
- Ensure viewport uses existing structure
- Initialize renderers with proper containers

**Implementation**:
```typescript
// Use existing containers directly
const gridContainer = document.getElementById('grid-container');
const ganttContainer = document.getElementById('gantt-container');

// Create viewport that works with existing structure
const viewport = new SchedulerViewport(gridContainer.parentElement!, options);

// Initialize renderers with existing containers
viewport.initGrid({ container: gridContainer, ... });
viewport.initGantt({ container: ganttContainer, ... });
```

## Implementation Order

1. **Fix GridRenderer** - Make it work with existing container (don't clear)
2. **Fix GanttRenderer** - Make it work with existing container (don't clear)
3. **Fix SchedulerViewport** - Work with existing structure, don't replace it
4. **Fix Scroll Container** - Create unified scroll wrapper
5. **Fix Header Sync** - Ensure grid header scrolls with grid
6. **Fix CSS** - Update styles and variables
7. **Test** - Verify all elements render correctly

## Testing Checklist

- [ ] Grid renders with columns
- [ ] Grid header is visible and scrolls horizontally
- [ ] Gantt renders with bars
- [ ] Gantt toolbar is visible
- [ ] Resizer divider is visible and functional
- [ ] Vertical scroll syncs both grid and gantt
- [ ] Horizontal scroll is independent
- [ ] Column widths are correct
- [ ] CSS variables are set correctly
- [ ] No layout shifts or jitter

