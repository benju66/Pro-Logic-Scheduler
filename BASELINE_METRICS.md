# Phase 1: Baseline Test Metrics

## Test Run Summary

**Date:** December 30, 2024  
**Environment:** Windows 10, Playwright + Chromium  
**Engine:** MockRustEngine (JavaScript mock for E2E testing)

```
Running 2 tests using 2 workers

  ✓ CPM Calculation: Should calculate correct dates for chain (5.0s)
  ✓ CRUD: Hierarchy remains intact after indentation (5.0s)

  2 passed (5.0s)
```

## Test Results

### Test 1: CPM Calculation (Forward Pass)

Verifies the scheduling engine correctly calculates dates for a task chain with dependencies.

**Reference Project:**
| Task ID | Name | Duration | Dependency | Link Type |
|---------|------|----------|------------|-----------|
| 1 | Project Start | 0 | - | - |
| 2 | Foundation | 5 | 1 | FS (Finish-to-Start) |
| 3 | Framing | 10 | 2 | FS |
| 4 | Roofing (Parallel) | 3 | 3 | SS+2 (Start-to-Start, lag 2) |
| 5 | Project Finish | 0 | 3, 4 | FS |

**Calculated Dates:**
| Task ID | Start | End |
|---------|-------|-----|
| 1 | 2024-01-01 | 2024-01-01 |
| 2 | 2024-01-02 | 2024-01-08 |
| 3 | 2024-01-09 | 2024-01-22 |
| 4 | 2024-01-11 | 2024-01-15 |
| 5 | 2024-01-23 | 2024-01-23 |

**Assertions Passed:**
- ✓ Foundation duration is 5 days
- ✓ Framing starts after Foundation ends (FS dependency)
- ✓ Project Finish has calculated start date
- ✓ Verified chain: Foundation (2024-01-08) → Framing (2024-01-09)

### Test 2: CRUD Hierarchy (Indentation)

Verifies task hierarchy relationships are maintained after indentation operations.

**Scenario:** Indent task "2" under task "1"

**Assertions Passed:**
- ✓ Child task has correct `parentId` after indentation
- ✓ Hierarchy structure is intact

## Green Light Status

✅ **All tests passed** - Ready to proceed to Phase 2

## Technical Notes

- Tests run against `MockRustEngine` (JavaScript mock) via Vite dev server
- Test mode enabled via `?test=true` URL parameter
- MockRustEngine implements iterative forward-pass CPM calculation
- Production uses `RustEngine` with full Tauri/WASM integration

## Files Created/Modified for Phase 1

- `playwright.config.ts` - Playwright configuration
- `tests/e2e/scheduling_logic.spec.ts` - Black box test suite
- `tests/fixtures/reference_project.json` - Reference dataset
- `src/core/engines/MockRustEngine.ts` - Mock engine for testing
- `src/utils/testMode.ts` - Test mode detection utilities
- `src/main.ts` - Added test mode bypass for Tauri check
- `src/services/SchedulerService.ts` - Engine selection based on test mode
