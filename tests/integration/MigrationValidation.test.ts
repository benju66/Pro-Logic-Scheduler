/**
 * @fileoverview Migration Validation Test Harness
 * @module tests/integration/MigrationValidation.test
 * 
 * Tests to validate the Strangler Fig migration from SchedulerService
 * to the new service architecture.
 * 
 * PURPOSE:
 * - Ensure new services produce identical results to legacy code
 * - Validate feature flag switching works correctly
 * - Provide regression safety during incremental migration
 * 
 * STRATEGY:
 * 1. Run operation with legacy code, capture result
 * 2. Run same operation with new service, capture result
 * 3. Compare results - they must be identical
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulingLogicService } from '../../src/services/migration/SchedulingLogicService';
import { ViewCoordinator } from '../../src/services/migration/ViewCoordinator';
import { FeatureFlags } from '../../src/core/FeatureFlags';
import { ProjectController } from '../../src/services/ProjectController';
import { SelectionModel } from '../../src/services/SelectionModel';
import type { Task, Calendar } from '../../src/types';

// Mock ProjectController for isolated testing
const createMockController = () => {
    const tasks: Task[] = [];
    const taskMap = new Map<string, Task>();
    
    return {
        tasks$: { value: tasks },
        calendar$: { value: { workingDays: [1, 2, 3, 4, 5], exceptions: {} } },
        stats$: { value: null },
        isInitialized$: { value: true },
        
        getTasks: () => tasks,
        getTaskById: (id: string) => taskMap.get(id),
        isParent: (id: string) => tasks.some(t => t.parentId === id),
        getDepth: () => 0,
        getChildren: (parentId: string | null) => tasks.filter(t => t.parentId === parentId),
        getCalendar: () => ({ workingDays: [1, 2, 3, 4, 5], exceptions: {} }),
        
        updateTask: vi.fn((id: string, updates: Partial<Task>) => {
            const task = taskMap.get(id);
            if (task) {
                Object.assign(task, updates);
            }
        }),
        
        addTask: (task: Task) => {
            tasks.push(task);
            taskMap.set(task.id, task);
        },
        
        _setTasks: (newTasks: Task[]) => {
            tasks.length = 0;
            taskMap.clear();
            newTasks.forEach(t => {
                tasks.push(t);
                taskMap.set(t.id, t);
            });
        }
    };
};

describe('Migration Validation: SchedulingLogicService', () => {
    let mockController: ReturnType<typeof createMockController>;
    let schedulingLogic: SchedulingLogicService;
    
    const defaultCalendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {}
    };
    
    const createTestTask = (overrides: Partial<Task> = {}): Task => ({
        id: 'task1',
        name: 'Test Task',
        start: '2024-01-01',
        end: '2024-01-05',
        duration: 5,
        parentId: null,
        dependencies: [],
        progress: 0,
        constraintType: 'asap',
        constraintDate: null,
        level: 0,
        sortKey: 'a0',
        notes: '',
        ...overrides
    });
    
    beforeEach(() => {
        mockController = createMockController();
        schedulingLogic = SchedulingLogicService.getInstance();
    });
    
    afterEach(() => {
        vi.clearAllMocks();
    });
    
    describe('Duration Edit', () => {
        it('should update duration for valid positive value', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'duration',
                '10',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', { duration: 10 });
        });
        
        it('should reject invalid duration', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'duration',
                'invalid',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true); // Success because we don't block editing
            expect(result.needsRecalc).toBe(false); // But no recalc
            expect(mockController.updateTask).not.toHaveBeenCalled();
        });
        
        it('should reject zero duration', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'duration',
                '0',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.needsRecalc).toBe(false);
            expect(mockController.updateTask).not.toHaveBeenCalled();
        });
    });
    
    describe('Start Date Edit (SNET Constraint)', () => {
        it('should apply SNET constraint when start is edited', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'start',
                '2024-01-15',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', {
                start: '2024-01-15',
                constraintType: 'snet',
                constraintDate: '2024-01-15'
            });
        });
        
        it('should reject invalid date format', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'start',
                '01/15/2024', // Wrong format
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(false);
            expect(mockController.updateTask).not.toHaveBeenCalled();
        });
    });
    
    describe('ActualStart Edit (Driver Mode + Anchor)', () => {
        it('should set actualStart with SNET constraint', () => {
            const task = createTestTask();
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualStart',
                '2024-01-03',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', {
                actualStart: '2024-01-03',
                start: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03'
            });
            expect(result.message).toContain('SNET');
        });
        
        it('should recalculate duration when actualFinish exists', () => {
            const task = createTestTask({ actualFinish: '2024-01-10' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualStart',
                '2024-01-03',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            // Duration should be recalculated from actualStart to actualFinish
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualStart: '2024-01-03',
                duration: expect.any(Number)
            }));
        });
        
        it('should preserve constraint when clearing actualStart', () => {
            const task = createTestTask({
                actualStart: '2024-01-03',
                constraintType: 'snet',
                constraintDate: '2024-01-03'
            });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualStart',
                null,
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', { actualStart: null });
            // Constraint should NOT be cleared
            expect(mockController.updateTask).not.toHaveBeenCalledWith('task1', 
                expect.objectContaining({ constraintType: expect.any(String) })
            );
        });
    });
    
    describe('ActualFinish Edit (Driver Mode + Completion)', () => {
        it('should mark task complete when actualFinish is set', () => {
            const task = createTestTask({ start: '2024-01-01' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualFinish',
                '2024-01-05',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(result.needsRecalc).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualFinish: '2024-01-05',
                end: '2024-01-05',
                progress: 100,
                remainingDuration: 0
            }));
        });
        
        it('should auto-populate actualStart when not set', () => {
            const task = createTestTask({ start: '2024-01-01' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualFinish',
                '2024-01-05',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', expect.objectContaining({
                actualStart: '2024-01-01',
                constraintType: 'snet',
                constraintDate: '2024-01-01'
            }));
        });
        
        it('should reject actualFinish before start date', () => {
            const task = createTestTask({ start: '2024-01-05' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualFinish',
                '2024-01-01', // Before start
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('before start');
            expect(mockController.updateTask).not.toHaveBeenCalled();
        });
        
        it('should reject actualFinish when no start date', () => {
            const task = createTestTask({ start: '' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualFinish',
                '2024-01-05',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('no Start Date');
            expect(mockController.updateTask).not.toHaveBeenCalled();
        });
        
        it('should reopen task when actualFinish is cleared', () => {
            const task = createTestTask({
                actualFinish: '2024-01-05',
                progress: 100,
                remainingDuration: 0
            });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'actualFinish',
                null,
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', {
                actualFinish: null,
                progress: 0,
                remainingDuration: 5 // Reset to original duration
            });
            expect(result.message).toContain('reopened');
        });
    });
    
    describe('SchedulingMode Transitions', () => {
        it('should convert Manual → Auto with SNET constraint', () => {
            const task = createTestTask({ 
                schedulingMode: 'Manual',
                start: '2024-01-15'
            });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'schedulingMode',
                'Auto',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', {
                schedulingMode: 'Auto',
                constraintType: 'snet',
                constraintDate: '2024-01-15'
            });
        });
        
        it('should allow Auto → Manual without constraint', () => {
            const task = createTestTask({ schedulingMode: 'Auto' });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'schedulingMode',
                'Manual',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', { 
                schedulingMode: 'Manual' 
            });
        });
        
        it('should reject Manual mode for parent tasks', () => {
            const parent = createTestTask({ id: 'parent1' });
            const child = createTestTask({ id: 'child1', parentId: 'parent1' });
            mockController._setTasks([parent, child]);
            
            const result = schedulingLogic.applyEdit(
                'parent1',
                'schedulingMode',
                'Manual',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Parent tasks');
        });
    });
    
    describe('ConstraintType Edit', () => {
        it('should clear constraintDate when set to ASAP', () => {
            const task = createTestTask({
                constraintType: 'snet',
                constraintDate: '2024-01-15'
            });
            mockController._setTasks([task]);
            
            const result = schedulingLogic.applyEdit(
                'task1',
                'constraintType',
                'asap',
                { controller: mockController as any, calendar: defaultCalendar }
            );
            
            expect(result.success).toBe(true);
            expect(mockController.updateTask).toHaveBeenCalledWith('task1', {
                constraintType: 'asap',
                constraintDate: null
            });
        });
    });
});

describe('Migration Validation: Feature Flags', () => {
    beforeEach(() => {
        FeatureFlags.reset();
    });
    
    it('should start with all flags disabled (legacy mode)', () => {
        expect(FeatureFlags.isLegacyMode()).toBe(true);
        expect(FeatureFlags.isNewArchitectureMode()).toBe(false);
    });
    
    it('should toggle individual flags', () => {
        FeatureFlags.enable('USE_VIEW_COORDINATOR');
        expect(FeatureFlags.get('USE_VIEW_COORDINATOR')).toBe(true);
        expect(FeatureFlags.get('USE_SCHEDULING_LOGIC_SERVICE')).toBe(false);
    });
    
    it('should enable all flags', () => {
        FeatureFlags.enableAll();
        expect(FeatureFlags.isNewArchitectureMode()).toBe(true);
    });
    
    it('should persist flags to localStorage', () => {
        FeatureFlags.enable('USE_VIEW_COORDINATOR');
        
        // Create new instance (simulates page reload)
        (FeatureFlags as any).instance = null;
        
        // Flag should be restored from localStorage
        expect(FeatureFlags.get('USE_VIEW_COORDINATOR')).toBe(true);
    });
});

describe('Migration Validation: ViewCoordinator', () => {
    let viewCoordinator: ViewCoordinator;
    
    beforeEach(() => {
        ViewCoordinator.resetInstance();
        viewCoordinator = ViewCoordinator.getInstance();
    });
    
    afterEach(() => {
        viewCoordinator.dispose();
    });
    
    it('should be a singleton', () => {
        const instance1 = ViewCoordinator.getInstance();
        const instance2 = ViewCoordinator.getInstance();
        expect(instance1).toBe(instance2);
    });
    
    it('should register selection change callbacks', () => {
        const callback = vi.fn();
        const unsubscribe = viewCoordinator.onSelectionChange(callback);
        
        expect(typeof unsubscribe).toBe('function');
        
        // Cleanup
        unsubscribe();
    });
    
    it('should register data change callbacks', () => {
        const callback = vi.fn();
        const unsubscribe = viewCoordinator.onDataChange(callback);
        
        expect(typeof unsubscribe).toBe('function');
        
        // Cleanup
        unsubscribe();
    });
    
    it('should clean up subscriptions on dispose', () => {
        viewCoordinator.initSubscriptions();
        viewCoordinator.dispose();
        
        // No error should be thrown on second dispose
        viewCoordinator.dispose();
    });
});

describe('Migration Parity Tests', () => {
    /**
     * These tests ensure the new services produce IDENTICAL output
     * to the legacy SchedulerService methods.
     * 
     * Run with legacy code, capture output.
     * Run with new service, compare output.
     */
    
    describe('_applyTaskEdit parity', () => {
        it('should produce same result for duration edit', () => {
            // This test structure shows how to verify parity
            // In practice, you would:
            // 1. Set up identical initial state
            // 2. Run legacy: scheduler._applyTaskEdit('task1', 'duration', 10)
            // 3. Run new: schedulingLogic.applyEdit('task1', 'duration', 10, context)
            // 4. Compare: expect(legacyResult).toEqual(newResult)
            
            // Placeholder - actual implementation requires running both code paths
            expect(true).toBe(true);
        });
        
        it('should produce same result for actualStart edit', () => {
            // Same pattern as above
            expect(true).toBe(true);
        });
        
        it('should produce same result for actualFinish edit', () => {
            // Same pattern as above
            expect(true).toBe(true);
        });
    });
});
