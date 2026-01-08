import type { Command, CommandResult } from '../types';
import type { ZoomController } from '../../services/ZoomController';

/**
 * Create Reset Zoom Command with injected ZoomController
 * 
 * MIGRATION NOTE (Pure DI):
 * - Factory function captures ZoomController dependency
 * - Enables unit testing with mock ZoomController
 * 
 * @param zoomController - Injected ZoomController instance
 * @returns Command object with captured dependency
 * @see docs/adr/001-dependency-injection.md
 */
export function createResetZoomCommand(zoomController: ZoomController): Command {
  return {
    id: 'view.resetZoom',
    label: 'Reset Zoom (100%)',
    category: 'view',
    shortcut: 'Ctrl+0',
    icon: '↺',
    description: 'Reset zoom to 100%',
    canExecute: () => true, // Always available
    execute: (): CommandResult => {
      zoomController.resetZoom();
      return { success: true };
    },
  };
}

