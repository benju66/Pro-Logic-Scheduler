/**
 * @fileoverview Integration test for PersistenceService
 * @module tests/integration/persistence-test
 * 
 * Tests the async write queue pattern and SQLite persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersistenceService } from '../../src/data/PersistenceService';

// Mock Tauri SQL plugin
const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
};

const mockDatabaseLoad = vi.fn().mockResolvedValue(mockDb);

// Mock window.__TAURI__ for Tauri environment detection
const mockTauri = {
  __TAURI__: true,
};

describe('PersistenceService Integration Tests', () => {
  let persistenceService: PersistenceService;
  let originalWindow: typeof window;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockDb.execute.mockReset();
    mockDb.select.mockReset();

    // Mock successful database operations
    mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });
    mockDb.select.mockResolvedValue([]);

    // Mock Tauri environment
    originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        // Return a mock timer ID
        return 123 as any;
      }),
      clearInterval: vi.fn(),
    };

    // Mock the SQL plugin import (Tauri v1)
    vi.mock('tauri-plugin-sql-api', () => ({
      default: mockDatabaseLoad,
      load: mockDatabaseLoad,
    }));

    persistenceService = new PersistenceService();
  });

  afterEach(async () => {
    // Cleanup
    if (persistenceService.getInitialized()) {
      await persistenceService.flushNow();
    }
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize database connection and run schema', async () => {
      // Mock schema execution
      mockDb.execute.mockImplementation(async (query: string) => {
        if (query.includes('CREATE TABLE')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('CREATE INDEX')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT OR IGNORE')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      await persistenceService.init();

      expect(persistenceService.getInitialized()).toBe(true);
      expect(mockDatabaseLoad).toHaveBeenCalledWith('sqlite:scheduler.db');
      // Verify schema was executed (should have multiple CREATE TABLE calls)
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should handle initialization failure gracefully', async () => {
      // Mock database load failure
      mockDatabaseLoad.mockRejectedValueOnce(new Error('Database connection failed'));

      await persistenceService.init();

      // Should still mark as initialized (but persistence disabled)
      expect(persistenceService.getInitialized()).toBe(true);
    });
  });

  describe('Event Queueing', () => {
    beforeEach(async () => {
      // Initialize service
      mockDb.execute.mockImplementation(async (query: string) => {
        if (query.includes('CREATE TABLE')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('CREATE INDEX')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT OR IGNORE')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 1, rowsAffected: 1 };
      });

      await persistenceService.init();
      // Clear mock calls from initialization
      mockDb.execute.mockClear();
    });

    it('should queue events without blocking', () => {
      const startTime = Date.now();

      // Queue multiple events
      for (let i = 0; i < 10; i++) {
        persistenceService.queueEvent('TASK_UPDATED', `task_${i}`, {
          field: 'duration',
          old_value: 5,
          new_value: 10,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should be very fast (< 10ms for 10 events)
      expect(duration).toBeLessThan(10);
      expect(persistenceService.getQueueSize()).toBe(10);
    });

    it('should flush events asynchronously', async () => {
      // Mock flush operations
      let eventCount = 0;
      mockDb.execute.mockImplementation(async (query: string, bindings?: unknown[]) => {
        if (query === 'BEGIN TRANSACTION') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO events')) {
          eventCount++;
          return { lastInsertId: eventCount, rowsAffected: 1 };
        }
        if (query.includes('UPDATE tasks')) {
          return { lastInsertId: 0, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      // Queue an event
      persistenceService.queueEvent('TASK_UPDATED', 'task_123', {
        field: 'name',
        old_value: 'Old Name',
        new_value: 'New Name',
      });

      expect(persistenceService.getQueueSize()).toBe(1);

      // Wait for flush (with timeout)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify event was persisted
      const insertCalls = mockDb.execute.mock.calls.filter(call =>
        call[0].includes('INSERT INTO events')
      );
      expect(insertCalls.length).toBeGreaterThan(0);

      // Verify event payload
      const eventCall = insertCalls[0];
      expect(eventCall[1][0]).toBe('TASK_UPDATED'); // event_type
      expect(eventCall[1][1]).toBe('task_123'); // target_id
      expect(JSON.parse(eventCall[1][2] as string)).toMatchObject({
        field: 'name',
        old_value: 'Old Name',
        new_value: 'New Name',
      });
    });

    it('should update tasks table when flushing TASK_UPDATED events', async () => {
      mockDb.execute.mockImplementation(async (query: string, bindings?: unknown[]) => {
        if (query === 'BEGIN TRANSACTION') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO events')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        if (query.includes('UPDATE tasks')) {
          return { lastInsertId: 0, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      persistenceService.queueEvent('TASK_UPDATED', 'task_123', {
        field: 'duration',
        old_value: 5,
        new_value: 10,
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify tasks table was updated
      const updateCalls = mockDb.execute.mock.calls.filter(call =>
        call[0].includes('UPDATE tasks')
      );
      expect(updateCalls.length).toBeGreaterThan(0);

      const updateCall = updateCalls[0];
      expect(updateCall[0]).toContain('duration');
      expect(updateCall[1][0]).toBe(10); // new_value
      expect(updateCall[1][1]).toBe('task_123'); // task id
    });

    it('should ignore calculated fields in TASK_UPDATED events', async () => {
      mockDb.execute.mockImplementation(async (query: string) => {
        if (query === 'BEGIN TRANSACTION' || query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO events')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      // Try to update a calculated field (should be ignored)
      persistenceService.queueEvent('TASK_UPDATED', 'task_123', {
        field: 'start', // Calculated field - should be ignored
        old_value: '2024-01-01',
        new_value: '2024-01-02',
      });

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify tasks table was NOT updated (only events table)
      const updateCalls = mockDb.execute.mock.calls.filter(call =>
        call[0].includes('UPDATE tasks')
      );
      expect(updateCalls.length).toBe(0);
    });
  });

  describe('Flush Now', () => {
    beforeEach(async () => {
      mockDb.execute.mockImplementation(async (query: string) => {
        if (query.includes('CREATE TABLE')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('CREATE INDEX')) {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT OR IGNORE')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 1, rowsAffected: 1 };
      });

      await persistenceService.init();
      mockDb.execute.mockClear();
    });

    it('should flush all pending events immediately', async () => {
      mockDb.execute.mockImplementation(async (query: string) => {
        if (query === 'BEGIN TRANSACTION') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO events')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        if (query.includes('UPDATE tasks')) {
          return { lastInsertId: 0, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      // Queue multiple events
      for (let i = 0; i < 5; i++) {
        persistenceService.queueEvent('TASK_UPDATED', `task_${i}`, {
          field: 'duration',
          old_value: 5,
          new_value: 10,
        });
      }

      expect(persistenceService.getQueueSize()).toBe(5);

      // Force flush
      await persistenceService.flushNow();

      // Verify all events were flushed
      expect(persistenceService.getQueueSize()).toBe(0);

      // Verify events were persisted
      const eventInserts = mockDb.execute.mock.calls.filter(call =>
        call[0].includes('INSERT INTO events')
      );
      expect(eventInserts.length).toBe(5);
    });
  });
});

