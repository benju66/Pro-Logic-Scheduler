/**
 * @fileoverview Trade Partner Store - Manages trade partner entities
 * @module data/TradePartnerStore
 * 
 * Single source of truth for trade partner data.
 * Follows same patterns as TaskStore and CalendarStore.
 */

import type { TradePartner } from '../types';

type Listener = () => void;

/**
 * Trade Partner Store
 * Manages CRUD operations for trade partners
 */
export class TradePartnerStore {
  private partners: Map<string, TradePartner> = new Map();
  private listeners: Set<Listener> = new Set();

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /**
   * Get all trade partners
   */
  getAll(): TradePartner[] {
    return Array.from(this.partners.values());
  }

  /**
   * Get a single trade partner by ID
   */
  get(id: string): TradePartner | undefined {
    return this.partners.get(id);
  }

  /**
   * Get multiple trade partners by IDs
   */
  getMany(ids: string[]): TradePartner[] {
    return ids
      .map(id => this.partners.get(id))
      .filter((p): p is TradePartner => p !== undefined);
  }

  /**
   * Add a new trade partner
   * @returns The created trade partner with generated ID
   */
  add(partner: Omit<TradePartner, 'id'>): TradePartner {
    const id = this.generateId();
    const newPartner: TradePartner = {
      id,
      name: partner.name,
      contact: partner.contact || '',
      phone: partner.phone || '',
      email: partner.email || '',
      color: partner.color || this.getNextColor(),
      notes: partner.notes || '',
    };
    
    this.partners.set(id, newPartner);
    this.notify();
    return newPartner;
  }

  /**
   * Update an existing trade partner
   */
  update(id: string, updates: Partial<Omit<TradePartner, 'id'>>): TradePartner | null {
    const existing = this.partners.get(id);
    if (!existing) return null;

    const updated: TradePartner = {
      ...existing,
      ...updates,
    };
    
    this.partners.set(id, updated);
    this.notify();
    return updated;
  }

  /**
   * Delete a trade partner
   * Note: Caller must handle removing assignments from tasks
   */
  delete(id: string): boolean {
    const deleted = this.partners.delete(id);
    if (deleted) {
      this.notify();
    }
    return deleted;
  }

  /**
   * Set all trade partners (used during data loading)
   */
  setAll(partners: TradePartner[]): void {
    this.partners.clear();
    for (const partner of partners) {
      this.partners.set(partner.id, partner);
    }
    this.notify();
  }

  /**
   * Clear all trade partners
   */
  clear(): void {
    this.partners.clear();
    this.notify();
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Search trade partners by name
   */
  search(query: string): TradePartner[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(p => 
      p.name.toLowerCase().includes(lowerQuery) ||
      p.contact?.toLowerCase().includes(lowerQuery) ||
      p.email?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get count of trade partners
   */
  count(): number {
    return this.partners.size;
  }

  // =========================================================================
  // Subscription
  // =========================================================================

  /**
   * Subscribe to changes
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private generateId(): string {
    return `tp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get next color from palette (cycles through)
   */
  private getNextColor(): string {
    const palette = [
      '#3B82F6', // Blue
      '#10B981', // Emerald
      '#F59E0B', // Amber
      '#EF4444', // Red
      '#8B5CF6', // Violet
      '#EC4899', // Pink
      '#06B6D4', // Cyan
      '#84CC16', // Lime
      '#F97316', // Orange
      '#6366F1', // Indigo
    ];
    
    const usedColors = new Set(this.getAll().map(p => p.color));
    const available = palette.find(c => !usedColors.has(c));
    return available || palette[this.partners.size % palette.length];
  }
}

// Singleton instance
let instance: TradePartnerStore | null = null;

/**
 * @deprecated Use constructor injection instead.
 * @see docs/adr/001-dependency-injection.md
 */
export function getTradePartnerStore(): TradePartnerStore {
  if (!instance) {
    instance = new TradePartnerStore();
  }
  return instance;
}

/**
 * @deprecated Create fresh instances in tests instead.
 * @see docs/adr/001-dependency-injection.md
 */
export function resetTradePartnerStore(): void {
  instance = null;
}

