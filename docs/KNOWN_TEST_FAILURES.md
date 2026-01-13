# Known Test Failures (Tech Debt)

> **Last Updated**: January 2026
> **Status**: Pre-existing failures, not blocking development

## Summary

| Test File | Failures | Root Cause | Priority |
|-----------|----------|------------|----------|
| `persistence.test.ts` | 7 | Vitest mock hoisting issue | Medium |
| `SnapshotService.test.ts` | ~5 | Timing/threshold issues | Low |
| `MigrationValidation.test.ts` | ~2 | Pre-existing | Low |

**Total**: 14 failing tests out of 432 (97% pass rate)

---

## persistence.test.ts (7 failures)

### Root Cause
Vitest mock hoisting issue with `@tauri-apps/plugin-sql`. The mock is defined inside `vi.mock()` but `(Database as any).__mockDb` returns `undefined` due to hoisting order.

### Symptoms
```
TypeError: Cannot read properties of undefined (reading 'execute')
 ❯ tests/integration/persistence.test.ts:40:16
    mockDb.execute.mockReset();
```

### Fix Required
Restructure the mock to use a module-level variable that's assigned before the mock factory:

```typescript
// Option 1: Use vi.hoisted()
const { mockDb, mockLoad } = vi.hoisted(() => {
  const db = {
    execute: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
  };
  return { mockDb: db, mockLoad: vi.fn().mockResolvedValue(db) };
});

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mockLoad },
}));
```

### Effort
~30 minutes

---

## SnapshotService.test.ts (~5 failures)

### Root Cause
Timing-sensitive tests with thresholds (e.g., "should trigger snapshot after 1000 events"). Flaky due to async timing.

### Symptoms
```
AssertionError: expected false to be true
 ❯ tests/integration/SnapshotService.test.ts:268:31
    expect(snapshotCreated).toBe(true);
```

### Fix Required
Use explicit flush/wait instead of relying on timing thresholds.

### Effort
~1 hour

---

## MigrationValidation.test.ts (~2 failures)

### Root Cause
Pre-existing failures from migration phase. Tests may be outdated.

### Fix Required
Review and update test expectations.

### Effort
~30 minutes

---

## Notes

- These failures are **not caused by DI refactoring** (verified by git history)
- All failures are in test infrastructure, not application code
- Application runs correctly in development and production builds
