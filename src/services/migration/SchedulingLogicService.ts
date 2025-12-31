/**
 * @fileoverview Scheduling Logic Service
 * @module services/migration/SchedulingLogicService
 * 
 * Extracted from SchedulerService._applyTaskEdit()
 * 
 * BUSINESS RULES DOCUMENTED:
 * 
 * 1. SCHEDULING TRIANGLE
 *    - Duration edit → Keep start, CPM recalculates end
 *    - Start edit → Apply SNET constraint (Start No Earlier Than)
 *    - End edit → Apply FNLT constraint (Finish No Later Than)
 * 
 * 2. DRIVER MODE (actualStart)
 *    - Setting actualStart "anchors" the task's historical start
 *    - Automatically applies SNET constraint to lock schedule
 *    - If actualFinish exists, recalculates duration
 *    - Clearing actualStart preserves the constraint (user's choice)
 * 
 * 3. COMPLETION MODE (actualFinish)
 *    - Setting actualFinish marks task 100% complete
 *    - Auto-populates actualStart if not set (uses planned start)
 *    - Sets remainingDuration to 0
 *    - Recalculates actual duration from start to finish
 *    - Cannot set actualFinish before start date
 *    - Cannot set actualFinish if task has no start date
 * 
 * 4. SCHEDULING MODE TRANSITIONS
 *    - Auto → Manual: Dates become "pinned" (CPM won't change them)
 *    - Manual → Auto: Converts current start to SNET constraint
 *                     (prevents jarring date jumps, user can remove constraint)
 *    - Parent tasks cannot be Manual mode
 * 
 * 5. CONSTRAINT HANDLING
 *    - Setting constraintType to 'asap' clears constraintDate
 *    - Other constraint types preserve existing constraintDate
 */

import { DateUtils } from '../../core/DateUtils';
import { ProjectController } from '../ProjectController';
import type { Task, ConstraintType, Calendar, SchedulingMode } from '../../types';

/**
 * Result of applying a task edit
 */
export interface TaskEditResult {
    /** Whether the edit was successful */
    success: boolean;
    /** Whether CPM recalculation is needed */
    needsRecalc: boolean;
    /** Whether UI render is needed (without recalc) */
    needsRender: boolean;
    /** User-facing message (for toast) */
    message?: string;
    /** Message type */
    messageType?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Scheduling Logic Service
 * 
 * Handles all business logic for task field edits.
 * Stateless service - receives dependencies through method parameters.
 */
export class SchedulingLogicService {
    private static instance: SchedulingLogicService;
    
    private constructor() {}
    
    public static getInstance(): SchedulingLogicService {
        if (!SchedulingLogicService.instance) {
            SchedulingLogicService.instance = new SchedulingLogicService();
        }
        return SchedulingLogicService.instance;
    }
    
    /**
     * Apply a task field edit with full business logic
     * 
     * @param taskId - Task ID
     * @param field - Field name being edited
     * @param value - New value
     * @param context - Dependencies (controller, calendar)
     * @returns Result indicating what follow-up actions are needed
     */
    public applyEdit(
        taskId: string,
        field: string,
        value: unknown,
        context: {
            controller: ProjectController;
            calendar: Calendar;
        }
    ): TaskEditResult {
        const { controller, calendar } = context;
        
        const task = controller.getTaskById(taskId);
        if (!task) {
            return { success: false, needsRecalc: false, needsRender: false };
        }
        
        const isParent = controller.isParent(taskId);
        
        switch (field) {
            case 'duration':
                return this._handleDuration(task, value, controller);
                
            case 'start':
                return this._handleStart(task, value, isParent, controller);
                
            case 'end':
                return this._handleEnd(task, value, isParent, controller);
                
            case 'actualStart':
                return this._handleActualStart(task, value, isParent, controller, calendar);
                
            case 'actualFinish':
                return this._handleActualFinish(task, value, isParent, controller, calendar);
                
            case 'constraintType':
                return this._handleConstraintType(task, value, controller);
                
            case 'constraintDate':
                return this._handleConstraintDate(task, value, controller);
                
            case 'schedulingMode':
                return this._handleSchedulingMode(task, value, isParent, controller);
                
            case 'progress':
                return this._handleProgress(task, value, controller);
                
            case 'tradePartnerIds':
                return this._handleTradePartners(task, value, controller);
                
            default:
                // Simple field update (name, notes, etc.)
                controller.updateTask(taskId, { [field]: value } as Partial<Task>);
                return { success: true, needsRecalc: false, needsRender: true };
        }
    }
    
    // =========================================================================
    // DURATION HANDLING
    // =========================================================================
    
    /**
     * Handle duration edit
     * 
     * Business Rule: Accept raw value during editing, validate at commit.
     * This prevents "fighting back" during typing.
     */
    private _handleDuration(
        task: Task,
        value: unknown,
        controller: ProjectController
    ): TaskEditResult {
        const rawValue = String(value).trim();
        const parsedDuration = parseInt(rawValue);
        
        // Only update if valid positive number
        if (!isNaN(parsedDuration) && parsedDuration >= 1) {
            controller.updateTask(task.id, { duration: parsedDuration });
            return { success: true, needsRecalc: true, needsRender: false };
        }
        
        // Invalid during edit - don't update store, DOM keeps user's input
        return { success: true, needsRecalc: false, needsRender: false };
    }
    
    // =========================================================================
    // START DATE HANDLING
    // =========================================================================
    
    /**
     * Handle start date edit
     * 
     * Business Rule: Editing start applies SNET constraint.
     * User is saying "this task should not start before this date".
     */
    private _handleStart(
        task: Task,
        value: unknown,
        isParent: boolean,
        controller: ProjectController
    ): TaskEditResult {
        if (!value || isParent) {
            return { success: false, needsRecalc: false, needsRender: false };
        }
        
        const startValue = String(value);
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
            return { 
                success: false, 
                needsRecalc: false, 
                needsRender: false,
                message: 'Invalid date format',
                messageType: 'warning'
            };
        }
        
        // Apply SNET constraint
        controller.updateTask(task.id, {
            start: startValue,
            constraintType: 'snet' as ConstraintType,
            constraintDate: startValue
        });
        
        return { 
            success: true, 
            needsRecalc: true, 
            needsRender: false,
            message: 'Start constraint applied (SNET)',
            messageType: 'info'
        };
    }
    
    // =========================================================================
    // END DATE HANDLING
    // =========================================================================
    
    /**
     * Handle end date edit
     * 
     * Business Rule: Editing end applies FNLT constraint.
     * User is saying "this task should not finish later than this date".
     */
    private _handleEnd(
        task: Task,
        value: unknown,
        isParent: boolean,
        controller: ProjectController
    ): TaskEditResult {
        if (!value || isParent) {
            return { success: false, needsRecalc: false, needsRender: false };
        }
        
        const endValue = String(value);
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endValue)) {
            return { 
                success: false, 
                needsRecalc: false, 
                needsRender: false,
                message: 'Invalid date format',
                messageType: 'warning'
            };
        }
        
        // Apply FNLT constraint
        controller.updateTask(task.id, {
            end: endValue,
            constraintType: 'fnlt' as ConstraintType,
            constraintDate: endValue
        });
        
        return { 
            success: true, 
            needsRecalc: true, 
            needsRender: false,
            message: 'Finish constraint applied (FNLT)',
            messageType: 'info'
        };
    }
    
    // =========================================================================
    // ACTUAL START HANDLING (Driver Mode + Anchor)
    // =========================================================================
    
    /**
     * Handle actualStart edit
     * 
     * Business Rules:
     * 1. Setting actualStart "anchors" the task's historical start
     * 2. Automatically applies SNET constraint to lock schedule
     * 3. If actualFinish exists, recalculates duration for consistency
     * 4. Clearing actualStart preserves the constraint
     */
    private _handleActualStart(
        task: Task,
        value: unknown,
        isParent: boolean,
        controller: ProjectController,
        calendar: Calendar
    ): TaskEditResult {
        if (isParent) {
            return { 
                success: false, 
                needsRecalc: false, 
                needsRender: false,
                message: 'Cannot set actual start on parent tasks',
                messageType: 'warning'
            };
        }
        
        // SETTING actualStart
        if (value) {
            const actualStartValue = String(value);
            
            // Validate date format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(actualStartValue)) {
                return { success: false, needsRecalc: false, needsRender: false };
            }
            
            // Build atomic update - SNET locks the historical fact
            const updates: Partial<Task> = {
                actualStart: actualStartValue,
                start: actualStartValue,
                constraintType: 'snet' as ConstraintType,
                constraintDate: actualStartValue,
            };
            
            // If task was already finished, recalculate duration for consistency
            if (task.actualFinish) {
                updates.duration = DateUtils.calcWorkDays(
                    actualStartValue,
                    task.actualFinish,
                    calendar
                );
            }
            
            controller.updateTask(task.id, updates);
            
            return { 
                success: true, 
                needsRecalc: true, 
                needsRender: false,
                message: 'Task started - schedule locked with SNET constraint',
                messageType: 'info'
            };
        }
        
        // CLEARING actualStart
        // Note: We preserve the constraint - user may have wanted SNET anyway
        controller.updateTask(task.id, { actualStart: null });
        
        return { 
            success: true, 
            needsRecalc: true, 
            needsRender: false,
            message: 'Actual start cleared. Start constraint preserved.',
            messageType: 'info'
        };
    }
    
    // =========================================================================
    // ACTUAL FINISH HANDLING (Driver Mode + Completion)
    // =========================================================================
    
    /**
     * Handle actualFinish edit
     * 
     * Business Rules:
     * 1. Setting actualFinish marks task 100% complete
     * 2. Auto-populates actualStart if not set (uses planned start)
     * 3. Sets remainingDuration to 0 (for Earned Value calculations)
     * 4. Recalculates actual duration from start to finish
     * 5. Cannot set actualFinish before start date
     * 6. Cannot set actualFinish if task has no start date
     */
    private _handleActualFinish(
        task: Task,
        value: unknown,
        isParent: boolean,
        controller: ProjectController,
        calendar: Calendar
    ): TaskEditResult {
        if (isParent) {
            return { 
                success: false, 
                needsRecalc: false, 
                needsRender: false,
                message: 'Cannot set actual finish on parent tasks',
                messageType: 'warning'
            };
        }
        
        // SETTING actualFinish
        if (value) {
            const actualFinishValue = String(value);
            
            // Validate date format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFinishValue)) {
                return { success: false, needsRecalc: false, needsRender: false };
            }
            
            // Determine effective start for validation and duration calc
            const effectiveStart = task.actualStart || task.start;
            
            // VALIDATION: Cannot finish without a start
            if (!effectiveStart) {
                return { 
                    success: false, 
                    needsRecalc: false, 
                    needsRender: false,
                    message: 'Cannot mark finished: Task has no Start Date.',
                    messageType: 'warning'
                };
            }
            
            // VALIDATION: Finish cannot be before start
            if (actualFinishValue < effectiveStart) {
                return { 
                    success: false, 
                    needsRecalc: false, 
                    needsRender: false,
                    message: 'Actual finish cannot be before start date',
                    messageType: 'warning'
                };
            }
            
            // Calculate actual duration
            const actualDuration = DateUtils.calcWorkDays(
                effectiveStart,
                actualFinishValue,
                calendar
            );
            
            // Build atomic update
            const updates: Partial<Task> = {
                actualFinish: actualFinishValue,
                end: actualFinishValue,
                progress: 100,
                remainingDuration: 0,  // CRITICAL: Zero out for Earned Value
                duration: actualDuration,
            };
            
            // Auto-populate actualStart if not set
            if (!task.actualStart && task.start) {
                // Apply "Anchor Logic" to the implied start
                updates.actualStart = task.start;
                updates.start = task.start;
                updates.constraintType = 'snet' as ConstraintType;
                updates.constraintDate = task.start;
            }
            
            controller.updateTask(task.id, updates);
            
            // Generate variance message
            const plannedDuration = task.duration || 0;
            const variance = actualDuration - plannedDuration;
            
            let message: string;
            let messageType: 'info' | 'success' | 'warning';
            
            if (variance > 0) {
                message = `Task complete - took ${variance} day${variance !== 1 ? 's' : ''} longer than planned`;
                messageType = 'info';
            } else if (variance < 0) {
                message = `Task complete - finished ${Math.abs(variance)} day${Math.abs(variance) !== 1 ? 's' : ''} early!`;
                messageType = 'success';
            } else {
                message = 'Task complete - on schedule';
                messageType = 'success';
            }
            
            return { 
                success: true, 
                needsRecalc: true, 
                needsRender: false,
                message,
                messageType
            };
        }
        
        // CLEARING actualFinish - task is no longer complete
        controller.updateTask(task.id, { 
            actualFinish: null,
            progress: 0,
            remainingDuration: task.duration // Reset remaining work
        });
        
        return { 
            success: true, 
            needsRecalc: true, 
            needsRender: false,
            message: 'Task reopened',
            messageType: 'info'
        };
    }
    
    // =========================================================================
    // CONSTRAINT HANDLING
    // =========================================================================
    
    /**
     * Handle constraintType edit
     * 
     * Business Rule: Setting to 'asap' clears the constraintDate.
     */
    private _handleConstraintType(
        task: Task,
        value: unknown,
        controller: ProjectController
    ): TaskEditResult {
        const constraintValue = String(value) as ConstraintType;
        
        if (constraintValue === 'asap') {
            controller.updateTask(task.id, { 
                constraintType: 'asap',
                constraintDate: null 
            });
            return { 
                success: true, 
                needsRecalc: true, 
                needsRender: false,
                message: 'Constraint removed - task will schedule based on dependencies',
                messageType: 'info'
            };
        }
        
        // Other constraint types - just update
        controller.updateTask(task.id, { constraintType: constraintValue });
        return { success: true, needsRecalc: true, needsRender: false };
    }
    
    /**
     * Handle constraintDate edit
     */
    private _handleConstraintDate(
        task: Task,
        value: unknown,
        controller: ProjectController
    ): TaskEditResult {
        controller.updateTask(task.id, { 
            constraintDate: String(value) || null 
        });
        return { success: true, needsRecalc: true, needsRender: false };
    }
    
    // =========================================================================
    // SCHEDULING MODE HANDLING
    // =========================================================================
    
    /**
     * Handle schedulingMode edit
     * 
     * Business Rules:
     * - Auto → Manual: Dates become "pinned" (CPM won't change them)
     * - Manual → Auto: Converts current start to SNET constraint
     *                  (prevents jarring date jumps)
     * - Parent tasks cannot be Manual mode
     */
    private _handleSchedulingMode(
        task: Task,
        value: unknown,
        isParent: boolean,
        controller: ProjectController
    ): TaskEditResult {
        const newMode = String(value) as SchedulingMode;
        
        // Validate mode value
        if (newMode !== 'Auto' && newMode !== 'Manual') {
            return { success: false, needsRecalc: false, needsRender: false };
        }
        
        // Parent tasks cannot be Manual
        if (isParent && newMode === 'Manual') {
            return { 
                success: false, 
                needsRecalc: false, 
                needsRender: false,
                message: 'Parent tasks cannot be manually scheduled',
                messageType: 'warning'
            };
        }
        
        // Skip if no change
        if (task.schedulingMode === newMode) {
            return { success: true, needsRecalc: false, needsRender: false };
        }
        
        if (newMode === 'Auto' && task.schedulingMode === 'Manual') {
            // MANUAL → AUTO TRANSITION
            // Convert current Start to SNET constraint to preserve user intent
            const updates: Partial<Task> = {
                schedulingMode: 'Auto',
                constraintType: 'snet' as ConstraintType,
                constraintDate: task.start || null
            };
            
            controller.updateTask(task.id, updates);
            
            return { 
                success: true, 
                needsRecalc: true, 
                needsRender: false,
                message: 'Task is now auto-scheduled with SNET constraint (remove constraint for ASAP)',
                messageType: 'info'
            };
        }
        
        // AUTO → MANUAL: Simple mode change, dates preserved
        controller.updateTask(task.id, { schedulingMode: newMode });
        
        return { 
            success: true, 
            needsRecalc: true, 
            needsRender: false,
            message: 'Task is now manually scheduled - dates are fixed',
            messageType: 'info'
        };
    }
    
    // =========================================================================
    // PROGRESS HANDLING
    // =========================================================================
    
    /**
     * Handle progress edit
     */
    private _handleProgress(
        task: Task,
        value: unknown,
        controller: ProjectController
    ): TaskEditResult {
        const progress = Math.max(0, Math.min(100, Number(value) || 0));
        controller.updateTask(task.id, { progress });
        return { success: true, needsRecalc: false, needsRender: true };
    }
    
    // =========================================================================
    // TRADE PARTNER HANDLING
    // =========================================================================
    
    /**
     * Handle tradePartnerIds edit
     */
    private _handleTradePartners(
        task: Task,
        value: unknown,
        controller: ProjectController
    ): TaskEditResult {
        const ids = Array.isArray(value) ? value as string[] : [];
        controller.updateTask(task.id, { tradePartnerIds: ids });
        return { success: true, needsRecalc: false, needsRender: true };
    }
}

/**
 * Singleton accessor
 */
export const schedulingLogic = SchedulingLogicService.getInstance();
