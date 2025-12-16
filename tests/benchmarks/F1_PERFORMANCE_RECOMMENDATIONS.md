# F1-Level Performance Optimization Recommendations

## Current State Analysis

**Test Results (After Optimization):**
- Average delay: **19.09ms** (target for F1: <8ms)
- 95th percentile: **52.40ms** (target for F1: <16ms)
- 9.8% renders exceed 50ms (target for F1: <1%)
- User perception: Still feels laggy

**Performance Gap:**
- Current: 19.09ms average (Good)
- F1 Target: <8ms average (Excellent)
- Gap: **11ms to eliminate**

## Root Cause Analysis

### Bottleneck #1: Double RAF Nesting (Critical)
**Location**: `_applyScrollUpdate()` → `requestAnimationFrame()` → `_updateVisibleRows()`

**Problem:**
```typescript
// Line 617: First RAF
this._scrollRAF = requestAnimationFrame(() => {
    this._updateVisibleRows(); // This happens ~16ms after scroll event
    // ...
});
```

**Impact**: Adds ~16ms delay even during "normal" scrolling
**Solution**: Remove RAF wrapper, call `_updateVisibleRows()` directly during scroll

### Bottleneck #2: Remaining Debounce Delays
**Location**: Lines 570-603

**Current Implementation:**
- Base debounce: 8ms
- Rapid scrolling: 12ms (8ms * 1.5)
- Secondary deferral: 16ms
- **Total potential delay: 36ms**

**Problem**: Even "optimized" debounce adds latency
**Solution**: Eliminate ALL debounce during active scrolling, use RAF only

### Bottleneck #3: Synchronous DOM Writes
**Location**: `_updateVisibleRows()` → spacer height updates

**Problem:**
```typescript
// Lines 1178-1179: Synchronous height changes
this.dom.topSpacer.style.height = `${topSpacerHeight}px`;
this.dom.bottomSpacer.style.height = `${bottomSpacerHeight}px`;
```

**Impact**: Forces synchronous layout recalculation
**Solution**: Use CSS transforms or batch DOM writes

### Bottleneck #4: Row Recycling Overhead
**Location**: `_recycleRows()` method

**Problem**: May be doing expensive DOM operations during scroll
**Solution**: Optimize recycling algorithm, use DocumentFragment, batch operations

### Bottleneck #5: Event Callback Overhead
**Location**: Lines 622-627

**Problem:**
```typescript
if (this.options.onScroll) {
    this.options.onScroll(this.scrollTop); // May trigger expensive operations
}
```

**Impact**: External callbacks may be slow (Gantt sync, etc.)
**Solution**: Defer callbacks, use postMessage, or optimize callback handlers

### Bottleneck #6: minScrollDelta Threshold
**Location**: Line 544-549

**Problem**: 3px threshold may cause missed updates
**Solution**: Reduce to 1px or eliminate for smoother feel

## F1-Level Optimization Strategy

### Phase 1: Eliminate All Debounce (Highest Impact)

**Changes:**
1. **Remove setTimeout debounce entirely**
   - Use RAF only, no setTimeout
   - Cancel previous RAF, schedule new one immediately

2. **Remove double RAF nesting**
   - Call `_updateVisibleRows()` directly in scroll handler
   - Use RAF only for batching, not deferral

3. **Eliminate rapid scrolling detection**
   - Treat all scrolling the same way
   - Let browser handle throttling via RAF

**Expected Impact**: Reduce average delay from 19ms → **<8ms**

### Phase 2: Optimize DOM Operations

**Changes:**
1. **Batch DOM writes**
   - Use DocumentFragment for row recycling
   - Batch spacer height updates
   - Use `will-change: transform` CSS hint

2. **Use CSS transforms instead of height**
   - Transform spacers instead of changing height
   - Avoids layout recalculation
   - GPU-accelerated

3. **Optimize row recycling**
   - Pre-calculate row positions
   - Minimize DOM queries
   - Use object pooling for row data

**Expected Impact**: Reduce 95th percentile from 52ms → **<16ms**

### Phase 3: Defer Expensive Operations

**Changes:**
1. **Defer event callbacks**
   - Use `postMessage` or `setTimeout(0)` for callbacks
   - Don't block scroll handler
   - Batch callback invocations

2. **Lazy update spacers**
   - Update spacer heights only when scroll stops
   - Use transform for immediate visual feedback
   - Update height in background

3. **Optimize Gantt sync**
   - If `onScroll` triggers Gantt updates, defer them
   - Use requestIdleCallback for non-critical updates
   - Batch multiple scroll events

**Expected Impact**: Eliminate spikes >50ms

### Phase 4: Advanced Optimizations

**Changes:**
1. **Use Intersection Observer**
   - Replace manual visibility calculations
   - Browser-native optimization
   - More efficient than manual checks

2. **Implement scroll prediction**
   - Predict next visible range
   - Pre-render rows before they're needed
   - Reduce perceived latency

3. **Use Web Workers**
   - Offload calculations to worker
   - Keep main thread free for rendering
   - Use SharedArrayBuffer for data sharing

4. **Optimize CSS**
   - Use `contain: layout style paint`
   - Use `will-change` strategically
   - Minimize repaints/reflows

**Expected Impact**: Achieve <8ms average, <16ms 95th percentile

## Implementation Priority

### Critical (Do First - Highest Impact)
1. ✅ Remove double RAF nesting
2. ✅ Eliminate setTimeout debounce
3. ✅ Call `_updateVisibleRows()` directly during scroll

**Expected**: 19ms → **<10ms average**

### High Priority (Do Second)
4. ✅ Batch DOM writes
5. ✅ Defer event callbacks
6. ✅ Optimize spacer updates

**Expected**: <10ms → **<8ms average**

### Medium Priority (Do Third)
7. ✅ Optimize row recycling
8. ✅ Use CSS transforms
9. ✅ Reduce minScrollDelta threshold

**Expected**: <8ms → **<6ms average**

### Low Priority (Polish)
10. ✅ Intersection Observer
11. ✅ Scroll prediction
12. ✅ Web Workers (if needed)

**Expected**: <6ms → **<4ms average**

## Code Changes Required

### Change 1: Remove Debounce, Use RAF Only
```typescript
private _onScroll(_e: Event): void {
    const newScrollTop = this.dom.viewport.scrollTop;
    const newScrollLeft = this.dom.viewport.scrollLeft;
    
    this.scrollTop = newScrollTop;
    this.scrollLeft = newScrollLeft;
    this._lastScrollTop = newScrollTop;
    
    // Cancel previous RAF
    if (this._scrollRAF !== null) {
        cancelAnimationFrame(this._scrollRAF);
    }
    
    // Schedule immediate update (no debounce)
    this._scrollRAF = requestAnimationFrame(() => {
        this._updateVisibleRows(); // Direct call, no wrapper
        
        // Defer callbacks to avoid blocking
        if (this.options.onScroll) {
            setTimeout(() => this.options.onScroll(this.scrollTop), 0);
        }
        
        this._scrollRAF = null;
    });
}
```

### Change 2: Batch DOM Writes
```typescript
private _updateVisibleRows(): void {
    // ... calculations ...
    
    // Batch DOM writes
    requestAnimationFrame(() => {
        this.dom.topSpacer.style.height = `${topSpacerHeight}px`;
        this.dom.bottomSpacer.style.height = `${bottomSpacerHeight}px`;
        this._recycleRows();
    });
}
```

### Change 3: Use CSS Transforms for Immediate Feedback
```typescript
// Immediate visual feedback via transform
this.dom.topSpacer.style.transform = `translateY(${-topSpacerHeight}px)`;

// Update height in background (doesn't block)
requestIdleCallback(() => {
    this.dom.topSpacer.style.height = `${topSpacerHeight}px`;
    this.dom.topSpacer.style.transform = '';
});
```

## Performance Targets

### Current (After Optimization)
- Average delay: 19.09ms
- 95th percentile: 52.40ms
- Max delay: 80.40ms
- Renders >50ms: 9.8%

### F1-Level Targets
- Average delay: **<8ms** (60% improvement needed)
- 95th percentile: **<16ms** (70% improvement needed)
- Max delay: **<33ms** (60% improvement needed)
- Renders >50ms: **<1%** (90% reduction needed)

### Stretch Goals (F1+)
- Average delay: **<4ms**
- 95th percentile: **<8ms**
- Max delay: **<16ms**
- Renders >16ms: **<1%**

## Testing Strategy

1. **Re-run Test 5** after each phase
2. **Measure improvements** incrementally
3. **Profile with DevTools** to identify remaining bottlenecks
4. **Monitor for regressions** in other tests

## Risk Assessment

### Low Risk Changes
- Removing debounce delays
- Using RAF only
- Batching DOM writes

### Medium Risk Changes
- CSS transforms (may affect layout)
- Deferring callbacks (may affect sync)

### High Risk Changes
- Intersection Observer (API changes)
- Web Workers (complexity)

## Expected Timeline

- **Phase 1**: 1-2 hours (Critical changes)
- **Phase 2**: 2-3 hours (High priority)
- **Phase 3**: 3-4 hours (Medium priority)
- **Phase 4**: 4-8 hours (Advanced)

**Total**: 10-17 hours for F1-level performance

## Success Criteria

✅ Average delay <8ms  
✅ 95th percentile <16ms  
✅ Max delay <33ms  
✅ <1% renders exceed 50ms  
✅ User perception: "Feels instant"  
✅ No regressions in other tests

## Notes

- Performance is a feature - prioritize user experience
- Measure everything - use Test 5 to validate improvements
- Iterate incrementally - don't change everything at once
- Profile first - use DevTools to find actual bottlenecks
- Test thoroughly - ensure no regressions

