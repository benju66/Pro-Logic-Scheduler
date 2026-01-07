# ADR-001: Dependency Injection Pattern

## Status

**Accepted** - January 7, 2026

## Context

Pro Logic Scheduler is a professional construction scheduling application built with TypeScript, Vite, and Tauri. As the application grew, we needed a strategy for:

1. **Testability** - Unit tests need to mock dependencies
2. **Maintainability** - Dependencies should be explicit, not hidden
3. **Scalability** - Adding new services should follow a clear pattern
4. **Team Onboarding** - New developers should understand the architecture quickly

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Pure DI (Constructor Injection)** | No dependencies, explicit, fast compilation | Manual wiring, composition root grows |
| **DI Container (TSyringe/InversifyJS)** | Automatic injection, industry standard | External dependency, decorators, magic |
| **Service Locator Pattern** | Simple to implement | Hidden dependencies, hard to test |

## Decision

We chose **Pure DI with Constructor Injection** (also known as "Poor Man's DI" or "Vanilla DI").

### Key Principles

1. **Single Composition Root** - All services are created and wired in `src/main.ts`
2. **Constructor Injection** - Dependencies are passed via constructor parameters
3. **Explicit Dependencies** - Every class declares what it needs
4. **No Service Locator** - Avoid `getInstance()` calls in new code

### Architecture

```
src/main.ts (Composition Root)
├── Creates all service instances
├── Wires dependencies via constructors
├── Passes services to AppInitializer
└── AppInitializer orchestrates initialization sequence

Services receive dependencies via constructor:
├── ProjectController
├── SelectionModel
├── CommandService
├── SchedulerService
└── ... (all 12+ services)
```

## Legacy Singleton Pattern

### Historical Context

The codebase originally used the Singleton pattern with `getInstance()` methods. During the Pure DI migration (January 2026), we:

1. Added `setInstance()` methods for testing/DI compatibility
2. Moved service creation to `main.ts` Composition Root
3. Kept `getInstance()` as fallbacks for backward compatibility

### Deprecated Methods

The following methods are **deprecated** and should not be used in new code:

| Method | Purpose | Use Instead |
|--------|---------|-------------|
| `getInstance()` | Get singleton instance | Constructor injection |
| `setInstance()` | Set instance for testing | Constructor injection with mock |
| `resetInstance()` | Reset for test isolation | Create new instance in test |

### Why They Still Exist

1. **Backward Compatibility** - Existing code continues to work
2. **Test Utilities** - `setInstance()` enables mock injection in tests
3. **Gradual Migration** - Allows incremental removal over time

## Preferred Patterns

### ✅ DO: Constructor Injection

```typescript
class TaskEditor {
    constructor(
        private projectController: ProjectController,
        private selectionModel: SelectionModel
    ) {}
    
    editTask(taskId: string): void {
        const task = this.projectController.getTask(taskId);
        // ...
    }
}

// In main.ts or test:
const editor = new TaskEditor(projectController, selectionModel);
```

### ✅ DO: Optional Dependencies with Defaults

```typescript
class GridRenderer {
    private controller: ProjectController;
    
    constructor(options: GridOptions, controller?: ProjectController) {
        // Fallback only for backward compatibility - prefer explicit injection
        this.controller = controller || ProjectController.getInstance();
    }
}
```

### ❌ AVOID: Direct Singleton Access

```typescript
// BAD - Hidden dependency
class TaskEditor {
    editTask(taskId: string): void {
        const controller = ProjectController.getInstance(); // ❌ Avoid
        const task = controller.getTask(taskId);
    }
}
```

### ❌ AVOID: Service Locator in New Code

```typescript
// BAD - Don't add new getInstance() calls
function processTask(taskId: string): void {
    const controller = ProjectController.getInstance(); // ❌ Avoid
    // ...
}
```

## Testing

### With Pure DI (Preferred)

```typescript
describe('TaskEditor', () => {
    it('should edit task', () => {
        // Create mock
        const mockController = {
            getTask: vi.fn().mockReturnValue({ id: '1', name: 'Test' })
        } as unknown as ProjectController;
        
        // Inject via constructor
        const editor = new TaskEditor(mockController, mockSelectionModel);
        
        editor.editTask('1');
        
        expect(mockController.getTask).toHaveBeenCalledWith('1');
    });
});
```

### With setInstance() (Legacy Support)

```typescript
describe('LegacyComponent', () => {
    afterEach(() => {
        ProjectController.resetInstance();
    });
    
    it('should work with injected mock', () => {
        const mock = createMockProjectController();
        ProjectController.setInstance(mock);
        
        // Component uses getInstance() internally
        const component = new LegacyComponent();
        // ...
    });
});
```

## Consequences

### Positive

- **Explicit Dependencies** - Constructor signature shows all requirements
- **Testable** - Easy to inject mocks without global state
- **Type Safe** - TypeScript catches missing dependencies at compile time
- **No External Dependencies** - No DI framework needed
- **IDE Support** - Deprecation warnings guide developers

### Negative

- **Manual Wiring** - Composition Root requires explicit setup
- **Boilerplate** - Constructor parameters for each dependency
- **Migration Incomplete** - Legacy `getInstance()` calls still exist

### Neutral

- **Learning Curve** - Developers must understand DI pattern
- **Fallback Pattern** - `|| getInstance()` provides backward compatibility

## Related Documents

- `master_spec.md` - Master system specification
- `docs/architecture/ARCHITECTURE.md` - System architecture guide
- `docs/CODING_GUIDELINES.md` - Developer guidelines
- `docs/TRUE_PURE_DI_IMPLEMENTATION_PLAN.md` - Migration implementation details
- `docs/DEPENDENCY_INJECTION_MIGRATION_PLAN.md` - Original migration plan

## References

- [Dependency Injection Principles, Practices, and Patterns](https://www.manning.com/books/dependency-injection-principles-practices-patterns) by Mark Seemann
- [Pure DI](https://blog.ploeh.dk/2014/06/10/pure-di/) - Mark Seemann's blog
- [VS Code Architecture](https://github.com/microsoft/vscode) - Example of Pure DI in large TypeScript app
