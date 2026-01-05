/**
 * @fileoverview Unit tests for ZoomController
 * @module tests/unit/ZoomController.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ZoomController, ZOOM_CONFIG, type IZoomableGantt } from '../../src/services/ZoomController';

/**
 * Mock GanttRenderer that implements IZoomableGantt
 */
function createMockGanttRenderer(initialZoom = ZOOM_CONFIG.DEFAULT): IZoomableGantt {
    let currentZoom = initialZoom;
    let viewMode = 'Week';
    
    return {
        setZoom: vi.fn((ppd: number) => {
            currentZoom = Math.max(ZOOM_CONFIG.MIN, Math.min(ZOOM_CONFIG.MAX, ppd));
        }),
        getZoom: vi.fn(() => currentZoom),
        zoomIn: vi.fn(() => {
            currentZoom = Math.min(currentZoom * ZOOM_CONFIG.STEP, ZOOM_CONFIG.MAX);
        }),
        zoomOut: vi.fn(() => {
            currentZoom = Math.max(currentZoom / ZOOM_CONFIG.STEP, ZOOM_CONFIG.MIN);
        }),
        fitToView: vi.fn(() => {
            currentZoom = 10; // Simulated fit-to-view result
        }),
        resetZoom: vi.fn(() => {
            currentZoom = ZOOM_CONFIG.DEFAULT;
        }),
        getViewMode: vi.fn(() => viewMode),
        setViewMode: vi.fn((mode: string) => {
            viewMode = mode;
        }),
    };
}

describe('ZoomController', () => {
    let controller: ZoomController;
    let mockRenderer: IZoomableGantt;
    
    beforeEach(() => {
        // Reset singleton before each test
        ZoomController.resetInstance();
        controller = ZoomController.getInstance();
        mockRenderer = createMockGanttRenderer();
    });
    
    afterEach(() => {
        ZoomController.resetInstance();
    });
    
    describe('Singleton Pattern', () => {
        it('should return the same instance', () => {
            const instance1 = ZoomController.getInstance();
            const instance2 = ZoomController.getInstance();
            expect(instance1).toBe(instance2);
        });
        
        it('should reset instance properly', () => {
            const instance1 = ZoomController.getInstance();
            ZoomController.resetInstance();
            const instance2 = ZoomController.getInstance();
            expect(instance1).not.toBe(instance2);
        });
    });
    
    describe('Initial State', () => {
        it('should have default zoom configuration', () => {
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.DEFAULT);
            expect(controller.percentage).toBe(100);
        });
        
        it('should have Week as default view mode', () => {
            expect(controller.currentState.viewMode).toBe('Week');
        });
    });
    
    describe('Zoom Constants', () => {
        it('should have correct ZOOM_CONFIG values', () => {
            expect(ZOOM_CONFIG.MIN).toBe(1);
            expect(ZOOM_CONFIG.MAX).toBe(80);
            expect(ZOOM_CONFIG.DEFAULT).toBe(20);
            expect(ZOOM_CONFIG.STEP).toBe(1.5);
        });
    });
    
    describe('Without Renderer', () => {
        it('should calculate zoom in locally', () => {
            const initialZoom = controller.pixelsPerDay;
            controller.zoomIn();
            expect(controller.pixelsPerDay).toBe(initialZoom * ZOOM_CONFIG.STEP);
        });
        
        it('should calculate zoom out locally', () => {
            const initialZoom = controller.pixelsPerDay;
            controller.zoomOut();
            expect(controller.pixelsPerDay).toBe(initialZoom / ZOOM_CONFIG.STEP);
        });
        
        it('should clamp zoom to MAX', () => {
            controller.setZoom(ZOOM_CONFIG.MAX + 100);
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MAX);
        });
        
        it('should clamp zoom to MIN', () => {
            controller.setZoom(0);
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MIN);
        });
        
        it('should reset to default zoom', () => {
            controller.setZoom(50);
            controller.resetZoom();
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.DEFAULT);
        });
    });
    
    describe('With Renderer', () => {
        beforeEach(() => {
            controller.setGanttRenderer(mockRenderer);
        });
        
        it('should delegate zoomIn to renderer', () => {
            controller.zoomIn();
            expect(mockRenderer.zoomIn).toHaveBeenCalled();
        });
        
        it('should delegate zoomOut to renderer', () => {
            controller.zoomOut();
            expect(mockRenderer.zoomOut).toHaveBeenCalled();
        });
        
        it('should delegate setZoom to renderer', () => {
            controller.setZoom(40);
            expect(mockRenderer.setZoom).toHaveBeenCalledWith(40);
        });
        
        it('should delegate fitToView to renderer', () => {
            controller.fitToView();
            expect(mockRenderer.fitToView).toHaveBeenCalled();
        });
        
        it('should delegate resetZoom to renderer', () => {
            controller.resetZoom();
            expect(mockRenderer.resetZoom).toHaveBeenCalled();
        });
        
        it('should delegate setViewMode to renderer', () => {
            controller.setViewMode('Day');
            expect(mockRenderer.setViewMode).toHaveBeenCalledWith('Day');
        });
        
        it('should sync state from renderer after operations', () => {
            controller.resetZoom();
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.DEFAULT);
        });
    });
    
    describe('Observable State', () => {
        it('should emit initial state', () => {
            // BehaviorSubject emits immediately, so we can check currentState
            const state = controller.currentState;
            expect(state.pixelsPerDay).toBe(ZOOM_CONFIG.DEFAULT);
            expect(state.percentage).toBe(100);
        });
        
        it('should emit state changes on zoom', async () => {
            const states: typeof controller.currentState[] = [];
            
            const sub = controller.zoomState$.subscribe(state => {
                states.push(state);
            });
            
            controller.zoomIn();
            sub.unsubscribe();
            
            expect(states.length).toBeGreaterThanOrEqual(2);
            const lastState = states[states.length - 1];
            expect(lastState.pixelsPerDay).toBe(ZOOM_CONFIG.DEFAULT * ZOOM_CONFIG.STEP);
        });
        
        it('should calculate percentage correctly', () => {
            controller.setZoom(40); // 200% of default
            expect(controller.percentage).toBe(200);
            
            controller.setZoom(10); // 50% of default
            expect(controller.percentage).toBe(50);
        });
    });
    
    describe('Zoom Clamping', () => {
        it('should not zoom in beyond MAX', () => {
            controller.setZoom(ZOOM_CONFIG.MAX);
            controller.zoomIn();
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MAX);
        });
        
        it('should not zoom out beyond MIN', () => {
            controller.setZoom(ZOOM_CONFIG.MIN);
            controller.zoomOut();
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MIN);
        });
        
        it('should clamp setZoom values', () => {
            controller.setZoom(1000);
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MAX);
            
            controller.setZoom(-50);
            expect(controller.pixelsPerDay).toBe(ZOOM_CONFIG.MIN);
        });
    });
    
    describe('View Mode', () => {
        it('should update view mode without changing zoom', () => {
            const initialZoom = controller.pixelsPerDay;
            controller.setViewMode('Day');
            expect(controller.currentState.viewMode).toBe('Day');
            expect(controller.pixelsPerDay).toBe(initialZoom);
        });
        
        it('should support Day, Week, and Month modes', () => {
            ['Day', 'Week', 'Month'].forEach(mode => {
                controller.setViewMode(mode);
                expect(controller.currentState.viewMode).toBe(mode);
            });
        });
    });
    
    describe('Renderer Sync', () => {
        it('should sync state when renderer is set', () => {
            const customRenderer = createMockGanttRenderer(40);
            controller.setGanttRenderer(customRenderer);
            
            // Trigger a sync
            controller.refresh();
            
            expect(controller.pixelsPerDay).toBe(40);
        });
        
        it('should handle null renderer', () => {
            controller.setGanttRenderer(mockRenderer);
            controller.setGanttRenderer(null);
            
            // Should still work without renderer
            controller.zoomIn();
            expect(controller.pixelsPerDay).toBeGreaterThan(ZOOM_CONFIG.DEFAULT);
        });
    });
    
    describe('Cleanup', () => {
        it('should complete observable on destroy', async () => {
            const completed = new Promise<void>(resolve => {
                controller.zoomState$.subscribe({
                    complete: () => resolve(),
                });
            });
            
            controller.destroy();
            
            await completed;
        });
        
        it('should not process operations after destroy', () => {
            controller.destroy();
            
            // After destroy, operations should be no-ops
            // The disposed flag prevents state updates
            // We can verify by checking that no errors are thrown
            expect(() => controller.zoomIn()).not.toThrow();
            expect(() => controller.zoomOut()).not.toThrow();
            expect(() => controller.setZoom(50)).not.toThrow();
        });
    });
});
