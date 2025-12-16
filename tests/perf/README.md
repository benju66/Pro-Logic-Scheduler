# Performance Regression Tests

Tests that fail if performance degrades below defined thresholds.

## Purpose

These tests ensure that performance doesn't regress as the codebase evolves. They're designed to catch performance issues before they reach production.

## Test Files

### scroll.perf.ts
**Scroll Performance Regression Tests**

Thresholds:
- Average scroll frame time < 12ms
- Max scroll frame time < 50ms
- Dropped frames < 5%

### render.perf.ts
**Render Performance Regression Tests**

Thresholds:
- `_updateVisibleRows()` average < 8ms
- Initial render of 1000 tasks < 100ms
- Initial render of 10000 tasks < 500ms

## Running Tests

### In CI/CD Pipeline

```bash
npm run test:perf
```

### Locally

```bash
npm test tests/perf
```

## Important Notes

1. **Browser Environment Required**: These tests require a real browser environment and may not work in jsdom. Consider running them as integration tests.

2. **Baseline Establishment**: Run these tests on known-good code to establish baselines. Adjust thresholds if needed.

3. **Flaky Tests**: Performance tests can be flaky due to system load. Consider:
   - Running multiple times and averaging
   - Using statistical analysis (percentiles)
   - Setting reasonable thresholds with some buffer

4. **Helper Functions**: Both test files export helper functions that can be used in:
   - Browser console scripts
   - Integration tests
   - Manual performance testing

## Helper Functions

### measureScrollPerformance()
Measures scroll performance by programmatically scrolling and tracking frame times.

```typescript
import { measureScrollPerformance } from './scroll.perf';

const viewport = document.querySelector('.vsg-viewport');
const results = await measureScrollPerformance(viewport, 100);
console.log(`Average frame time: ${results.avgFrameTime}ms`);
```

### measureRenderPerformance()
Measures `_updateVisibleRows()` performance.

```typescript
import { measureRenderPerformance } from './render.perf';

const grid = window.scheduler.grid;
const results = await measureRenderPerformance(grid, 100);
console.log(`Average render time: ${results.avgRenderTime}ms`);
```

### measureInitialRenderTime()
Measures initial render time for a dataset.

```typescript
import { measureInitialRenderTime } from './render.perf';

const tasks = generateTasks(1000);
const renderTime = await measureInitialRenderTime(grid, tasks);
console.log(`Initial render: ${renderTime}ms`);
```

## Adjusting Thresholds

If tests fail due to legitimate changes (e.g., new features that add overhead):

1. **Investigate**: Determine if the performance regression is acceptable
2. **Optimize**: Try to optimize before adjusting thresholds
3. **Document**: If thresholds must be adjusted, document why
4. **Update**: Update thresholds in test files

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# Example GitHub Actions
- name: Run Performance Tests
  run: npm run test:perf
  continue-on-error: true  # Don't fail build, but report
```

Consider running performance tests:
- On every PR (with warnings)
- On main branch (fail on regression)
- Nightly (track trends)

