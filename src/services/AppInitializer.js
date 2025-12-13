// @ts-check
/**
 * @fileoverview App Initializer - Handles application startup and initialization
 * @module services/AppInitializer
 * 
 * Manages the initialization sequence for the application.
 */

import { SchedulerService } from './SchedulerService.js';
import { StatsService } from './StatsService.js';

/**
 * App Initializer Service
 * Handles application initialization sequence
 * @class
 */
export class AppInitializer {
    /**
     * Create a new AppInitializer instance
     * @param {Object} options - Configuration
     * @param {boolean} options.isTauri - Whether running in Tauri environment
     */
    constructor(options = {}) {
        this.isTauri = options.isTauri || false;
        this.scheduler = null;
        this.statsService = null;
        this.isInitializing = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the application
     * @returns {Promise<SchedulerService>} The initialized scheduler instance
     */
    async initialize() {
        // Prevent double initialization
        if (this.isInitializing || this.isInitialized) {
            console.log('⚠️ Already initializing or initialized, skipping duplicate init');
            return this.scheduler;
        }
        
        this.isInitializing = true;
        console.log('🏎️ Pro Logic Scheduler - VS Code of Scheduling Tools');
        console.log('==================================================');
        console.log(`Environment: ${this.isTauri ? 'Tauri Desktop' : 'Web Browser'}`);
        console.log('🦀 Tauri detected:', this.isTauri);
        console.log('📄 Document ready state:', document.readyState);
        
        try {
            // Setup Tauri APIs if needed
            if (this.isTauri) {
                await this._setupTauriAPIs();
                // Give Tauri a moment to fully initialize
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // Initialize scheduler
            await this._initializeScheduler();
            
            // Initialize UI handlers
            this._initializeUIHandlers();
            
            // Initialize stats service
            this._initializeStatsService();
            
            this.isInitialized = true;
            this.isInitializing = false;
            
            console.log('✅ Scheduler initialized');
            console.log('✅ window.scheduler available:', typeof window.scheduler);
            console.log('✅ Initial task count:', this.scheduler.tasks?.length || 0);
            console.log('✅ Grid initialized:', !!this.scheduler.grid);
            console.log('✅ Gantt initialized:', !!this.scheduler.gantt);
            
            return this.scheduler;
        } catch (error) {
            console.error('❌ Failed to initialize scheduler:', error);
            console.error('Error stack:', error.stack);
            this.isInitializing = false;
            this.scheduler = null;
            window.scheduler = null;
            alert('Failed to initialize scheduler. Check console for details.');
            throw error;
        }
    }

    /**
     * Setup Tauri APIs
     * @private
     */
    async _setupTauriAPIs() {
        console.log('🦀 Running in Tauri environment');
        
        // Import Tauri APIs when available
        try {
            const { open, save } = await import('@tauri-apps/api/dialog');
            window.tauriDialog = { open, save };
        } catch (e) {
            console.warn('Failed to load Tauri dialog API:', e);
        }
        
        try {
            const { readTextFile, writeTextFile } = await import('@tauri-apps/api/fs');
            window.tauriFs = { readTextFile, writeTextFile };
        } catch (e) {
            console.warn('Failed to load Tauri fs API:', e);
        }
    }

    /**
     * Initialize scheduler service
     * @private
     */
    async _initializeScheduler() {
        console.log('🚀 Starting scheduler initialization...');
        
        // Get containers
        const gridContainer = document.getElementById('grid-container');
        const ganttContainer = document.getElementById('gantt-container');
        const drawerContainer = document.getElementById('drawer-container');
        const modalContainer = document.getElementById('modal-container');
        
        if (!gridContainer || !ganttContainer) {
            throw new Error('Missing required containers!', {
                gridContainer: !!gridContainer,
                ganttContainer: !!ganttContainer
            });
        }
        
        // Initialize scheduler service
        console.log('🔧 Creating SchedulerService...');
        this.scheduler = new SchedulerService({
            gridContainer: gridContainer,
            ganttContainer: ganttContainer,
            drawerContainer: drawerContainer,
            modalContainer: modalContainer,
            isTauri: this.isTauri,
        });
        
        console.log('✅ SchedulerService created');
        console.log('  - grid:', !!this.scheduler.grid);
        console.log('  - gantt:', !!this.scheduler.gantt);
        
        // Verify scheduler initialized successfully
        console.log('🔍 Verifying scheduler components...');
        if (!this.scheduler || !this.scheduler.grid || !this.scheduler.gantt) {
            throw new Error('Scheduler initialization incomplete - components missing');
        }
        
        // Make scheduler available globally (for button handlers)
        window.scheduler = this.scheduler;
        console.log('✅ window.scheduler set');
        
        // Wait a moment for scheduler to fully initialize
        console.log('⏳ Waiting for scheduler to fully initialize...');
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('✅ Wait complete');
    }

    /**
     * Initialize UI handlers
     * @private
     * @param {Object} handlers - UI handler functions from main.js
     */
    _initializeUIHandlers(handlers = {}) {
        console.log('🔧 Setting up UI handlers...');
        
        // These will be extracted to UIEventManager in next step
        // For now, they're called from main.js after initialization
        // This method is kept for future refactoring
        
        console.log('  ✅ UI handlers will be initialized from main.js');
    }

    /**
     * Initialize stats service
     * @private
     */
    _initializeStatsService() {
        this.statsService = new StatsService({
            getScheduler: () => this.scheduler
        });
        this.statsService.start(500);
        window.statsService = this.statsService;
    }

    /**
     * Get the scheduler instance
     * @returns {SchedulerService|null} Scheduler instance
     */
    getScheduler() {
        return this.scheduler;
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.statsService) {
            this.statsService.destroy();
        }
        this.scheduler = null;
        window.scheduler = null;
    }
}

