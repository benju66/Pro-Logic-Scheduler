/**
 * @fileoverview Test for Date Double-Entry Bug
 * Tests that date inputs save correctly on first Enter press
 * @module tests/integration/DateDoubleEntryBug.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditingStateManager, getEditingStateManager } from '../../src/services/EditingStateManager';
import { formatDateForDisplay, formatDateISO, parseFlexibleDate } from '../../src/ui/components/scheduler/datepicker/DatePickerConfig';

describe('Date Double-Entry Bug', () => {
    let editingManager: EditingStateManager;

    beforeEach(() => {
        EditingStateManager.resetInstance();
        editingManager = getEditingStateManager();
    });

    describe('Editing state clearing sequence', () => {
        it('should clear editing state before save triggers render', () => {
            const taskId = 'task1';
            const field = 'start';
            const originalValue = '2025-12-29';
            const newValue = '2025-12-30';

            // Simulate entering edit mode
            editingManager.enterEditMode(
                { taskId, field },
                'click',
                originalValue
            );

            expect(editingManager.isEditingCell(taskId, field)).toBe(true);

            // Simulate the fix: Clear editing state BEFORE save
            editingManager.exitEditMode('enter');
            
            expect(editingManager.isEditingCell(taskId, field)).toBe(false);

            // Now simulate save (which would trigger render)
            // During render, BindingSystem._bindCell() should see isEditing = false
            const isBeingEditedDuringRender = editingManager.isEditingCell(taskId, field);
            expect(isBeingEditedDuringRender).toBe(false);
        });

        it('should maintain correct state sequence for Enter handler', () => {
            const taskId = 'task1';
            const field = 'start';
            const originalValue = '2025-12-29';

            // Step 1: Enter edit mode
            editingManager.enterEditMode(
                { taskId, field },
                'click',
                originalValue
            );
            expect(editingManager.isEditing()).toBe(true);

            // Step 2: Clear editing state (as Enter handler should do BEFORE save)
            editingManager.exitEditMode('enter');
            expect(editingManager.isEditing()).toBe(false);

            // Step 3: Simulate save triggering render
            // During render, editing guard should allow DOM update
            const isEditingDuringRender = editingManager.isEditingCell(taskId, field);
            expect(isEditingDuringRender).toBe(false);
        });
    });

    describe('Date value parsing and storage', () => {
        it('should parse display format correctly', () => {
            const displayValue = '12/30/2025';
            const parsed = parseFlexibleDate(displayValue);
            expect(parsed).not.toBeNull();
            
            if (parsed) {
                const isoValue = formatDateISO(parsed);
                expect(isoValue).toBe('2025-12-30');
            }
        });

        it('should format ISO to display correctly', () => {
            const isoValue = '2025-12-30';
            const displayValue = formatDateForDisplay(isoValue);
            expect(displayValue).toBe('12/30/2025');
        });
    });

    describe('State transition timing', () => {
        it('should verify editing state is cleared synchronously', () => {
            const taskId = 'task1';
            const field = 'start';

            editingManager.enterEditMode(
                { taskId, field },
                'click',
                '2025-12-29'
            );

            // Clear state
            editingManager.exitEditMode('enter');

            // Immediately check (simulating synchronous render)
            const isEditing = editingManager.isEditingCell(taskId, field);
            expect(isEditing).toBe(false);
        });
    });
});
