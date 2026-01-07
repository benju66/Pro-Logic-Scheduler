import type { Command, CommandResult } from '../types';
import { ZoomController } from '../../services/ZoomController';

/**
 * Create Zoom In Command with injected ZoomController
 * 
 * MIGRATION NOTE (Pure DI):
 * - Factory function captures ZoomController dependency
 * - Enables unit testing with mock ZoomController
 * 
 * @param zoomController - Injected ZoomController instance
 * @returns Command object with captured dependency
 * @see docs/adr/001-dependency-injection.md
 */
export function createZoomInCommand(zoomController: ZoomController): Command {
  return {
    id: 'view.zoomIn',
    label: 'Zoom In',
    category: 'view',
    shortcut: 'Ctrl+=',
    alternateShortcuts: ['Ctrl++'],
    icon: '🔍',
    description: 'Zoom in on the Gantt chart',
    canExecute: () => true, // Always available
    execute: (): CommandResult => {
      zoomController.zoomIn();
      return { success: true };
    },
  };
}

/**
 * @deprecated Use createZoomInCommand(zoomController) factory instead.
 * Kept for backward compatibility during migration.
 * @see docs/adr/001-dependency-injection.md
 */
export const ZoomInCommand: Command = createZoomInCommand(ZoomController.getInstance());
