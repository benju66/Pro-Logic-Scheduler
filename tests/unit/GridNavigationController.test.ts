/**
 * @fileoverview Unit tests for GridNavigationController
 * @module tests/unit/GridNavigationController.test
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
    GridNavigationController, 
    type GridNavigationControllerDeps 
} from '../../src/services/scheduler/GridNavigationController';

describe('GridNavigationController', () => {
    let controller: GridNavigationController;
    let mockDeps: GridNavigationControllerDeps;
    
    const defaultTaskIds = ['task1', 'task2', 'task3', 'task4', 'task5'];
    const defaultColumns = ['name', 'start', 'end', 'duration'];
    
    beforeEach(() => {
        mockDeps = {
            getVisibleTaskIds: vi.fn(() => defaultTaskIds),
            getNavigableColumns: vi.fn(() => defaultColumns),
            isEditing: vi.fn(() => false)
        };
        controller = new GridNavigationController(mockDeps);
    });
    
    // =========================================================================
    // BASIC NAVIGATION
    // =========================================================================
    
    describe('Basic Navigation', () => {
        it('navigates down from first row', () => {
            controller.setPositionByIndex(0, 0);
            
            const result = controller.navigate('down');
            
            expect(result).not.toBeNull();
            expect(result!.taskId).toBe('task2');
            expect(result!.field).toBe('name');
            expect(result!.position.rowIndex).toBe(1);
        });
        
        it('navigates up from second row', () => {
            controller.setPositionByIndex(1, 0);
            
            const result = controller.navigate('up');
            
            expect(result).not.toBeNull();
            expect(result!.taskId).toBe('task1');
            expect(result!.position.rowIndex).toBe(0);
        });
        
        it('navigates right from first column', () => {
            controller.setPositionByIndex(0, 0);
            
            const result = controller.navigate('right');
            
            expect(result).not.toBeNull();
            expect(result!.field).toBe('start');
            expect(result!.position.colIndex).toBe(1);
        });
        
        it('navigates left from second column', () => {
            controller.setPositionByIndex(0, 1);
            
            const result = controller.navigate('left');
            
            expect(result).not.toBeNull();
            expect(result!.field).toBe('name');
            expect(result!.position.colIndex).toBe(0);
        });
    });
    
    // =========================================================================
    // BOUNDARY BEHAVIOR
    // =========================================================================
    
    describe('Boundary Behavior', () => {
        it('does not go past first row', () => {
            controller.setPositionByIndex(0, 0);
            
            const result = controller.navigate('up');
            
            expect(result).not.toBeNull();
            expect(result!.position.rowIndex).toBe(0);
            expect(result!.taskId).toBe('task1');
        });
        
        it('does not go past last row', () => {
            controller.setPositionByIndex(4, 0); // Last row (index 4)
            
            const result = controller.navigate('down');
            
            expect(result).not.toBeNull();
            expect(result!.position.rowIndex).toBe(4);
            expect(result!.taskId).toBe('task5');
        });
        
        it('does not go past first column', () => {
            controller.setPositionByIndex(0, 0);
            
            const result = controller.navigate('left');
            
            expect(result).not.toBeNull();
            expect(result!.position.colIndex).toBe(0);
            expect(result!.field).toBe('name');
        });
        
        it('does not go past last column', () => {
            controller.setPositionByIndex(0, 3); // Last column (index 3)
            
            const result = controller.navigate('right');
            
            expect(result).not.toBeNull();
            expect(result!.position.colIndex).toBe(3);
            expect(result!.field).toBe('duration');
        });
    });
    
    // =========================================================================
    // EDIT MODE BLOCKING
    // =========================================================================
    
    describe('Edit Mode Blocking', () => {
        it('returns null when in edit mode', () => {
            mockDeps.isEditing = vi.fn(() => true);
            controller.setPositionByIndex(1, 1);
            
            const result = controller.navigate('down');
            
            expect(result).toBeNull();
        });
        
        it('navigates when not in edit mode', () => {
            mockDeps.isEditing = vi.fn(() => false);
            controller.setPositionByIndex(1, 1);
            
            const result = controller.navigate('down');
            
            expect(result).not.toBeNull();
        });
    });
    
    // =========================================================================
    // EMPTY DATA HANDLING
    // =========================================================================
    
    describe('Empty Data Handling', () => {
        it('returns null with no tasks', () => {
            mockDeps.getVisibleTaskIds = vi.fn(() => []);
            
            const result = controller.navigate('down');
            
            expect(result).toBeNull();
        });
        
        it('returns null with no columns', () => {
            mockDeps.getNavigableColumns = vi.fn(() => []);
            controller.invalidateColumnCache();
            
            const result = controller.navigate('right');
            
            expect(result).toBeNull();
        });
    });
    
    // =========================================================================
    // POSITION MANAGEMENT
    // =========================================================================
    
    describe('Position Management', () => {
        it('sets position by task ID and field', () => {
            const success = controller.setPosition('task3', 'end');
            
            expect(success).toBe(true);
            
            const pos = controller.getPosition();
            expect(pos.rowIndex).toBe(2);
            expect(pos.colIndex).toBe(2);
        });
        
        it('returns false for invalid task ID', () => {
            const success = controller.setPosition('nonexistent', 'name');
            
            expect(success).toBe(false);
        });
        
        it('returns false for invalid field', () => {
            const success = controller.setPosition('task1', 'nonexistent');
            
            expect(success).toBe(false);
        });
        
        it('resets position to origin', () => {
            controller.setPositionByIndex(3, 2);
            controller.reset();
            
            const pos = controller.getPosition();
            expect(pos.rowIndex).toBe(0);
            expect(pos.colIndex).toBe(0);
        });
        
        it('gets current cell correctly', () => {
            controller.setPositionByIndex(2, 1);
            
            const cell = controller.getCurrentCell();
            
            expect(cell).not.toBeNull();
            expect(cell!.taskId).toBe('task3');
            expect(cell!.field).toBe('start');
        });
    });
    
    // =========================================================================
    // RANGE SELECTION (SHIFT+ARROW)
    // =========================================================================
    
    describe('Range Selection', () => {
        it('returns range from anchor to new position (down)', () => {
            controller.setPositionByIndex(1, 0); // Start at task2
            
            const result = controller.navigateWithRange('down', 'task2');
            
            expect(result).not.toBeNull();
            expect(result!.result.taskId).toBe('task3');
            expect(result!.rangeTaskIds).toEqual(['task2', 'task3']);
        });
        
        it('returns range from anchor to new position (up)', () => {
            controller.setPositionByIndex(3, 0); // Start at task4
            
            const result = controller.navigateWithRange('up', 'task4');
            
            expect(result).not.toBeNull();
            expect(result!.result.taskId).toBe('task3');
            expect(result!.rangeTaskIds).toEqual(['task3', 'task4']);
        });
        
        it('extends range correctly when anchor is above', () => {
            controller.setPositionByIndex(2, 0); // At task3
            
            // Anchor is task1, we're moving down to task3
            const result = controller.navigateWithRange('down', 'task1');
            
            expect(result).not.toBeNull();
            expect(result!.result.taskId).toBe('task4');
            // Range should be from task1 to task4
            expect(result!.rangeTaskIds).toEqual(['task1', 'task2', 'task3', 'task4']);
        });
        
        it('returns single task when no anchor', () => {
            controller.setPositionByIndex(1, 0);
            
            const result = controller.navigateWithRange('down', null);
            
            expect(result).not.toBeNull();
            expect(result!.rangeTaskIds).toEqual(['task3']);
        });
    });
    
    // =========================================================================
    // COLUMN CACHING
    // =========================================================================
    
    describe('Column Caching', () => {
        it('caches columns after first navigation', () => {
            controller.navigate('right');
            controller.navigate('right');
            
            // Should only call getNavigableColumns once
            expect(mockDeps.getNavigableColumns).toHaveBeenCalledTimes(1);
        });
        
        it('invalidates cache when requested', () => {
            controller.navigate('right');
            controller.invalidateColumnCache();
            controller.navigate('right');
            
            // Should call getNavigableColumns twice (before and after invalidation)
            expect(mockDeps.getNavigableColumns).toHaveBeenCalledTimes(2);
        });
        
        it('uses provided columns when set directly', () => {
            controller.setNavigableColumns(['a', 'b', 'c']);
            controller.setPositionByIndex(0, 0);
            
            const result = controller.navigate('right');
            
            expect(result!.field).toBe('b');
            // Should not have called getNavigableColumns
            expect(mockDeps.getNavigableColumns).not.toHaveBeenCalled();
        });
    });
});
