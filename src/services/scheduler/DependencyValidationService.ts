/**
 * @fileoverview Dependency Validation Service
 * @module services/scheduler/DependencyValidationService
 * 
 * Handles dependency validation including cycle detection.
 * Extracted from SchedulerService as part of the decomposition plan.
 * 
 * RESPONSIBILITIES:
 * - Validate dependencies before saving
 * - Detect circular dependencies
 * - Check for invalid dependency configurations
 * 
 * ARCHITECTURE:
 * - Uses dependency injection pattern (only needs ProjectController)
 * - Pure business logic - no side effects
 * - Reusable validation logic
 * 
 * @see docs/PHASE3_DECOMPOSITION_AUDIT.md - Phase 3.1
 */

import type { ProjectController } from '../ProjectController';
import type { LinkType } from '../../types';

/**
 * Dependencies required by DependencyValidationService
 */
export interface DependencyValidationServiceDeps {
    /** ProjectController for accessing task data */
    projectController: ProjectController;
}

/**
 * Validation result returned by validate()
 */
export interface ValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Error message if validation failed */
    error?: string;
}

/**
 * Dependency Validation Service
 * 
 * Handles all dependency validation logic including:
 * - Cycle detection (circular dependencies)
 * - Predecessor existence checks
 * - Link type validation
 * - Lag value validation
 */
export class DependencyValidationService {
    private deps: DependencyValidationServiceDeps;

    constructor(deps: DependencyValidationServiceDeps) {
        this.deps = deps;
    }

    /**
     * Get all predecessor task IDs (transitive closure through dependencies)
     * Uses BFS to traverse dependency graph backward
     * 
     * @param taskId - Task ID to find predecessors for
     * @returns Set of all predecessor task IDs (direct and transitive)
     */
    getAllPredecessors(taskId: string): Set<string> {
        const predecessors = new Set<string>();
        const visited = new Set<string>();
        const queue: string[] = [taskId];
        
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            
            const task = this.deps.projectController.getTaskById(currentId);
            if (task?.dependencies) {
                for (const dep of task.dependencies) {
                    if (!visited.has(dep.id)) {
                        predecessors.add(dep.id);
                        queue.push(dep.id);
                    }
                }
            }
        }
        
        return predecessors;
    }

    /**
     * Check if adding a dependency would create a circular dependency
     * 
     * @param taskId - Task that will have the dependency
     * @param predecessorId - Predecessor task ID to check
     * @returns True if adding this dependency would create a cycle
     */
    wouldCreateCycle(taskId: string, predecessorId: string): boolean {
        // A cycle exists if the predecessor depends on (directly or transitively) the current task
        const predecessorPredecessors = this.getAllPredecessors(predecessorId);
        return predecessorPredecessors.has(taskId);
    }

    /**
     * Validate dependencies before saving
     * 
     * Performs comprehensive validation:
     * - Task exists
     * - Predecessor exists
     * - Predecessor is not a blank row
     * - No circular dependencies
     * - Not linking to self
     * - Valid link type
     * - Valid lag value
     * 
     * @param taskId - Task ID
     * @param dependencies - Dependencies to validate
     * @returns Validation result with error message if invalid
     */
    validate(taskId: string, dependencies: Array<{ id: string; type: LinkType; lag: number }>): ValidationResult {
        const task = this.deps.projectController.getTaskById(taskId);
        if (!task) {
            return { valid: false, error: 'Task not found' };
        }

        // Check each dependency
        for (const dep of dependencies) {
            // Check if predecessor exists
            const predecessor = this.deps.projectController.getTaskById(dep.id);
            if (!predecessor) {
                return { valid: false, error: `Predecessor task "${dep.id}" not found` };
            }

            // Check if predecessor is a blank row
            if (predecessor.rowType === 'blank') {
                return { valid: false, error: 'Cannot create dependency to a blank row' };
            }

            // Check for circular dependencies
            if (this.wouldCreateCycle(taskId, dep.id)) {
                const taskName = task.name || taskId;
                const predName = predecessor.name || dep.id;
                return { valid: false, error: `Circular dependency detected: "${taskName}" depends on "${predName}", which depends on "${taskName}"` };
            }

            // Check if linking to self
            if (dep.id === taskId) {
                return { valid: false, error: 'Task cannot depend on itself' };
            }

            // Validate link type
            const validLinkTypes: LinkType[] = ['FS', 'SS', 'FF', 'SF'];
            if (!validLinkTypes.includes(dep.type)) {
                return { valid: false, error: `Invalid link type: ${dep.type}` };
            }

            // Validate lag is a number
            if (typeof dep.lag !== 'number' || isNaN(dep.lag)) {
                return { valid: false, error: 'Lag must be a number' };
            }
        }

        return { valid: true };
    }
}
