/**
 * ============================================================================
 * CPM.ts - Critical Path Method Engine
 * ============================================================================
 * 
 * Pure calculation module for Critical Path Method scheduling.
 * This module is stateless and operates on task arrays.
 * 
 * CPM ALGORITHM OVERVIEW:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  1. FORWARD PASS (Left to Right)                                       │
 * │     - Calculate Early Start (ES) and Early Finish (EF)                 │
 * │     - ES = Max(Predecessor EF + 1) for FS relationships                │
 * │     - EF = ES + Duration - 1                                           │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  2. BACKWARD PASS (Right to Left)                                      │
 * │     - Calculate Late Start (LS) and Late Finish (LF)                   │
 * │     - LF = Min(Successor LS - 1) for FS relationships                  │
 * │     - LS = LF - Duration + 1                                           │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  3. FLOAT CALCULATION                                                  │
 * │     - Total Float = LS - ES (or LF - EF)                               │
 * │     - Free Float = Min(Successor ES) - EF - 1                          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  4. CRITICAL PATH                                                      │
 * │     - Tasks with Total Float <= 0 are critical                         │
 * │     - Critical path = longest path through network                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * @author Pro Logic Scheduler
 * @version 2.0.0 - Ferrari Engine
 */

import type { Task, Calendar, CPMResult, LinkType } from '../types';
import { DateUtils } from './DateUtils';
import { DEFAULT_LINK_TYPE, MAX_CPM_ITERATIONS } from './Constants';

/**
 * @fileoverview Critical Path Method (CPM) calculation engine
 * @module core/CPM
 */

/**
 * Successor map entry
 */
interface SuccessorEntry {
  id: string;
  type: LinkType;
  lag: number;
}

/**
 * Task context functions
 */
interface TaskContext {
  isParent: (id: string) => boolean;
  getDepth: (id: string, depth?: number) => number;
}

/**
 * CPM calculation context
 */
interface CPMContext {
  tasks: Task[];
  calendar: Calendar;
  isParent: (id: string) => boolean;
  getDepth: (id: string, depth?: number) => number;
  successorMap: Map<string, SuccessorEntry[]>;
}

/**
 * CPM calculation options
 */
export interface CPMOptions extends Partial<TaskContext> {}

/**
 * CPM (Critical Path Method) Calculator
 * Static class providing pure calculation functions
 */
export class CPM {
    
    /** Maximum iterations to prevent infinite loops in circular dependencies */
    static readonly MAX_ITERATIONS = MAX_CPM_ITERATIONS;

    /**
     * Calculate the full CPM schedule for a set of tasks
     * 
     * This is the main entry point for CPM calculations.
     * It runs the complete scheduling algorithm:
     * 1. Build successor map
     * 2. Forward pass (ES, EF)
     * 3. Parent date rollup
     * 4. Backward pass (LS, LF)
     * 5. Float calculation
     * 6. Critical path marking
     * 
     * @param tasks - Array of task objects
     * @param calendar - Calendar configuration
     * @param options - Additional options
     * @returns Result with calculated tasks and statistics
     */
    static calculate(tasks: Task[], calendar: Calendar, options: CPMOptions = {}): CPMResult {
        const startTime = performance.now();
        
        // Validate inputs
        if (!tasks || !Array.isArray(tasks)) {
            console.error('[CPM] Invalid tasks array');
            return { 
                tasks: [], 
                stats: { 
                    calcTime: 0,
                    taskCount: 0,
                    criticalCount: 0,
                    projectEnd: '',
                    error: 'Invalid tasks array' 
                } 
            };
        }
        
        if (tasks.length === 0) {
            return { 
                tasks: [], 
                stats: { 
                    calcTime: 0,
                    taskCount: 0,
                    criticalCount: 0,
                    projectEnd: ''
                } 
            };
        }
        
        // Create a deep copy of tasks to avoid mutating the original array
        // This prevents issues if tasks are modified during calculation
        const tasksCopy: Task[] = tasks.map(t => ({ ...t }));
        
        // Create helper functions with closure over tasksCopy
        const isParent = options.isParent || ((id: string) => tasksCopy.some(t => t.parentId === id));
        const getDepth = options.getDepth || ((id: string, depth: number = 0): number => {
            const task = tasksCopy.find(t => t.id === id);
            if (task && task.parentId) {
                return getDepth(task.parentId, depth + 1);
            }
            return depth;
        });
        
        // Create context object for passing to internal methods
        const ctx: CPMContext = {
            tasks: tasksCopy,
            calendar,
            isParent,
            getDepth,
            successorMap: new Map(),
        };
        
        try {
            // Step 1: Build successor map for backward pass
            CPM._buildSuccessorMap(ctx);
            
            // Step 2: Forward pass - calculate Early Start and Early Finish
            CPM._forwardPass(ctx);
            
            // Step 3: Calculate parent dates from children
            CPM._calculateParentDates(ctx);
            
            // Step 4: Backward pass - calculate Late Start and Late Finish
            CPM._backwardPass(ctx);
            
            // Step 5: Calculate float values
            CPM._calculateFloat(ctx);
            
            // Step 6: Mark critical path based on float
            CPM._markCriticalPath(ctx);
            
            const calcTime = performance.now() - startTime;
            
            // Find project end date
            const validEnds = tasksCopy
                .filter(t => t.end && !isParent(t.id))
                .map(t => t.end!)
                .sort()
                .reverse();
            const projectEnd = validEnds.length > 0 ? validEnds[0] : '';
            
            return {
                tasks: ctx.tasks,
                stats: {
                    calcTime,
                    taskCount: tasks.length,
                    criticalCount: tasksCopy.filter(t => t._isCritical && !isParent(t.id)).length,
                    projectEnd,
                },
            };
        } catch (error) {
            const err = error as Error;
            console.error('[CPM] Calculation error:', err);
            // Return original tasks with error info
            return {
                tasks: tasksCopy,
                stats: {
                    calcTime: performance.now() - startTime,
                    taskCount: tasks.length,
                    criticalCount: 0,
                    projectEnd: '',
                    error: err.message,
                },
            };
        }
    }

    /**
     * Build a map of task successors for efficient backward pass
     * 
     * For each task, we need to know which tasks depend on it (successors).
     * This inverts the dependency relationships stored on tasks.
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _buildSuccessorMap(ctx: CPMContext): void {
        const { tasks } = ctx;
        
        ctx.successorMap = new Map();
        
        // Initialize empty arrays for all tasks
        tasks.forEach(task => {
            ctx.successorMap.set(task.id, []);
        });
        
        // Build successor relationships from dependencies
        // If Task B depends on Task A, then Task B is a successor of Task A
        tasks.forEach(task => {
            if (task.dependencies && task.dependencies.length > 0) {
                task.dependencies.forEach(dep => {
                    const successors = ctx.successorMap.get(dep.id);
                    if (successors) {
                        successors.push({
                            id: task.id,
                            type: dep.type || DEFAULT_LINK_TYPE,
                            lag: dep.lag || 0,
                        });
                    }
                });
            }
        });
    }

    /**
     * Forward pass - calculate Early Start (ES) and Early Finish (EF)
     * 
     * Process tasks iteratively until no changes occur.
     * ES = Max(all predecessor constraints based on dependency type)
     * EF = ES + Duration - 1 (in work days)
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _forwardPass(ctx: CPMContext): void {
        const { tasks, calendar, isParent } = ctx;
        
        let changed = true;
        let iterations = 0;
        
        while (changed && iterations < CPM.MAX_ITERATIONS) {
            changed = false;
            iterations++;
            
            tasks.forEach(task => {
                if (isParent(task.id)) return;
                
                let earliestStart: string | null | undefined = null;
                
                // Calculate based on dependencies (predecessors)
                if (task.dependencies && task.dependencies.length > 0) {
                    task.dependencies.forEach(dep => {
                        // Use find with error handling to prevent stack overflow
                        let pred: Task | undefined;
                        try {
                            pred = tasks.find(t => t && t.id === dep.id);
                        } catch (err) {
                            console.error('[CPM] Error finding predecessor:', dep.id, err);
                            return;
                        }
                        if (!pred || !pred.start || !pred.end) return;
                        
                        const lag = dep.lag || 0;
                        let depStart: string;
                        
                        // Calculate earliest start based on dependency type
                        switch (dep.type) {
                            case 'FS': // Finish-to-Start
                                depStart = DateUtils.addWorkDays(pred.end, 1 + lag, calendar);
                                break;
                            case 'SS': // Start-to-Start
                                depStart = DateUtils.addWorkDays(pred.start, lag, calendar);
                                break;
                            case 'FF': // Finish-to-Finish
                                depStart = DateUtils.addWorkDays(pred.end, lag - task.duration + 1, calendar);
                                break;
                            case 'SF': // Start-to-Finish
                                depStart = DateUtils.addWorkDays(pred.start, lag - task.duration + 1, calendar);
                                break;
                            default:
                                depStart = DateUtils.addWorkDays(pred.end, 1 + lag, calendar);
                        }
                        
                        // Take the maximum (latest) start date from all predecessors
                        if (!earliestStart || depStart > earliestStart) {
                            earliestStart = depStart;
                        }
                    });
                }
                
                // Apply constraints
                const constType = task.constraintType || 'asap';
                const constDate: string | null = task.constraintDate;
                
                let finalStart: string | null | undefined = earliestStart;
                
                switch (constType) {
                    case 'snet': // Start No Earlier Than
                        if (constDate) {
                            if (finalStart === null || finalStart === undefined) {
                                finalStart = constDate;
                            } else {
                                const fs: string = finalStart;
                                if (constDate > fs) {
                                    finalStart = constDate;
                                }
                            }
                        }
                        break;
                    case 'snlt': // Start No Later Than
                        if (constDate) {
                            if (finalStart === null || finalStart === undefined) {
                                finalStart = constDate;
                            } else {
                                const fs: string = finalStart;
                                if (fs > constDate) {
                                    finalStart = constDate;
                                }
                            }
                        }
                        break;
                    case 'fnet': // Finish No Earlier Than
                        if (constDate) {
                            const impliedStart = DateUtils.addWorkDays(constDate, -(task.duration - 1), calendar);
                            if (finalStart === null || finalStart === undefined) {
                                finalStart = impliedStart;
                            } else {
                                const fs: string = finalStart;
                                if (impliedStart > fs) {
                                    finalStart = impliedStart;
                                }
                            }
                        }
                        break;
                    case 'fnlt': // Finish No Later Than
                        // FNLT: Task must finish by constraint date (deadline)
                        // If normal end (from dependencies) exceeds constraint, push start earlier to meet deadline
                        if (constDate && typeof constDate === 'string') {
                            // Ensure we have a start date to work with (from dependencies or task.start)
                            const dependencyStart = finalStart || task.start || DateUtils.today();
                            
                            // Calculate what the normal end would be from dependency-driven start
                            const normalEnd = DateUtils.addWorkDays(dependencyStart, task.duration - 1, calendar);
                            
                            // If normal end exceeds constraint date, we need to start earlier to meet deadline
                            if (normalEnd > constDate) {
                                // Calculate required start to meet deadline
                                const requiredStart = DateUtils.addWorkDays(constDate, -(task.duration - 1), calendar);
                                
                                // Use the required start to meet deadline
                                // If requiredStart < earliestStart (from dependencies), this creates an impossible
                                // constraint - the backward pass will show negative float
                                finalStart = requiredStart;
                            }
                            // If normalEnd <= constDate, constraint is already satisfied, no change needed
                        }
                        break;
                    case 'mfo': // Must Finish On
                        if (constDate) {
                            task.end = constDate;
                            task.start = DateUtils.addWorkDays(constDate, -(task.duration - 1), calendar);
                            return; // Skip normal calculation
                        }
                        break;
                    case 'asap': // As Soon As Possible
                    default:
                        if (!finalStart && !task.start) {
                            finalStart = DateUtils.today();
                        }
                        break;
                }
                
                if (!finalStart) finalStart = task.start;
                
                // Update if changed
                if (task.start !== finalStart) {
                    task.start = finalStart;
                    changed = true;
                }
                
                // Calculate end date (Early Finish)
                if (task.start && task.duration >= 0) {
                    const newEnd = DateUtils.addWorkDays(task.start, task.duration - 1, calendar);
                    if (task.end !== newEnd) {
                        task.end = newEnd;
                        changed = true;
                    }
                }
            });
        }
        
        if (iterations >= CPM.MAX_ITERATIONS) {
            console.warn('[CPM] Forward pass reached max iterations - possible circular dependency');
        }
    }

    /**
     * Calculate parent (summary) task dates from children
     * 
     * Parent ES = Min(Child ES)
     * Parent EF = Max(Child EF)
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _calculateParentDates(ctx: CPMContext): void {
        const { tasks, calendar, isParent, getDepth } = ctx;
        
        // Process from deepest level up to handle nested parents
        const maxDepth = Math.max(...tasks.map(t => getDepth(t.id)), 0);
        
        for (let depth = maxDepth; depth >= 0; depth--) {
            tasks.forEach(parent => {
                if (!isParent(parent.id)) return;
                if (getDepth(parent.id) !== depth) return;
                
                const children = tasks.filter(c => 
                    c.parentId === parent.id && c.start && c.end
                );
                
                if (children.length > 0) {
                    const starts: string[] = children
                        .map(c => c.start)
                        .filter((s): s is string => typeof s === 'string')
                        .sort();
                    const ends: string[] = children
                        .map(c => c.end)
                        .filter((e): e is string => typeof e === 'string')
                        .sort();
                    
                    if (starts.length > 0 && ends.length > 0) {
                        parent.start = starts[0];
                        parent.end = ends[ends.length - 1];
                        parent.duration = DateUtils.calcWorkDays(parent.start, parent.end, calendar);
                    }
                }
            });
        }
    }

    /**
     * Backward pass - calculate Late Start (LS) and Late Finish (LF)
     * 
     * Process tasks from right to left (project end to start).
     * LF = Min(all successor constraints based on dependency type)
     * LS = LF - Duration + 1 (in work days)
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _backwardPass(ctx: CPMContext): void {
        const { tasks, calendar, isParent, successorMap } = ctx;
        
        // Find project Late Finish (maximum end date of all leaf tasks)
        const validEnds = tasks
            .filter(t => t.end && !isParent(t.id))
            .map(t => t.end!)
            .sort()
            .reverse();
        
        if (validEnds.length === 0) return;
        
        const projectLateFinish = validEnds[0];
        
        // Initialize late dates for tasks with no successors
        tasks.forEach(task => {
            if (isParent(task.id)) {
                task.lateFinish = null;
                task.lateStart = null;
                return;
            }
            
            const successors = successorMap.get(task.id) || [];
            if (successors.length === 0) {
                // No successors - late finish equals project end
                task.lateFinish = projectLateFinish;
                task.lateStart = DateUtils.addWorkDays(task.lateFinish, -(task.duration - 1), calendar);
            } else {
                // Will be calculated in iteration
                task.lateFinish = null;
                task.lateStart = null;
            }
        });
        
        // Iterate until stable (propagate backwards from successors)
        let changed = true;
        let iterations = 0;
        
        while (changed && iterations < CPM.MAX_ITERATIONS) {
            changed = false;
            iterations++;
            
            tasks.forEach(task => {
                if (isParent(task.id)) return;
                
                const successors = successorMap.get(task.id) || [];
                if (successors.length === 0) return; // Already initialized
                
                let minLateFinish: string | null = null;
                let allSuccessorsCalculated = true;
                
                successors.forEach(succ => {
                    const succTask = tasks.find(t => t.id === succ.id);
                    if (!succTask) return;
                    
                    // Skip parent tasks in successor calculations
                    if (isParent(succTask.id)) return;
                    
                    if (succTask.lateStart === null || succTask.lateFinish === null) {
                        allSuccessorsCalculated = false;
                        return;
                    }
                    
                    const lag = succ.lag || 0;
                    let constrainedFinish: string;
                    
                    // Calculate late finish based on dependency type
                    switch (succ.type) {
                        case 'FS': // Finish-to-Start
                            constrainedFinish = DateUtils.addWorkDays(succTask.lateStart!, -1 - lag, calendar);
                            break;
                        case 'SS': // Start-to-Start
                            constrainedFinish = DateUtils.addWorkDays(succTask.lateStart!, task.duration - 1 - lag, calendar);
                            break;
                        case 'FF': // Finish-to-Finish
                            constrainedFinish = DateUtils.addWorkDays(succTask.lateFinish!, -lag, calendar);
                            break;
                        case 'SF': // Start-to-Finish
                            constrainedFinish = DateUtils.addWorkDays(succTask.lateFinish!, task.duration - 1 - lag, calendar);
                            break;
                        default:
                            constrainedFinish = DateUtils.addWorkDays(succTask.lateStart!, -1 - lag, calendar);
                    }
                    
                    // Take the minimum (earliest) late finish from all successors
                    if (minLateFinish === null || constrainedFinish < minLateFinish) {
                        minLateFinish = constrainedFinish;
                    }
                });
                
                // Update if we have a valid late finish
                if (minLateFinish !== null) {
                    if (task.lateFinish !== minLateFinish) {
                        task.lateFinish = minLateFinish;
                        task.lateStart = DateUtils.addWorkDays(minLateFinish, -(task.duration - 1), calendar);
                        changed = true;
                    }
                } else if (!allSuccessorsCalculated) {
                    changed = true;
                }
            });
        }
        
        // Handle any remaining tasks without late dates
        tasks.forEach(task => {
            if (isParent(task.id)) return;
            
            if (!task.lateFinish) {
                task.lateFinish = projectLateFinish;
                task.lateStart = DateUtils.addWorkDays(projectLateFinish, -(task.duration - 1), calendar);
            }
        });
        
        // Calculate late dates for parent tasks (from children)
        CPM._calculateParentLateDates(ctx);
        
        if (iterations >= CPM.MAX_ITERATIONS) {
            console.warn('[CPM] Backward pass reached max iterations - possible circular dependency');
        }
    }

    /**
     * Calculate late dates for parent tasks from their children
     * 
     * Parent LS = Min(Child LS)
     * Parent LF = Max(Child LF)
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _calculateParentLateDates(ctx: CPMContext): void {
        const { tasks, isParent, getDepth } = ctx;
        
        // Process from deepest level up
        const maxDepth = Math.max(...tasks.map(t => getDepth(t.id)), 0);
        
        for (let depth = maxDepth; depth >= 0; depth--) {
            tasks.forEach(parent => {
                if (!isParent(parent.id)) return;
                if (getDepth(parent.id) !== depth) return;
                
                const children = tasks.filter(c => 
                    c.parentId === parent.id && c.lateStart && c.lateFinish
                );
                
                if (children.length > 0) {
                    const lateStarts = children.map(c => c.lateStart!).sort();
                    const lateFinishes = children.map(c => c.lateFinish!).sort();
                    
                    parent.lateStart = lateStarts[0];
                    parent.lateFinish = lateFinishes[lateFinishes.length - 1];
                }
            });
        }
    }

    /**
     * Calculate Total Float and Free Float for all tasks
     * 
     * Total Float = LS - ES = LF - EF (slack before delaying project)
     * Free Float = Min(Successor ES) - EF - 1 (slack before delaying successor)
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _calculateFloat(ctx: CPMContext): void {
        const { tasks, calendar, isParent, successorMap } = ctx;
        
        tasks.forEach(task => {
            if (isParent(task.id)) {
                // Parent tasks: calculate from children
                const children = tasks.filter(c => c.parentId === task.id);
                if (children.length > 0) {
                    const childFloats = children
                        .filter(c => c.totalFloat !== undefined)
                        .map(c => c.totalFloat!);
                    task.totalFloat = childFloats.length > 0 ? Math.min(...childFloats) : 0;
                    task.freeFloat = 0;
                } else {
                    task.totalFloat = 0;
                    task.freeFloat = 0;
                }
                return;
            }
            
            // Total Float = Late Start - Early Start (in work days)
            if (task.lateStart && task.start) {
                task.totalFloat = DateUtils.calcWorkDaysDifference(task.start, task.lateStart, calendar);
            } else {
                task.totalFloat = 0;
            }
            
            // Free Float calculation
            const successors = successorMap.get(task.id) || [];
            
            if (successors.length === 0) {
                // No successors - free float equals total float
                task.freeFloat = task.totalFloat;
            } else {
                let minFreeFloat: number | null = null;
                
                successors.forEach(succ => {
                    const succTask = tasks.find(t => t.id === succ.id);
                    if (!succTask || !succTask.start || isParent(succTask.id)) return;
                    
                    const lag = succ.lag || 0;
                    let freeFloatForSucc: number;
                    
                    // Calculate free float based on dependency type
                    switch (succ.type) {
                        case 'FS': // Finish-to-Start
                            freeFloatForSucc = DateUtils.calcWorkDaysDifference(task.end, succTask.start, calendar) - 1 - lag;
                            break;
                        case 'SS': // Start-to-Start
                            freeFloatForSucc = DateUtils.calcWorkDaysDifference(task.start, succTask.start, calendar) - lag;
                            break;
                        case 'FF': // Finish-to-Finish
                            freeFloatForSucc = DateUtils.calcWorkDaysDifference(task.end, succTask.end, calendar) - lag;
                            break;
                        case 'SF': // Start-to-Finish
                            freeFloatForSucc = DateUtils.calcWorkDaysDifference(task.start, succTask.end, calendar) - lag;
                            break;
                        default:
                            freeFloatForSucc = DateUtils.calcWorkDaysDifference(task.end, succTask.start, calendar) - 1 - lag;
                    }
                    
                    if (minFreeFloat === null || freeFloatForSucc < minFreeFloat) {
                        minFreeFloat = freeFloatForSucc;
                    }
                });
                
                // Free float cannot exceed total float
                task.freeFloat = minFreeFloat !== null 
                    ? Math.max(0, Math.min(minFreeFloat, task.totalFloat || 0))
                    : (task.totalFloat || 0);
            }
        });
    }

    /**
     * Mark critical path based on Total Float
     * 
     * A task is critical if Total Float <= 0
     * Parent tasks are critical if any child is critical
     * 
     * @param ctx - Calculation context
     * @private
     */
    private static _markCriticalPath(ctx: CPMContext): void {
        const { tasks, isParent, getDepth } = ctx;
        
        // First pass: mark leaf tasks based on float
        tasks.forEach(task => {
            if (isParent(task.id)) {
                task._isCritical = false; // Will be set in second pass
            } else {
                task._isCritical = (task.totalFloat !== undefined && task.totalFloat <= 0);
            }
        });
        
        // Second pass: mark parent tasks as critical if any child is critical
        const maxDepth = Math.max(...tasks.map(t => getDepth(t.id)), 0);
        
        for (let depth = maxDepth; depth >= 0; depth--) {
            tasks.forEach(task => {
                if (!isParent(task.id)) return;
                if (getDepth(task.id) !== depth) return;
                
                const children = tasks.filter(c => c.parentId === task.id);
                task._isCritical = children.some(c => c._isCritical);
            });
        }
    }

    /**
     * Get detailed CPM data for a specific task
     * 
     * @param tasks - Array of all tasks
     * @param taskId - ID of the task to get data for
     * @param successorMap - Pre-built successor map (optional)
     * @returns CPM data object or null if task not found
     */
    static getTaskCPMData(
        tasks: Task[], 
        taskId: string, 
        successorMap: Map<string, SuccessorEntry[]> | null = null
    ): {
        id: string;
        name: string;
        earlyStart: string;
        earlyFinish: string;
        lateStart: string | null | undefined;
        lateFinish: string | null | undefined;
        duration: number;
        totalFloat: number | undefined;
        freeFloat: number | undefined;
        isCritical: boolean | undefined;
        predecessors: string[];
        successors: string[];
    } | null {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return null;
        
        // Build successor map if not provided
        if (!successorMap) {
            successorMap = new Map();
            tasks.forEach(t => successorMap!.set(t.id, []));
            tasks.forEach(t => {
                if (t.dependencies) {
                    t.dependencies.forEach(dep => {
                        const succs = successorMap!.get(dep.id);
                        if (succs) succs.push({ id: t.id, type: dep.type, lag: dep.lag });
                    });
                }
            });
        }
        
        return {
            id: task.id,
            name: task.name,
            earlyStart: task.start,
            earlyFinish: task.end,
            lateStart: task.lateStart,
            lateFinish: task.lateFinish,
            duration: task.duration,
            totalFloat: task.totalFloat,
            freeFloat: task.freeFloat,
            isCritical: task._isCritical,
            predecessors: task.dependencies?.map(d => d.id) || [],
            successors: (successorMap.get(task.id) || []).map(s => s.id),
        };
    }
}

export default CPM;
