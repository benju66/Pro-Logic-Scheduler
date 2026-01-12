/**
 * Test Mode Detection and Mocking Utilities
 * 
 * Detects when running in test mode and provides utilities for mocking Tauri APIs.
 * Used for E2E testing with Playwright when Tauri APIs aren't available.
 */

/**
 * Check if we're running in test mode
 */
export function isTestMode(): boolean {
    // Check URL parameter
    if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('test') === 'true') {
            return true;
        }
    }
    
    // Check environment variable (Vite-specific)
    if ((import.meta as any).env?.VITE_TEST_MODE === 'true') {
        return true;
    }
    
    // Check if Playwright is running (window.playwright is set by Playwright)
    if (typeof window !== 'undefined' && (window as any).playwright) {
        return true;
    }
    
    return false;
}

/**
 * Check if Tauri APIs are actually available and functional
 */
export async function isTauriAvailable(): Promise<boolean> {
    // In test mode, be very strict - only return true if we can PROVE Tauri works
    // In Playwright, __TAURI__ might exist from imports but invoke won't work
    if (isTestMode()) {
        // In test mode, assume Tauri is NOT available unless proven otherwise
        // ProjectController will use the WASM Worker for calculations
        return false;
    }
    
    // Production mode: use standard checks
    // Quick check: window.__TAURI__ (most reliable indicator)
    const hasTauriGlobal = typeof window !== 'undefined' && 
        (window as Window & { __TAURI__?: unknown }).__TAURI__;
    
    if (!hasTauriGlobal) {
        return false;
    }
    
    // If we have __TAURI__, try to import the API
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        if (invoke && typeof invoke === 'function') {
            return true;
        }
    } catch (e) {
        // Can't import Tauri API - not available
        return false;
    }
    
    return false;
}

/**
 * Should use mock implementations?
 * Returns true if we're in test mode AND Tauri is not available
 */
export async function shouldUseMocks(): Promise<boolean> {
    return isTestMode() && !(await isTauriAvailable());
}
