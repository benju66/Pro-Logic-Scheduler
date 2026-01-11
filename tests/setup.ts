/**
 * @fileoverview Vitest Setup File
 * 
 * Provides polyfills and global setup for test environment.
 */

// Polyfill requestAnimationFrame for tests that use ViewCoordinator
if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
        return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    };
}

if (typeof globalThis.cancelAnimationFrame === 'undefined') {
    globalThis.cancelAnimationFrame = (id: number): void => {
        clearTimeout(id);
    };
}

// Ensure Worker is defined for tests (even if just as a stub)
if (typeof globalThis.Worker === 'undefined') {
    globalThis.Worker = class MockWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        
        constructor(_url: string | URL) {
            // Mock worker - doesn't do anything
        }
        
        postMessage(_message: unknown): void {
            // No-op
        }
        
        terminate(): void {
            // No-op
        }
        
        addEventListener(): void {
            // No-op
        }
        
        removeEventListener(): void {
            // No-op
        }
        
        dispatchEvent(): boolean {
            return true;
        }
    } as unknown as typeof Worker;
}
