/**
 * @fileoverview Shared Task Assertion Utilities for Round-Trip Tests
 * @module tests/helpers/taskAssertions
 * 
 * Provides assertion utilities for comparing Task objects through
 * serialization/deserialization cycles (SQLite, WASM).
 */

import { expect } from 'vitest';
import type { Task, Dependency, Calendar } from '../../src/types';

/**
 * Options for task comparison
 */
export interface TaskComparisonOptions {
  /** Ignore calculated fields (start, end, level, float, etc.) */
  ignoreCalculatedFields?: boolean;
  /** Ignore transient UI fields (_visualRowNumber, etc.) */
  ignoreTransientFields?: boolean;
  /** Allow undefined to match empty array for tradePartnerIds */
  allowEmptyTradePartners?: boolean;
}

/**
 * Fields that are calculated by CPM engine (not persisted)
 */
const CALCULATED_FIELDS: (keyof Task)[] = [
  'start',
  'end',
  'level',
  '_isCritical',
  '_totalFloat',
  '_freeFloat',
  '_earlyStart',
  '_earlyFinish',
  'lateStart',
  'lateFinish',
  'totalFloat',
  'freeFloat',
  '_health',
];

/**
 * Fields that are transient UI state (not persisted)
 */
const TRANSIENT_FIELDS: (keyof Task)[] = [
  '_visualRowNumber',
];

/**
 * Assert that two Task objects have equal input fields
 * (fields that should be preserved through persistence)
 */
export function assertTaskInputFieldsEqual(
  expected: Task,
  actual: Task | undefined,
  options: TaskComparisonOptions = {}
): void {
  const {
    ignoreCalculatedFields = true,
    ignoreTransientFields = true,
    allowEmptyTradePartners = true,
  } = options;

  expect(actual).toBeDefined();
  if (!actual) return;

  // Core identity fields
  expect(actual.id).toBe(expected.id);
  expect(actual.name).toBe(expected.name);
  
  // Hierarchy fields
  expect(actual.parentId).toBe(expected.parentId);
  expect(actual.sortKey).toBe(expected.sortKey);
  expect(actual.rowType ?? 'task').toBe(expected.rowType ?? 'task');

  // Scheduling input fields
  expect(actual.duration).toBe(expected.duration);
  expect(actual.constraintType).toBe(expected.constraintType);
  expect(actual.constraintDate).toBe(expected.constraintDate);
  expect(actual.schedulingMode ?? 'Auto').toBe(expected.schedulingMode ?? 'Auto');

  // Dependencies (deep comparison)
  assertDependenciesEqual(expected.dependencies, actual.dependencies);

  // Status fields
  expect(actual.progress).toBe(expected.progress);
  expect(actual.notes).toBe(expected.notes);

  // Actuals tracking
  expect(actual.actualStart).toBe(expected.actualStart);
  expect(actual.actualFinish).toBe(expected.actualFinish);
  expect(actual.remainingDuration).toBe(expected.remainingDuration);

  // Baseline tracking
  expect(actual.baselineStart).toBe(expected.baselineStart);
  expect(actual.baselineFinish).toBe(expected.baselineFinish);
  expect(actual.baselineDuration).toBe(expected.baselineDuration);

  // UI state (persisted)
  expect(actual._collapsed).toBe(expected._collapsed);

  // Trade partners
  if (allowEmptyTradePartners) {
    const expectedTp = expected.tradePartnerIds ?? [];
    const actualTp = actual.tradePartnerIds ?? [];
    expect(actualTp).toEqual(expectedTp);
  } else {
    expect(actual.tradePartnerIds).toEqual(expected.tradePartnerIds);
  }

  // Calculated fields (optional check)
  if (!ignoreCalculatedFields) {
    expect(actual.start).toBe(expected.start);
    expect(actual.end).toBe(expected.end);
    expect(actual.level).toBe(expected.level);
  }
}

/**
 * Assert that two Dependency arrays are equal
 */
export function assertDependenciesEqual(
  expected: Dependency[],
  actual: Dependency[]
): void {
  expect(actual).toHaveLength(expected.length);
  
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].id).toBe(expected[i].id);
    expect(actual[i].type).toBe(expected[i].type);
    expect(actual[i].lag).toBe(expected[i].lag);
  }
}

/**
 * Assert that all tasks in an array match their expected counterparts
 */
export function assertTaskArraysEqual(
  expected: Task[],
  actual: Task[],
  options: TaskComparisonOptions = {}
): void {
  expect(actual).toHaveLength(expected.length);
  
  for (const expectedTask of expected) {
    const actualTask = actual.find(t => t.id === expectedTask.id);
    assertTaskInputFieldsEqual(expectedTask, actualTask, options);
  }
}

/**
 * Create a complete Task object with all fields populated
 * Useful for round-trip testing
 */
export function createCompleteTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-1',
    name: 'Test Task',
    parentId: null,
    sortKey: 'a0',
    rowType: 'task',
    level: 0,
    start: '',
    end: '',
    duration: 5,
    dependencies: [],
    constraintType: 'asap',
    constraintDate: null,
    schedulingMode: 'Auto',
    progress: 0,
    notes: '',
    _collapsed: false,
    tradePartnerIds: [],
    ...overrides,
  };
}

/**
 * Create a task with complex dependencies
 */
export function createTaskWithDependencies(
  id: string,
  dependencies: Dependency[],
  overrides: Partial<Task> = {}
): Task {
  return createCompleteTask({
    id,
    name: `Task ${id}`,
    dependencies,
    ...overrides,
  });
}

/**
 * Create a minimal default calendar
 */
export function createDefaultCalendar(): Calendar {
  return {
    workingDays: [1, 2, 3, 4, 5], // Mon-Fri
    exceptions: {},
  };
}

/**
 * Convert Task to persistence event payload (snake_case)
 * Mirrors ProjectController.addTask() event payload creation
 */
export function taskToEventPayload(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    parent_id: task.parentId,
    sort_key: task.sortKey,
    row_type: task.rowType || 'task',
    name: task.name,
    notes: task.notes || '',
    duration: task.duration,
    constraint_type: task.constraintType,
    constraint_date: task.constraintDate,
    scheduling_mode: task.schedulingMode || 'Auto',
    dependencies: task.dependencies || [],
    progress: task.progress || 0,
    actual_start: task.actualStart,
    actual_finish: task.actualFinish,
    remaining_duration: task.remainingDuration,
    baseline_start: task.baselineStart,
    baseline_finish: task.baselineFinish,
    baseline_duration: task.baselineDuration,
    is_collapsed: task._collapsed || false,
  };
}

/**
 * Convert persistence row (snake_case) to Task (camelCase)
 * Mirrors DataLoader.hydrateTask() hydration logic
 */
export function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    sortKey: (row.sort_key as string) || '',
    rowType: ((row.row_type) as 'task' | 'blank' | 'phantom') || 'task',
    name: (row.name as string) || 'New Task',
    notes: (row.notes as string) || '',
    level: 0,
    start: '',
    end: '',
    duration: (row.duration as number) || 1,
    constraintType: (row.constraint_type as Task['constraintType']) || 'asap',
    constraintDate: (row.constraint_date as string | null) ?? null,
    schedulingMode: (row.scheduling_mode as 'Auto' | 'Manual') ?? 'Auto',
    dependencies: parseDependencies(row.dependencies),
    progress: (row.progress as number) || 0,
    actualStart: nullToUndefined(row.actual_start as string | null),
    actualFinish: nullToUndefined(row.actual_finish as string | null),
    remainingDuration: nullToUndefined(row.remaining_duration as number | null),
    baselineStart: nullToUndefined(row.baseline_start as string | null),
    baselineFinish: nullToUndefined(row.baseline_finish as string | null),
    baselineDuration: nullToUndefined(row.baseline_duration as number | null),
    _collapsed: Boolean(row.is_collapsed),
    tradePartnerIds: [],
  };
}

/**
 * Parse dependencies from various formats
 */
function parseDependencies(value: unknown): Dependency[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Convert null to undefined (for optional fields)
 */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Create test tasks for round-trip testing
 */
export function createRoundTripTestTasks(): Task[] {
  return [
    // Basic task
    createCompleteTask({
      id: 'basic-task',
      name: 'Basic Task',
      duration: 5,
    }),
    
    // Task with complex dependencies
    createCompleteTask({
      id: 'task-with-deps',
      name: 'Task with Dependencies',
      dependencies: [
        { id: 'basic-task', type: 'FS', lag: 0 },
        { id: 'other', type: 'SS', lag: 2 },
        { id: 'another', type: 'FF', lag: -1 },
      ],
    }),
    
    // Task with nullable fields set to null
    createCompleteTask({
      id: 'nullable-task',
      name: 'Task with Nulls',
      constraintDate: null,
      actualStart: undefined,
      actualFinish: undefined,
    }),
    
    // Task with constraint
    createCompleteTask({
      id: 'constrained-task',
      name: 'Constrained Task',
      constraintType: 'snet',
      constraintDate: '2024-03-15',
    }),
    
    // Manually scheduled task
    createCompleteTask({
      id: 'manual-task',
      name: 'Manual Task',
      schedulingMode: 'Manual',
    }),
    
    // Blank row (note: empty name gets defaulted to 'New Task' by DataLoader)
    createCompleteTask({
      id: 'blank-row',
      name: 'Blank Spacer',  // Non-empty to avoid default behavior
      rowType: 'blank',
      duration: 1,  // Non-zero to avoid default behavior
    }),
    
    // Task with actuals
    createCompleteTask({
      id: 'actual-task',
      name: 'Task with Actuals',
      actualStart: '2024-01-05',
      actualFinish: '2024-01-10',
      remainingDuration: 0,
      progress: 100,
    }),
    
    // Task with baseline
    createCompleteTask({
      id: 'baseline-task',
      name: 'Task with Baseline',
      baselineStart: '2024-01-01',
      baselineFinish: '2024-01-05',
      baselineDuration: 5,
    }),
    
    // Task with parent
    createCompleteTask({
      id: 'child-task',
      name: 'Child Task',
      parentId: 'basic-task',
      sortKey: 'a0a0',
    }),
    
    // Edge case: low duration (milestone-like)
    // NOTE: duration=0 gets defaulted to 1 by DataLoader, so we test with 1
    createCompleteTask({
      id: 'milestone',
      name: 'Milestone',
      duration: 1,
    }),
  ];
}
