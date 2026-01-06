import type { Command, CommandResult } from '../types';
import { ZoomController } from '../../services/ZoomController';

/**
 * Zoom Out Command
 * Decreases the Gantt chart zoom level (fewer pixels per day)
 */
export const ZoomOutCommand: Command = {
  id: 'view.zoomOut',
  label: 'Zoom Out',
  category: 'view',
  shortcut: 'Ctrl+-',
  icon: '🔍',
  description: 'Zoom out on the Gantt chart',
  canExecute: () => true, // Always available
  execute: (): CommandResult => {
    const controller = ZoomController.getInstance();
    controller.zoomOut();
    return { success: true };
  },
};
