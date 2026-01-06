import type { Command, CommandResult } from '../types';
import { ZoomController } from '../../services/ZoomController';

/**
 * Fit To View Command
 * Adjusts zoom to fit the entire timeline in the visible area
 */
export const FitToViewCommand: Command = {
  id: 'view.fitToView',
  label: 'Fit to View',
  category: 'view',
  icon: '⬜',
  description: 'Fit the entire timeline in view',
  canExecute: () => true, // Always available
  execute: (): CommandResult => {
    const controller = ZoomController.getInstance();
    controller.fitToView();
    return { success: true };
  },
};
