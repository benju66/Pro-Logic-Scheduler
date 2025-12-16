# Testing Suite - Pro Logic Scheduler

Comprehensive testing suite for performance, correctness, and regression prevention.

## Structure

```
tests/
├── benchmarks/          # Phase 1: Browser console scripts
│   ├── 01-scroll-performance.js
│   ├── 02-render-performance.js
│   ├── 03-large-dataset-stress.js
│   ├── 04-memory-baseline.js
│   └── README.md
├── unit/                # Phase 2: Unit tests
│   ├── CPM.test.ts
│   ├── DateUtils.test.ts
│   └── VirtualScrollGrid.test.ts
├── perf/                # Phase 3: Performance regression tests
│   ├── scroll.perf.ts
│   ├── render.perf.ts
│   └── README.md
└── README.md            # This file
```

## Quick Start

### Phase 1: Browser Console Scripts (No Setup Required)

1. Open DevTools Console (F12)
2. Load the application
3. Copy and paste a script from `tests/benchmarks/`
4. Press Enter to run
5. Review results in console

**See**: [tests/benchmarks/README.md](./benchmarks/README.md)

### Phase 2: Unit Tests

```bash
# Run all unit tests
npm test tests/unit

# Run specific test file
npm test tests/unit/CPM.test.ts

# Watch mode
npm run test:watch
```

### Phase 3: Performance Regression Tests

```bash
# Run performance tests
npm test tests/perf

# Note: These may require a real browser environment
```

## Test Phases

### Phase 1: Browser Console Benchmark Scripts ✅

**Purpose**: Quick performance checks without setup

**Scripts**:
1. **Scroll Performance** - Measures scroll smoothness (FPS, frame times)
2. **Render Performance** - Measures `_updateVisibleRows()` speed
3. **Large Dataset Stress** - Tests performance at scale (1K, 5K, 10K tasks)
4. **Memory Baseline** - Tracks memory usage and potential leaks

**Usage**: Copy-paste into browser console

**See**: [tests/benchmarks/README.md](./benchmarks/README.md)

### Phase 2: Vitest Unit Tests ✅

**Purpose**: Ensure correctness and prevent regressions

**Test Files**:
- **CPM.test.ts** - Critical Path Method calculations
  - Forward/backward pass
  - Float calculations
  - Critical path identification
  - All constraint types (ASAP, SNET, SNLT, FNET, FNLT, MFO)
  - Milestone bug regression
  - Dependency types (FS, SS, FF, SF) with lag
  - Circular dependency detection

- **DateUtils.test.ts** - Working day calculations
  - `addWorkDays()` skips weekends/holidays
  - `calcWorkDays()` counts correctly
  - Edge cases (Friday + 1 = Monday, negative durations, zero duration)

- **VirtualScrollGrid.test.ts** - Grid rendering logic
  - `_getVisibleRowCount()` calculations
  - Visible index calculations with buffer
  - Row hash invalidation
  - Editing preservation during scroll

### Phase 3: Performance Regression Tests ✅

**Purpose**: Fail if performance degrades below thresholds

**Test Files**:
- **scroll.perf.ts** - Scroll performance thresholds
  - Average frame time < 12ms
  - Max frame time < 50ms
  - Dropped frames < 5%

- **render.perf.ts** - Render performance thresholds
  - `_updateVisibleRows()` average < 8ms
  - Initial render 1000 tasks < 100ms
  - Initial render 10000 tasks < 500ms

**See**: [tests/perf/README.md](./perf/README.md)

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Performance Tests Only
```bash
npm test tests/perf
```

### Watch Mode
```bash
npm run test:watch
```

### UI Mode (Interactive)
```bash
npm run test:ui
```

## Test Coverage

View coverage report:
```bash
npm test -- --coverage
```

Coverage reports are generated in:
- `coverage/` directory
- HTML report: `coverage/index.html`

## Writing New Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { MyClass } from '../../src/MyClass';

describe('MyClass', () => {
    it('should do something', () => {
        const instance = new MyClass();
        expect(instance.method()).toBe(expected);
    });
});
```

### Performance Test Example

```typescript
import { describe, it, expect } from 'vitest';

describe('Performance Test', () => {
    it('should complete in < 10ms', () => {
        const start = performance.now();
        // ... code to test ...
        const end = performance.now();
        const duration = end - start;
        
        expect(duration).toBeLessThan(10);
    });
});
```

## Best Practices

1. **Unit Tests**: Test one thing at a time, use descriptive names
2. **Performance Tests**: Establish baselines, use percentiles, account for variance
3. **Browser Scripts**: Make them standalone, no dependencies
4. **Documentation**: Document thresholds and why they exist

## Troubleshooting

### Tests fail in CI but pass locally
- Check for timing issues (use `waitFor` or `setTimeout`)
- Verify environment differences (Node version, etc.)
- Check for flaky tests (run multiple times)

### Performance tests are flaky
- Use statistical analysis (percentiles, averages)
- Run multiple iterations
- Set thresholds with reasonable buffer
- Consider system load

### Browser scripts don't work
- Ensure app is fully loaded
- Check `window.scheduler` exists
- Verify grid viewport is rendered
- Check browser console for errors

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit
      - run: npm test tests/perf
        continue-on-error: true  # Don't fail build on perf tests
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Performance Testing Guide](./perf/README.md)
- [Browser Scripts Guide](./benchmarks/README.md)
