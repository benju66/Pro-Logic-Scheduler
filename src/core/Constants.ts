/**
 * @fileoverview Application-wide constants
 * @module core/Constants
 * 
 * Centralized constants to eliminate magic strings and improve maintainability.
 * All constants are exported for use across the application.
 */

import type { LinkType, ConstraintType, SchedulingMode } from '../types';

/**
 * Link types for task dependencies
 */
export const LINK_TYPES: readonly LinkType[] = Object.freeze(['FS', 'SS', 'FF', 'SF'] as const);

/**
 * Constraint types for task scheduling
 */
export const CONSTRAINT_TYPES: readonly ConstraintType[] = Object.freeze([
  'asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'
] as const);

/**
 * Link type labels for display
 */
export const LINK_TYPE_LABELS: Readonly<Record<LinkType, string>> = Object.freeze({
  'FS': 'Finish-to-Start',
  'SS': 'Start-to-Start',
  'FF': 'Finish-to-Finish',
  'SF': 'Start-to-Finish'
} as const);

/**
 * Constraint type labels for display
 */
export const CONSTRAINT_TYPE_LABELS: Readonly<Record<ConstraintType, string>> = Object.freeze({
  'asap': 'As Soon As Possible',
  'snet': 'Start No Earlier Than',
  'snlt': 'Start No Later Than',
  'fnet': 'Finish No Earlier Than',
  'fnlt': 'Finish No Later Than',
  'mfo': 'Must Finish On'
} as const);

/**
 * Default link type
 */
export const DEFAULT_LINK_TYPE: LinkType = 'FS';

/**
 * Default constraint type
 */
export const DEFAULT_CONSTRAINT_TYPE: ConstraintType = 'asap';

/**
 * Default working days (Monday-Friday)
 */
export const DEFAULT_WORKING_DAYS: number[] = [1, 2, 3, 4, 5];

/**
 * Storage key for localStorage persistence
 */
export const STORAGE_KEY = 'pro_scheduler_v10';

/**
 * Maximum history size for undo/redo
 */
export const MAX_HISTORY_SIZE = 50;

/**
 * Maximum iterations for CPM calculation to prevent infinite loops
 */
export const MAX_CPM_ITERATIONS = 50;

/**
 * Validate if a value is a valid link type
 * @param type - Link type to validate
 * @returns True if valid
 */
export function isValidLinkType(type: string): type is LinkType {
  return LINK_TYPES.includes(type as LinkType);
}

/**
 * Validate if a value is a valid constraint type
 * @param type - Constraint type to validate
 * @returns True if valid
 */
export function isValidConstraintType(type: string): type is ConstraintType {
  return CONSTRAINT_TYPES.includes(type as ConstraintType);
}

/**
 * Scheduling modes for tasks
 */
export const SCHEDULING_MODES: readonly SchedulingMode[] = Object.freeze(['Auto', 'Manual'] as const);

/**
 * Scheduling mode labels for display
 */
export const SCHEDULING_MODE_LABELS: Readonly<Record<SchedulingMode, string>> = Object.freeze({
  'Auto': 'Auto-Scheduled (CPM)',
  'Manual': 'Manually Scheduled'
} as const);

/**
 * Scheduling mode descriptions for help text
 */
export const SCHEDULING_MODE_DESCRIPTIONS: Readonly<Record<SchedulingMode, string>> = Object.freeze({
  'Auto': 'Dates are calculated by the CPM engine based on dependencies and constraints.',
  'Manual': 'Dates are fixed by the user. CPM will not change this task\'s dates, but successors will still respect them as anchors.'
} as const);

/**
 * Default scheduling mode for new tasks
 */
export const DEFAULT_SCHEDULING_MODE: SchedulingMode = 'Auto';

/**
 * Validate if a value is a valid scheduling mode
 * @param mode - Scheduling mode to validate
 * @returns True if valid
 */
export function isValidSchedulingMode(mode: string): mode is SchedulingMode {
  return SCHEDULING_MODES.includes(mode as SchedulingMode);
}
