/**
 * SelectionModel
 * 
 * Manages synchronous UI state for selection and focus.
 * 
 * This is decoupled from the data/worker logic to ensure instant UI responsiveness.
 * When a user clicks a row, the selection updates immediately without waiting
 * for any worker communication.
 * 
 * Features:
 * - Single selection
 * - Multi-selection (Ctrl+click)
 * - Range selection (Shift+click)
 * - Focus tracking (keyboard navigation target)
 */

import { BehaviorSubject } from 'rxjs';

/**
 * Selection state interface
 */
export interface SelectionState {
    /** Currently selected task IDs */
    selectedIds: Set<string>;
    /** Selection order - tracks the order tasks were selected (for linking) */
    selectionOrder: string[];
    /** Currently focused task ID (keyboard navigation target) */
    focusedId: string | null;
    /** Anchor ID for shift-click range selection */
    anchorId: string | null;
    /** Focused field (column) for cell navigation */
    focusedField: string | null;
}

/**
 * SelectionModel - Singleton
 * 
 * Manages synchronous UI state for selection and focus.
 * All selection operations are instant and don't require worker communication.
 */
export class SelectionModel {
    private static instance: SelectionModel;

    // State exposed as observable for UI binding
    public readonly state$ = new BehaviorSubject<SelectionState>({
        selectedIds: new Set(),
        selectionOrder: [],
        focusedId: null,
        anchorId: null,
        focusedField: null
    });

    // ========================================================================
    // Constructor & Singleton
    // ========================================================================

    private constructor() {}

    /**
     * Get the singleton instance
     */
    public static getInstance(): SelectionModel {
        if (!SelectionModel.instance) {
            SelectionModel.instance = new SelectionModel();
        }
        return SelectionModel.instance;
    }

    // ========================================================================
    // Selection Operations
    // ========================================================================

    /**
     * Select a task
     * 
     * @param id - Task ID to select
     * @param multi - If true, add to selection (Ctrl+click behavior)
     * @param range - If true, select range from anchor (Shift+click behavior)
     * @param taskOrder - Optional task ID array for range selection
     */
    public select(
        id: string,
        multi: boolean = false,
        range: boolean = false,
        taskOrder?: string[]
    ): void {
        const current = this.state$.value;
        let newSet: Set<string>;
        let newOrder: string[];

        if (range && current.anchorId && taskOrder) {
            // Range selection: select all tasks between anchor and clicked task
            newSet = this.selectRange(current.anchorId, id, taskOrder, multi ? current.selectedIds : new Set());
            // For range, preserve existing order and add new items in task order
            newOrder = [...current.selectionOrder];
            newSet.forEach(taskId => {
                if (!newOrder.includes(taskId)) {
                    newOrder.push(taskId);
                }
            });
        } else if (multi) {
            // Multi-selection: toggle the clicked task
            newSet = new Set(current.selectedIds);
            newOrder = [...current.selectionOrder];
            if (newSet.has(id)) {
                newSet.delete(id);
                newOrder = newOrder.filter(i => i !== id);
            } else {
                newSet.add(id);
                if (!newOrder.includes(id)) {
                    newOrder.push(id);
                }
            }
        } else {
            // Single selection: replace selection with just this task
            newSet = new Set([id]);
            newOrder = [id];
        }

        this.state$.next({
            selectedIds: newSet,
            selectionOrder: newOrder,
            focusedId: id,
            anchorId: range ? current.anchorId : id, // Keep anchor on range, update on new selection
            focusedField: current.focusedField
        });
    }

    /**
     * Select a range of tasks between anchor and target
     */
    private selectRange(
        anchorId: string,
        targetId: string,
        taskOrder: string[],
        existingSelection: Set<string>
    ): Set<string> {
        const anchorIndex = taskOrder.indexOf(anchorId);
        const targetIndex = taskOrder.indexOf(targetId);

        if (anchorIndex === -1 || targetIndex === -1) {
            // Fallback: just select the target
            return new Set([...existingSelection, targetId]);
        }

        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);

        const newSet = new Set(existingSelection);
        for (let i = start; i <= end; i++) {
            newSet.add(taskOrder[i]);
        }

        return newSet;
    }

    /**
     * Select all tasks
     */
    public selectAll(taskIds: string[]): void {
        const current = this.state$.value;
        this.state$.next({
            ...current,
            selectedIds: new Set(taskIds),
            selectionOrder: [...taskIds]
        });
    }

    /**
     * Clear all selection (including focus)
     */
    public clear(): void {
        this.state$.next({
            selectedIds: new Set(),
            selectionOrder: [],
            focusedId: null,
            anchorId: null,
            focusedField: null
        });
    }

    /**
     * Clear selection but preserve focus/navigation state.
     * Used by Escape command - user wants to deselect but keep their position
     * for continued keyboard navigation.
     */
    public clearSelectionOnly(): void {
        const current = this.state$.value;
        this.state$.next({
            selectedIds: new Set(),
            selectionOrder: [],
            focusedId: current.focusedId,      // Preserve focus
            anchorId: null,                     // Clear anchor (no range selection)
            focusedField: current.focusedField  // Preserve focused column
        });
    }

    /**
     * Set selection directly (for sync with legacy SchedulerService)
     * @param selectedIds - Set of selected task IDs
     * @param focusedId - Optional focused task ID
     * @param selectionOrder - Optional selection order array
     */
    public setSelection(selectedIds: Set<string>, focusedId: string | null = null, selectionOrder?: string[]): void {
        const current = this.state$.value;
        // If no order provided, derive from selectedIds (order not preserved)
        const newOrder = selectionOrder ?? Array.from(selectedIds);
        this.state$.next({
            ...current,
            selectedIds: new Set(selectedIds), // Defensive copy
            selectionOrder: newOrder,
            focusedId: focusedId ?? current.focusedId,
            anchorId: focusedId ?? current.anchorId
        });
    }

    /**
     * Set focus without changing selection
     */
    public setFocus(id: string | null, field?: string): void {
        const current = this.state$.value;
        this.state$.next({
            ...current,
            focusedId: id,
            focusedField: field ?? current.focusedField
        });
    }

    /**
     * Set focused field (column)
     */
    public setFocusedField(field: string | null): void {
        const current = this.state$.value;
        this.state$.next({
            ...current,
            focusedField: field
        });
    }

    /**
     * Add to selection without changing focus
     */
    public addToSelection(ids: string[]): void {
        const current = this.state$.value;
        const newSet = new Set(current.selectedIds);
        const newOrder = [...current.selectionOrder];
        
        ids.forEach(id => {
            newSet.add(id);
            if (!newOrder.includes(id)) {
                newOrder.push(id);
            }
        });
        
        this.state$.next({
            ...current,
            selectedIds: newSet,
            selectionOrder: newOrder
        });
    }

    /**
     * Remove from selection
     */
    public removeFromSelection(ids: string[]): void {
        const current = this.state$.value;
        const newSet = new Set(current.selectedIds);
        const idsToRemove = new Set(ids);
        ids.forEach(id => newSet.delete(id));
        const newOrder = current.selectionOrder.filter(id => !idsToRemove.has(id));

        // If focused task was removed, clear focus
        const newFocusedId = current.focusedId && newSet.has(current.focusedId) 
            ? current.focusedId 
            : null;

        this.state$.next({
            ...current,
            selectedIds: newSet,
            selectionOrder: newOrder,
            focusedId: newFocusedId
        });
    }

    // ========================================================================
    // Getters (Synchronous access)
    // ========================================================================

    /**
     * Get array of selected task IDs
     */
    public getSelectedIds(): string[] {
        return Array.from(this.state$.value.selectedIds);
    }

    /**
     * Get the Set of selected IDs (for O(1) lookups)
     */
    public getSelectedIdSet(): Set<string> {
        return this.state$.value.selectedIds;
    }

    /**
     * Get focused task ID
     */
    public getFocusedId(): string | null {
        return this.state$.value.focusedId;
    }

    /**
     * Get focused field
     */
    public getFocusedField(): string | null {
        return this.state$.value.focusedField;
    }

    /**
     * Get anchor ID (for range selection)
     */
    public getAnchorId(): string | null {
        return this.state$.value.anchorId;
    }

    /**
     * Get selection in order (for linking tasks in selection order)
     */
    public getSelectionInOrder(): string[] {
        return [...this.state$.value.selectionOrder];
    }

    /**
     * Check if a task is selected
     */
    public isSelected(id: string): boolean {
        return this.state$.value.selectedIds.has(id);
    }

    /**
     * Check if a task is focused
     */
    public isFocused(id: string): boolean {
        return this.state$.value.focusedId === id;
    }

    /**
     * Get selection count
     */
    public getSelectionCount(): number {
        return this.state$.value.selectedIds.size;
    }

    /**
     * Check if selection is empty
     */
    public isEmpty(): boolean {
        return this.state$.value.selectedIds.size === 0;
    }

    // ========================================================================
    // Utility
    // ========================================================================

    /**
     * Get current state snapshot
     */
    public getState(): SelectionState {
        return this.state$.value;
    }
}
