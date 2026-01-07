# Coding Guidelines

## Dependency Injection

### The Golden Rule

> **All dependencies should be passed via constructor parameters.**

```typescript
// ✅ CORRECT
class MyService {
    constructor(
        private projectController: ProjectController,
        private selectionModel: SelectionModel
    ) {}
}

// ❌ INCORRECT - Do not add new getInstance() calls
class MyService {
    doSomething(): void {
        const controller = ProjectController.getInstance(); // ❌ Deprecated
    }
}
```

### Creating New Services

When creating a new service or class:

1. **Identify dependencies** - What other services does it need?
2. **Add to constructor** - Accept dependencies as constructor parameters
3. **Wire in main.ts** - Create and inject in the Composition Root

```typescript
// 1. Define service with constructor injection
class NewFeatureService {
    constructor(
        private projectController: ProjectController,
        private commandService: CommandService
    ) {}
    
    doFeature(): void {
        // Use injected dependencies
        const tasks = this.projectController.tasks$.value;
        this.commandService.execute('some.command');
    }
}

// 2. Wire in main.ts (Composition Root)
const newFeatureService = new NewFeatureService(
    projectController,
    commandService
);
```

### Deprecated Patterns

The following patterns are **deprecated** and show warnings in your IDE:

| Pattern | Status | Use Instead |
|---------|--------|-------------|
| `X.getInstance()` | ⚠️ Deprecated | Constructor injection |
| `X.setInstance()` | ⚠️ Deprecated | Constructor injection with mock |
| `X.resetInstance()` | ⚠️ Deprecated | Create new instance |
| `getEditingStateManager()` | ⚠️ Deprecated | Constructor injection |
| `getClipboardManager()` | ⚠️ Deprecated | Constructor injection |
| `getTradePartnerStore()` | ⚠️ Deprecated | Constructor injection |

### When You See Deprecated Methods

If you're modifying code that uses `getInstance()`:

1. **New code** - Use constructor injection instead
2. **Existing code** - Consider refactoring if touching that area
3. **Quick fix** - Leaving as-is is acceptable for small changes

### Testing

#### Preferred: Constructor Injection

```typescript
describe('MyService', () => {
    it('should do something', () => {
        // Create mocks
        const mockController = {
            tasks$: { value: [] }
        } as unknown as ProjectController;
        
        // Inject via constructor
        const service = new MyService(mockController, mockCommandService);
        
        // Test
        service.doSomething();
        expect(/* ... */);
    });
});
```

#### Legacy: setInstance() (Still Supported)

```typescript
describe('LegacyCode', () => {
    afterEach(() => {
        ProjectController.resetInstance();
    });
    
    it('should work', () => {
        ProjectController.setInstance(mockController);
        // ... test code that uses getInstance() internally
    });
});
```

---

## Code Organization

### File Structure

```
src/
├── commands/           # Command pattern implementations
├── core/              # Core utilities and column system
├── data/              # Data layer (persistence, loading)
├── services/          # Application services
├── ui/                # UI components and renderers
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── main.ts            # Composition Root - ALL wiring here
```

### Composition Root (main.ts)

The `main.ts` file is the **single location** where services are created and wired:

```typescript
// main.ts - Composition Root
// Level 0: Leaf services (no dependencies)
const featureFlags = new FeatureFlags();
const selectionModel = new SelectionModel();

// Level 1: Services with dependencies
const projectController = new ProjectController();
const commandService = new CommandService();

// Level 2: Higher-level services
const scheduler = new SchedulerService({
    projectController,
    selectionModel,
    commandService
});
```

---

## TypeScript Conventions

### Strict Mode

We use TypeScript strict mode. All types must be explicit:

```typescript
// ✅ CORRECT
function processTask(task: Task): ProcessedTask {
    return { ...task, processed: true };
}

// ❌ INCORRECT - Implicit any
function processTask(task) {
    return { ...task, processed: true };
}
```

### Interfaces for Dependencies

Define interfaces for services when needed for testing:

```typescript
// Define interface
interface IProjectController {
    tasks$: BehaviorSubject<Task[]>;
    getTask(id: string): Task | undefined;
}

// Implement
class ProjectController implements IProjectController {
    // ...
}

// Easy to mock
const mock: IProjectController = {
    tasks$: new BehaviorSubject([]),
    getTask: vi.fn()
};
```

---

## Related Documentation

- [Master Specification](../master_spec.md) - System specification
- [Architecture Guide](architecture/ARCHITECTURE.md) - System architecture
- [ADR-001: Dependency Injection](adr/001-dependency-injection.md) - Architecture decision
- [DI Implementation Plan](TRUE_PURE_DI_IMPLEMENTATION_PLAN.md) - Migration details
