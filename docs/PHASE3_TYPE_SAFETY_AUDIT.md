# Phase 3: Type Safety Audit - TypeScript ↔ Data Layer Round-Trip

**Date:** January 2025  
**Status:** 🔍 **AUDIT COMPLETE**  
**Purpose:** Investigate, research, and plan type safety round-trip tests

---

## Executive Summary

This audit examines the data serialization boundaries in Pro Logic Scheduler to identify where type safety round-trip tests are needed.

### Key Finding: No Direct TypeScript ↔ Rust Serialization

The Tauri backend is **minimal** - it only provides plugins:
- `tauri-plugin-sql` for SQLite access
- `tauri-plugin-fs` for file system
- `tauri-plugin-dialog` for file dialogs

**All data serialization happens in TypeScript/JavaScript land**, with two critical boundaries:

1. **TypeScript ↔ SQLite** (via Tauri SQL plugin)
2. **TypeScript ↔ WASM** (via serde_wasm_bindgen)

---

## Data Flow Analysis

### 1. Persistence Layer (TypeScript ↔ SQLite)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   TypeScript    │────▶│  PersistenceService │────▶│    SQLite       │
│   Task Object   │     │  (JSON.stringify)    │     │  (TEXT columns) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              │
│   TypeScript    │◀────│   DataLoader      │◀────────────┘
│   Task Object   │     │   (hydrateTask)   │
└─────────────────┘     └──────────────────┘
```

**Serialization Points:**
- **Write**: `JSON.stringify(dependencies)` → TEXT column
- **Read**: `JSON.parse(row.dependencies)` → Dependency[]

**Field Mapping (snake_case → camelCase):**
- `parent_id` → `parentId`
- `sort_key` → `sortKey`
- `constraint_type` → `constraintType`
- `constraint_date` → `constraintDate`
- `scheduling_mode` → `schedulingMode`
- `actual_start` → `actualStart`
- `actual_finish` → `actualFinish`
- `remaining_duration` → `remainingDuration`
- `baseline_start` → `baselineStart`
- `baseline_finish` → `baselineFinish`
- `baseline_duration` → `baselineDuration`
- `is_collapsed` → `_collapsed`
- `row_type` → `rowType`

---

### 2. WASM Worker (TypeScript ↔ Rust/WASM)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   TypeScript    │────▶│   Web Worker      │────▶│   WASM Engine   │
│   Task[]        │     │   postMessage     │     │   (Rust types)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   TypeScript    │◀────│   Web Worker      │◀────│   CPM Result    │
│   CPMResult     │     │   postMessage     │     │   (with dates)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Serialization Points:**
- **To WASM**: `serde_wasm_bindgen::from_value()` (JS → Rust)
- **From WASM**: `serde_wasm_bindgen::to_value()` (Rust → JS)

**Critical Fields:**
- `dependencies: Dependency[]` (complex nested structure)
- `constraintDate: string | null` (nullable)
- `schedulingMode: 'Auto' | 'Manual'` (string enum)
- Calculated fields: `_isCritical`, `totalFloat`, `freeFloat`, etc.

---

## Risk Analysis

### High Risk Areas

| Area | Risk Level | Issue |
|------|------------|-------|
| `dependencies` serialization | 🔴 HIGH | Complex nested objects, JSON string storage |
| `null` vs `undefined` handling | 🔴 HIGH | SQLite returns `null`, TS uses `undefined` |
| Date field preservation | 🟡 MEDIUM | Calculated fields should not be persisted |
| WASM type coercion | 🟡 MEDIUM | serde defaults may differ from TS defaults |
| `schedulingMode` default | 🟡 MEDIUM | Must default to `'Auto'` consistently |

### Current Mitigations

1. **`nullToUndefined()` helper** in `DatabaseTypes.ts` - converts SQLite nulls
2. **`hydrateTask()` in DataLoader** - explicit field mapping
3. **Calculated fields filtered** in PersistenceService - not persisted
4. **`#[serde(default)]` in Rust** - provides defaults for optional fields

---

## Existing Test Coverage

### ✅ What's Tested

| Test File | Coverage |
|-----------|----------|
| `persistence.test.ts` | Event queueing, flush operations, schema migrations |
| `SnapshotService.test.ts` | Snapshot creation, event threshold, calculated field stripping |
| `ProjectController-Rollback.test.ts` | State rollback mechanism |
| `BehaviorSnapshot.test.ts` | Integration snapshot tests |

### ❌ What's NOT Tested

1. **Full round-trip**: Task → SQLite → Task (field-by-field equality)
2. **WASM round-trip**: Task → WASM → Task (with/without CPM calculation)
3. **Edge cases**: Empty dependencies, null dates, special characters in names
4. **Type coercion**: String "0" vs number 0, null vs undefined
5. **Reference project**: Load → Save → Load (data integrity)

---

## Phase 3 Implementation Plan

### 3.1: Persistence Round-Trip Tests

**Goal:** Verify all Task fields survive SQLite storage

**Test Cases:**
1. **Basic Task**: All required fields
2. **Complex Dependencies**: Multiple dependencies with different link types and lags
3. **Nullable Fields**: constraintDate = null, actualStart = null, etc.
4. **Special Characters**: Names with quotes, unicode, emoji
5. **Edge Values**: duration = 0, progress = 100, negative lag
6. **SchedulingMode**: 'Auto' and 'Manual' tasks
7. **Blank Rows**: rowType = 'blank'
8. **Trade Partners**: tradePartnerIds array

**Implementation:**
```typescript
// tests/integration/TypeSafetyRoundTrip.test.ts
describe('Persistence Round-Trip', () => {
  it('should preserve all Task fields through SQLite cycle', async () => {
    const originalTask = createCompleteTask();
    await persistenceService.queueEvent('TASK_CREATED', originalTask.id, toPayload(originalTask));
    await persistenceService.flushNow();
    const loadedData = await dataLoader.loadData();
    const loadedTask = loadedData.tasks.find(t => t.id === originalTask.id);
    assertTasksEqual(originalTask, loadedTask, { ignoreCalculatedFields: true });
  });
});
```

---

### 3.2: WASM Round-Trip Tests

**Goal:** Verify Task structure survives WASM serialization

**Test Cases:**
1. **Initialize → Get Tasks**: Tasks in === Tasks out (pre-calculation)
2. **Calculate**: Verify calculated fields are added correctly
3. **Sync Tasks**: Bulk replace → verify all fields preserved
4. **Update Task**: Partial updates don't lose other fields
5. **Dependencies**: Complex dependency graphs survive serialization
6. **Manual Mode**: `schedulingMode: 'Manual'` tasks have fixed dates

**Implementation:**
```typescript
// tests/integration/WASMRoundTrip.test.ts
describe('WASM Round-Trip', () => {
  it('should preserve all Task fields through WASM cycle', async () => {
    const originalTasks = loadReferenceProject();
    engine.initialize(originalTasks, calendar);
    const result = engine.calculate();
    for (const originalTask of originalTasks) {
      const resultTask = result.tasks.find(t => t.id === originalTask.id);
      assertTaskInputFieldsEqual(originalTask, resultTask);
      // Verify calculated fields are present
      expect(resultTask.start).toBeDefined();
      expect(resultTask.end).toBeDefined();
    }
  });
});
```

---

### 3.3: Full Cycle Integration Test

**Goal:** Verify complete data cycle integrity

**Flow:**
```
Reference Project (JSON)
    ↓ Load
TypeScript Task[]
    ↓ Save
SQLite (via PersistenceService)
    ↓ Load
TypeScript Task[] (via DataLoader)
    ↓ Send to Worker
WASM (via serde_wasm_bindgen)
    ↓ Calculate CPM
CPMResult (WASM → TypeScript)
    ↓ Save
SQLite (snapshot)
    ↓ Load
TypeScript Task[] (restored)
    ↓ Compare
Original Task[] (should match input fields)
```

**Implementation:**
```typescript
// tests/integration/FullCycleIntegrity.test.ts
describe('Full Cycle Integrity', () => {
  it('should preserve all Task data through complete cycle', async () => {
    // Load reference project
    const original = loadReferenceProject();
    
    // Persist to SQLite
    for (const task of original) {
      persistenceService.queueEvent('TASK_CREATED', task.id, toPayload(task));
    }
    await persistenceService.flushNow();
    
    // Load from SQLite
    const loaded = await dataLoader.loadData();
    
    // Send to WASM
    engine.initialize(loaded.tasks, loaded.calendar);
    const result = engine.calculate();
    
    // Verify input fields match
    for (const orig of original) {
      const final = result.tasks.find(t => t.id === orig.id);
      assertTaskInputFieldsEqual(orig, final);
    }
  });
});
```

---

### 3.4: Edge Case Tests

**Goal:** Catch subtle serialization bugs

| Test Case | Input | Expected |
|-----------|-------|----------|
| Empty dependencies | `[]` | `[]` (not `null`) |
| Null constraint date | `null` | `null` (not `undefined`) |
| Zero duration | `0` | `0` (not `null` or `1`) |
| Empty name | `""` | `""` (not `"New Task"`) |
| Unicode name | `"タスク 日本語"` | Preserved exactly |
| Emoji name | `"🏗️ Construction"` | Preserved exactly |
| Negative lag | `-5` | `-5` (allowed) |
| Very long name | 10000 chars | Preserved exactly |
| Special chars | `"Task with \"quotes\" and 'apostrophes'"` | Preserved exactly |

---

## Implementation Priority

### Phase 3.1: Core Round-Trip (HIGH - Do First)
- **Files to create:**
  - `tests/integration/TypeSafetyRoundTrip.test.ts`
  - `tests/helpers/taskAssertions.ts` (shared assertion utilities)
- **Effort:** ~2 hours
- **Risk if skipped:** Data corruption on save/load cycles

### Phase 3.2: WASM Round-Trip (HIGH - Do Second)
- **Files to create:**
  - `tests/integration/WASMRoundTrip.test.ts`
- **Effort:** ~1.5 hours
- **Risk if skipped:** CPM calculation corrupts task data

### Phase 3.3: Full Cycle (MEDIUM - Optional)
- **Files to create:**
  - `tests/integration/FullCycleIntegrity.test.ts`
- **Effort:** ~1 hour
- **Risk if skipped:** Compound bugs in chained operations

### Phase 3.4: Edge Cases (MEDIUM - Optional)
- **Files to create:**
  - `tests/integration/EdgeCaseSerialization.test.ts`
- **Effort:** ~1 hour
- **Risk if skipped:** Subtle bugs with special data

---

## Confidence Assessment

### Current Confidence: **95%** (after deep investigation)

**Verified:**
- ✅ Complete field mapping traced through code
- ✅ Null/undefined handling confirmed (`nullToUndefined()` helper)
- ✅ Dependencies serialization verified (JSON.stringify/parse)
- ✅ Trade partners use junction table pattern (correct)
- ✅ WASM serde annotations match TypeScript exactly
- ✅ Existing test patterns are reusable

**Remaining Risks (Minor):**
- No existing round-trip tests (gap to fill)
- Edge cases need explicit testing

### With Phase 3.1 + 3.2: **98%**

**After implementing core tests:**
- All field mappings verified with tests
- Edge cases covered
- Regression protection in place

---

## Technical Notes

### Test Environment Requirements

1. **Persistence Tests**: Need Tauri SQL plugin mock (existing pattern in `persistence.test.ts`)
2. **WASM Tests**: Need WASM module mock or actual WASM in test environment
3. **Reference Project**: Use existing `tests/fixtures/reference_project.json`

### Shared Assertion Utilities

```typescript
// tests/helpers/taskAssertions.ts
export function assertTaskInputFieldsEqual(
  expected: Task,
  actual: Task,
  options?: { strict?: boolean }
): void {
  // Input fields that should be preserved
  expect(actual.id).toBe(expected.id);
  expect(actual.name).toBe(expected.name);
  expect(actual.duration).toBe(expected.duration);
  expect(actual.parentId).toBe(expected.parentId);
  expect(actual.sortKey).toBe(expected.sortKey);
  expect(actual.rowType ?? 'task').toBe(expected.rowType ?? 'task');
  expect(actual.constraintType).toBe(expected.constraintType);
  expect(actual.constraintDate).toBe(expected.constraintDate);
  expect(actual.schedulingMode ?? 'Auto').toBe(expected.schedulingMode ?? 'Auto');
  expect(actual.progress).toBe(expected.progress);
  expect(actual.notes).toBe(expected.notes);
  
  // Dependencies (deep comparison)
  expect(actual.dependencies).toHaveLength(expected.dependencies.length);
  for (let i = 0; i < expected.dependencies.length; i++) {
    expect(actual.dependencies[i].id).toBe(expected.dependencies[i].id);
    expect(actual.dependencies[i].type).toBe(expected.dependencies[i].type);
    expect(actual.dependencies[i].lag).toBe(expected.dependencies[i].lag);
  }
}
```

---

## Conclusion

**Phase 3 is well-defined and ready for implementation.**

The audit reveals that:
1. No direct TypeScript ↔ Rust serialization exists (backend is minimal)
2. The real serialization boundaries are SQLite and WASM
3. Existing tests cover individual components but not round-trips
4. The highest priority is persistence round-trip testing

**Recommended Next Steps:**
1. Create `tests/helpers/taskAssertions.ts` (shared utilities)
2. Implement `tests/integration/TypeSafetyRoundTrip.test.ts` (Phase 3.1)
3. Implement `tests/integration/WASMRoundTrip.test.ts` (Phase 3.2)

**Estimated Total Effort:** 4-5 hours

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Status:** 🔍 Audit Complete
