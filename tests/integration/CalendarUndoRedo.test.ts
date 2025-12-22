/**
 * @fileoverview Integration test for Calendar Undo/Redo
 * @module tests/integration/CalendarUndoRedo-test
 * 
 * Tests undo/redo functionality for calendar changes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarStore } from '../../src/data/CalendarStore';
import { HistoryManager } from '../../src/data/HistoryManager';
import { PersistenceService } from '../../src/data/PersistenceService';

// Mock Tauri SQL plugin at module level
vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    execute: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
  };
  const mockDatabaseLoad = vi.fn().mockResolvedValue(mockDb);
  return {
    default: {
      load: mockDatabaseLoad,
    },
    __mockDb: mockDb,
  };
});

describe('Calendar Undo/Redo Integration Tests', () => {
  let calendarStore: CalendarStore;
  let historyManager: HistoryManager;
  let persistenceService: PersistenceService;
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;

    vi.clearAllMocks();
    mockDb.execute.mockReset();
    mockDb.select.mockReset();
    mockDb.close.mockReset();
    mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });

    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn(() => 123 as any),
      clearInterval: vi.fn(),
    };

    mockDb.execute.mockImplementation(async (query: string) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX') || query.includes('INSERT OR IGNORE')) {
        return { lastInsertId: 0, rowsAffected: 0 };
      }
      return { lastInsertId: 1, rowsAffected: 1 };
    });

    persistenceService = new PersistenceService();
    await persistenceService.init();
    mockDb.execute.mockClear();

    historyManager = new HistoryManager({ maxHistory: 50 });
    calendarStore = new CalendarStore();
    calendarStore.setPersistenceService(persistenceService);
    calendarStore.setHistoryManager(historyManager);
  });

  describe('Calendar Undo/Redo', () => {
    it('should undo working days change', () => {
      const originalDays = calendarStore.getWorkingDays();
      expect(originalDays).toEqual([1, 2, 3, 4, 5]);

      // Change working days
      calendarStore.setWorkingDays([1, 2, 3]);
      expect(calendarStore.getWorkingDays()).toEqual([1, 2, 3]);

      // Undo
      const backwardEvents = historyManager.undo();
      expect(backwardEvents).not.toBeNull();
      expect(backwardEvents!.length).toBe(1);
      expect(backwardEvents![0].type).toBe('CALENDAR_UPDATED');

      calendarStore.applyEvent(backwardEvents![0]);
      expect(calendarStore.getWorkingDays()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should redo working days change', () => {
      // Change working days
      calendarStore.setWorkingDays([1, 2, 3]);
      expect(calendarStore.getWorkingDays()).toEqual([1, 2, 3]);

      // Undo
      const backwardEvents = historyManager.undo();
      calendarStore.applyEvent(backwardEvents![0]);
      expect(calendarStore.getWorkingDays()).toEqual([1, 2, 3, 4, 5]);

      // Redo
      const forwardEvents = historyManager.redo();
      expect(forwardEvents).not.toBeNull();
      expect(forwardEvents!.length).toBe(1);
      expect(forwardEvents![0].type).toBe('CALENDAR_UPDATED');

      calendarStore.applyEvent(forwardEvents![0]);
      expect(calendarStore.getWorkingDays()).toEqual([1, 2, 3]);
    });

    it('should undo exception addition', () => {
      const originalExceptions = calendarStore.getExceptions();
      expect(Object.keys(originalExceptions).length).toBe(0);

      // Add exception
      calendarStore.addException('2024-01-01', 'New Year');
      expect(calendarStore.getExceptions()['2024-01-01']).toBeDefined();

      // Undo
      const backwardEvents = historyManager.undo();
      calendarStore.applyEvent(backwardEvents![0]);
      expect(Object.keys(calendarStore.getExceptions()).length).toBe(0);
    });

    it('should undo exception removal', () => {
      // Add exception first
      calendarStore.addException('2024-01-01', 'New Year');
      expect(calendarStore.getExceptions()['2024-01-01']).toBeDefined();

      // Clear history from add
      historyManager.clear();

      // Remove exception
      calendarStore.removeException('2024-01-01');
      expect(calendarStore.getExceptions()['2024-01-01']).toBeUndefined();

      // Undo removal
      const backwardEvents = historyManager.undo();
      calendarStore.applyEvent(backwardEvents![0]);
      expect(calendarStore.getExceptions()['2024-01-01']).toBeDefined();
    });

    it('should not record history when applying events', () => {
      // Make a change
      calendarStore.setWorkingDays([1, 2, 3]);
      expect(historyManager.canUndo()).toBe(true);

      // Undo
      const backwardEvents = historyManager.undo();
      calendarStore.applyEvent(backwardEvents![0]);
      
      // History should show we can redo, not undo
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);

      // Redo
      const forwardEvents = historyManager.redo();
      calendarStore.applyEvent(forwardEvents![0]);

      // Should still have only one action in history
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);
    });
  });
});

