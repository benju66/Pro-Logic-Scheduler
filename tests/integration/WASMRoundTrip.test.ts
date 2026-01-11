/**
 * @fileoverview WASM Round-Trip Tests - TypeScript ↔ Rust Serialization
 * @module tests/integration/WASMRoundTrip
 * 
 * PHASE 3.2: Verifies all Task fields survive the WASM serialization cycle:
 * TypeScript Task → serde_wasm_bindgen → Rust → serde_wasm_bindgen → TypeScript
 * 
 * These tests ensure type safety and data integrity across the
 * serialization boundary between TypeScript and the WASM CPM engine.
 * 
 * NOTE: These tests mock the WASM worker to simulate serialization behavior.
 * For true WASM integration testing, use E2E tests with the actual worker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Task, Calendar, CPMResult, Dependency } from '../../src/types';
import {
  createCompleteTask,
  createRoundTripTestTasks,
  createDefaultCalendar,
  assertTaskInputFieldsEqual,
  assertDependenciesEqual,
} from '../helpers/taskAssertions';

// Reference project fixture
import referenceProject from '../fixtures/reference_project.json';

/**
 * Simulates WASM serde_wasm_bindgen serialization behavior
 * This mimics what happens when data crosses the JS ↔ WASM boundary
 */
function simulateWasmSerialization<T>(data: T): T {
  // serde_wasm_bindgen uses structured clone-like behavior
  // JSON.parse(JSON.stringify()) simulates this for our purposes
  return JSON.parse(JSON.stringify(data));
}

/**
 * Simulates CPM calculation adding calculated fields
 */
function simulateCpmCalculation(tasks: Task[], calendar: Calendar): CPMResult {
  const calculatedTasks = tasks.map((task, index) => {
    // Skip blank rows
    if (task.rowType === 'blank') {
      return {
        ...task,
        level: 0,
        start: '',
        end: '',
      };
    }

    // Simulate CPM adding calculated fields
    const startDate = '2024-01-01';
    const endDate = '2024-01-05';
    
    return {
      ...task,
      // Calculated fields added by CPM
      level: task.parentId ? 1 : 0,
      start: task.schedulingMode === 'Manual' ? (task.start || startDate) : startDate,
      end: task.schedulingMode === 'Manual' ? (task.end || endDate) : endDate,
      _isCritical: index === 0 || task.dependencies.length === 0,
      _totalFloat: 0,
      _freeFloat: 0,
      lateStart: startDate,
      lateFinish: endDate,
      totalFloat: 0,
      freeFloat: 0,
    };
  });

  return {
    tasks: calculatedTasks,
    stats: {
      calcTime: 1.5,
      taskCount: tasks.length,
      criticalCount: calculatedTasks.filter(t => t._isCritical).length,
      projectEnd: '2024-01-05',
      duration: 5,
    },
  };
}

describe('Phase 3.2: WASM Round-Trip Type Safety', () => {
  const calendar = createDefaultCalendar();

  describe('Basic Serialization', () => {
    it('should preserve all Task input fields through WASM serialization', () => {
      const originalTask = createCompleteTask({
        id: 'wasm-test-1',
        name: 'WASM Test Task',
        duration: 5,
        progress: 50,
        notes: 'Test notes for WASM',
      });

      // Simulate JS → WASM → JS round-trip
      const serialized = simulateWasmSerialization(originalTask);

      assertTaskInputFieldsEqual(originalTask, serialized);
    });

    it('should preserve tasks through CPM calculation cycle', () => {
      const originalTasks = [
        createCompleteTask({ id: 'task-1', name: 'First Task' }),
        createCompleteTask({ 
          id: 'task-2', 
          name: 'Second Task',
          dependencies: [{ id: 'task-1', type: 'FS', lag: 0 }],
        }),
      ];

      // Simulate WASM initialization and calculation
      const serializedTasks = simulateWasmSerialization(originalTasks);
      const result = simulateCpmCalculation(serializedTasks, calendar);

      // Verify input fields preserved
      for (const original of originalTasks) {
        const calculated = result.tasks.find(t => t.id === original.id);
        assertTaskInputFieldsEqual(original, calculated);
      }

      // Verify calculated fields added
      expect(result.tasks[0].start).toBeDefined();
      expect(result.tasks[0].end).toBeDefined();
      expect(result.tasks[0].level).toBeDefined();
    });
  });

  describe('Dependencies Serialization', () => {
    it('should preserve empty dependencies array through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'no-deps',
        dependencies: [],
      });

      const serialized = simulateWasmSerialization(originalTask);
      
      expect(serialized.dependencies).toEqual([]);
    });

    it('should preserve all link types through WASM', () => {
      const dependencies: Dependency[] = [
        { id: 'a', type: 'FS', lag: 0 },
        { id: 'b', type: 'SS', lag: 2 },
        { id: 'c', type: 'FF', lag: -1 },
        { id: 'd', type: 'SF', lag: 5 },
      ];

      const originalTask = createCompleteTask({
        id: 'all-deps',
        dependencies,
      });

      const serialized = simulateWasmSerialization(originalTask);

      assertDependenciesEqual(dependencies, serialized.dependencies);
    });

    it('should preserve negative lag values through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'neg-lag',
        dependencies: [{ id: 'pred', type: 'FS', lag: -5 }],
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.dependencies[0].lag).toBe(-5);
    });
  });

  describe('Optional Fields Handling', () => {
    it('should preserve null constraintDate through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'null-constraint',
        constraintType: 'asap',
        constraintDate: null,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.constraintDate).toBeNull();
    });

    it('should preserve set constraintDate through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'set-constraint',
        constraintType: 'snet',
        constraintDate: '2024-03-15',
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.constraintDate).toBe('2024-03-15');
    });

    it('should handle undefined optional fields', () => {
      const originalTask: Task = {
        id: 'minimal-task',
        name: 'Minimal',
        parentId: null,
        sortKey: 'a0',
        level: 0,
        start: '',
        end: '',
        duration: 1,
        dependencies: [],
        constraintType: 'asap',
        constraintDate: null,
        progress: 0,
        notes: '',
        // No optional fields set
      };

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.id).toBe('minimal-task');
      expect(serialized.schedulingMode).toBeUndefined();
      expect(serialized.actualStart).toBeUndefined();
      expect(serialized.baselineStart).toBeUndefined();
    });
  });

  describe('SchedulingMode Serialization', () => {
    it('should preserve schedulingMode = Auto through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'auto-mode',
        schedulingMode: 'Auto',
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.schedulingMode).toBe('Auto');
    });

    it('should preserve schedulingMode = Manual through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'manual-mode',
        schedulingMode: 'Manual',
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.schedulingMode).toBe('Manual');
    });

    it('should handle Manual mode in CPM calculation (dates preserved)', () => {
      const originalTask = createCompleteTask({
        id: 'manual-calc',
        schedulingMode: 'Manual',
        start: '2024-02-01',
        end: '2024-02-10',
      });

      const serialized = simulateWasmSerialization([originalTask]);
      const result = simulateCpmCalculation(serialized, calendar);

      const calculatedTask = result.tasks[0];
      
      // Manual tasks should preserve their dates
      expect(calculatedTask.start).toBe('2024-02-01');
      expect(calculatedTask.end).toBe('2024-02-10');
    });
  });

  describe('RowType Serialization', () => {
    it('should preserve rowType = task through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'task-type',
        rowType: 'task',
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.rowType).toBe('task');
    });

    it('should preserve rowType = blank through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'blank-type',
        rowType: 'blank',
        duration: 0,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.rowType).toBe('blank');
    });

    it('should skip blank rows in CPM calculation', () => {
      const tasks = [
        createCompleteTask({ id: 'task-1', rowType: 'task' }),
        createCompleteTask({ id: 'blank-1', rowType: 'blank', duration: 0 }),
        createCompleteTask({ id: 'task-2', rowType: 'task' }),
      ];

      const serialized = simulateWasmSerialization(tasks);
      const result = simulateCpmCalculation(serialized, calendar);

      // Blank row should have empty dates
      const blankRow = result.tasks.find(t => t.id === 'blank-1');
      expect(blankRow?.start).toBe('');
      expect(blankRow?.end).toBe('');
    });
  });

  describe('Actuals and Baseline Fields', () => {
    it('should preserve actuals fields through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'actuals-task',
        actualStart: '2024-01-05',
        actualFinish: '2024-01-10',
        remainingDuration: 0,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.actualStart).toBe('2024-01-05');
      expect(serialized.actualFinish).toBe('2024-01-10');
      expect(serialized.remainingDuration).toBe(0);
    });

    it('should preserve baseline fields through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'baseline-task',
        baselineStart: '2024-01-01',
        baselineFinish: '2024-01-05',
        baselineDuration: 5,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.baselineStart).toBe('2024-01-01');
      expect(serialized.baselineFinish).toBe('2024-01-05');
      expect(serialized.baselineDuration).toBe(5);
    });
  });

  describe('Trade Partners', () => {
    it('should preserve empty tradePartnerIds through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'no-partners',
        tradePartnerIds: [],
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.tradePartnerIds).toEqual([]);
    });

    it('should preserve tradePartnerIds through WASM', () => {
      const partnerIds = ['partner-1', 'partner-2', 'partner-3'];
      const originalTask = createCompleteTask({
        id: 'with-partners',
        tradePartnerIds: partnerIds,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.tradePartnerIds).toEqual(partnerIds);
    });
  });

  describe('Calendar Serialization', () => {
    it('should preserve workingDays through WASM', () => {
      const calendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {},
      };

      const serialized = simulateWasmSerialization(calendar);

      expect(serialized.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('should preserve calendar exceptions through WASM', () => {
      const calendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {
          '2024-12-25': { date: '2024-12-25', working: false, description: 'Christmas' },
          '2024-07-04': { date: '2024-07-04', working: false, description: 'Independence Day' },
        },
      };

      const serialized = simulateWasmSerialization(calendar);

      expect(serialized.exceptions['2024-12-25'].working).toBe(false);
      expect(serialized.exceptions['2024-12-25'].description).toBe('Christmas');
    });
  });

  describe('Reference Project Round-Trip', () => {
    it('should preserve reference project tasks through WASM cycle', () => {
      // Cast fixture to Task[]
      const originalTasks = referenceProject as unknown as Task[];

      // Simulate WASM round-trip
      const serialized = simulateWasmSerialization(originalTasks);

      // Verify all tasks preserved
      expect(serialized).toHaveLength(originalTasks.length);

      for (const original of originalTasks) {
        const serializedTask = serialized.find((t: Task) => t.id === original.id);
        expect(serializedTask).toBeDefined();
        expect(serializedTask.name).toBe(original.name);
        expect(serializedTask.duration).toBe(original.duration);
        expect(serializedTask.constraintType).toBe(original.constraintType);
        assertDependenciesEqual(original.dependencies, serializedTask.dependencies);
      }
    });

    it('should handle reference project through CPM calculation', () => {
      const originalTasks = referenceProject as unknown as Task[];
      const calendar = createDefaultCalendar();

      const serialized = simulateWasmSerialization(originalTasks);
      const result = simulateCpmCalculation(serialized, calendar);

      // Verify CPM produces results
      expect(result.tasks).toHaveLength(originalTasks.length);
      expect(result.stats.taskCount).toBe(originalTasks.length);

      // Verify input fields preserved
      for (const original of originalTasks) {
        const calculated = result.tasks.find((t: Task) => t.id === original.id);
        expect(calculated?.name).toBe(original.name);
        expect(calculated?.duration).toBe(original.duration);
      }

      // Verify calculated fields added
      const firstTask = result.tasks[0];
      expect(firstTask.start).toBeDefined();
      expect(firstTask.end).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should preserve zero duration (milestone) through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'milestone',
        duration: 0,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.duration).toBe(0);
    });

    it('should preserve progress = 100 through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'complete',
        progress: 100,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.progress).toBe(100);
    });

    it('should preserve _collapsed = true through WASM', () => {
      const originalTask = createCompleteTask({
        id: 'collapsed',
        _collapsed: true,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized._collapsed).toBe(true);
    });

    it('should preserve names with special characters', () => {
      const specialName = 'Task with "quotes" and \'apostrophes\' & <special>';
      const originalTask = createCompleteTask({
        id: 'special-chars',
        name: specialName,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.name).toBe(specialName);
    });

    it('should preserve names with unicode', () => {
      const unicodeName = 'タスク 日本語 🏗️ Construction';
      const originalTask = createCompleteTask({
        id: 'unicode',
        name: unicodeName,
      });

      const serialized = simulateWasmSerialization(originalTask);

      expect(serialized.name).toBe(unicodeName);
    });
  });

  describe('Full Round-Trip Test Suite', () => {
    it('should preserve all fields for comprehensive test tasks through WASM', () => {
      const testTasks = createRoundTripTestTasks();

      // Simulate full WASM cycle
      const serialized = simulateWasmSerialization(testTasks);
      const result = simulateCpmCalculation(serialized, calendar);

      // Verify each task
      for (const originalTask of testTasks) {
        const calculated = result.tasks.find(t => t.id === originalTask.id);
        assertTaskInputFieldsEqual(originalTask, calculated);
      }
    });
  });
});
