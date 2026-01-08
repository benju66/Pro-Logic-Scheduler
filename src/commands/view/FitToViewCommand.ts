import type { Command, CommandResult } from '../types';
import type { ZoomController } from '../../services/ZoomController';

/**
 * Create Fit To View Command with injected ZoomController
 * 
 * MIGRATION NOTE (Pure DI):
 * - Factory function captures ZoomController dependency
 * - Enables unit testing with mock ZoomController
 * 
 * @param zoomController - Injected ZoomController instance
 * @returns Command object with captured dependency
 * @see docs/adr/001-dependency-injection.md
 */
export function createFitToViewCommand(zoomController: ZoomController): Command {
  return {
    id: 'view.fitToView',
    label: 'Fit to View',
    category: 'view',
    icon: '⬜',
    description: 'Fit the entire timeline in view',
    canExecute: () => true, // Always available
    execute: (): CommandResult => {
      zoomController.fitToView();
      return { success: true };
    },
  };
}

