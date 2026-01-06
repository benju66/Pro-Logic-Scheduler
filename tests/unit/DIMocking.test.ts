/**
 * @fileoverview Sample Test Demonstrating Pure DI Mocking Pattern
 * 
 * This test file demonstrates how to use the Pure DI pattern for unit testing.
 * Services can now be mocked by:
 * 1. Creating a mock instance
 * 2. Calling ServiceName.setInstance(mockInstance)
 * 3. Running tests
 * 4. Calling ServiceName.resetInstance() in afterEach
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';

// Import services and their types
import { ProjectController } from '../../src/services/ProjectController';
import { SelectionModel } from '../../src/services/SelectionModel';
import { CommandService } from '../../src/commands/CommandService';
import { FeatureFlags } from '../../src/core/FeatureFlags';
import type { Task, Calendar, CPMResult } from '../../src/types';

describe('Pure DI Mocking Pattern', () => {
    // =========================================================================
    // SETUP & TEARDOWN
    // =========================================================================
    
    afterEach(() => {
        // CRITICAL: Always reset singletons after each test
        // This prevents test pollution
        ProjectController.resetInstance();
        SelectionModel.resetInstance();
        CommandService.resetInstance();
        FeatureFlags.resetInstance();
    });

    // =========================================================================
    // TEST: Mocking ProjectController
    // =========================================================================
    
    describe('ProjectController Mocking', () => {
        it('should allow injecting a mock ProjectController', () => {
            // Arrange: Create a mock with observable subjects
            const mockTasks: Task[] = [
                { id: '1', name: 'Test Task 1', sortKey: 'a' } as Task,
                { id: '2', name: 'Test Task 2', sortKey: 'b' } as Task,
            ];
            
            const mockController = {
                tasks$: new BehaviorSubject<Task[]>(mockTasks),
                calendar$: new BehaviorSubject<Calendar>({ workingDays: [1,2,3,4,5], exceptions: {} }),
                stats$: new BehaviorSubject<CPMResult['stats'] | null>(null),
                isInitialized$: new BehaviorSubject<boolean>(true),
                isCalculating$: new BehaviorSubject<boolean>(false),
                errors$: new Subject<string>(),
                getTasks: vi.fn(() => mockTasks),
                getTaskById: vi.fn((id: string) => mockTasks.find(t => t.id === id)),
                isParent: vi.fn(() => false),
                getDepth: vi.fn(() => 0),
                updateTask: vi.fn(),
                addTask: vi.fn(),
                deleteTask: vi.fn(),
            } as unknown as ProjectController;
            
            // Act: Inject the mock
            ProjectController.setInstance(mockController);
            
            // Assert: getInstance returns our mock
            const retrieved = ProjectController.getInstance();
            expect(retrieved).toBe(mockController);
            expect(retrieved.getTasks()).toEqual(mockTasks);
            expect(retrieved.getTasks()).toHaveLength(2);
        });
        
        it('should allow testing code that depends on ProjectController', () => {
            // Arrange: Create mock
            const mockTasks: Task[] = [
                { id: 'task-1', name: 'Design Phase', duration: 5, sortKey: 'a' } as Task,
            ];
            
            const mockController = {
                tasks$: new BehaviorSubject<Task[]>(mockTasks),
                getTasks: vi.fn(() => mockTasks),
                getTaskById: vi.fn((id: string) => mockTasks.find(t => t.id === id)),
                updateTask: vi.fn(),
            } as unknown as ProjectController;
            
            ProjectController.setInstance(mockController);
            
            // Act: Simulate what a component would do
            const controller = ProjectController.getInstance();
            controller.updateTask('task-1', { name: 'Updated Design Phase' });
            
            // Assert: Verify the mock was called correctly
            expect(mockController.updateTask).toHaveBeenCalledWith('task-1', { name: 'Updated Design Phase' });
            expect(mockController.updateTask).toHaveBeenCalledTimes(1);
        });
    });

    // =========================================================================
    // TEST: Mocking SelectionModel
    // =========================================================================
    
    describe('SelectionModel Mocking', () => {
        it('should allow injecting a mock SelectionModel', () => {
            // Arrange
            const mockSelection = {
                state$: new BehaviorSubject({ selectedIds: ['task-1', 'task-2'], focusedId: 'task-1' }),
                getSelectedIds: vi.fn(() => ['task-1', 'task-2']),
                getSelectedIdSet: vi.fn(() => new Set(['task-1', 'task-2'])),
                getFocusedId: vi.fn(() => 'task-1'),
                select: vi.fn(),
                clear: vi.fn(),
                addToSelection: vi.fn(),
            } as unknown as SelectionModel;
            
            // Act
            SelectionModel.setInstance(mockSelection);
            
            // Assert
            const retrieved = SelectionModel.getInstance();
            expect(retrieved.getSelectedIds()).toEqual(['task-1', 'task-2']);
            expect(retrieved.getFocusedId()).toBe('task-1');
        });
        
        it('should track selection changes via mock', () => {
            // Arrange
            const selectFn = vi.fn();
            const mockSelection = {
                state$: new BehaviorSubject({ selectedIds: [], focusedId: null }),
                select: selectFn,
                getSelectedIds: vi.fn(() => []),
            } as unknown as SelectionModel;
            
            SelectionModel.setInstance(mockSelection);
            
            // Act
            const selection = SelectionModel.getInstance();
            selection.select('new-task');
            
            // Assert
            expect(selectFn).toHaveBeenCalledWith('new-task');
        });
    });

    // =========================================================================
    // TEST: Mocking FeatureFlags
    // =========================================================================
    
    describe('FeatureFlags Mocking', () => {
        it('should allow enabling/disabling features for tests', () => {
            // Arrange: Create a mock with specific flags
            const mockFlags = new FeatureFlags();
            // In a real scenario, you'd set specific flags
            
            // Act
            FeatureFlags.setInstance(mockFlags);
            
            // Assert
            const retrieved = FeatureFlags.getInstance();
            expect(retrieved).toBe(mockFlags);
        });
    });

    // =========================================================================
    // TEST: Integration - Multiple Mocks Working Together
    // =========================================================================
    
    describe('Multiple Service Mocks', () => {
        it('should allow mocking multiple services simultaneously', () => {
            // Arrange: Mock multiple services
            const mockTasks: Task[] = [{ id: '1', name: 'Task 1', sortKey: 'a' } as Task];
            
            const mockController = {
                tasks$: new BehaviorSubject<Task[]>(mockTasks),
                getTasks: vi.fn(() => mockTasks),
            } as unknown as ProjectController;
            
            const mockSelection = {
                state$: new BehaviorSubject({ selectedIds: ['1'], focusedId: '1' }),
                getSelectedIds: vi.fn(() => ['1']),
            } as unknown as SelectionModel;
            
            // Act: Inject all mocks
            ProjectController.setInstance(mockController);
            SelectionModel.setInstance(mockSelection);
            
            // Assert: Both work correctly
            expect(ProjectController.getInstance().getTasks()).toHaveLength(1);
            expect(SelectionModel.getInstance().getSelectedIds()).toContain('1');
        });
    });

    // =========================================================================
    // TEST: Observable Behavior
    // =========================================================================
    
    describe('Observable Mocking', () => {
        it('should allow testing reactive subscriptions', () => {
            // Arrange
            const tasksSubject = new BehaviorSubject<Task[]>([]);
            const mockController = {
                tasks$: tasksSubject,
                getTasks: () => tasksSubject.value,
            } as unknown as ProjectController;
            
            ProjectController.setInstance(mockController);
            
            // Act: Subscribe and emit
            const receivedTasks: Task[][] = [];
            ProjectController.getInstance().tasks$.subscribe(tasks => {
                receivedTasks.push(tasks);
            });
            
            // Emit new tasks
            const newTasks = [{ id: '1', name: 'New Task', sortKey: 'a' } as Task];
            tasksSubject.next(newTasks);
            
            // Assert
            expect(receivedTasks).toHaveLength(2); // Initial empty + new emission
            expect(receivedTasks[1]).toEqual(newTasks);
        });
    });
});
