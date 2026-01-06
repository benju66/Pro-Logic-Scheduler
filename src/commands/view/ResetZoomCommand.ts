import type { Command, CommandResult } from '../types';
import { ZoomController } from '../../services/ZoomController';

/**
 * Reset Zoom Command
 * Resets zoom to 100% (default for current view mode)
 */
export const ResetZoomCommand: Command = {
  id: 'view.resetZoom',
  label: 'Reset Zoom (100%)',
  category: 'view',
  shortcut: 'Ctrl+0',
  icon: '↺',
  description: 'Reset zoom to 100%',
  canExecute: () => true, // Always available
  execute: (): CommandResult => {
    const controller = ZoomController.getInstance();
    controller.resetZoom();
    return { success: true };
  },
};
