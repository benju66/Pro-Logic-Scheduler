# Phase 1: The Safety Net (Verification) - Setup Complete

> **📜 Historical Document**: This document describes Phase 1 of the WASM migration (December 2024). The migration is now complete. See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for the current architecture using WASM Worker.

## Overview
Phase 1 established a "truth" baseline to ensure the new WASM engine behaved like the original implementation. This phase created black-box E2E tests using Playwright.

## What Was Set Up

### 1. Playwright Installation ✅
- Installed `@playwright/test` as a dev dependency
- Installed Chromium browser for testing
- Created `playwright.config.ts` with TypeScript configuration
- Added `test:e2e` script to `package.json`

### 2. Reference Dataset ✅
Created `tests/fixtures/reference_project.json` with a comprehensive test dataset covering:
- Task chains (Project Start → Foundation → Framing → Project Finish)
- Parallel tasks (Roofing with SS dependency)
- Multiple dependency types (FS, SS)
- Task hierarchy

### 3. Black Box Test Suite ✅
Created `tests/e2e/scheduling_logic.spec.ts` with two critical tests:
- **CPM Calculation Test**: Verifies correct date calculation for task chains
- **CRUD Hierarchy Test**: Verifies hierarchy remains intact after indentation operations

### 4. Scheduler Exposure ✅
Modified `src/main.ts` to expose the scheduler instance to `window.scheduler` for E2E testing access.

### 5. Test Mode Support ✅
Added test mode bypass in `src/main.ts` to allow browser-based testing:
- App can run in browser when accessed with `?test=true` URL parameter
- This allows Playwright to test the scheduling logic without requiring Tauri desktop environment

## Files Created/Modified

### New Files
- `playwright.config.ts` - Playwright configuration
- `tests/fixtures/reference_project.json` - Reference test dataset
- `tests/e2e/scheduling_logic.spec.ts` - E2E test suite

### Modified Files
- `package.json` - Added Playwright dependency and test:e2e script
- `src/main.ts` - Added scheduler exposure and test mode support

## How to Run Tests

### Step 1: Start the Vite Dev Server
In one terminal, start the Vite dev server:
```bash
npm run dev
```

This will:
- Start the Vite dev server on `http://localhost:1420`
- The app will run in test mode when accessed with `?test=true`

> **Note:** The current architecture uses WASM Worker for all calculations. See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

### Step 2: Run E2E Tests
In a **separate terminal**, run the Playwright tests:
```bash
npm run test:e2e
```

Or directly:
```bash
npx playwright test
```

The tests will:
- Connect to `http://localhost:1420/?test=true`
- App uses WASM Worker for calculations
- Verify scheduling logic through `window.scheduler` API

### Step 3: View Results
After tests complete:
- Test results will be displayed in the terminal
- HTML report will be generated (run `npx playwright show-report` to view)

### Step 4: Create Baseline Metrics
Once tests pass, create `BASELINE_METRICS.md` in the project root with:
- Test execution output
- Test results summary
- Any timing/performance metrics
- This serves as the "Green Light" to proceed to Phase 2

## Test Details

### Test 1: CPM Calculation
**Purpose**: Verify that the CPM engine correctly calculates dates for task chains.

**What it tests**:
- Foundation task (5 days) starts after Project Start
- Framing task (10 days) starts after Foundation ends (FS relationship)
- Project Finish starts after both Framing and Roofing complete
- Date calculations respect dependencies and durations

**Assertions**:
- Foundation duration is 5 days
- Framing start date > Foundation end date
- Project Finish has calculated dates

### Test 2: CRUD Hierarchy
**Purpose**: Verify that task hierarchy operations (indentation) work correctly.

**What it tests**:
- Setting tasks via `scheduler.tasks` property
- Performing indent operation via `scheduler.indent()`
- Verifying parent-child relationship is established correctly

**Assertions**:
- After indenting task "2", it becomes a child of task "1" (`parentId === '1'`)

## Notes

### Test Mode
The app now supports a test mode that bypasses the Tauri requirement:
- Access via `http://localhost:1420/?test=true`
- Allows browser-based testing without Tauri desktop environment
- Some features (like persistence) may not work in test mode, but scheduling logic is fully testable

### Async Operations
The tests properly handle async CPM calculations:
- Uses `page.waitForFunction()` to wait for calculations to complete
- Checks for calculated end dates before making assertions
- Accounts for the async nature of the scheduling engine

## Next Steps

After Phase 1 is complete and baseline metrics are established:
1. **Phase 2**: Implement WASM engine
2. **Phase 3**: Run same tests against WASM engine
3. **Phase 4**: Compare results and ensure parity

## Troubleshooting

### Tests fail to connect
- Ensure `npm run tauri:dev` is running
- Verify Vite server is accessible at `http://localhost:1420`
- Check that test mode is enabled (`?test=true` in URL)

### Scheduler not initialized
- Check browser console for initialization errors
- Verify `window.scheduler` is exposed in `src/main.ts`
- Ensure `isInitialized` flag is set correctly

### Date calculations incorrect
- Verify reference dataset is loaded correctly
- Check that CPM engine is running (look for `recalculateAll()` calls)
- Ensure dependencies are properly formatted in test data
