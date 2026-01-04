/**
 * @fileoverview Text Column Renderer
 * @module core/columns/renderers/TextRenderer
 * 
 * Renders editable text input columns.
 */

import type { ColumnType } from '../types';
import { InputRenderer } from './BaseRenderer';

/**
 * Text Renderer - For editable text columns
 * 
 * Used by: name (base behavior), notes, etc.
 */
export class TextRenderer extends InputRenderer {
    readonly type: ColumnType = 'text';
}
