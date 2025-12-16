# Performance Benchmark Scripts

Browser console scripts for quick performance testing without setup.

## Usage

1. **Open DevTools Console** (F12)
2. **Load the application** and ensure it has data
3. **Copy and paste** the entire script into the console
4. **Press Enter** to run
5. **Review results** in the console output

## Scripts

### 01-scroll-performance.js
**Scroll Performance Benchmark**

Measures scroll smoothness by programmatically scrolling the grid and tracking frame times.

**What it tests:**
- Average frame time
- Max frame time
- Dropped frames (>16.67ms)
- Effective FPS

**Expected results:**
- Average frame time < 12ms = Excellent (60+ FPS)
- Average frame time 12-16ms = Good (50-60 FPS)
- Average frame time > 16.67ms = Poor (<60 FPS)

---

### 02-render-performance.js
**Render Performance Benchmark**

Measures the speed of `_updateVisibleRows()` method calls.

**What it tests:**
- Average render time
- Max render time
- Percentiles (p50, p75, p95, p99)

**Expected results:**
- Average render time < 8ms = Excellent
- Average render time 8-12ms = Good
- Average render time > 12ms = Needs optimization

**Note:** This tests raw render method. Real-world performance may differ due to RAF batching.

---

### 03-large-dataset-stress.js
**Large Dataset Stress Test**

Tests performance with different dataset sizes (1K, 5K, 10K tasks).

**What it tests:**
- Initial render time at each dataset size
- Scroll performance consistency
- Virtualization effectiveness

**Expected results:**
- Render time should scale sub-linearly (virtualization working)
- Scroll performance should remain consistent
- Only ~40-50 rows should be rendered regardless of dataset size

**Note:** This temporarily replaces your data. Original data is restored after the test.

---

### 04-memory-baseline.js
**Memory Baseline Test**

Tracks memory usage during operations to detect potential leaks.

**What it tests:**
- Initial memory usage
- Memory growth after 100 operations
- Memory trend analysis

**Expected results:**
- Memory growth < 10MB = Excellent (no leaks)
- Memory growth 10-50MB = Acceptable
- Memory growth > 50MB = Potential memory leak

**Note:** Requires Chrome DevTools with memory profiling enabled. May not work in Tauri WebView.

---

## Quick Start

Run all benchmarks in sequence:

```javascript
// Run scroll benchmark
// (paste 01-scroll-performance.js)

// Run render benchmark
// (paste 02-render-performance.js)

// Run stress test
// (paste 03-large-dataset-stress.js)

// Run memory test
// (paste 04-memory-baseline.js)
```

## Troubleshooting

### "Scheduler not found"
- Make sure the app is fully loaded
- Check `window.scheduler` exists in console
- Wait for initialization to complete

### "Grid viewport not found"
- Make sure the grid is rendered
- Check that `.vsg-viewport` element exists
- Try scrolling manually first

### "No data" errors
- Add some tasks to the scheduler
- Use the "+ 1,000 Tasks" button if available
- Or manually add tasks

### Memory API not available
- Use Chrome browser (not Firefox/Safari)
- Enable memory profiling in DevTools
- Or use Chrome with `--enable-precise-memory-info` flag

## Interpreting Results

### Good Performance Indicators
- ✅ Scroll FPS > 55
- ✅ Render time < 10ms average
- ✅ Memory growth < 20MB
- ✅ Consistent performance across dataset sizes

### Warning Signs
- ⚠️ Dropped frames > 5%
- ⚠️ Max frame time > 50ms
- ⚠️ Render time > 16ms average
- ⚠️ Memory growth > 50MB

### Critical Issues
- ❌ Average FPS < 30
- ❌ Render time > 50ms
- ❌ Memory growth > 100MB
- ❌ Performance degrades with dataset size

