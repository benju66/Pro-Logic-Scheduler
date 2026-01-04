// =============================================================================
// CORE TYPES - Pro Logic Scheduler
// =============================================================================

/**
 * Link/dependency types between tasks
 * - FS: Finish-to-Start (most common)
 * - SS: Start-to-Start
 * - FF: Finish-to-Finish
 * - SF: Start-to-Finish (rare)
 */
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * Constraint types for task scheduling
 * - asap: As Soon As Possible (default)
 * - snet: Start No Earlier Than
 * - snlt: Start No Later Than
 * - fnet: Finish No Earlier Than
 * - fnlt: Finish No Later Than
 * - mfo: Must Finish On
 */
export type ConstraintType = 'asap' | 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mfo';

/**
 * Task scheduling mode
 * - Auto: Dates calculated by CPM engine based on dependencies and constraints
 * - Manual: Dates are user-fixed, CPM ignores predecessor logic for this task
 *           (but successors still use this task's dates as anchors)
 */
export type SchedulingMode = 'Auto' | 'Manual';

/**
 * Row type discriminator
 * - 'task': Normal schedulable task (default)
 * - 'blank': Visual spacer row (no scheduling)
 * - 'phantom': Ghost row at bottom for quick add (transient, not persisted)
 */
export type RowType = 'task' | 'blank' | 'phantom';

/**
 * Health status for schedule analysis
 * - healthy: Task is on track with adequate float
 * - at-risk: Task has low float or minor constraint variance (1-3 days)
 * - critical: Task has negative float or significant constraint variance (>3 days)
 * - blocked: Task has dependency errors (circular, missing predecessor)
 * - forced: Task dates have been manually overridden
 */
export type HealthStatus = 'healthy' | 'at-risk' | 'critical' | 'blocked' | 'forced';

/**
 * Health indicator for a task
 * Provides at-a-glance status with progressive detail levels
 */
export interface HealthIndicator {
  /** Overall health status */
  status: HealthStatus;
  /** Icon for display (emoji or can be mapped to SVG) */
  icon: string;
  /** One-line summary for tooltips */
  summary: string;
  /** Detailed bullet points explaining the status */
  details: string[];
  /** Variance from constraint in work days (negative = late) */
  constraintVariance?: number;
  /** The constraint date being compared against */
  constraintTarget?: string;
  /** The projected/calculated date */
  projectedDate?: string;
}

/**
 * Dependency between tasks
 */
export interface Dependency {
  /** Predecessor task ID */
  id: string;
  /** Link type */
  type: LinkType;
  /** Lag in working days (can be negative) */
  lag: number;
}

/**
 * Task in the schedule
 */
export interface Task {
  /** Unique identifier */
  id: string;
  /** Row type - determines rendering and CPM behavior */
  rowType?: RowType;  // undefined = 'task' for backward compatibility
  /** Task name/description */
  name: string;
  /** Work Breakdown Structure code (currently unused, kept for future) */
  wbs?: string;
  /** Hierarchy level (0 = root) */
  level: number;
  /** Start date (ISO format: YYYY-MM-DD) */
  start: string;
  /** End date (ISO format: YYYY-MM-DD) */
  end: string;
  /** Duration in working days */
  duration: number;
  /** Task dependencies */
  dependencies: Dependency[];
  /** Constraint type */
  constraintType: ConstraintType;
  /** Constraint date (ISO format, null if ASAP) */
  constraintDate: string | null;
  
  /**
   * Scheduling mode: 'Auto' (default) or 'Manual'
   * 
   * Auto: CPM calculates dates based on dependencies and constraints
   * Manual: User-fixed dates that CPM will not change (task is "pinned")
   * 
   * Manual tasks still:
   * - Participate in backward pass (have Late Start/Finish)
   * - Have float calculated
   * - Act as anchors for their successors
   */
  schedulingMode?: SchedulingMode;
  
  /** Notes/comments */
  notes: string;
  
  /** Parent task ID (null for root tasks) */
  parentId: string | null;
  
  /** Progress percentage (0-100) */
  progress: number;
  
  /**
   * Sort key for ordering within siblings (tasks with same parentId)
   * Uses fractional indexing - string-based keys that allow infinite subdivision
   * Example values: "a0", "a1", "a0V", "Zz"
   */
  sortKey: string;
  
  // === Calculated fields (set by CPM engine) ===
  
  /** Is this task on the critical path? */
  _isCritical?: boolean;
  /** Total float in days */
  _totalFloat?: number;
  /** Free float in days */
  _freeFloat?: number;
  /** Is this task collapsed in the hierarchy view? */
  _collapsed?: boolean;
  /** Early start (calculated) */
  _earlyStart?: string;
  /** Early finish (calculated) */
  _earlyFinish?: string;
  /** Late start (calculated by CPM) */
  lateStart?: string | null;
  /** Late finish (calculated by CPM) */
  lateFinish?: string | null;
  /** Total float in days (calculated by CPM) */
  totalFloat?: number;
  /** Free float in days (calculated by CPM) */
  freeFloat?: number;
  
  // === Schedule Health (calculated by CPM) ===
  
  /** Schedule health analysis */
  _health?: HealthIndicator;
  
  /**
   * Visual row number for UI display (transient, calculated property).
   * - Sequential number (1, 2, 3...) for schedulable tasks
   * - null for blank rows and phantom rows (not displayed)
   * This enables "logical numbering" where blank rows don't consume numbers.
   * Recalculated on each render cycle by SchedulerService._assignVisualRowNumbers()
   */
  _visualRowNumber?: number | null;
  
  // === Actuals Tracking (future implementation) ===
  
  /** Actual start date - when work actually began (null if not started) */
  actualStart?: string | null;
  /** Actual finish date - when work actually completed (null if not finished) */
  actualFinish?: string | null;
  /** Remaining duration in work days (for in-progress tasks) */
  remainingDuration?: number;
  
  // === Baseline Tracking (future implementation) ===
  
  /** Baseline start date - from saved baseline snapshot */
  baselineStart?: string | null;
  /** Baseline finish date - from saved baseline snapshot */
  baselineFinish?: string | null;
  /** Baseline duration in work days */
  baselineDuration?: number;
  
  // === Trade Partners ===
  /** Assigned trade partner IDs */
  tradePartnerIds?: string[];
}

/**
 * Check if a task is manually scheduled
 */
export function isManuallyScheduled(task: Task): boolean {
  return task.schedulingMode === 'Manual';
}

/**
 * Check if a task is auto-scheduled (default)
 */
export function isAutoScheduled(task: Task): boolean {
  return task.schedulingMode !== 'Manual'; // Treat undefined as Auto
}

/**
 * Check if a task is a blank row (visual spacer)
 */
export function isBlankRow(task: Task): boolean {
  return task.rowType === 'blank';
}

/**
 * Check if a task is the phantom row
 */
export function isPhantomRow(task: Task): boolean {
  return task.rowType === 'phantom';
}

/**
 * Check if a task should be scheduled (not blank/phantom)
 */
export function isSchedulableTask(task: Task): boolean {
  return !task.rowType || task.rowType === 'task';
}

/**
 * Calendar exception (non-working day or working exception)
 */
export interface CalendarException {
  /** Date (ISO format: YYYY-MM-DD) */
  date: string;
  /** True = working day, False = non-working day */
  working: boolean;
  /** Optional description */
  description?: string;
}

/**
 * Project calendar configuration
 */
export interface Calendar {
  /** Working days (0=Sunday, 1=Monday, ..., 6=Saturday) */
  workingDays: number[];
  /** Date-specific exceptions - can be CalendarException object or string (legacy format) */
  exceptions: Record<string, CalendarException | string>;
}

// =============================================================================
// TRADE PARTNER TYPES
// =============================================================================

/**
 * Trade Partner entity - represents a subcontractor/company
 */
export interface TradePartner {
  /** Unique identifier */
  id: string;
  /** Company/contractor name */
  name: string;
  /** Primary contact person */
  contact?: string;
  /** Phone number */
  phone?: string;
  /** Email address */
  email?: string;
  /** Display color (hex format) */
  color: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Trade Partner assignment to a task
 */
export interface TaskTradePartnerAssignment {
  taskId: string;
  tradePartnerId: string;
  assignedAt?: string;
}

/**
 * CPM calculation result
 */
export interface CPMResult {
  /** Tasks with calculated dates and float */
  tasks: Task[];
  /** Calculation statistics */
  stats: {
    /** Calculation time in milliseconds */
    calcTime: number;
    /** Number of tasks processed */
    taskCount: number;
    /** Number of critical tasks */
    criticalCount: number;
    /** Project end date */
    projectEnd: string;
    /** Project duration in work days */
    duration: number;
    /** Error message if calculation failed */
    error?: string;
  };
}

/**
 * Grid column definition
 */
export interface GridColumn {
  /** Column identifier */
  id: string;
  /** Display label */
  label: string;
  /** Width in pixels */
  width: number;
  /** Is column editable? */
  editable: boolean;
  /** Column type for rendering/editing */
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'readonly' | 'actions' | 'drag' | 'health' | 'variance' | 'tradePartners' | 'schedulingMode' | 'rowNumber' | 'name';
  /** Options for select type */
  options?: string[];
  /** Field name on Task object (or computed field name) */
  field: keyof Task | 'checkbox' | 'startVariance' | 'finishVariance' | 'drag' | 'rowNum' | 'actions';
  /** Alignment */
  align?: 'left' | 'center' | 'right';
  /** Is column readonly for parent tasks? */
  readonlyForParent?: boolean;
  /** Show constraint icon on date cells? */
  showConstraintIcon?: boolean;
  /** Custom renderer function */
  renderer?: (task: Task, meta: { isParent: boolean; depth: number; isCollapsed: boolean; index: number }) => string;
  /** Actions for actions column */
  actions?: Array<{
    id: string;
    name?: string;
    label?: string;
    icon?: string;
    title?: string;
    color?: string;
    showIf?: (task: Task, meta: { isParent: boolean; depth: number; isCollapsed: boolean; index: number }) => boolean;
  }>;
  /** Minimum width for resizing (defaults to width * 0.5) */
  minWidth?: number;
  /** Whether column should have a resizer (defaults to true, except for drag/checkbox) */
  resizable?: boolean;
  /** CSS class for header cell */
  headerClass?: string;
  /** CSS class for data cells */
  cellClass?: string;
  /** Whether column is visible (for conditional columns, defaults to true) */
  visible?: boolean | (() => boolean);
}

/**
 * Selection state
 */
export interface SelectionState {
  /** Selected task IDs */
  selectedIds: Set<string>;
  /** Currently focused task ID */
  focusedId: string | null;
  /** Anchor ID for range selection */
  anchorId: string | null;
}

/**
 * History entry for undo/redo
 */
export interface HistoryEntry {
  /** Serialized tasks state */
  tasks: string;
  /** Serialized calendar state */
  calendar: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Toast notification type
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Gantt chart view mode
 */
export type ViewMode = 'Day' | 'Week' | 'Month';

/**
 * File operation result
 */
export interface FileOperationResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Project data structure for file operations
 */
export interface ProjectData {
  tasks: Task[];
  calendar: Calendar;
  version?: string;
  exportedAt?: string;
}

// =============================================================================
// COMPONENT OPTION TYPES
// =============================================================================

/**
 * Options for CanvasGantt
 */
export interface CanvasGanttOptions {
  container: HTMLElement;
  rowHeight?: number;
  headerHeight?: number;
  isParent?: (id: string) => boolean;
  onBarClick?: (taskId: string, event: MouseEvent) => void;
  onBarDoubleClick?: (taskId: string, event: MouseEvent) => void;
  onBarDrag?: (task: Task, start: string, end: string) => void;
  onDependencyClick?: (fromId: string, toId: string) => void;
  onScroll?: (scrollTop: number) => void;
}

/**
 * Options for SchedulerService
 */
export interface SchedulerServiceOptions {
  gridContainer: HTMLElement;
  ganttContainer: HTMLElement;
  drawerContainer?: HTMLElement;
  modalContainer?: HTMLElement;
  isTauri?: boolean;
}

/**
 * Column preferences for visibility, order, and pinning
 */
export interface ColumnPreferences {
  /** Column visibility: columnId -> visible */
  visible: Record<string, boolean>;
  /** Column order: array of column IDs */
  order: string[];
  /** Pinned column IDs (sticky columns) */
  pinned: string[];
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Make specific properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Task creation input (ID generated automatically)
 */
export type TaskInput = PartialBy<Task, 'id' | '_isCritical' | '_totalFloat' | '_freeFloat' | '_collapsed' | 'lateStart' | 'lateFinish' | 'totalFloat' | 'freeFloat'>;

/**
 * Callback function type
 */
export type Callback<T = void> = (value: T) => void;

/**
 * Event handler with optional event
 */
export type EventHandler<E = Event> = (event: E) => void;

// Re-export DropPosition for convenience
export type { DropPosition } from '../ui/components/scheduler/types';

// =============================================================================
// RIGHT SIDEBAR TYPES
// =============================================================================

/**
 * Panel identifiers for the right sidebar
 */
export type RightPanelId = 'details' | 'links' | 'tradePartners';

/**
 * State for the right sidebar (for persistence)
 */
export interface RightSidebarState {
    activePanels: RightPanelId[];
    isBarVisible: boolean;
}

/**
 * Options for opening a panel
 */
export interface PanelOpenOptions {
    isParent?: boolean;
    focusField?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Safely get a task field value using dynamic property access
 * Handles the case where col.field might be 'checkbox' (not a Task property)
 * 
 * @param task - The task object
 * @param field - The field name (may be 'checkbox' or a Task property)
 * @returns The field value or undefined
 */
export function getTaskFieldValue(task: Task, field: GridColumn['field']): unknown {
  // Special fields that don't exist on Task objects
  if (field === 'checkbox' || field === 'drag' || field === 'rowNum' || field === 'actions') {
    return undefined;
  }
  
  // Computed fields (variance) - these are calculated, not stored
  if (field === 'startVariance' || field === 'finishVariance') {
    return undefined; // Variance is computed in renderer, not stored
  }
  
  // Handle schedulingMode default
  if (field === 'schedulingMode') {
    return task.schedulingMode ?? 'Auto';
  }
  
  return task[field as keyof Task];
}
