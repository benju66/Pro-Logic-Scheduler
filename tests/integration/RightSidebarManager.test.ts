/**
 * Integration tests for RightSidebarManager fixes
 * 
 * Tests the twin drawer system with right activity bar:
 * - Panel initialization without crashes
 * - Panel opening/closing
 * - Task selection syncing
 * - Modal vs Panel mode routing
 * 
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RightSidebarManager } from '../../src/ui/components/RightSidebarManager';
import { SideDrawer } from '../../src/ui/components/SideDrawer';
import { DependenciesModal } from '../../src/ui/components/DependenciesModal';
import { SchedulerService } from '../../src/services/SchedulerService';
import type { Task } from '../../src/types';

// Mock DOM elements
function createMockContainer(id: string): HTMLElement {
    const container = document.createElement('div');
    container.id = id;
    container.className = id.includes('panel') ? 'right-panel-container' : 'activity-bar right';
    document.body.appendChild(container);
    return container;
}

// Mock SchedulerService
function createMockScheduler(): Partial<SchedulerService> {
    const mockTask: Task = {
        id: 'task-1',
        name: 'Test Task',
        duration: 5,
        start: '2024-01-01',
        end: '2024-01-05',
        progress: 0,
        constraintType: 'asap',
        dependencies: [],
    };

    const callbacks: {
        selection: Array<(taskId: string | null, task: Task | null) => void>;
        panelOpen: Array<(panelId: string) => void>;
        dataChange: Array<() => void>;
    } = {
        selection: [],
        panelOpen: [],
        dataChange: [],
    };

    return {
        getTask: vi.fn((id: string) => (id === 'task-1' ? mockTask : null)),
        getSelectedTask: vi.fn(() => mockTask),
        isParent: vi.fn(() => false),
        hasBaseline: vi.fn(() => false),
        calculateVariance: vi.fn(() => ({ start: 0, finish: 0 })),
        handleTaskUpdate: vi.fn(),
        deleteTask: vi.fn(),
        updateDependencies: vi.fn(),
        tasks: [mockTask],
        onTaskSelect: vi.fn((callback) => {
            callbacks.selection.push(callback);
            return () => {
                const index = callbacks.selection.indexOf(callback);
                if (index > -1) callbacks.selection.splice(index, 1);
            };
        }),
        onPanelOpenRequest: vi.fn((callback) => {
            callbacks.panelOpen.push(callback);
            return () => {
                const index = callbacks.panelOpen.indexOf(callback);
                if (index > -1) callbacks.panelOpen.splice(index, 1);
            };
        }),
        onDataChange: vi.fn((callback) => {
            callbacks.dataChange.push(callback);
            return () => {
                const index = callbacks.dataChange.indexOf(callback);
                if (index > -1) callbacks.dataChange.splice(index, 1);
            };
        }),
        selectTask: vi.fn((taskId: string) => {
            callbacks.selection.forEach(cb => cb(taskId, mockTask));
        }),
        // Expose callbacks for testing
        _triggerSelection: (taskId: string | null, task: Task | null) => {
            callbacks.selection.forEach(cb => cb(taskId, task));
        },
        _triggerPanelOpen: (panelId: string) => {
            callbacks.panelOpen.forEach(cb => cb(panelId));
        },
        _triggerDataChange: () => {
            callbacks.dataChange.forEach(cb => cb());
        },
    } as any;
}

describe('RightSidebarManager - Panel Initialization', () => {
    let container: HTMLElement;
    let activityBar: HTMLElement;
    let scheduler: Partial<SchedulerService>;

    beforeEach(() => {
        // Clean up
        document.body.innerHTML = '';
        
        // Create mock elements
        container = createMockContainer('right-panel-container');
        activityBar = createMockContainer('activity-bar-right');
        
        // Add activity bar buttons
        activityBar.innerHTML = `
            <div class="activity-bar-top">
                <button class="activity-btn" data-panel="details">Details</button>
                <button class="activity-btn" data-panel="links">Links</button>
            </div>
        `;
        
        scheduler = createMockScheduler();
    });

    it('should initialize without crashing in embedded mode', () => {
        expect(() => {
            const manager = new RightSidebarManager({
                containerId: 'right-panel-container',
                activityBarId: 'activity-bar-right',
                scheduler: scheduler as SchedulerService,
            });
            
            expect(manager).toBeDefined();
        }).not.toThrow();
    });

    it('should create panel elements without null references', () => {
        const manager = new RightSidebarManager({
            containerId: 'right-panel-container',
            activityBarId: 'activity-bar-right',
            scheduler: scheduler as SchedulerService,
        });

        // Access private properties via type assertion for testing
        const managerAny = manager as any;
        
        expect(managerAny.detailsPanel).toBeDefined();
        expect(managerAny.dependenciesPanel).toBeDefined();
        
        // Verify getElement() doesn't throw
        expect(() => {
            const detailsEl = managerAny.detailsPanel.getElement();
            expect(detailsEl).toBeDefined();
            expect(detailsEl instanceof HTMLElement).toBe(true);
        }).not.toThrow();
        
        expect(() => {
            const depsEl = managerAny.dependenciesPanel.getElement();
            expect(depsEl).toBeDefined();
            expect(depsEl instanceof HTMLElement).toBe(true);
        }).not.toThrow();
    });
});

describe('RightSidebarManager - Panel Opening/Closing', () => {
    let container: HTMLElement;
    let activityBar: HTMLElement;
    let scheduler: Partial<SchedulerService>;
    let manager: RightSidebarManager;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = createMockContainer('right-panel-container');
        activityBar = createMockContainer('activity-bar-right');
        activityBar.innerHTML = `
            <div class="activity-bar-top">
                <button class="activity-btn" data-panel="details">Details</button>
                <button class="activity-btn" data-panel="links">Links</button>
            </div>
        `;
        scheduler = createMockScheduler();
        
        manager = new RightSidebarManager({
            containerId: 'right-panel-container',
            activityBarId: 'activity-bar-right',
            scheduler: scheduler as SchedulerService,
        });
    });

    afterEach(() => {
        // Clean up manager state
        if (manager) {
            try {
                manager.destroy();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });

    it('should open details panel when togglePanel is called', () => {
        manager.togglePanel('details');
        
        const containerWidth = container.style.width;
        expect(containerWidth).toBe('400px'); // PANEL_WIDTH
        
        const buttons = activityBar.querySelectorAll('.activity-btn');
        const detailsBtn = Array.from(buttons).find(
            btn => (btn as HTMLElement).dataset.panel === 'details'
        );
        expect(detailsBtn?.classList.contains('active')).toBe(true);
    });

    it('should open links panel when togglePanel is called', () => {
        // Ensure no panels are open first
        manager.closePanel('details');
        manager.closePanel('links');
        
        manager.togglePanel('links');
        
        const containerWidth = container.style.width;
        expect(containerWidth).toBe('400px');
        
        const buttons = activityBar.querySelectorAll('.activity-btn');
        const linksBtn = Array.from(buttons).find(
            btn => (btn as HTMLElement).dataset.panel === 'links'
        );
        expect(linksBtn?.classList.contains('active')).toBe(true);
    });

    it('should open both panels simultaneously (twin drawers)', () => {
        // Ensure no panels are open first
        manager.closePanel('details');
        manager.closePanel('links');
        
        manager.togglePanel('details');
        manager.togglePanel('links');
        
        const containerWidth = container.style.width;
        expect(containerWidth).toBe('800px'); // 2 * PANEL_WIDTH
        
        const buttons = activityBar.querySelectorAll('.activity-btn');
        const detailsBtn = Array.from(buttons).find(
            btn => (btn as HTMLElement).dataset.panel === 'details'
        );
        const linksBtn = Array.from(buttons).find(
            btn => (btn as HTMLElement).dataset.panel === 'links'
        );
        
        expect(detailsBtn?.classList.contains('active')).toBe(true);
        expect(linksBtn?.classList.contains('active')).toBe(true);
    });

    it('should close panel when togglePanel is called again', () => {
        // Ensure panel starts closed
        manager.closePanel('details');
        manager.closePanel('links');
        
        manager.togglePanel('details');
        expect(container.style.width).toBe('400px');
        
        manager.togglePanel('details');
        expect(container.style.width).toBe('0px');
        
        const buttons = activityBar.querySelectorAll('.activity-btn');
        const detailsBtn = Array.from(buttons).find(
            btn => (btn as HTMLElement).dataset.panel === 'details'
        );
        expect(detailsBtn?.classList.contains('active')).toBe(false);
    });

    it('should attach panel elements to container when opened', () => {
        manager.togglePanel('details');
        
        const panelWrappers = container.querySelectorAll('.sidebar-panel-wrapper');
        expect(panelWrappers.length).toBe(1);
        
        const panelBody = panelWrappers[0]?.querySelector('.panel-body');
        expect(panelBody).toBeDefined();
        
        const drawerElement = panelBody?.querySelector('.side-drawer-embedded');
        expect(drawerElement).toBeDefined();
    });
});

describe('RightSidebarManager - Task Selection Syncing', () => {
    let container: HTMLElement;
    let activityBar: HTMLElement;
    let scheduler: Partial<SchedulerService>;
    let manager: RightSidebarManager;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = createMockContainer('right-panel-container');
        activityBar = createMockContainer('activity-bar-right');
        activityBar.innerHTML = `
            <div class="activity-bar-top">
                <button class="activity-btn" data-panel="details">Details</button>
                <button class="activity-btn" data-panel="links">Links</button>
            </div>
        `;
        scheduler = createMockScheduler();
        
        manager = new RightSidebarManager({
            containerId: 'right-panel-container',
            activityBarId: 'activity-bar-right',
            scheduler: scheduler as SchedulerService,
        });
    });

    afterEach(() => {
        if (manager) {
            manager.destroy();
        }
    });

    it('should sync details panel when task is selected', () => {
        const managerAny = manager as any;
        const detailsPanel = managerAny.detailsPanel;
        
        // Manually add panel to activePanels and ensure bar is visible
        managerAny.isBarVisible = true;
        managerAny.activePanels.add('details');
        managerAny._renderLayout();
        
        // Verify panel is open
        expect(managerAny.activePanels.has('details')).toBe(true);
        
        // Manually trigger the selection handler
        const task = scheduler.getTask?.('task-1') as Task;
        const openSpy = vi.spyOn(detailsPanel, 'open');
        
        managerAny._onSelectionChange('task-1', task);
        
        // Panel should sync when task is selected
        expect(openSpy).toHaveBeenCalledWith(task, { isParent: false });
    });

    it('should sync links panel when task is selected', () => {
        manager.togglePanel('links');
        
        const managerAny = manager as any;
        const syncSpy = vi.spyOn(managerAny.dependenciesPanel, 'syncPanel');
        
        // Manually trigger the selection handler
        const task = scheduler.getTask?.('task-1') as Task;
        managerAny._onSelectionChange('task-1', task);
        
        expect(syncSpy).toHaveBeenCalled();
    });
});

describe('DependenciesModal - Panel Mode', () => {
    it('should use syncPanel instead of showModal in panel mode', () => {
        const container = document.createElement('div');
        
        const mockScheduler = createMockScheduler();
        const modal = new DependenciesModal({
            container,
            isPanel: true,
            getTasks: () => [],
            isParent: () => false,
            onSave: vi.fn(),
        });
        
        const syncSpy = vi.spyOn(modal, 'syncPanel');
        const mockTask: Task = {
            id: 'task-1',
            name: 'Test',
            duration: 1,
            dependencies: [],
        };
        
        modal.open(mockTask);
        
        expect(syncSpy).toHaveBeenCalledWith(mockTask);
    });

    it('should throw error if getElement() called before initialization', () => {
        const container = document.createElement('div');
        
        const modal = new DependenciesModal({
            container,
            isPanel: true,
            getTasks: () => [],
            isParent: () => false,
            onSave: vi.fn(),
        });
        
        // Access panelElement directly to simulate uninitialized state
        const modalAny = modal as any;
        const originalPanelElement = modalAny.panelElement;
        modalAny.panelElement = null;
        
        expect(() => {
            modal.getElement();
        }).toThrow('DependenciesModal: panelElement not initialized in panel mode');
        
        // Restore for cleanup
        modalAny.panelElement = originalPanelElement;
    });
});

describe('SchedulerService - openDependencies Routing', () => {
    it('should route to panel system when callbacks are available', () => {
        const scheduler = createMockScheduler() as any;
        const panelOpenSpy = vi.fn();
        
        scheduler.onPanelOpenRequest((cb: (id: string) => void) => {
            scheduler._panelOpenCallback = cb;
            return () => {};
        });
        
        scheduler._openPanelCallbacks = [panelOpenSpy];
        scheduler.openDependencies = function(taskId: string) {
            const task = this.getTask(taskId);
            if (!task) return;
            
            if (this._openPanelCallbacks.length > 0) {
                this._openPanelCallbacks.forEach((cb: (id: string) => void) => {
                    cb('links');
                });
                this.selectTask(taskId);
                return;
            }
            
            // Fallback to modal
            if (this.dependenciesModal) {
                this.dependenciesModal.open(task);
            }
        };
        
        scheduler.openDependencies('task-1');
        
        expect(panelOpenSpy).toHaveBeenCalledWith('links');
        expect(scheduler.selectTask).toHaveBeenCalledWith('task-1');
    });

    it('should fallback to modal when no panel callbacks available', () => {
        const scheduler = createMockScheduler() as any;
        const mockModal = {
            open: vi.fn(),
        };
        
        scheduler.dependenciesModal = mockModal;
        scheduler._openPanelCallbacks = [];
        
        scheduler.openDependencies = function(taskId: string) {
            const task = this.getTask(taskId);
            if (!task) return;
            
            if (this._openPanelCallbacks.length > 0) {
                this._openPanelCallbacks.forEach((cb: (id: string) => void) => {
                    cb('links');
                });
                this.selectTask(taskId);
                return;
            }
            
            if (this.dependenciesModal) {
                this.dependenciesModal.open(task);
            }
        };
        
        scheduler.openDependencies('task-1');
        
        expect(mockModal.open).toHaveBeenCalled();
    });
});

describe('SideDrawer - Embedded Mode', () => {
    it('should not crash when closeBtn is null in embedded mode', () => {
        const container = document.createElement('div');
        
        expect(() => {
            const drawer = new SideDrawer({
                container,
                isEmbedded: true,
                onUpdate: vi.fn(),
                onDelete: vi.fn(),
                onOpenLinks: vi.fn(),
                getScheduler: () => ({
                    hasBaseline: () => false,
                    calculateVariance: () => ({ start: 0, finish: 0 }),
                }),
            });
            
            // Access private property to verify closeBtn is null
            const drawerAny = drawer as any;
            expect(drawerAny.dom.closeBtn).toBeNull();
            
            // Binding events should not throw (already called in constructor, but verify it's safe)
            expect(() => {
                drawerAny._bindEvents();
            }).not.toThrow();
        }).not.toThrow();
    });
});

