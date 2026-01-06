import type { Command, CommandResult } from '../types';
import { ZoomController } from '../../services/ZoomController';

/**
 * Zoom In Command
 * Increases the Gantt chart zoom level (more pixels per day)
 */
export const ZoomInCommand: Command = {
  id: 'view.zoomIn',
  label: 'Zoom In',
  category: 'view',
  shortcut: 'Ctrl+=',
  alternateShortcuts: ['Ctrl++'],
  icon: '🔍',
  description: 'Zoom in on the Gantt chart',
  canExecute: () => true, // Always available
  execute: (): CommandResult => {
    const controller = ZoomController.getInstance();
    controller.zoomIn();
    return { success: true };
  },
};
