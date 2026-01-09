/**
 * @fileoverview Task Operations Service
 * @module services/scheduler/TaskOperationsService
 * 
 * Handles all task-level CRUD operations, hierarchy changes, and movement.
 * Extracted from SchedulerService as part of the decomposition plan.
 * 
 * RESPONSIBILITIES:
 * - Task CRUD: addTask, deleteTask, deleteSelected
 * - Hierarchy: indent, outdent, indentSelected, outdentSelected
 * - Movement: moveSelectedTasks, handleRowMove
 * - Blank rows: insertBlankRowAbove, insertBlankRowBelow, wakeUpBlankRow, convertBlankToTask
 * - Collapse: toggleCollapse
 * 
 * ARCHITECTURE:
 * - Uses callback injection pattern to avoid circular dependencies
 * - Relies on ViewCoordinator for reactive rendering (no render() calls)
 * - All operations fire-and-forget to ProjectController (which handles Worker + persistence)
 * 
 * @see docs/SCHEDULER_SERVICE_FULL_DECOMPOSITION_PLAN.md - Phase 2
 */

import { OperationQueue } from '../../core/OperationQueue';
import { OrderingService } from '../OrderingService';
import { DateUtils } from '../../core/DateUtils';
import type { Task } from '../../types';
import type { ProjectController } from '../ProjectController';
import type { SelectionModel } from '../SelectionModel';
import type { EditingStateManager } from '../EditingStateManager';
import type { CommandService } from '../../commands';
import type { ToastService } from '../../ui/services/ToastService';
import type { GridAccessor, GanttAccessor } from './types';

// =========================================================================
// DEPENDENCY INTERFACE
// =========================================================================

/**
 * Dependencies required by TaskOperationsService.
 * Uses callback injection pattern to avoid circular dependencies.
 */
export interface TaskOperationsServiceDeps {
    /** ProjectController for data operations */
    projectController: ProjectController;
    /** SelectionModel for selection state */
    selectionModel: SelectionModel;
    /** EditingStateManager for edit mode tracking */
    editingStateManager: EditingStateManager;
    /** CommandService for command execution */
    commandService: CommandService;
    /** ToastService for user feedback */
    toastService: ToastService;
    /** Getter for grid component (may be null before init) */
    getGrid: () => GridAccessor | null;
    /** Getter for gantt component (may be null before init) */
    getGantt: () => GanttAccessor | null;
    /** Save checkpoint for undo/redo */
    saveCheckpoint: () => void;
    /** Enter edit mode on current cell */
    enterEditMode: () => void;
    /** Check if scheduler is initialized */
    isInitialized: () => boolean;
    /** Update header checkbox state after add/delete */
    updateHeaderCheckboxState: () => void;
}

// =========================================================================
// SERVICE CLASS
// =========================================================================

/**
 * Task Operations Service
 * 
 * Handles all task-level operations including CRUD, hierarchy changes,
 * movement, and blank row management.
 */
export class TaskOperationsService {
    private deps: TaskOperationsServiceDeps;
    private operationQueue: OperationQueue;

    constructor(deps: TaskOperationsServiceDeps) {
        this.deps = deps;
        this.operationQueue = new OperationQueue();
    }

    // =========================================================================
    // CRUD OPERATIONS
    // =========================================================================

    /**
     * Add a new task - ALWAYS appends to bottom of siblings
     * Uses fractional indexing for bulletproof ordering
     */
    addTask(taskData: Partial<Task> = {}): Promise<Task | undefined> {
        if (!this.deps.isInitialized()) {
            return Promise.resolve(undefined);
        }
        
        const { projectController, selectionModel, toastService } = this.deps;
        
        return this.operationQueue.enqueue(async () => {
            this.deps.saveCheckpoint();
            
            // Determine parent
            let parentId: string | null = taskData.parentId ?? null;
            const currentFocusedId = selectionModel.getFocusedId();
            if (currentFocusedId && taskData.parentId === undefined) {
                const focusedTask = projectController.getTaskById(currentFocusedId);
                if (focusedTask) {
                    parentId = focusedTask.parentId ?? null;
                }
            }
            
            // Generate sort key (now guaranteed to see latest state)
            const lastSortKey = projectController.getLastSortKey(parentId);
            const sortKey = OrderingService.generateAppendKey(lastSortKey);
            
            const today = DateUtils.today();
            const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const task: Task = {
                id: taskId,
                rowType: 'task',  // Explicitly set rowType
                name: taskData.name || 'New Task',
                start: taskData.start || today,
                end: taskData.end || today,
                duration: taskData.duration || 1,
                parentId: parentId,
                dependencies: taskData.dependencies || [],
                progress: taskData.progress || 0,
                constraintType: taskData.constraintType || 'asap',
                constraintDate: taskData.constraintDate || null,
                notes: taskData.notes || '',
                level: 0,
                sortKey: sortKey,
                _collapsed: false,
            } as Task;
            
            // Fire-and-forget to ProjectController (handles optimistic update + worker + persistence)
            projectController.addTask(task);
            
            // Update UI state
            selectionModel.setSelection(new Set([task.id]), task.id, [task.id]);
            
            // Pass focusCell: true to focus the name input for immediate editing
            const grid = this.deps.getGrid();
            const gantt = this.deps.getGantt();
            
            if (grid) {
                grid.setSelection(selectionModel.getSelectedIdSet(), selectionModel.getFocusedId(), { focusCell: true, focusField: 'name' });
            }
            if (gantt) {
                gantt.setSelection(selectionModel.getSelectedIdSet());
            }
            this.deps.updateHeaderCheckboxState();
            
            // NOTE: Removed recalculateAll(), engine sync, saveData(), render()
            // ProjectController handles these via Worker + optimistic updates
            // SchedulerViewport subscribes to controller.tasks$ and auto-renders
            
            toastService?.success('Task added');
            return task;
        });
    }

    /**
     * Delete a task and its children
     */
    deleteTask(taskId: string): void {
        const { projectController, selectionModel, editingStateManager, toastService } = this.deps;
        
        if (editingStateManager.isEditingTask(taskId)) {
            editingStateManager.exitEditMode('task-deleted');
        }
        
        // Fire-and-forget to ProjectController (handles optimistic update + worker + persistence)
        // ProjectController.deleteTask() also handles descendants
        projectController.deleteTask(taskId);
        
        // Update UI state
        selectionModel.removeFromSelection([taskId]);
        if (selectionModel.getFocusedId() === taskId) {
            selectionModel.setFocus(null);
        }

        // NOTE: Removed recalculateAll(), engine sync, saveData(), render()
        // ProjectController handles these via Worker + optimistic updates
        // SchedulerViewport subscribes to controller.tasks$ and auto-renders
        
        toastService.success('Task deleted');
    }

    /**
     * Delete all selected tasks
     * Shows confirmation for multiple tasks or parent tasks
     */
    async deleteSelected(): Promise<void> {
        const { projectController, selectionModel, editingStateManager, toastService } = this.deps;
        
        if (selectionModel.getSelectionCount() === 0) {
            toastService?.info('No tasks selected');
            return;
        }
        
        const selectedCount = selectionModel.getSelectionCount();
        const selectedArray = selectionModel.getSelectedIds();
        const hasParents = selectedArray.some(id => projectController.isParent(id));
        
        // Confirm for multiple tasks or parent tasks
        if (selectedCount > 1 || hasParents) {
            const childCount = hasParents
                ? selectedArray.reduce((sum, id) => 
                    sum + this.getAllDescendants(id).size, 0)
                : 0;
            
            const message = hasParents
                ? `Delete ${selectedCount} task${selectedCount > 1 ? 's' : ''} and ${childCount} child task${childCount !== 1 ? 's' : ''}?`
                : `Delete ${selectedCount} tasks?`;
            
            const confirmed = await this._confirmAction(message);
            if (!confirmed) return;
        }
        
        this.deps.saveCheckpoint();
        
        const idsToDelete = selectionModel.getSelectedIds();
        
        for (const taskId of idsToDelete) {
            if (editingStateManager.isEditingTask(taskId)) {
                editingStateManager.exitEditMode('task-deleted');
            }
            projectController.deleteTask(taskId);
            selectionModel.removeFromSelection([taskId]);
            // NOTE: Removed engine sync - ProjectController handles via Worker
        }
        
        const currentFocusedId = selectionModel.getFocusedId();
        if (currentFocusedId && idsToDelete.includes(currentFocusedId)) {
            selectionModel.setFocus(null);
        }
        
        // NOTE: ProjectController handles recalc/save via Worker
        
        toastService?.success(`Deleted ${idsToDelete.length} task${idsToDelete.length > 1 ? 's' : ''}`);
    }

    // =========================================================================
    // HIERARCHY OPERATIONS
    // =========================================================================

    /**
     * Indent a task (make it a child of previous sibling)
     */
    indent(taskId: string): void {
        const { projectController } = this.deps;
        const task = projectController.getTaskById(taskId);
        if (!task) return;

        const list = projectController.getVisibleTasks((id) => {
            const t = projectController.getTaskById(id);
            return t?._collapsed || false;
        });
        
        const idx = list.findIndex(t => t.id === taskId);
        if (idx <= 0) return;
        
        const prev = list[idx - 1];
        const taskDepth = projectController.getDepth(taskId);
        const prevDepth = projectController.getDepth(prev.id);
        
        if (prevDepth < taskDepth) return;
        
        let newParentId: string | null = null;
        
        if (prevDepth === taskDepth) {
            newParentId = prev.id;
        } else {
            let curr: Task | undefined = prev;
            while (curr && projectController.getDepth(curr.id) > taskDepth) {
                curr = curr.parentId ? projectController.getTaskById(curr.parentId) : undefined;
            }
            if (curr) {
                newParentId = curr.id;
            }
        }
        
        if (newParentId !== null) {
            // Generate new sort key for new parent's children
            const newSortKey = OrderingService.generateAppendKey(
                projectController.getLastSortKey(newParentId)
            );
            
            // Fire-and-forget to ProjectController
            projectController.moveTask(taskId, newParentId, newSortKey);
            
            // NOTE: Removed recalculateAll(), saveData(), render()
        }
    }

    /**
     * Outdent a task (move to parent's level)
     */
    outdent(taskId: string): void {
        const { projectController } = this.deps;
        const task = projectController.getTaskById(taskId);
        if (!task || !task.parentId) return;

        const parent = projectController.getTaskById(task.parentId);
        const newParentId = parent ? parent.parentId : null;
        
        // Generate sort key to insert after former parent
        const siblings = projectController.getChildren(newParentId);
        const parentIndex = siblings.findIndex(t => t.id === task.parentId);
        
        let newSortKey: string;
        if (parentIndex >= 0 && parentIndex < siblings.length - 1) {
            // Insert between parent and next sibling
            newSortKey = OrderingService.generateInsertKey(
                siblings[parentIndex].sortKey ?? null,
                siblings[parentIndex + 1].sortKey ?? null
            );
        } else {
            // Insert at end
            newSortKey = OrderingService.generateAppendKey(
                projectController.getLastSortKey(newParentId)
            );
        }
        
        // Fire-and-forget to ProjectController
        projectController.moveTask(taskId, newParentId, newSortKey);
        
        // NOTE: Removed recalculateAll(), saveData(), render()
    }

    /**
     * Indent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    indentSelected(): void {
        const { projectController, selectionModel, toastService } = this.deps;
        
        if (selectionModel.getSelectionCount() === 0) {
            toastService?.info('No tasks selected');
            return;
        }
        
        this.deps.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(selectionModel.getSelectedIds());
        
        // Get top-level selected tasks (parent not in selection)
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        // Process in visual order (top to bottom)
        let indentedCount = 0;
        for (const task of topLevelSelected) {
            const idx = list.findIndex(t => t.id === task.id);
            if (idx <= 0) continue;
            
            const prev = list[idx - 1];
            const taskDepth = projectController.getDepth(task.id);
            const prevDepth = projectController.getDepth(prev.id);
            
            // Can only indent if prev is at same or higher depth
            if (prevDepth < taskDepth) continue;
            
            let newParentId: string | null = null;
            if (prevDepth === taskDepth) {
                newParentId = prev.id;
            } else {
                let curr: Task | undefined = prev;
                while (curr && projectController.getDepth(curr.id) > taskDepth) {
                    curr = curr.parentId ? projectController.getTaskById(curr.parentId) : undefined;
                }
                if (curr) newParentId = curr.id;
            }
            
            if (newParentId !== null) {
                const newSortKey = OrderingService.generateAppendKey(
                    projectController.getLastSortKey(newParentId)
                );
                projectController.moveTask(task.id, newParentId, newSortKey);
                indentedCount++;
            }
        }
        
        if (indentedCount > 0) {
            // NOTE: ProjectController handles recalc/save via Worker
            toastService?.success(`Indented ${indentedCount} task${indentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Outdent all selected tasks
     * Processes top-level selections only (children move with parents)
     */
    outdentSelected(): void {
        const { projectController, selectionModel, toastService } = this.deps;
        
        if (selectionModel.getSelectionCount() === 0) {
            toastService?.info('No tasks selected');
            return;
        }
        
        this.deps.saveCheckpoint();
        
        const list = this._getFlatList();
        const selectedIds = new Set(selectionModel.getSelectedIds());
        const allTasks = projectController.getTasks();
        
        // Get top-level selected tasks
        const topLevelSelected = list.filter(task =>
            selectedIds.has(task.id) &&
            (!task.parentId || !selectedIds.has(task.parentId))
        );
        
        let outdentedCount = 0;
        for (const task of topLevelSelected) {
            if (!task.parentId) continue; // Already at root
            
            const currentParent = allTasks.find(t => t.id === task.parentId);
            const grandparentId = currentParent ? currentParent.parentId : null;
            
            // Position after former parent among its siblings
            const auntsUncles = projectController.getChildren(grandparentId);
            const formerParentIndex = auntsUncles.findIndex(t => t.id === currentParent?.id);
            
            const beforeKey = currentParent?.sortKey ?? null;
            const afterKey = formerParentIndex < auntsUncles.length - 1
                ? auntsUncles[formerParentIndex + 1].sortKey
                : null;
            
            const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
            
            projectController.updateTask(task.id, {
                parentId: grandparentId,
                sortKey: newSortKey
            });
            outdentedCount++;
        }
        
        if (outdentedCount > 0) {
            // NOTE: ProjectController handles recalc/save via Worker
            toastService?.success(`Outdented ${outdentedCount} task${outdentedCount > 1 ? 's' : ''}`);
        }
    }

    /**
     * Toggle collapse state
     */
    toggleCollapse(taskId: string): void {
        // Delegate to CommandService
        this.deps.commandService.execute('view.toggleCollapse', { args: { taskId } });
    }

    // =========================================================================
    // MOVEMENT OPERATIONS
    // =========================================================================

    /**
     * Move the focused task up or down
     */
    moveSelectedTasks(direction: number): void {
        // Delegate to CommandService
        if (direction === -1) {
            this.deps.commandService.execute('hierarchy.moveUp');
        } else {
            this.deps.commandService.execute('hierarchy.moveDown');
        }
        
        // Keep focus on moved task
        const grid = this.deps.getGrid();
        if (grid) {
            const currentFocusedId = this.deps.selectionModel.getFocusedId();
            if (currentFocusedId) {
                grid.scrollToTask(currentFocusedId);
            }
        }
    }

    /**
     * Handle drag-and-drop row movement
     */
    handleRowMove(taskIds: string[], targetId: string, position: 'before' | 'after' | 'child'): void {
        const { projectController, toastService } = this.deps;
        
        // =========================================================================
        // VALIDATION
        // =========================================================================
        
        // Guard: No tasks to move
        if (!taskIds || taskIds.length === 0) {
            return;
        }
        
        // Guard: No valid target
        const targetTask = projectController.getTaskById(targetId);
        if (!targetTask) {
            toastService.warning('Invalid drop target');
            return;
        }
        
        // Guard: Can't drop on self
        if (taskIds.includes(targetId)) {
            return;
        }
        
        // =========================================================================
        // COLLECT ALL TASKS TO MOVE (including descendants)
        // =========================================================================
        
        const selectedSet = new Set(taskIds);
        
        // Find "top-level" selected tasks (tasks whose parent is NOT also selected)
        const topLevelSelected = taskIds
            .map(id => projectController.getTaskById(id))
            .filter((t): t is Task => t !== undefined)
            .filter(task => !task.parentId || !selectedSet.has(task.parentId));
        
        if (topLevelSelected.length === 0) {
            return;
        }
        
        // Collect all tasks to move (top-level + all their descendants)
        const tasksToMove = new Set<Task>();
        const taskIdsToMove = new Set<string>();
        
        const collectDescendants = (task: Task): void => {
            tasksToMove.add(task);
            taskIdsToMove.add(task.id);
            
            // Recursively collect all descendants
            projectController.getChildren(task.id).forEach(child => {
                collectDescendants(child);
            });
        };
        
        topLevelSelected.forEach(task => collectDescendants(task));
        
        // =========================================================================
        // VALIDATE: Prevent circular reference (can't drop parent onto descendant)
        // =========================================================================
        
        if (taskIdsToMove.has(targetId)) {
            toastService.warning('Cannot drop a task onto its own descendant');
            return;
        }
        
        // Also check if target is inside any task being moved
        let checkParent = targetTask.parentId;
        while (checkParent) {
            if (taskIdsToMove.has(checkParent)) {
                toastService.warning('Cannot drop a task onto its own descendant');
                return;
            }
            const parent = projectController.getTaskById(checkParent);
            checkParent = parent?.parentId ?? null;
        }
        
        // =========================================================================
        // SAVE CHECKPOINT FOR UNDO
        // =========================================================================
        
        this.deps.saveCheckpoint();
        
        // =========================================================================
        // DETERMINE NEW PARENT AND SORT KEY POSITION
        // =========================================================================
        
        let newParentId: string | null;
        let beforeKey: string | null;
        let afterKey: string | null;
        
        if (position === 'child') {
            // Make dragged tasks children of target
            newParentId = targetId;
            
            // Append to end of target's children
            const existingChildren = projectController.getChildren(targetId);
            beforeKey = existingChildren.length > 0 
                ? existingChildren[existingChildren.length - 1].sortKey ?? null 
                : null;
            afterKey = null;
            
            // If target was collapsed, expand it to show the newly added children
            if (targetTask._collapsed) {
                projectController.updateTask(targetId, { _collapsed: false });
            }
            
        } else if (position === 'before') {
            // Insert before target (same parent level)
            newParentId = targetTask.parentId ?? null;
            
            // Get siblings at target's level
            const siblings = projectController.getChildren(newParentId);
            const targetIndex = siblings.findIndex(t => t.id === targetId);
            
            beforeKey = targetIndex > 0 ? siblings[targetIndex - 1].sortKey ?? null : null;
            afterKey = targetTask.sortKey ?? null;
            
        } else {
            // Insert after target (same parent level)
            newParentId = targetTask.parentId ?? null;
            
            // Get siblings at target's level
            const siblings = projectController.getChildren(newParentId);
            const targetIndex = siblings.findIndex(t => t.id === targetId);
            
            beforeKey = targetTask.sortKey ?? null;
            afterKey = targetIndex < siblings.length - 1 
                ? siblings[targetIndex + 1].sortKey ?? null 
                : null;
        }
        
        // =========================================================================
        // GENERATE SORT KEYS FOR MOVED TASKS
        // =========================================================================
        
        const sortKeys = OrderingService.generateBulkKeys(
            beforeKey,
            afterKey,
            topLevelSelected.length
        );
        
        // =========================================================================
        // UPDATE TOP-LEVEL TASKS (change parentId and sortKey)
        // =========================================================================
        
        topLevelSelected.forEach((task, index) => {
            projectController.updateTask(task.id, {
                parentId: newParentId,
                sortKey: sortKeys[index]
            });
        });
        
        // NOTE: Descendants keep their parentId unchanged (they stay as children of their original parent)
        // NOTE: ProjectController handles recalc/save via Worker
        
        // =========================================================================
        // USER FEEDBACK
        // =========================================================================
        
        const totalMoved = tasksToMove.size;
        const topLevelCount = topLevelSelected.length;
        
        if (totalMoved === 1) {
            toastService.success('Task moved');
        } else if (totalMoved === topLevelCount) {
            toastService.success(`Moved ${totalMoved} tasks`);
        } else {
            toastService.success(`Moved ${topLevelCount} task(s) with ${totalMoved - topLevelCount} children`);
        }
    }

    /**
     * Handle Enter key on last row - creates new task as sibling
     */
    handleEnterLastRow(lastTaskId: string, field: string): void {
        const { projectController, selectionModel } = this.deps;
        
        // Get the last task to determine its parent (new task will be a sibling)
        const lastTask = projectController.getTaskById(lastTaskId);
        if (!lastTask) return;
        
        // We need to temporarily set focusedId so addTask creates sibling at correct level
        selectionModel.setFocus(lastTaskId);
        
        // Add the task - this will create it as a sibling of lastTask
        this.addTask().then((newTask) => {
            const grid = this.deps.getGrid();
            if (newTask && grid) {
                // Focus the same field that was being edited (not always 'name')
                // Use a short delay to ensure the task is rendered
                setTimeout(() => {
                    grid.focusCell(newTask.id, field);
                }, 100);
            }
        });
    }

    // =========================================================================
    // BLANK ROW OPERATIONS
    // =========================================================================

    /**
     * Insert blank row above a task
     */
    insertBlankRowAbove(taskId: string): void {
        const { projectController, selectionModel } = this.deps;
        const task = projectController.getTaskById(taskId);
        if (!task) return;
        
        this.deps.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = projectController.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = taskIndex > 0 ? siblings[taskIndex - 1].sortKey : null;
        const afterKey = task.sortKey;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        // Fire-and-forget to ProjectController
        const blankRow = projectController.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        selectionModel.setSelection(new Set([blankRow.id]), blankRow.id, [blankRow.id]);
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
        // Scroll to and highlight the new row
        const grid = this.deps.getGrid();
        if (grid) {
            grid.scrollToTask(blankRow.id);
            grid.highlightCell(blankRow.id, 'name');
        }
    }

    /**
     * Insert blank row below a task
     */
    insertBlankRowBelow(taskId: string): void {
        const { projectController, selectionModel } = this.deps;
        const task = projectController.getTaskById(taskId);
        if (!task) return;
        
        this.deps.saveCheckpoint();
        
        // Get siblings to find sort key position
        const siblings = projectController.getChildren(task.parentId);
        const taskIndex = siblings.findIndex(s => s.id === taskId);
        
        const beforeKey = task.sortKey;
        const afterKey = taskIndex < siblings.length - 1 ? siblings[taskIndex + 1].sortKey : null;
        
        const newSortKey = OrderingService.generateInsertKey(beforeKey, afterKey);
        // Fire-and-forget to ProjectController
        const blankRow = projectController.createBlankRow(newSortKey, task.parentId);
        
        // Select the new blank row
        selectionModel.setSelection(new Set([blankRow.id]), blankRow.id, [blankRow.id]);
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
        // Scroll to and highlight the new row
        const grid = this.deps.getGrid();
        if (grid) {
            grid.scrollToTask(blankRow.id);
            grid.highlightCell(blankRow.id, 'name');
        }
    }

    /**
     * Wake up a blank row (convert to task and enter edit mode)
     * Called when user double-clicks a blank row
     */
    wakeUpBlankRow(taskId: string): void {
        const { projectController, selectionModel } = this.deps;
        const task = projectController.getTaskById(taskId);
        if (!task || !projectController.isBlankRow(taskId)) {
            return;
        }
        
        this.deps.saveCheckpoint();
        
        // Fire-and-forget to ProjectController
        const wokenTask = projectController.wakeUpBlankRow(taskId);
        if (!wokenTask) return;
        
        // Update selection state
        selectionModel.setSelection(new Set([taskId]), taskId, [taskId]);
        selectionModel.setFocus(taskId, 'name');
        
        // NOTE: Removed recalculateAll(), render() - ProjectController handles via Worker
        
        // Wait for the next paint frame before focusing (allows reactive update to propagate)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.deps.enterEditMode();
            });
        });
    }

    /**
     * Convert a blank row to a task
     */
    convertBlankToTask(taskId: string): void {
        const { projectController, toastService } = this.deps;
        
        if (!projectController.isBlankRow(taskId)) {
            toastService?.error('Only blank rows can be converted');
            return;
        }
        
        this.deps.saveCheckpoint();
        
        // Fire-and-forget to ProjectController
        const task = projectController.wakeUpBlankRow(taskId, 'New Task');
        if (!task) return;
        
        // NOTE: Removed recalculateAll(), saveData(), render() - ProjectController handles via Worker
        
        // Focus the name field for immediate editing
        const grid = this.deps.getGrid();
        if (grid) {
            setTimeout(() => {
                grid.focusCell(taskId, 'name');
            }, 50);
        }
    }

    // =========================================================================
    // INSERT OPERATIONS (delegates to CommandService)
    // =========================================================================

    /**
     * Insert a new task above the currently focused task
     */
    insertTaskAbove(): void {
        this.deps.commandService.execute('task.insertAbove');
    }

    /**
     * Insert a new task below the currently focused task
     */
    insertTaskBelow(): void {
        this.deps.commandService.execute('task.insertBelow');
    }

    /**
     * Add a new task as a child of the currently focused task
     */
    addChildTask(): void {
        this.deps.commandService.execute('task.addChild');
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    /**
     * Get all descendants of a task
     */
    getAllDescendants(taskId: string): Set<string> {
        const { projectController } = this.deps;
        const descendants = new Set<string>();
        const collect = (id: string) => {
            const children = projectController.getChildren(id);
            for (const child of children) {
                descendants.add(child.id);
                collect(child.id);
            }
        };
        collect(taskId);
        return descendants;
    }

    /**
     * Get flat list of visible tasks
     * @private
     */
    private _getFlatList(): Task[] {
        const { projectController } = this.deps;
        return projectController.getVisibleTasks((id) => {
            const t = projectController.getTaskById(id);
            return t?._collapsed || false;
        });
    }

    /**
     * Simple confirmation dialog
     * @private
     */
    private _confirmAction(message: string): Promise<boolean> {
        return new Promise(resolve => {
            // For now, use browser confirm - can be replaced with custom modal
            const result = confirm(message);
            resolve(result);
        });
    }
}
