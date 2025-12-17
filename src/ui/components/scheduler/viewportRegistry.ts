/**
 * @fileoverview Viewport Registry - Shared viewport instance management
 * @module ui/components/scheduler/viewportRegistry
 * 
 * Allows facades to share the same SchedulerViewport instance
 * without using a singleton pattern.
 */

import type { SchedulerViewport } from './SchedulerViewport';

/**
 * Registry to store viewport instances
 * Key: container element (shared parent)
 * Value: SchedulerViewport instance
 */
const viewportRegistry = new WeakMap<HTMLElement, SchedulerViewport>();

/**
 * Get or create viewport instance for a container
 */
export function getViewport(container: HTMLElement): SchedulerViewport | null {
    return viewportRegistry.get(container) || null;
}

/**
 * Set viewport instance for a container
 */
export function setViewport(container: HTMLElement, viewport: SchedulerViewport): void {
    viewportRegistry.set(container, viewport);
}

/**
 * Remove viewport instance
 */
export function removeViewport(container: HTMLElement): void {
    viewportRegistry.delete(container);
}

