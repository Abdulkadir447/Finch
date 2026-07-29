# Coding Standards

This document defines the coding standards and conventions that must be followed for all code in the Finch project.

## Table of Contents
1. [General Principles](#general-principles)
2. [TypeScript/JavaScript Standards](#typescriptjavascript-standards)
3. [Python Standards](#python-standards)
4. [React Standards](#react-standards)
5. [Electron Standards](#electron-standards)
6. [Naming Conventions](#naming-conventions)
7. [Code Organization](#code-organization)
8. [Testing Standards](#testing-standards)
9. [Security Standards](#security-standards)

## General Principles

### KISS (Keep It Simple, Stupid)
- Prefer simple solutions over complex ones
- Avoid premature optimization
- Write code that is easy to understand

### DRY (Don't Repeat Yourself)
- Extract repeated logic into shared functions or utilities
- Avoid copy-paste implementation
- Introduce abstractions when repetition is real

### YAGNI (You Aren't Gonna Need It)
- Do not build features before they are needed
- Avoid speculative generality
- Start simple, then refactor when pressure is real

### Immutability
- ALWAYS create new objects, NEVER mutate existing ones
- Use immutable data structures when possible
- Prefer pure functions without side effects

### Error Handling
- ALWAYS handle errors comprehensively
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

### Input Validation
- ALWAYS validate at system boundaries
- Use schema-based validation where available
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

## TypeScript/JavaScript Standards

### Types and Interfaces
- Use types to make public APIs, shared models, and component props explicit
- Let TypeScript infer obvious local variable types
- Extract repeated inline object shapes into named types or interfaces
- Avoid `any` type - use `unknown` for external/untrusted input
- Use generics when a value's type depends on the caller

### Immutability (CRITICAL)
```typescript
// WRONG: Mutation
function updateUser(user: User, name: string): User {
  user.name = name // MUTATION!
  return user
}

// CORRECT: Immutability
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name
  }
}
```

### Error Handling
```typescript
// WRONG: Unhandled error
function riskyOperation(): string {
  throw new Error('Something went wrong')
}

// CORRECT: Proper error handling
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected error'
}

async function loadUser(): Promise<User> {
  try {
    const result = await riskyOperation()
    return result
  } catch (error: unknown) {
    // Log error with context
    logger.error('Failed to load user', error)
    throw new Error(getErrorMessage(error))
  }
}
```

### Input Validation
- Use Zod for schema-based validation
```typescript
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

type UserInput = z.infer<typeof userSchema>

const validated: UserInput = userSchema.parse(input)
```

### Hooks Discipline
- Custom hooks must start with `use`
- Group all hook calls at the top of the component
- Avoid creating ad-hoc hooks for one-line wrappers
- Use `useMemo` and `useCallback` only when necessary

## Python Standards

### Type Annotations
- Use type annotations on all function signatures
- Use `dataclasses` for data transfer objects
- Avoid `Any` type - use specific types
- Use protocols for duck typing

### Formatting
- Use `black` for code formatting (line length 100)
- Use `isort` for import sorting
- Use `ruff` for linting

### Immutability
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str

# Immutable update
def update_user(user: User, name: str) -> User:
    return User(name=name, email=user.email)
```

### Error Handling
- Use `try`/`except` with specific exceptions
- Use custom exception classes for domain-specific errors
- Log errors with context before re-raising

## React Standards

### Component Shape
```typescript
// Prefer functional components with explicit prop types
interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

export function UserCard({ user, onSelect }: UserCardProps) {
  return (
    <button onClick={() => onSelect(user.id)}>
      {user.name}
    </button>
  )
}
```

### JSX Best Practices
- Self-close tags with no components
- Use fragments `<>...</>` over wrapper `<div>` when no DOM element needed
- Conditional rendering: `{condition && <Foo />}` for booleans
- Extract complex JSX expressions to variables above return

### State Management
- Local first (`useState`), lift only when shared
- Context for cross-cutting state (theme, auth, i18n)
- External store (Zustand) for state that persists across route changes
- Never duplicate state that can be derived

### Forms
- Uncontrolled inputs with form actions when form has clear submit step
- Controlled inputs when value drives other UI or requires real-time validation
- Use React Hook Form for complex forms

## Electron Standards

### Main Process
- Keep main process minimal
- Use preload scripts for IPC communication
- Avoid blocking operations in main process
- Use `webPreferences` with security settings:
  ```javascript
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
  }
  ```

### Preload Scripts
- Expose only necessary APIs to renderer process
- Use context bridge for secure communication
- Validate all inputs from renderer process

### Renderer Process
- Never require Node.js modules directly
- Use IPC for main process communication
- Handle unhandled promise rejections

## Naming Conventions

### Files and Directories
- Use lowercase kebab-case for files and directories
- Examples: `order-service.ts`, `user-profile.component.tsx`
- Component files: PascalCase (`UserProfile.tsx`)
- Hook files: camelCase with `use` prefix (`useAuth.ts`)
- Utility files: camelCase (`formatCurrency.ts`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`)

### Variables and Functions
- Variables and functions: `camelCase`
- Booleans: prefer `is`, `has`, `should`, or `can` prefixes
- Classes, interfaces, types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Enums: PascalCase for enum name, UPPER_SNAKE_CASE for values

### Database
- Tables: plural, lowercase, snake_case (`users`, `orders`)
- Columns: lowercase snake_case (`created_at`, `user_id`)
- Foreign keys: always end with `_id` (`user_id`, `order_id`)
- Primary keys: `id` (UUID preferred, Auto-increment acceptable temporarily)

## Code Organization

### File Layout per Component
```
components/UserCard/
  UserCard.tsx
  UserCard.module.css   # or styled-components, or Tailwind classes inline
  UserCard.test.tsx
  index.ts              # re-export only
```

### Import Order
1. React imports first: `import { useState } from "react"`
2. Then third-party libraries
3. Then absolute project imports
4. Then relative imports
5. Type-only imports: `import type { ReactNode } from "react"`

### Module Boundaries
- Each module should have a single, well-defined purpose
- Modules communicate through well-defined interfaces
- Avoid circular dependencies
- Use dependency injection for loose coupling

## Testing Standards

### Unit Tests
- Follow Arrange-Act-Assert (AAA) pattern
- Test one thing per test
- Use descriptive test names
```typescript
test('returns empty array when no markets match query', () => {})
test('throws error when API key is missing', () => {})
test('falls back to substring search when Redis is unavailable', () => {})
```

### Mocking
- Mock external dependencies (APIs, databases, file system)
- Use Jest mocking utilities for frontend
- Use unittest.mock for backend Python
- Verify mocks were called as expected

### Coverage
- Minimum 80% code coverage for all modules
- Test critical paths and edge cases
- Test error conditions and error handling

## Security Standards

### Secret Management
- NEVER hardcode secrets in source code
- ALWAYS use environment variables or secret managers
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

### XSS Prevention
- Never inject unsanitized HTML
- Avoid `dangerouslySetInnerHTML` unless sanitized first
- Escape dynamic template values
- Sanitize user HTML with a vetted local sanitizer when absolutely necessary

### Secret Exposure via Environment Variables
- Prefixed env vars are bundled into client (VITE_*, NEXT_PUBLIC_*, etc.)
- Treat prefixed vars as public - do not store secrets in them
- Audit env vars on every PR that touches them

## Enforcement

These standards are enforced through:
- ESLint and TypeScript checking (pre-commit and CI)
- Prettier formatting (pre-commit and CI)
- Code reviews (mandatory for all changes)
- Automated testing (CI pipeline)
- Security scanning (CI pipeline)

Violations of these standards will block merge until resolved.