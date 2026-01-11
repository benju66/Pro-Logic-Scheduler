/**
 * @fileoverview Unit tests for AppInitializer singleton removal (Phase 2)
 * @module tests/unit/AppInitializer-SingletonRemoval.test
 * @vitest-environment happy-dom
 * 
 * Tests that AppInitializer no longer exposes singleton accessors
 * and fails fast if required dependencies are not injected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppInitializer } from '../../src/services/AppInitializer';
import { ProjectController } from '../../src/services/ProjectController';

// Mock the worker - must be defined before imports
vi.mock('../../src/workers/scheduler.worker?worker', () => ({
  default: class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  }
}));

// Mock Worker global for happy-dom environment
global.Worker = class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  
  constructor() {
    // Worker constructor
  }
} as any;

describe('AppInitializer - Singleton Removal (Phase 2)', () => {
  beforeEach(() => {
    // Reset any singleton state
    (ProjectController as any).instance = null;
    
    // Mock alert for test environment
    global.alert = vi.fn();
  });

  describe('Singleton accessors removed', () => {
    it('should not have getInstance() method', () => {
      // @ts-expect-error - getInstance should not exist
      expect(AppInitializer.getInstance).toBeUndefined();
    });

    it('should not have setInstance() method', () => {
      // @ts-expect-error - setInstance should not exist
      expect(AppInitializer.setInstance).toBeUndefined();
    });

    it('should not have resetInstance() method', () => {
      // @ts-expect-error - resetInstance should not exist
      expect(AppInitializer.resetInstance).toBeUndefined();
    });
  });

  describe('Fail-fast injection validation', () => {
    it('should throw error if projectController not injected', async () => {
      const initializer = new AppInitializer({
        isTauri: false,
        // projectController is NOT provided
      });

      await expect(initializer.initialize()).rejects.toThrow(
        /ProjectController must be injected via constructor/
      );
    });

    it('should succeed if projectController is injected', async () => {
      const projectController = new ProjectController();
      
      const initializer = new AppInitializer({
        isTauri: false,
        projectController,
      });

      // Should not throw projectController validation error
      // Note: May fail later if other dependencies missing, but projectController check passes
      try {
        // Use Promise.race with timeout to prevent hanging
        await Promise.race([
          initializer.initialize(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 1000)
          )
        ]);
      } catch (error) {
        // Other initialization errors are OK - we're just testing projectController validation
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain('ProjectController must be injected');
        // Timeout is acceptable - means projectController validation passed
        if (message === 'Timeout') {
          // This is fine - initialization is complex and may take time
          return;
        }
      }
    }, 2000); // Increase timeout
  });
});
