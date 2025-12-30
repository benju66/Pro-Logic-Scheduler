# Phase 1: Test Mode Implementation

## Overview

Phase 1 E2E tests verify scheduling logic correctness. Since Playwright connects to the Vite dev server (`localhost:1420`) rather than the Tauri webview directly, we've implemented a **test mode** that allows the app to run with mocked Tauri APIs.

## How It Works

### Test Mode Detection

The app detects test mode via:
1. URL parameter: `?test=true`
2. Environment variable: `VITE_TEST_MODE=true`
3. Playwright detection: `window.playwright` exists

### Mock Components

When in test mode **AND** Tauri APIs aren't available:

1. **MockRustEngine** (`src/core/engines/MockRustEngine.ts`)
   - JavaScript implementation of CPM calculations
   - Implements forward pass with dependency handling
   - Supports FS, SS, FF, SF link types
   - Handles lag values (positive and negative)
   - **NOTE**: This is ONLY for testing. Production always uses RustEngine.

2. **PersistenceService** 
   - Skips initialization in test mode
   - Tests don't require SQLite database

3. **Main App Initialization**
   - Allows app to initialize without Tauri environment
   - Tests can verify scheduling logic through `window.scheduler` API

## Test Execution

### Step 1: Start Vite Dev Server

```bash
npm run dev
```

This starts the Vite server on `localhost:1420`.

### Step 2: Run E2E Tests

```bash
npm run test:e2e
```

Playwright will:
1. Connect to `http://localhost:1420/?test=true`
2. App detects test mode and uses MockRustEngine
3. Tests verify scheduling logic through `window.scheduler`
4. Tests pass if scheduling calculations are correct

## What Gets Tested

The tests verify:
- **CPM Calculations**: Task dates are calculated correctly based on dependencies
- **Dependency Types**: FS, SS relationships work as expected
- **Hierarchy Operations**: Indent/outdent operations maintain parent-child relationships

## Important Notes

1. **Mock Engine Limitations**: MockRustEngine implements basic CPM logic but may not match Rust engine behavior exactly. The goal is to verify the **scheduling logic flow**, not exact date calculations.

2. **Production vs Test**: 
   - Production: Always uses RustEngine with full Tauri integration
   - Test Mode: Uses MockRustEngine when Tauri APIs unavailable
   - Both paths test the same scheduling logic concepts

3. **Future Enhancement**: For more accurate testing, consider using `tauri-driver` or WebDriverIO to test the actual Tauri webview with the real Rust engine.

## Files Modified

- `src/core/engines/MockRustEngine.ts` - Mock engine for testing
- `src/utils/testMode.ts` - Test mode detection utilities
- `src/services/SchedulerService.ts` - Engine selection logic
- `src/main.ts` - Test mode bypass for Tauri check
- `src/data/PersistenceService.ts` - Skip initialization in test mode
- `tests/e2e/scheduling_logic.spec.ts` - Uses `?test=true` parameter

## Verification

After tests pass, create `BASELINE_METRICS.md` with:
- Test execution results
- Any timing/performance metrics
- Confirmation that scheduling logic works correctly

This baseline will be used in Phase 2 to verify the WASM engine produces identical results.
