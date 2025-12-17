/**
 * @fileoverview Ordering Service - Manages task ordering using fractional indexing
 * @module services/OrderingService
 * 
 * Fractional indexing allows inserting items between any two existing items
 * without modifying other items. This eliminates race conditions and ensures
 * deterministic ordering.
 * 
 * Used by: Jira (LexoRank), Figma, Trello, Notion, Linear
 * 
 * @author Pro Logic Scheduler
 * @version 1.0.0
 */

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * OrderingService - Pure utility for generating sort keys
 * 
 * Sort keys are strings that can be compared lexicographically.
 * They allow infinite subdivision without touching other items.
 * 
 * Key properties:
 * - generateKeyBetween(null, null) → "a0" (first key)
 * - generateKeyBetween("a0", null) → "a1" (append)
 * - generateKeyBetween(null, "a0") → "Zz" (prepend)
 * - generateKeyBetween("a0", "a1") → "a0V" (insert between)
 */
export class OrderingService {
    
    /**
     * Generate a sort key for appending to the end of a list
     * @param lastKey - The sort key of the current last item (null if list is empty)
     * @returns New sort key that sorts after lastKey
     * 
     * @example
     * generateAppendKey(null)   // → "a0" (first item)
     * generateAppendKey("a0")   // → "a1"
     * generateAppendKey("a1")   // → "a2"
     */
    static generateAppendKey(lastKey: string | null): string {
        return generateKeyBetween(lastKey, null);
    }
    
    /**
     * Generate a sort key for prepending to the start of a list
     * @param firstKey - The sort key of the current first item (null if list is empty)
     * @returns New sort key that sorts before firstKey
     * 
     * @example
     * generatePrependKey(null)  // → "a0" (first item)
     * generatePrependKey("a0")  // → "Zz"
     * generatePrependKey("Zz")  // → "Zy"
     */
    static generatePrependKey(firstKey: string | null): string {
        return generateKeyBetween(null, firstKey);
    }
    
    /**
     * Generate a sort key for inserting between two items
     * @param beforeKey - Sort key of item that will be BEFORE the new item (null if inserting at start)
     * @param afterKey - Sort key of item that will be AFTER the new item (null if inserting at end)
     * @returns New sort key that sorts between beforeKey and afterKey
     * 
     * @example
     * generateInsertKey("a0", "a1")   // → "a0V" (between a0 and a1)
     * generateInsertKey("a0", "a0V")  // → "a0G" (between a0 and a0V)
     * generateInsertKey(null, "a0")   // → "Zz" (before a0)
     * generateInsertKey("a2", null)   // → "a3" (after a2)
     */
    static generateInsertKey(beforeKey: string | null, afterKey: string | null): string {
        return generateKeyBetween(beforeKey, afterKey);
    }
    
    /**
     * Generate multiple sort keys for bulk insert operations
     * Keys are evenly distributed between beforeKey and afterKey
     * 
     * @param beforeKey - Sort key of item before insertion point (null if at start)
     * @param afterKey - Sort key of item after insertion point (null if at end)
     * @param count - Number of keys to generate
     * @returns Array of sort keys, in order
     * 
     * @example
     * generateBulkKeys(null, null, 3)     // → ["a0", "a1", "a2"]
     * generateBulkKeys("a0", "a1", 2)     // → ["a0G", "a0V"]
     * generateBulkKeys("a2", null, 3)     // → ["a3", "a4", "a5"]
     */
    static generateBulkKeys(
        beforeKey: string | null, 
        afterKey: string | null, 
        count: number
    ): string[] {
        if (count <= 0) return [];
        return generateNKeysBetween(beforeKey, afterKey, count);
    }
    
    /**
     * Compare two sort keys
     * Use this for sorting instead of localeCompare (which is case-insensitive)
     * 
     * @param a - First sort key
     * @param b - Second sort key
     * @returns -1 if a < b, 0 if a === b, 1 if a > b
     */
    static compare(a: string, b: string): number {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }
    
    /**
     * Sort an array of items by their sortKey property
     * Returns a NEW array (does not mutate input)
     * 
     * @param items - Array of items with sortKey property
     * @returns New sorted array
     */
    static sortBySortKey<T extends { sortKey: string }>(items: T[]): T[] {
        return [...items].sort((a, b) => this.compare(a.sortKey, b.sortKey));
    }
}

