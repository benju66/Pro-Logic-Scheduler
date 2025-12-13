# Tests Directory

This directory contains test files for the Pro Logic Scheduler application.

## Structure

```
tests/
├── unit/           # Unit tests for individual modules
├── integration/    # Integration tests for module interactions
└── e2e/           # End-to-end tests for full workflows
```

## Testing Strategy

### Unit Tests
- Test individual modules in isolation
- Mock dependencies
- Focus on pure logic (core/, data/)

### Integration Tests
- Test module interactions
- Verify data flow between layers
- Test service orchestration

### E2E Tests
- Test full user workflows
- Verify UI interactions
- Test file operations

## Setup

Tests will use Vitest (compatible with Vite).

```bash
npm install -D vitest @vitest/ui
```

## Running Tests

```bash
npm test              # Run all tests
npm test:unit         # Run unit tests only
npm test:integration  # Run integration tests only
npm test:e2e          # Run E2E tests only
npm test:watch        # Watch mode
```

## Example Test

```javascript
import { describe, it, expect } from 'vitest';
import { DateUtils } from '../src/core/DateUtils.js';

describe('DateUtils', () => {
    it('should calculate working days correctly', () => {
        const start = '2024-01-01';
        const end = '2024-01-05';
        const days = DateUtils.calcWorkDays(start, end);
        expect(days).toBeGreaterThan(0);
    });
});
```

