import type { Command, CommandResult } from '../types';
import type { ZoomController } from '../../services/ZoomController';

/**
 * Create Zoom Out Command with injected ZoomController
 * 
 * MIGRATION NOTE (Pure DI):
 * - Factory function captures ZoomController dependency
 * - Enables unit testing with mock ZoomController
 * 
 * @param zoomController - Injected ZoomController instance
 * @returns Command object with captured dependency
 * @see docs/adr/001-dependency-injection.md
 */
export function createZoomOutCommand(zoomController: ZoomController): Command {
  return {
    id: 'view.zoomOut',
    label: 'Zoom Out',
    category: 'view',
    shortcut: 'Ctrl+-',
    icon: '🔍',
    description: 'Zoom out on the Gantt chart',
    canExecute: () => true, // Always available
    execute: (): CommandResult => {
      zoomController.zoomOut();
      return { success: true };
    },
  };
}

