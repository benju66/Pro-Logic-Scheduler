/**
 * @fileoverview Default Column Definitions
 * @module core/columns/definitions/defaultColumns
 * 
 * Static column definitions for the scheduler grid.
 * No functions - pure metadata only.
 */

import type { ColumnDefinition } from '../types';

/**
 * Base columns (always available)
 */
export const BASE_COLUMNS: ColumnDefinition[] = [
    {
        id: 'drag',
        field: 'drag',
        label: '',
        type: 'drag',
        width: 28,
        align: 'center',
        editable: false,
        resizable: false,
        minWidth: 20,
    },
    {
        id: 'checkbox',
        field: 'checkbox',
        label: '',
        type: 'checkbox',
        width: 30,
        align: 'center',
        editable: false,
        resizable: false,
        minWidth: 25,
    },
    {
        id: 'rowNum',
        field: 'rowNum',
        label: '#',
        type: 'rowNumber',
        width: 35,
        align: 'center',
        editable: false,
        minWidth: 30,
    },
    {
        id: 'name',
        field: 'name',
        label: 'Task Name',
        type: 'name',
        width: 220,
        editable: true,
        minWidth: 100,
    },
    {
        id: 'duration',
        field: 'duration',
        label: 'Duration',
        type: 'number',
        width: 50,
        align: 'center',
        editable: true,
        readonlyForParent: true,
        minWidth: 40,
    },
    {
        id: 'start',
        field: 'start',
        label: 'Start',
        type: 'date',
        width: 100,
        editable: true,
        showConstraintIcon: true,
        readonlyForParent: true,
        minWidth: 80,
    },
    {
        id: 'end',
        field: 'end',
        label: 'End',
        type: 'date',
        width: 100,
        editable: true,
        showConstraintIcon: true,
        readonlyForParent: true,
        minWidth: 80,
    },
    {
        id: 'tradePartners',
        field: 'tradePartnerIds',
        label: 'Trade Partners',
        type: 'tradePartners',
        width: 180,
        editable: false,
        align: 'left',
        minWidth: 120,
    },
    {
        id: 'constraintType',
        field: 'constraintType',
        label: 'Constraint',
        type: 'select',
        width: 80,
        editable: true,
        options: ['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'],
        readonlyForParent: true,
        minWidth: 50,
    },
    {
        id: 'schedulingMode',
        field: 'schedulingMode',
        label: 'Mode',
        type: 'schedulingMode',
        width: 90,
        editable: true,
        options: ['Auto', 'Manual'],
        readonlyForParent: true,
        align: 'center',
        resizable: true,
        minWidth: 80,
    },
    {
        id: 'health',
        field: '_health',
        label: 'Health',
        type: 'health',
        width: 80,
        align: 'center',
        editable: false,
        minWidth: 60,
    },
    {
        id: 'actions',
        field: 'actions',
        label: 'Actions',
        type: 'actions',
        width: 40,
        editable: false,
        minWidth: 36,
        resizable: true,
        align: 'center',
        actions: [
            {
                id: 'row-menu',
                name: 'row-menu',
                title: 'Row Menu',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                </svg>`,
                color: '#64748b',
            },
        ],
    },
];

/**
 * Tracking columns (shown when baseline exists)
 */
export const TRACKING_COLUMNS: ColumnDefinition[] = [
    {
        id: 'baselineStart',
        field: 'baselineStart',
        label: 'Baseline Start',
        type: 'date',
        width: 110,
        editable: false,
        readonlyForParent: true,
        minWidth: 80,
        headerClass: 'baseline-column-header',
        cellClass: 'baseline-column',
        visible: false, // Hidden by default, shown when baseline set
    },
    {
        id: 'actualStart',
        field: 'actualStart',
        label: 'Actual Start',
        type: 'date',
        width: 110,
        editable: true,
        readonlyForParent: true,
        minWidth: 80,
        headerClass: 'actual-column-header',
        cellClass: 'actual-column',
        visible: false,
    },
    {
        id: 'startVariance',
        field: 'startVariance',
        label: 'Start Var',
        type: 'variance',
        width: 80,
        align: 'center',
        editable: false,
        readonlyForParent: true,
        minWidth: 60,
        visible: false,
        config: {
            varianceField: 'start',
        },
    },
    {
        id: 'baselineFinish',
        field: 'baselineFinish',
        label: 'Baseline Finish',
        type: 'date',
        width: 110,
        editable: false,
        readonlyForParent: true,
        minWidth: 80,
        headerClass: 'baseline-column-header',
        cellClass: 'baseline-column',
        visible: false,
    },
    {
        id: 'actualFinish',
        field: 'actualFinish',
        label: 'Actual Finish',
        type: 'date',
        width: 110,
        editable: true,
        readonlyForParent: true,
        minWidth: 80,
        headerClass: 'actual-column-header',
        cellClass: 'actual-column',
        visible: false,
    },
    {
        id: 'finishVariance',
        field: 'finishVariance',
        label: 'Finish Var',
        type: 'variance',
        width: 80,
        align: 'center',
        editable: false,
        readonlyForParent: true,
        minWidth: 60,
        visible: false,
        config: {
            varianceField: 'finish',
        },
    },
];

/**
 * All default columns (base + tracking)
 */
export const DEFAULT_COLUMNS: ColumnDefinition[] = [
    ...BASE_COLUMNS,
    ...TRACKING_COLUMNS,
];
