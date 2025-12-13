# Optimization Path - Recommended Implementation Order

## Phase 1: Foundation (30-45 minutes) ✅

### 1. jsconfig.json (5 min)
**Priority:** HIGH - Immediate IDE improvements
- Create `jsconfig.json` for better type checking
- Enables project-wide type inference
- Improves autocomplete and error detection

**Dependencies:** None
**Risk:** None

### 2. Constants.js (20-30 min)
**Priority:** HIGH - Reduces magic strings
- Create `src/core/Constants.js`
- Extract: LINK_TYPES, CONSTRAINT_TYPES
- Update 7 files with imports
- Found 85 magic string matches across codebase

**Dependencies:** None
**Risk:** Low - Just refactoring constants

### 3. Unit Tests Setup + CPM.js + DateUtils.js (30-45 min)
**Priority:** HIGH - Foundation for testing
- Install Vitest: `npm install -D vitest @vitest/ui`
- Add test scripts to package.json
- Create `tests/unit/CPM.test.js`
- Create `tests/unit/DateUtils.test.js`
- Focus on critical paths first

**Dependencies:** None
**Risk:** Low - Pure functions, easy to test

### 4. Clean Up Migration Docs (10 min)
**Priority:** MEDIUM - Documentation hygiene
- Move/archive `docs/migration/*.md` to `docs/archive/`
- Update references to SchedulerEngine
- Remove outdated migration status

**Dependencies:** None
**Risk:** None

**Total Phase 1 Time:** 65-130 minutes (1-2 hours)

---

## Phase 2: Testing Expansion (1-2 hours) ⏳

### 5. Integration Tests (1-2 hours)
**Priority:** MEDIUM - After unit tests proven
- Test TaskStore + HistoryManager interaction
- Test SchedulerService orchestration
- Test data flow between layers
- Verify service dependencies

**Dependencies:** Unit tests working
**Risk:** Medium - More complex setup

---

## Implementation Notes

### jsconfig.json Structure
```json
{
  "compilerOptions": {
    "checkJs": true,
    "module": "ES2020",
    "target": "ES2020",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.js"],
  "exclude": ["node_modules", "dist", "src-tauri"]
}
```

### Constants.js Structure
```javascript
// src/core/Constants.js
export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
export const CONSTRAINT_TYPES = ['asap', 'snet', 'snlt', 'fnet', 'fnlt', 'mfo'];
```

### Test Setup
- Use Vitest (Vite-compatible)
- Test pure functions first (CPM, DateUtils)
- Mock dependencies for integration tests
- Focus on edge cases and error handling

---

## Success Criteria

- ✅ jsconfig.json improves IDE experience
- ✅ Constants.js eliminates magic strings
- ✅ Unit tests cover CPM.js and DateUtils.js critical paths
- ✅ Migration docs cleaned up
- ✅ Integration tests verify service interactions

---

## Next Steps After Phase 1

1. Add more unit tests (TaskStore, CalendarStore)
2. Add error handling tests
3. Performance benchmarks
4. E2E tests for critical workflows

