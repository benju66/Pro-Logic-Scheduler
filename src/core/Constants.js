// @ts-check
/**
 * @fileoverview Application-wide constants
 * @module core/Constants
 * 
 * Centralized constants to eliminate magic strings and improve maintainability.
 * All constants are exported for use across the application.
 */

/**
 * Link types for task dependencies
 * @type {readonly string[]}
 */
export const LINK_TYPES = Object.freeze(['FS', 'SS', 'FF', 'SF']);

/**
 * Constraint types for task scheduling
 * @type {readonly string[]}
 */
export const CONSTRAINT_TYPES = Object.freeze(['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo']);

/**
 * Link type labels for display
 * @type {Object<string, string>}
 */
export const LINK_TYPE_LABELS = Object.freeze({
    'FS': 'Finish-to-Start',
    'SS': 'Start-to-Start',
    'FF': 'Finish-to-Finish',
    'SF': 'Start-to-Finish'
});

/**
 * Constraint type labels for display
 * @type {Object<string, string>}
 */
export const CONSTRAINT_TYPE_LABELS = Object.freeze({
    'asap': 'As Soon As Possible',
    'snet': 'Start No Earlier Than',
    'snlt': 'Start No Later Than',
    'fnet': 'Finish No Earlier Than',
    'fnlt': 'Finish No Later Than',
    'mfo': 'Must Finish On'
});

/**
 * Default link type
 * @type {string}
 */
export const DEFAULT_LINK_TYPE = 'FS';

/**
 * Default constraint type
 * @type {string}
 */
export const DEFAULT_CONSTRAINT_TYPE = 'asap';

/**
 * Validate if a value is a valid link type
 * @param {string} type - Link type to validate
 * @returns {boolean} True if valid
 */
export function isValidLinkType(type) {
    return LINK_TYPES.includes(type);
}

/**
 * Validate if a value is a valid constraint type
 * @param {string} type - Constraint type to validate
 * @returns {boolean} True if valid
 */
export function isValidConstraintType(type) {
    return CONSTRAINT_TYPES.includes(type);
}

