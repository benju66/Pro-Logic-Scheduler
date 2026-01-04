/**
 * @fileoverview Trade Partners Column Renderer
 * @module core/columns/renderers/TradePartnersRenderer
 * 
 * Renders trade partner chips for assigned partners.
 */

import type { Task } from '../../../types';
import type { ColumnType, ColumnDefinition, ColumnContext } from '../types';
import { TextDisplayRenderer } from './BaseRenderer';

/**
 * Trade Partners Renderer - For trade partner assignment column
 * 
 * Shows colored chips for each assigned trade partner.
 * Uses ServiceContainer for partner data lookup (dependency injection).
 */
export class TradePartnersRenderer extends TextDisplayRenderer {
    readonly type: ColumnType = 'tradePartners';
    
    /**
     * Render trade partner chips
     */
    protected renderHtml(ctx: ColumnContext, _column: ColumnDefinition): string {
        const partnerIds = ctx.task.tradePartnerIds || [];
        
        if (partnerIds.length === 0) {
            return '';
        }
        
        const chips = partnerIds.map(id => {
            // Use injected service to get partner data
            const partner = this.services.getTradePartner(id);
            if (!partner) return '';
            
            // Truncate long names
            const shortName = partner.name.length > 12 
                ? partner.name.substring(0, 10) + '...' 
                : partner.name;
            
            return `<span class="trade-chip" data-partner-id="${id}" 
                    style="background-color:${partner.color}; color: white; 
                    padding: 2px 8px; border-radius: 12px; font-size: 11px;
                    margin-right: 4px; cursor: pointer; display: inline-block;
                    white-space: nowrap; max-width: 100px; overflow: hidden;
                    text-overflow: ellipsis;" title="${this.escapeHtml(partner.name)}">${this.escapeHtml(shortName)}</span>`;
        }).filter(Boolean).join('');
        
        return chips;
    }
    
    /**
     * Get partner names as comma-separated string
     */
    getValue(task: Task, _column: ColumnDefinition): string {
        const partnerIds = task.tradePartnerIds || [];
        
        return partnerIds.map(id => {
            const partner = this.services.getTradePartner(id);
            return partner?.name || id;
        }).join(', ');
    }
}
