# Phase 1: Test Mode Implementation

> **📜 Historical Document**: This document describes Phase 1 of the WASM migration (December 2024). The migration is now complete. MockRustEngine has been removed - the app now uses WASM Worker for all calculations. See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for current architecture.

## Overview

Phase 1 E2E tests verified scheduling logic correctness. Since Playwright connects to the Vite dev server (`localhost:1420`) rather than the Tauri webview directly, a **test mode** was implemented that allows the app to run without full Tauri APIs.

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

> **Update (January 2026):** The WASM migration is complete. MockRustEngine has been removed. The app now uses:
> - **Production & Test:** WASM Worker with SchedulerEngine (Rust → WebAssembly)
> - **Test Mode:** Bypasses Tauri-only features (file dialogs, SQLite) but uses real WASM calculations

1. **Current Architecture**: All calculations run in WASM Worker. See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

2. **Test Mode**: Allows app to run without full Tauri environment while still using real WASM calculations.

## Files (Current Architecture)

- `src/utils/testMode.ts` - Test mode detection utilities
- `src/workers/scheduler.worker.ts` - WASM Worker (runs calculations)
- `src/services/ProjectController.ts` - Worker interface
- `src/main.ts` - Test mode bypass for Tauri check
- `src/data/PersistenceService.ts` - Skip initialization in test mode
- `tests/e2e/scheduling_logic.spec.ts` - Uses `?test=true` parameter

> **Note:** MockRustEngine.ts was removed after the WASM migration was complete.
