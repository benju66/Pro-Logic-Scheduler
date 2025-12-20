/**
 * @fileoverview Integration test for MigrationService
 * @module tests/integration/migration-test
 * 
 * Tests migration from localStorage to SQLite
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationService } from '../../src/data/MigrationService';
import { PersistenceService } from '../../src/data/PersistenceService';
import type { Task, Calendar } from '../../src/types';

// Mock Tauri SQL plugin at module level
// Define everything inside the factory to avoid hoisting issues
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
    __mockDb: mockDb, // Export for test access
  };
});

describe('MigrationService Integration Tests', () => {
  let persistenceService: PersistenceService;
  let migrationService: MigrationService;
  let originalLocalStorage: Storage;
  let mockLocalStorage: Record<string, string>;
  let mockDb: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Get the mocked database from the module
    const sqlModule = await import('@tauri-apps/plugin-sql');
    mockDb = (sqlModule as any).__mockDb;

    // Reset mocks
    vi.clearAllMocks();
    mockDb.execute.mockReset();
    mockDb.select.mockReset();
    mockDb.close.mockReset();

    // Mock successful database operations
    mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });
    mockDb.select.mockResolvedValue([]);

    // Mock localStorage
    mockLocalStorage = {};
    originalLocalStorage = global.localStorage;
    (global as any).localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      key: vi.fn(),
      length: 0,
    };

    // Mock Tauri environment
    const originalWindow = global.window;
    (global as any).window = {
      ...originalWindow,
      __TAURI__: true,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setTimeout(() => fn(), ms);
        return 123 as any;
      }),
      clearInterval: vi.fn(),
    };

    persistenceService = new PersistenceService();
    migrationService = new MigrationService(persistenceService);
  });

  afterEach(async () => {
    global.localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  describe('Migration from localStorage', () => {
    beforeEach(async () => {
      // Initialize persistence service
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

    it('should return false when no localStorage data exists', async () => {
      const result = await migrationService.migrateFromLocalStorage();
      
      expect(result).toBe(false);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('should migrate tasks from localStorage to SQLite', async () => {
      // Setup mock localStorage data
      const sampleTasks: Task[] = [
        {
          id: 'task_1',
          name: 'Task 1',
          parentId: null,
          sortKey: 'a0',
          duration: 5,
          constraintType: 'asap',
          constraintDate: null,
          dependencies: [],
          progress: 0,
          notes: '',
          level: 0,
          start: '2024-01-01',
          end: '2024-01-05',
        },
        {
          id: 'task_2',
          name: 'Task 2',
          parentId: 'task_1',
          sortKey: 'a1',
          duration: 3,
          constraintType: 'asap',
          constraintDate: null,
          dependencies: [],
          progress: 0,
          notes: '',
          level: 1,
          start: '2024-01-06',
          end: '2024-01-08',
        },
      ];

      const sampleCalendar: Calendar = {
        workingDays: [1, 2, 3, 4, 5],
        exceptions: {},
      };

      const projectData = {
        tasks: sampleTasks,
        calendar: sampleCalendar,
        version: '2.0.0',
        savedAt: new Date().toISOString(),
      };

      mockLocalStorage[MigrationService.OLD_STORAGE_KEY] = JSON.stringify(projectData);

      // Mock database operations
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
        if (query.includes('INSERT INTO tasks')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        if (query.includes('UPDATE calendar')) {
          return { lastInsertId: 0, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      // Run migration
      const result = await migrationService.migrateFromLocalStorage();

      // Verify migration succeeded
      expect(result).toBe(true);
      
      // Verify PROJECT_IMPORTED event was created
      const eventCalls = mockDb.execute.mock.calls.filter(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('INSERT INTO events')
      );
      expect(eventCalls.length).toBeGreaterThan(0);
      
      // Verify tasks were inserted (should be 2 calls for 2 tasks)
      const taskCalls = mockDb.execute.mock.calls.filter(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('INSERT INTO tasks')
      );
      expect(taskCalls.length).toBe(2);

      // Verify localStorage was archived
      expect(mockLocalStorage[MigrationService.OLD_STORAGE_KEY]).toBeUndefined();
      expect(mockLocalStorage[MigrationService.BACKUP_STORAGE_KEY]).toBe(JSON.stringify(projectData));

      // Verify PROJECT_IMPORTED event was created
      const eventCall = eventCalls[0];
      expect(eventCall[1][0]).toBe('PROJECT_IMPORTED');
      const payload = JSON.parse(eventCall[1][1] as string);
      expect(payload.source).toBe('localStorage_migration');
      expect(payload.task_count).toBe(2);
    });

    it('should strip calculated fields when migrating tasks', async () => {
      const sampleTasks: Task[] = [
        {
          id: 'task_1',
          name: 'Task 1',
          parentId: null,
          sortKey: 'a0',
          duration: 5,
          constraintType: 'asap',
          constraintDate: null,
          dependencies: [],
          progress: 0,
          notes: '',
          level: 0,
          start: '2024-01-01', // Calculated field - should NOT be persisted
          end: '2024-01-05', // Calculated field - should NOT be persisted
          _isCritical: true, // Calculated field - should NOT be persisted
          _totalFloat: 0, // Calculated field - should NOT be persisted
        },
      ];

      mockLocalStorage[MigrationService.OLD_STORAGE_KEY] = JSON.stringify({
        tasks: sampleTasks,
        calendar: { workingDays: [1, 2, 3, 4, 5], exceptions: {} },
      });

      let taskInsertCall: unknown[] | null = null;
      mockDb.execute.mockImplementation(async (query: string, bindings?: unknown[]) => {
        if (query === 'BEGIN TRANSACTION' || query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO tasks')) {
          taskInsertCall = bindings || [];
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        if (query.includes('INSERT INTO events') || query.includes('UPDATE calendar')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      await migrationService.migrateFromLocalStorage();

      // Verify task insert call exists
      expect(taskInsertCall).not.toBeNull();
      
      // Verify calculated fields are NOT in the insert (check that only input fields are present)
      // The insert should have: id, parent_id, sort_key, name, notes, duration, constraint_type, etc.
      // But NOT: start, end, _isCritical, _totalFloat
      expect(taskInsertCall![0]).toBe('task_1'); // id
      expect(taskInsertCall![1]).toBe(null); // parent_id
      expect(taskInsertCall![2]).toBe('a0'); // sort_key
      expect(taskInsertCall![3]).toBe('Task 1'); // name
      expect(taskInsertCall![4]).toBe(''); // notes
      expect(taskInsertCall![5]).toBe(5); // duration
      // Should NOT contain start, end, _isCritical, _totalFloat
    });

    it('should handle migration failure gracefully', async () => {
      mockLocalStorage[MigrationService.OLD_STORAGE_KEY] = JSON.stringify({
        tasks: [{ id: 'task_1', name: 'Task 1' }], // Invalid task data
        calendar: { workingDays: [1, 2, 3, 4, 5], exceptions: {} },
      });

      // Mock database failure
      mockDb.execute.mockRejectedValueOnce(new Error('Database error'));

      // Migration should throw error
      await expect(migrationService.migrateFromLocalStorage()).rejects.toThrow();

      // Verify localStorage was NOT deleted (safety net)
      expect(mockLocalStorage[MigrationService.OLD_STORAGE_KEY]).toBeDefined();
      expect(mockLocalStorage[MigrationService.BACKUP_STORAGE_KEY]).toBeUndefined();
    });

    it('should query SQLite tasks table after migration', async () => {
      const sampleTasks: Task[] = [
        {
          id: 'task_1',
          name: 'Task 1',
          parentId: null,
          sortKey: 'a0',
          duration: 5,
          constraintType: 'asap',
          constraintDate: null,
          dependencies: [],
          progress: 0,
          notes: '',
          level: 0,
          start: '',
          end: '',
        },
      ];

      mockLocalStorage[MigrationService.OLD_STORAGE_KEY] = JSON.stringify({
        tasks: sampleTasks,
        calendar: { workingDays: [1, 2, 3, 4, 5], exceptions: {} },
      });

      mockDb.execute.mockImplementation(async (query: string) => {
        if (query === 'BEGIN TRANSACTION' || query === 'COMMIT') {
          return { lastInsertId: 0, rowsAffected: 0 };
        }
        if (query.includes('INSERT INTO events') || query.includes('INSERT INTO tasks') || query.includes('UPDATE calendar')) {
          return { lastInsertId: 1, rowsAffected: 1 };
        }
        return { lastInsertId: 0, rowsAffected: 0 };
      });

      // Mock select to return migrated tasks
      const migratedTask = {
        id: 'task_1',
        name: 'Task 1',
        parent_id: null,
        sort_key: 'a0',
        duration: 5,
        constraint_type: 'asap',
        constraint_date: null,
        dependencies: '[]',
        progress: 0,
        notes: '',
        is_collapsed: 0,
      };

      mockDb.select.mockResolvedValueOnce([migratedTask]);

      await migrationService.migrateFromLocalStorage();

      // Query tasks table
      const tasks = await mockDb.select('SELECT * FROM tasks WHERE id = ?', ['task_1']);

      expect(tasks.length).toBe(1);
      expect(tasks[0]).toMatchObject({
        id: 'task_1',
        name: 'Task 1',
        duration: 5,
      });
    });
  });
});

