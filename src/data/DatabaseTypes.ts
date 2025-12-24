/**
 * @fileoverview Shared Database Types for Tauri SQLite Plugin
 * @module data/DatabaseTypes
 * 
 * Centralizes DatabaseInterface to ensure consistency across:
 * - DataLoader
 * - PersistenceService  
 * - SnapshotService
 * 
 * USAGE:
 * Place this file at: src/data/DatabaseTypes.ts
 * 
 * Then import in your data services:
 * import type { DatabaseInterface, PersistedTaskRow, ... } from './DatabaseTypes';
 */

// =============================================================================
// DATABASE INTERFACE
// =============================================================================

/**
 * Database interface matching @tauri-apps/plugin-sql
 * 
 * CRITICAL: The select<T> generic represents a SINGLE ROW type.
 * The method returns Promise<T[]> - an array of rows.
 * 
 * @example
 * // CORRECT usage - T is a single row type
 * const rows = await db.select<{ id: string; name: string }>('SELECT id, name FROM tasks');
 * // rows has type: { id: string; name: string }[]
 * 
 * @example
 * // INCORRECT usage - Don't wrap in Array<>
 * const rows = await db.select<Array<{ id: string }>>('SELECT id FROM tasks');
 * // This would give you: { id: string }[][] (double-nested!) - WRONG!
 */
export interface DatabaseInterface {
  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   * @param query - SQL query string with optional ? placeholders
   * @param bindings - Values to bind to ? placeholders
   * @returns Object with lastInsertId and rowsAffected
   */
  execute(
    query: string, 
    bindings?: unknown[]
  ): Promise<{ lastInsertId: number; rowsAffected: number }>;
  
  /**
   * Execute a read query (SELECT)
   * @template T - The shape of a SINGLE row (not an array)
   * @param query - SQL SELECT query string
   * @param bindings - Values to bind to ? placeholders
   * @returns Promise<T[]> - Array of rows matching type T
   */
  select<T = Record<string, unknown>>(
    query: string, 
    bindings?: unknown[]
  ): Promise<T[]>;
  
  /**
   * Close the database connection
   * @returns Promise<boolean> - true on successful close
   * 
   * Note: The @tauri-apps/plugin-sql returns boolean, not void
   */
  close(): Promise<boolean>;
}

// =============================================================================
// ROW TYPE DEFINITIONS
// =============================================================================

/**
 * Persisted task row from SQLite tasks table
 * 
 * Note: SQLite returns `null` for NULL columns, not `undefined`.
 * The hydrateTask function should convert null to undefined where
 * the Task interface uses optional (?) properties.
 * 
 * Column name mapping:
 * - SQL uses snake_case (parent_id, sort_key, etc.)
 * - TypeScript Task uses camelCase (parentId, sortKey, etc.)
 */
export interface PersistedTaskRow {
  id: string;
  parent_id: string | null;
  sort_key: string;
  name: string;
  notes: string;
  duration: number;
  constraint_type: string;
  constraint_date: string | null;
  scheduling_mode: string | null;
  dependencies: string; // JSON string of Dependency[]
  progress: number;
  actual_start: string | null;
  actual_finish: string | null;
  remaining_duration: number | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  baseline_duration: number | null;
  is_collapsed: number; // SQLite stores boolean as 0/1
  created_at?: string;
  updated_at?: string;
}

/**
 * Event row from SQLite events table
 * Used for event sourcing replay
 */
export interface EventRow {
  id: number;
  event_type: string;
  target_id: string | null;
  payload: string; // JSON string
  timestamp: string;
  user_id?: string | null;
  session_id?: string | null;
}

/**
 * Snapshot row from SQLite snapshots table
 * Contains full state dumps for faster loading
 */
export interface SnapshotRow {
  id: number;
  tasks_json: string; // JSON string of Task[]
  calendar_json: string; // JSON string of Calendar
  trade_partners_json: string; // JSON string of TradePartner[]
  event_id: number; // Last event ID included in snapshot
  created_at: string;
}

/**
 * Calendar row from SQLite calendar table
 */
export interface CalendarRow {
  id?: number;
  working_days: string; // JSON string of number[] (0-6)
  exceptions: string; // JSON string of Record<string, CalendarException>
  updated_at?: string;
}

/**
 * Trade partner row from SQLite trade_partners table
 */
export interface TradePartnerRow {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  color: string;
  notes: string | null;
}

/**
 * Task trade partner assignment row from junction table
 */
export interface TaskTradePartnerRow {
  task_id: string;
  trade_partner_id: string;
}

/**
 * Max event ID query result
 */
export interface MaxEventIdRow {
  max_id: number | null;
}

/**
 * Event ID from snapshot query result
 */
export interface SnapshotEventIdRow {
  event_id: number;
}

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Helper to convert SQLite null to undefined for optional Task fields
 * 
 * @example
 * const task: Task = {
 *   ...otherFields,
 *   remainingDuration: nullToUndefined(row.remaining_duration),
 * };
 */
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Type guard to check if a value is null or undefined
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

