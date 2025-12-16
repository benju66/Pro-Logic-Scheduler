# Testing & Issue Identification Guide

## Overview

This guide walks you through systematically testing the Pro Logic Scheduler and identifying performance issues.

## Testing Strategy

We have three phases of testing:

1. **Phase 1: Browser Console Benchmarks** - Real-world performance measurements
2. **Phase 2: Unit Tests** - Functional correctness (✅ All passing)
3. **Phase 3: Performance Regression Tests** - Automated performance checks

---

## Step 1: Run Browser Console Benchmarks

These scripts measure actual performance in your browser environment.

### Prerequisites
- App must be running (either `npm run dev` or `npm run tauri:dev`)
- Open DevTools Console (F12)
- Have some data loaded (at least 1000 tasks recommended)

### Running the Benchmarks

#### 1. Scroll Performance Test
```bash
# Copy contents of tests/benchmarks/01-scroll-performance.js
# Paste into browser console
# Wait for results (~10-15 seconds)
```

**What it measures:**
- Average frame time during scrolling
- Max frame time spikes
- Dropped frames (>16.67ms)
- Effective FPS

**Expected results:**
- ✅ Excellent: <8ms average
- ⚠️ Good: 8-12ms average
- ❌ Poor: >16.67ms average (needs optimization)

#### 2. Render Performance Test
```bash
# Copy contents of tests/benchmarks/02-render-performance.js
# Paste into browser console
```

**What it measures:**
- `_updateVisibleRows()` execution time
- Percentiles (p50, p75, p95, p99)

**Expected results:**
- ✅ Excellent: <4ms average
- ⚠️ Good: 4-8ms average
- ❌ Poor: >8ms average

#### 3. Large Dataset Stress Test
```bash
# Copy contents of tests/benchmarks/03-large-dataset-stress.js
# Paste into browser console
```

**What it measures:**
- Initial render time for 1K, 5K, 10K tasks
- Scroll performance at each dataset size

**Expected results:**
- 1K tasks: <100ms initial render
- 5K tasks: <200ms initial render
- 10K tasks: <500ms initial render

#### 4. Memory Baseline Test
```bash
# Copy contents of tests/benchmarks/04-memory-baseline.js
# Paste into browser console
```

**What it measures:**
- Memory growth during 100 operations
- Memory leak detection

**Expected results:**
- ✅ Excellent: <10MB growth
- ⚠️ Warning: 10-50MB growth
- ❌ Critical: >50MB growth (memory leak)

#### 5. Real-World Scroll Responsiveness
```bash
# Copy contents of tests/benchmarks/05-real-world-scroll-responsiveness.js
# Paste into browser console
# Follow on-screen instructions to manually scroll
```

**What it measures:**
- Time from scroll event to visible row update
- Rendering during active scrolling
- User-perceived responsiveness

**Expected results:**
- ✅ Excellent: <16ms delay
- ⚠️ Good: 16-33ms delay
- ❌ Poor: >33ms delay

### Logging Results

After running each benchmark, log the results:

```bash
# Results are automatically logged to:
tests/benchmarks/results/results-log.md      # Human-readable
tests/benchmarks/results/results-data.json   # Machine-readable
```

**To log manually:**
1. Copy console output
2. Append to `tests/benchmarks/results/results-log.md`
3. Add JSON entry to `results-data.json`

---

## Step 2: Run Performance Regression Tests

These tests fail if performance degrades below thresholds.

### Running Performance Tests

```bash
npm test:perf
```

### What Gets Tested

#### `tests/perf/scroll.perf.ts`
- Average scroll frame time < 12ms
- Max scroll frame time < 50ms
- Dropped frames < 5%

#### `tests/perf/render.perf.ts`
- `_updateVisibleRows()` < 8ms average
- Initial render 1000 tasks < 100ms
- Initial render 10000 tasks < 500ms

### Interpreting Results

**If tests pass:**
- ✅ Performance is within acceptable thresholds
- Continue monitoring with browser benchmarks

**If tests fail:**
- ❌ Performance has degraded
- Check recent code changes
- Run browser benchmarks to identify specific bottlenecks
- See "Issue Identification" section below

---

## Step 3: Issue Identification Process

### A. Analyze Browser Benchmark Results

#### Scroll Performance Issues

**Symptom:** Average frame time > 16.67ms

**Possible Causes:**
1. **Too many DOM updates per frame**
   - Check: Are we updating rows unnecessarily?
   - Fix: Add better change detection

2. **Expensive calculations during scroll**
   - Check: Is CPM recalculating on every scroll?
   - Fix: Debounce/throttle calculations

3. **Heavy reflows/repaints**
   - Check: Are we changing layout properties?
   - Fix: Use `transform` instead of `top/left`

4. **Scroll debounce too aggressive**
   - Check: Is `scrollDebounce` delay too high?
   - Fix: Reduce debounce delay (current: 16ms default)

**Investigation Steps:**
```javascript
// In browser console, profile scroll:
performance.mark('scroll-start');
// Scroll the grid
performance.mark('scroll-end');
performance.measure('scroll-duration', 'scroll-start', 'scroll-end');
console.log(performance.getEntriesByName('scroll-duration'));
```

#### Render Performance Issues

**Symptom:** `_updateVisibleRows()` > 8ms

**Possible Causes:**
1. **Too many DOM operations**
   - Check: Are we creating/destroying elements?
   - Fix: Ensure DOM recycling is working

2. **Expensive cell rendering**
   - Check: Are cell templates complex?
   - Fix: Simplify templates, use CSS instead of JS

3. **Synchronous data processing**
   - Check: Are we processing all data synchronously?
   - Fix: Batch processing, use `requestIdleCallback`

**Investigation Steps:**
```javascript
// Profile _updateVisibleRows:
const grid = window.scheduler.grid;
const original = grid['_updateVisibleRows'];
grid['_updateVisibleRows'] = function() {
    performance.mark('render-start');
    original.call(this);
    performance.mark('render-end');
    performance.measure('render', 'render-start', 'render-end');
    const measure = performance.getEntriesByName('render')[0];
    console.log(`Render took ${measure.duration.toFixed(2)}ms`);
};
```

#### Memory Leak Issues

**Symptom:** Memory growth > 50MB after 100 operations

**Possible Causes:**
1. **Event listeners not removed**
   - Check: Are scroll listeners cleaned up?
   - Fix: Remove listeners in cleanup

2. **DOM nodes not recycled**
   - Check: Are old rows removed from DOM?
   - Fix: Ensure row pool cleanup

3. **Closures holding references**
   - Check: Are event handlers holding data?
   - Fix: Use weak references where possible

**Investigation Steps:**
```javascript
// Check for memory leaks:
// 1. Take heap snapshot before operations
// 2. Perform operations
// 3. Force GC (if available)
// 4. Take heap snapshot after
// 5. Compare snapshots in DevTools Memory tab
```

### B. Use Browser DevTools Profiler

1. **Open Performance Tab**
   - Record while scrolling
   - Look for long tasks (>50ms)

2. **Check Call Tree**
   - Identify functions taking most time
   - Focus optimization on hot paths

3. **Check Memory Tab**
   - Take heap snapshots
   - Compare before/after operations
   - Look for detached DOM nodes

### C. Common Performance Issues & Fixes

#### Issue 1: Scroll Lag
**Symptoms:** Janky scrolling, dropped frames

**Fixes:**
- Reduce `scrollDebounce` delay
- Use `will-change: transform` on scrolling elements
- Ensure RAF throttling is working
- Check for synchronous operations in scroll handler

#### Issue 2: Slow Initial Render
**Symptoms:** Long delay before grid appears

**Fixes:**
- Implement progressive rendering
- Use `requestIdleCallback` for non-critical updates
- Lazy-load cell content
- Reduce initial visible row count

#### Issue 3: Memory Leaks
**Symptoms:** Memory grows over time

**Fixes:**
- Clean up event listeners
- Remove DOM nodes from memory
- Use WeakMap for caches
- Avoid closures holding large objects

#### Issue 4: Poor Responsiveness
**Symptoms:** Delay between scroll and visual update

**Fixes:**
- Reduce debounce delays
- Render during active scrolling
- Use `requestAnimationFrame` for updates
- Pre-render buffer rows

---

## Step 4: Create Performance Baseline

Before making changes, establish a baseline:

1. **Run all Phase 1 benchmarks**
2. **Log results** to `tests/benchmarks/results/`
3. **Run Phase 3 tests** and note pass/fail
4. **Document environment:**
   - Browser version
   - OS version
   - Dataset size
   - Hardware specs (if known)

**Baseline Template:**
```markdown
## Baseline - [Date]

### Environment
- Browser: Chrome 120
- OS: Windows 11
- Dataset: 1000 tasks

### Results
- Scroll Performance: 16.79ms avg (51% dropped frames)
- Render Performance: 0.66ms avg ✅
- Large Dataset: 1K=97ms, 5K=137ms, 10K=58ms ✅
- Memory: -9MB (GC working) ✅
- Responsiveness: [Not yet measured]
```

---

## Step 5: Iterative Improvement Process

1. **Identify Issue** (from benchmarks/profiler)
2. **Create Hypothesis** (what's causing it?)
3. **Make Fix** (optimize code)
4. **Re-run Benchmarks** (measure improvement)
5. **Compare Results** (before vs after)
6. **Document** (log results, note fixes)

### Example Workflow

```bash
# 1. Run baseline
npm run dev
# [Run benchmarks, log results]

# 2. Identify issue
# Scroll performance: 20ms avg (too slow)

# 3. Make fix
# [Edit VirtualScrollGrid.ts, reduce debounce]

# 4. Re-test
# [Run benchmarks again]

# 5. Compare
# Before: 20ms avg
# After: 12ms avg ✅
# Improvement: 40% faster

# 6. Document
# [Update results-log.md with new results]
```

---

## Step 6: Continuous Monitoring

### Daily Checks
- Run Phase 3 performance tests before committing
- Check if any tests fail

### Weekly Checks
- Run full Phase 1 benchmark suite
- Compare against baseline
- Document any regressions

### Before Releases
- Full benchmark suite
- Performance regression tests
- Memory leak check
- Large dataset stress test

---

## Quick Reference

### Running Tests
```bash
# All unit tests
npm test:unit

# Performance regression tests
npm test:perf

# Watch mode (for development)
npm test:watch

# UI mode (interactive)
npm test:ui
```

### Benchmark Scripts Location
```
tests/benchmarks/
├── 01-scroll-performance.js
├── 02-render-performance.js
├── 03-large-dataset-stress.js
├── 04-memory-baseline.js
└── 05-real-world-scroll-responsiveness.js
```

### Results Location
```
tests/benchmarks/results/
├── results-log.md      # Human-readable log
└── results-data.json   # Machine-readable data
```

---

## Next Steps

1. ✅ **Run Phase 1 Script 1** (Scroll Performance)
   - Copy script to console
   - Log results
   - Identify if scroll performance needs improvement

2. ✅ **Run Phase 1 Script 2** (Render Performance)
   - Should be fast (<4ms), verify

3. ✅ **Run Phase 1 Script 3** (Large Dataset)
   - Test with 1K, 5K, 10K tasks
   - Verify scalability

4. ✅ **Run Phase 1 Script 4** (Memory)
   - Check for leaks
   - Verify GC is working

5. ✅ **Run Phase 1 Script 5** (Real-World Scroll)
   - Manual scroll test
   - Measure responsiveness

6. ✅ **Run Phase 3 Tests**
   - `npm test:perf`
   - See if any thresholds are exceeded

7. **Analyze Results**
   - Compare against expected values
   - Identify bottlenecks
   - Prioritize fixes

8. **Fix Issues**
   - Start with highest impact issues
   - Re-test after each fix
   - Document improvements

---

## Getting Help

If you encounter issues:

1. **Check console errors** - Fix any JavaScript errors first
2. **Verify environment** - Make sure app is running
3. **Check data** - Ensure grid has data loaded
4. **Review logs** - Check `results-log.md` for patterns
5. **Use profiler** - Browser DevTools Performance tab

---

## Performance Targets

### Current Targets (from Phase 1 results)
- Scroll: 16.79ms avg (⚠️ needs improvement)
- Render: 0.66ms avg (✅ excellent)
- Memory: -9MB (✅ excellent, GC working)
- Large Dataset: All within targets (✅)

### Ideal Targets
- Scroll: <12ms avg, <50ms max
- Render: <4ms avg
- Memory: <10MB growth
- Responsiveness: <16ms delay

---

**Last Updated:** [Current Date]
**Status:** Ready for testing

