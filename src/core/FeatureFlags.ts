/**
 * @fileoverview Feature Flags for Strangler Fig Migration
 * @module core/FeatureFlags
 * 
 * Enables incremental migration from SchedulerService to new architecture.
 * Each flag controls whether a specific feature uses the new service or legacy code.
 * 
 * Usage:
 *   if (FeatureFlags.get('USE_VIEW_COORDINATOR')) {
 *     viewCoordinator.render();
 *   } else {
 *     this._legacyRender();
 *   }
 * 
 * Migration Order:
 *   Phase 1: VIEW_COORDINATOR (fix UI blocking)
 *   Phase 2: SCHEDULING_LOGIC_SERVICE
 *   Phase 3: TASK_OPERATION_SERVICE
 *   Phase 4: UI_EVENT_COORDINATOR
 *   Phase 5: Remaining services
 */

/**
 * Feature flag definitions
 */
export interface FeatureFlagConfig {
    // Phase 1: Fix UI Blocking
    USE_VIEW_COORDINATOR: boolean;
    USE_REACTIVE_SUBSCRIPTIONS: boolean;
    
    // Phase 2: Core Logic
    USE_SCHEDULING_LOGIC_SERVICE: boolean;
    
    // Phase 3: Task Operations  
    USE_TASK_OPERATION_SERVICE: boolean;
    
    // Phase 4: UI Events
    USE_UI_EVENT_COORDINATOR: boolean;
    
    // Phase 5: Features
    USE_CLIPBOARD_SERVICE: boolean;
    USE_BASELINE_MANAGER: boolean;
    USE_COLUMN_MANAGER: boolean;
    USE_FILE_OPERATION_SERVICE: boolean;
    USE_TRADE_PARTNER_SERVICE: boolean;
    
    // Column Registry (Strangler Fig)
    USE_COLUMN_REGISTRY: boolean;
}

/**
 * Default flag values (all false = legacy behavior)
 */
const DEFAULT_FLAGS: FeatureFlagConfig = {
    USE_VIEW_COORDINATOR: false,
    USE_REACTIVE_SUBSCRIPTIONS: false,
    USE_SCHEDULING_LOGIC_SERVICE: false,
    USE_TASK_OPERATION_SERVICE: false,
    USE_UI_EVENT_COORDINATOR: false,
    USE_CLIPBOARD_SERVICE: false,
    USE_BASELINE_MANAGER: false,
    USE_COLUMN_MANAGER: false,
    USE_FILE_OPERATION_SERVICE: false,
    USE_TRADE_PARTNER_SERVICE: false,
    USE_COLUMN_REGISTRY: true, // ✅ ENABLED: New Column Registry is production-ready
};

/**
 * Feature Flags Service
 * 
 * Provides type-safe access to feature flags with persistence to localStorage.
 * 
 * MIGRATION NOTE (Pure DI):
 * - Constructor is now public for DI compatibility
 * - Static methods retained for backward compatibility
 * - Use setInstance() in Composition Root for testing
 * 
 * @see docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md
 */
export class FeatureFlags {
    private static instance: FeatureFlags | null = null;
    private flags: FeatureFlagConfig;
    
    private static readonly STORAGE_KEY = 'pro_scheduler_feature_flags';
    
    /**
     * Constructor is public for Pure DI compatibility.
     * Use getInstance() for singleton access or inject directly for testing.
     */
    public constructor() {
        this.flags = this.loadFlags();
    }
    
    /**
     * @deprecated Use constructor injection instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static getInstance(): FeatureFlags {
        if (!FeatureFlags.instance) {
            FeatureFlags.instance = new FeatureFlags();
        }
        return FeatureFlags.instance;
    }
    
    /**
     * @deprecated Use constructor injection with mocks instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static setInstance(instance: FeatureFlags): void {
        FeatureFlags.instance = instance;
    }
    
    /**
     * @deprecated Create fresh instances in tests instead.
     * @see docs/adr/001-dependency-injection.md
     * @internal
     */
    public static resetInstance(): void {
        FeatureFlags.instance = null;
    }
    
    /**
     * Get a feature flag value
     */
    public static get<K extends keyof FeatureFlagConfig>(flag: K): boolean {
        return FeatureFlags.getInstance().flags[flag];
    }
    
    /**
     * Set a feature flag value
     */
    public static set<K extends keyof FeatureFlagConfig>(flag: K, value: boolean): void {
        const instance = FeatureFlags.getInstance();
        instance.flags[flag] = value;
        instance.saveFlags();
        console.log(`[FeatureFlags] ${flag} = ${value}`);
    }
    
    /**
     * Enable a feature flag
     */
    public static enable<K extends keyof FeatureFlagConfig>(flag: K): void {
        FeatureFlags.set(flag, true);
    }
    
    /**
     * Disable a feature flag
     */
    public static disable<K extends keyof FeatureFlagConfig>(flag: K): void {
        FeatureFlags.set(flag, false);
    }
    
    /**
     * Toggle a feature flag
     */
    public static toggle<K extends keyof FeatureFlagConfig>(flag: K): boolean {
        const newValue = !FeatureFlags.get(flag);
        FeatureFlags.set(flag, newValue);
        return newValue;
    }
    
    /**
     * Get all flags
     */
    public static getAll(): FeatureFlagConfig {
        return { ...FeatureFlags.getInstance().flags };
    }
    
    /**
     * Reset all flags to defaults
     */
    public static reset(): void {
        const instance = FeatureFlags.getInstance();
        instance.flags = { ...DEFAULT_FLAGS };
        instance.saveFlags();
        console.log('[FeatureFlags] Reset to defaults');
    }
    
    /**
     * Enable all flags (for testing full new architecture)
     */
    public static enableAll(): void {
        const instance = FeatureFlags.getInstance();
        for (const key of Object.keys(DEFAULT_FLAGS) as Array<keyof FeatureFlagConfig>) {
            instance.flags[key] = true;
        }
        instance.saveFlags();
        console.log('[FeatureFlags] All flags enabled');
    }
    
    /**
     * Check if we're in "full legacy" mode (all flags off)
     */
    public static isLegacyMode(): boolean {
        const flags = FeatureFlags.getAll();
        return Object.values(flags).every(v => v === false);
    }
    
    /**
     * Check if we're in "full new" mode (all flags on)
     */
    public static isNewArchitectureMode(): boolean {
        const flags = FeatureFlags.getAll();
        return Object.values(flags).every(v => v === true);
    }
    
    /**
     * Load flags from localStorage
     */
    private loadFlags(): FeatureFlagConfig {
        try {
            if (typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem(FeatureFlags.STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    // Merge with defaults to handle new flags added later
                    return { ...DEFAULT_FLAGS, ...parsed };
                }
            }
        } catch (err) {
            console.warn('[FeatureFlags] Failed to load from localStorage:', err);
        }
        return { ...DEFAULT_FLAGS };
    }
    
    /**
     * Save flags to localStorage
     */
    private saveFlags(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(FeatureFlags.STORAGE_KEY, JSON.stringify(this.flags));
            }
        } catch (err) {
            console.warn('[FeatureFlags] Failed to save to localStorage:', err);
        }
    }
    
    /**
     * Log current flag status (for debugging)
     */
    public static logStatus(): void {
        const flags = FeatureFlags.getAll();
        console.log('[FeatureFlags] Current Status:');
        for (const [key, value] of Object.entries(flags)) {
            console.log(`  ${key}: ${value ? '✅ ENABLED' : '❌ DISABLED'}`);
        }
    }
}

/**
 * Expose to window for DevTools debugging
 */
if (typeof window !== 'undefined') {
    (window as any).FeatureFlags = FeatureFlags;
}

/**
 * Helper: Run code only if flag is enabled
 */
export function withFeatureFlag<T>(
    flag: keyof FeatureFlagConfig,
    enabledFn: () => T,
    disabledFn: () => T
): T {
    return FeatureFlags.get(flag) ? enabledFn() : disabledFn();
}

/**
 * Helper: Decorator for methods that should use new architecture when flag is enabled
 * 
 * Usage:
 *   @useNewArchitecture('USE_VIEW_COORDINATOR', function(this: Scheduler) { 
 *     return this.viewCoordinator.render(); 
 *   })
 *   render() { ... legacy code ... }
 */
export function useNewArchitecture(
    flag: keyof FeatureFlagConfig,
    newImplementation: (...args: any[]) => any
) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        
        descriptor.value = function (...args: any[]) {
            if (FeatureFlags.get(flag)) {
                return newImplementation.apply(this, args);
            }
            return originalMethod.apply(this, args);
        };
        
        return descriptor;
    };
}
