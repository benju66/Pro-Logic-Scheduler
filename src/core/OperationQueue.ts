/**
 * @fileoverview Operation Queue - Serializes task operations to prevent race conditions
 * @module core/OperationQueue
 * 
 * This module provides a queue-based serialization mechanism for task operations.
 * All operations are processed sequentially to ensure data consistency and prevent
 * race conditions when multiple operations are triggered rapidly.
 */

/**
 * Operation function type
 */
type Operation<T> = () => Promise<T> | T;

/**
 * Operation queue item
 */
interface QueuedOperation<T> {
    operation: Operation<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

/**
 * Operation Queue
 * Serializes operations to prevent race conditions
 */
export class OperationQueue {
    private queue: QueuedOperation<unknown>[] = [];
    private processing = false;

    /**
     * Enqueue an operation
     * @param operation - Operation to execute
     * @returns Promise that resolves when operation completes
     */
    async enqueue<T>(operation: Operation<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                operation: operation as Operation<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject: reject
            });

            // Start processing if not already processing
            if (!this.processing) {
                this._processQueue();
            }
        });
    }

    /**
     * Process the queue
     * @private
     */
    private async _processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (!item) break;

            try {
                const result = await item.operation();
                item.resolve(result);
            } catch (error) {
                item.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }

        this.processing = false;
    }

    /**
     * Get queue length
     * @returns Number of queued operations
     */
    getLength(): number {
        return this.queue.length;
    }

    /**
     * Check if queue is processing
     * @returns True if processing
     */
    isProcessing(): boolean {
        return this.processing;
    }
}

/**
 * Operation Lock
 * Provides mutex-like behavior for critical sections
 */
export class OperationLock {
    private locked = false;
    private waiters: Array<() => void> = [];

    /**
     * Acquire lock
     * @returns Promise that resolves when lock is acquired
     */
    async acquire(): Promise<() => void> {
        return new Promise<() => void>((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve(() => this._release());
            } else {
                this.waiters.push(() => {
                    this.locked = true;
                    resolve(() => this._release());
                });
            }
        });
    }

    /**
     * Release lock
     * @private
     */
    private _release(): void {
        this.locked = false;
        const next = this.waiters.shift();
        if (next) {
            next();
        }
    }

    /**
     * Check if locked
     * @returns True if locked
     */
    isLocked(): boolean {
        return this.locked;
    }
}

